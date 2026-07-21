/**
 * lib/services/system-pages.ts · Phase B.7a (2026-05-22 ·
 * legacy-modernizer REST→tRPC system-pages slice · sub-slice A).
 *
 * The shared services the `app/(mastery)/system/*` page surfaces (first
 * ~13 files) delegate to. Each function was inline in its REST route
 * handler (no shared module) until this slice; the logic is lifted here
 * byte-for-byte so the legacy `/api/system/*` route AND the new
 * `system.*` tRPC procedure call the SAME function · drift between the
 * two transports structurally impossible.
 *
 * Every function returns an explicit, shallow interface. Several read
 * Prisma rows whose models carry `Json` columns (AutonomousAction
 * `payload` · BrainBusEvent `payload` · cron logs); the interfaces type
 * those columns `unknown` so Prisma's recursive `JsonValue` machinery
 * never leaks into the `AppRouter` type — the TS2589 firewall the
 * migration roadmap mandates (the `system` router is already the
 * largest, near TypeScript's instantiation-depth ceiling).
 *
 * Routes covered:
 *   buildDiagnostics        ← app/api/system/diagnostics/route.ts
 *   buildSystemHealth       ← app/api/health/route.ts
 *   buildAutonomousActionsFeed ← app/api/system/actions/route.ts
 *   buildAgentTracesFeed    ← app/api/system/agent-traces/route.ts
 *   buildAgentTraceDetail   ← app/api/system/agent-traces/[traceId]/route.ts
 *   buildChatHealth         ← app/api/system/chat-health/route.ts
 *   buildSystemCosts        ← app/api/system/costs/route.ts
 *   buildCronRunHistory     ← app/api/system/cron-runs/[jobName]/route.ts
 *   buildCronCommandDeck    ← app/api/system/crons/route.ts
 *   buildDeploymentTruth    ← app/api/system/deployment-truth/route.ts
 *   buildDeviceFleet        ← app/api/system/devices/route.ts
 *
 * (brain-bus-events keeps using the pre-existing `tailEvents` service;
 * the cron run + toggle mutations keep using `cron-control`; the
 * approvals surface keeps using `approval-queue` — all already shared.)
 */

import { prisma, checkDbConnection } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { getKpiSummary } from "@/lib/services/metrics";
import {
  listRecentTraceChains,
  getTraceChain,
  type TraceSource,
} from "@/lib/ai/agent-trace";
import {
  extractEnvelope,
  type ExplanationEnvelope,
} from "@/lib/automation/envelope";
import { ServiceError } from "@/lib/utils/service-error";
import { safeQuery } from "@/lib/db/safe-prisma";
import { getBlockedTools } from "@/lib/ai/tool-telemetry";
import { getCacheStats } from "@/lib/ai/system-prompt-cache";
import {
  getModelLatencyStats,
  getModelLatencyTrend,
  getAiUsageStats,
} from "@/lib/ai/track";
import { getProviderHealth } from "@/lib/ai/provider-health";
import { checkBudget } from "@/lib/ai/budget";
import { runSchemaDriftCheck } from "@/lib/db/schema-sentinel";
import { CRONS } from "@/config/crons";
import { isInngestFullyConfigured } from "@/lib/inngest/client";
import { MEGA_JOB_COUNTS } from "@/lib/inngest/jobs";
import { braintrustWrapStatus } from "@/lib/ai/braintrust-wrap";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { listCronControls, getCronStats } from "@/lib/services/cron-control";
import {
  measure,
  deriveHealthHeadline,
  type MetricResult,
} from "@/lib/services/metric-result";
import { getDeployMeta } from "@/lib/services/deploy-identity";

// ════════════════════════ /system · diagnostics ════════════════════════

/** The /system landing-page diagnostics rollup. Shallow — every nested
 *  object is plain scalars (no Prisma Json reaches the procedure). */
export interface DiagnosticsView {
  db: { connected: boolean; latency_ms: number };
  kpis: Record<string, unknown>;
  // truth-substrate audit P0 (2026-07-21 · finding #7). Removed customers/leads/
  // jobs — statenour has NO Customer/Lead/Job model (they are nickstire concepts),
  // so a real count can't exist; they were hardcoded Promise.resolve(0) that
  // rendered as if measured. Every remaining field is a real prisma count.
  models: {
    missions: number;
    tasks: number;
    devices: number;
    deviceEvents: number;
    chatMessages: number;
    aiGenerations: number;
    systemMetrics: number;
    brainMemories: number;
    automationRules: number;
  };
  devices: { online: number; offline: number; error: number; total: number };
  integrations: Array<{
    name: string;
    status: string;
    enabled: boolean;
    lastSync: string | null;
  }>;
  // NOTE: the `queue` field was removed here (audit #7) — statenour has no
  // job-queue subsystem, so pending/failed were hardcoded Promise.resolve(0).
  version: string;
  timestamp: string;
}

/** Composite system diagnostics — DB health + KPIs + row counts +
 *  device rollup + integrations. Lifted verbatim from
 *  app/api/system/diagnostics/route.ts. */
export async function buildDiagnostics(): Promise<DiagnosticsView> {
  const [db, kpis, modelCounts, deviceCounts, integrations] =
    await Promise.all([
      checkDbConnection(),
      getKpiSummary(),
      Promise.all([
        // modelCounts = PHYSICAL table census (tombstones included on
        // purpose — see ALLOWLIST in scripts/audit-soft-delete-filters.ts;
        // rows must stay comparable with models that have no deletedAt).
        // Every entry is a REAL count — the former Promise.resolve(0)
        // placeholders for customers/leads/jobs were removed (audit #7).
        prisma.mission.count(),
        prisma.task.count(),
        prisma.smartDevice.count(),
        prisma.deviceEvent.count(),
        prisma.chatMessage.count(),
        prisma.aiGeneration.count(),
        prisma.systemMetric.count(),
        prisma.brainMemory.count(), // modelCounts census (see comment above)
        prisma.automationRule.count(),
      ]).then(
        ([
          missions,
          tasks,
          devices,
          deviceEvents,
          chatMessages,
          aiGenerations,
          systemMetrics,
          brainMemories,
          automationRules,
        ]) => ({
          missions,
          tasks,
          devices,
          deviceEvents,
          chatMessages,
          aiGenerations,
          systemMetrics,
          brainMemories,
          automationRules,
        }),
      ),
      prisma.smartDevice.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      prisma.integration.findMany({
        select: { name: true, status: true, lastSyncAt: true, enabled: true },
      }),
    ]);

  const devices = { online: 0, offline: 0, error: 0, total: 0 };
  for (const g of deviceCounts) {
    devices.total += g._count.id;
    if (g.status === "ONLINE") devices.online = g._count.id;
    else if (g.status === "ERROR") devices.error = g._count.id;
    else devices.offline += g._count.id;
  }

  return {
    db: { connected: db.connected, latency_ms: db.latency_ms },
    kpis,
    models: modelCounts,
    devices,
    integrations: integrations.map((i) => ({
      name: i.name,
      status: i.status,
      enabled: i.enabled,
      lastSync: i.lastSyncAt?.toISOString() ?? null,
    })),
    // truth-substrate audit #11/#14: Railway-first short SHA (was Vercel-only → "local" on prod).
    version: getDeployMeta().shaShort ?? "local",
    timestamp: new Date().toISOString(),
  };
}

// ═════════════════════════════ /api/health ═════════════════════════════

/** Composite health probe shape. Plain scalars only — no Prisma Json. */
// truth-substrate audit P0 (2026-07-21 · findings #4-6). The four fields whose
// reads previously `.catch(() => 0/[]/null)` are now MetricResult<T>: a failed
// read is `unavailable` (not a fake zero), so the UI can render "unknown"
// distinctly from a real 0. `db`, `tasks`, `commitments`, `devices` stay scalar
// — their reads are UNCAUGHT (they reject the whole probe on failure = an honest
// hard error, never a false green). `status` no longer follows db connectivity
// alone; it is "healthy" only when db is up AND every metric measured ok.
export interface SystemHealthView {
  status: string;
  db: { connected: boolean; latency_ms: number };
  tasks: { inbox: number; ready: number; doing: number; done: number; total: number };
  alerts: MetricResult<{ unresolved: number }>;
  commitments: { active: number };
  devices: { online: number; offline: number; total: number };
  radar: MetricResult<{
    threads: { active: number; dormant: number; archived: number; total: number };
    pendingCandidates: number;
    pendingSuggestions: number;
  }>;
  morningBrief: MetricResult<{ ready: boolean; date: string; composedAt: string | null }>;
  inngest: {
    configured: boolean;
    functions: number;
    megaJobs: typeof MEGA_JOB_COUNTS;
  };
  braintrust: { status: ReturnType<typeof braintrustWrapStatus> };
  autonomic: MetricResult<{
    lastRunAt: string | null;
    status: string | null;
    error: string | null;
  }>;
  /** Sources of every non-ok metric — the quick "what is unknown right now" list. */
  degradedSources: string[];
}

/** Composite health probe · 30s-cached. Lifted verbatim from
 *  app/api/health/route.ts. */
export async function buildSystemHealth(): Promise<SystemHealthView> {
  return cached("health_v1", 30, async (): Promise<SystemHealthView> => {
    const today = new Date().toISOString().slice(0, 10);

    // Hard-required reads: UNCAUGHT on purpose — a failure rejects the whole
    // probe (an honest 500, never a false green). Kept scalar for consumers.
    // Soft-deleted tasks are tombstones — `where: { deletedAt: null }` keeps the
    // count aligned with the live universe (104 of 161 Task rows are tombstones).
    const hard = Promise.all([
      checkDbConnection(),
      prisma.task.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { id: true },
      }),
      prisma.commitment.count({
        where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
      }),
      prisma.smartDevice.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
    ]);

    // False-green-prone reads: each MEASURED. A failure becomes `unavailable`
    // (distinct from a real zero) instead of the old silent .catch(()=>0/[]/null),
    // so the UI can render "unknown" and the headline can reflect the failure.
    const alertsMetric = measure("alerts", async () => {
      const rows = await prisma.brainMemory.findMany({
        where: { category: "coach_event", key: { startsWith: "coach:drift-recovery:" } },
        select: { metadata: true },
      });
      const unresolved = rows.filter((r) => {
        const meta = (r.metadata ?? {}) as Record<string, any>;
        return !meta.ackedAt;
      }).length;
      return { unresolved };
    });

    const radarMetric = measure("radar", async () => {
      const [threadCounts, pendingCandidates, pendingSuggestions] = await Promise.all([
        prisma.journalThread.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { id: true } }),
        prisma.brainMemory.count({ where: { category: BRAIN_CATEGORIES.JOURNAL_CONVERGENCE_CANDIDATE, deletedAt: null } }),
        prisma.brainMemory.count({ where: { category: BRAIN_CATEGORIES.JOURNAL_THREAD_SUGGESTION, deletedAt: null } }),
      ]);
      const threads = { active: 0, dormant: 0, archived: 0, total: 0 };
      for (const g of threadCounts) {
        const count = g._count.id;
        threads.total += count;
        if (g.status === "active") threads.active = count;
        else if (g.status === "dormant") threads.dormant = count;
        else if (g.status === "archived") threads.archived = count;
      }
      return { threads, pendingCandidates, pendingSuggestions };
    });

    const morningBriefMetric = measure("morningBrief", async () => {
      const briefRow = await prisma.brainMemory.findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.MORNING_BRIEF, key: today } },
        select: { updatedAt: true },
      });
      return {
        ready: briefRow != null,
        date: today,
        composedAt: briefRow?.updatedAt?.toISOString() ?? null,
      };
    });

    const autonomicMetric = measure("autonomic", async () => {
      const healerLog = await prisma.cronJobLog.findFirst({
        where: { jobName: "cron-healer" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true, error: true },
      });
      return {
        lastRunAt: healerLog?.createdAt?.toISOString() ?? null,
        status: healerLog?.status ?? null,
        error: healerLog?.error ?? null,
      };
    });

    const [[db, taskCounts, commitmentCount, deviceCounts], alerts, radar, morningBrief, autonomic] =
      await Promise.all([hard, alertsMetric, radarMetric, morningBriefMetric, autonomicMetric]);

    const tasks = { inbox: 0, ready: 0, doing: 0, done: 0, total: 0 };
    for (const g of taskCounts) {
      const count = g._count.id;
      tasks.total += count;
      const key = g.status.toLowerCase() as keyof typeof tasks;
      if (key in tasks) tasks[key] = count;
    }

    const devices = { online: 0, offline: 0, total: 0 };
    for (const g of deviceCounts) {
      const count = g._count.id;
      devices.total += count;
      if (g.status === "ONLINE") devices.online = count;
      else devices.offline += count;
    }

    // Honest headline: healthy ONLY when the DB is up AND every measured metric
    // succeeded. A swallowed sub-read can no longer read "healthy" (audit #4).
    const { status, degradedSources } = deriveHealthHeadline(db.connected, [
      alerts,
      radar,
      morningBrief,
      autonomic,
    ]);

    return {
      status,
      db: { connected: db.connected, latency_ms: db.latency_ms },
      tasks,
      alerts,
      commitments: { active: commitmentCount },
      devices,
      radar,
      morningBrief,
      inngest: {
        configured: isInngestFullyConfigured(),
        functions: 8,
        megaJobs: MEGA_JOB_COUNTS,
      },
      braintrust: { status: braintrustWrapStatus() },
      autonomic,
      degradedSources,
    };
  });
}

// ═══════════════════════ /system/actions · feed ═══════════════════════

type Approval = "auto" | "pending" | "approved" | "rejected";

/** One autonomous-action row. `payload` is the AutonomousAction Json
 *  column — typed `unknown` so the recursive JsonValue stays out of the
 *  AppRouter (TS2589 firewall). */
export interface AutonomousActionRow {
  id: string;
  ruleName: string;
  trigger: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  approval: string;
  approvedBy: string | null;
  executedAt: string | null;
  result: string | null;
  error: string | null;
  createdAt: string;
}

export interface AutonomousActionsFeed {
  recent: AutonomousActionRow[];
  rules: Array<{
    ruleName: string;
    total: number;
    success: number;
    failed: number;
    skipped: number;
    lastFiredAt: string | null;
    successRate: number;
  }>;
  approvalBreakdown: {
    auto: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  totalInWindow: number;
  generatedAt: string;
}

function actionsWindowCutoff(win: string | undefined): Date {
  if (win === "30d") return new Date(Date.now() - 30 * 86400_000);
  if (win === "24h") return new Date(Date.now() - 24 * 3600_000);
  return new Date(Date.now() - 7 * 86400_000);
}

/** Nick's autonomous-action audit feed · grouped-by-rule leaderboard +
 *  latest 100 rows. Lifted verbatim from app/api/system/actions/route.ts. */
export async function buildAutonomousActionsFeed(opts: {
  since?: string;
  rule?: string;
  approval?: string;
}): Promise<AutonomousActionsFeed> {
  const since = actionsWindowCutoff(opts.since);
  const where = {
    createdAt: { gte: since },
    ...(opts.rule ? { ruleName: opts.rule } : {}),
    ...(opts.approval ? { approval: opts.approval as Approval } : {}),
  };

  const [recent, ruleStats, totals] = await Promise.all([
    prisma.autonomousAction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        ruleName: true,
        trigger: true,
        actionType: true,
        targetType: true,
        targetId: true,
        payload: true,
        approval: true,
        approvedBy: true,
        executedAt: true,
        result: true,
        error: true,
        createdAt: true,
      },
    }),
    prisma.autonomousAction.groupBy({
      by: ["ruleName", "result"],
      where,
      _count: { id: true },
    }),
    prisma.autonomousAction.groupBy({
      by: ["approval"],
      where,
      _count: { id: true },
    }),
  ]);

  const ruleAgg = new Map<
    string,
    {
      total: number;
      success: number;
      failed: number;
      skipped: number;
      lastFiredAt: string | null;
    }
  >();
  for (const r of ruleStats) {
    if (!ruleAgg.has(r.ruleName)) {
      ruleAgg.set(r.ruleName, {
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        lastFiredAt: null,
      });
    }
    const s = ruleAgg.get(r.ruleName)!;
    s.total += r._count.id;
    if (r.result === "success") s.success = r._count.id;
    if (r.result === "failed") s.failed = r._count.id;
    if (r.result === "skipped") s.skipped = r._count.id;
  }
  for (const row of recent) {
    const s = ruleAgg.get(row.ruleName);
    if (s && !s.lastFiredAt) s.lastFiredAt = row.createdAt.toISOString();
  }

  const rules = [...ruleAgg.entries()]
    .map(([ruleName, s]) => ({
      ruleName,
      ...s,
      successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const approvalBreakdown = {
    auto: totals.find((t) => t.approval === "auto")?._count.id ?? 0,
    pending: totals.find((t) => t.approval === "pending")?._count.id ?? 0,
    approved: totals.find((t) => t.approval === "approved")?._count.id ?? 0,
    rejected: totals.find((t) => t.approval === "rejected")?._count.id ?? 0,
  };

  return {
    recent: recent.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      executedAt: r.executedAt?.toISOString() ?? null,
    })),
    rules,
    approvalBreakdown,
    totalInWindow: recent.length,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════ /system/agent-traces ═══════════════════════

interface AgentTraceChildView {
  id: string;
  label: string;
  source: string;
  provider: string | null;
  durationMs: number | null;
  costCents: number | null;
  errorClass: string | null;
  startedAt: string;
}

interface AgentTraceChainView {
  traceId: string;
  rootLabel: string;
  rootSource: string;
  callCount: number;
  totalDurationMs: number;
  totalCostCents: number;
  hasError: boolean;
  startedAt: string;
  children: AgentTraceChildView[];
}

export interface AgentTracesFeed {
  generatedAt: string;
  filter: { limit: number; source: string | null };
  stats: {
    chainCount: number;
    totalCalls: number;
    totalCostCents: number;
    totalDurationMs: number;
    errorChains: number;
    errorRate: number;
  };
  previous: {
    chainCount: number;
    totalCalls: number;
    totalCostCents: number;
    totalDurationMs: number;
    errorChains: number;
  };
  chains: AgentTraceChainView[];
}

/** Recent agent-trace chains + roll-ups + a prior-24h baseline. Lifted
 *  verbatim from app/api/system/agent-traces/route.ts. */
export async function buildAgentTracesFeed(opts: {
  limit?: number;
  source?: TraceSource;
}): Promise<AgentTracesFeed> {
  const limit = opts.limit ?? 25;
  const source = opts.source;
  const chains = await listRecentTraceChains({ limit, source });

  const totalCalls = chains.reduce((acc, c) => acc + c.callCount, 0);
  const totalCostCents = chains.reduce((acc, c) => acc + c.totalCostCents, 0);
  const totalDurationMs = chains.reduce(
    (acc, c) => acc + c.totalDurationMs,
    0,
  );
  const errorChains = chains.filter((c) => c.hasError).length;

  const oldestVisible =
    chains.length > 0 ? chains[chains.length - 1].startedAt : new Date();
  const priorWindowMs = 24 * 3600_000;
  const priorStart = new Date(oldestVisible.getTime() - priorWindowMs);
  const priorEnd = oldestVisible;
  const priorAgg = await prisma.agentTrace.groupBy({
    by: ["traceId"],
    where: {
      createdAt: { gte: priorStart, lt: priorEnd },
      ...(source ? { source } : {}),
    },
    _count: { _all: true },
    _sum: { costCents: true, durationMs: true },
    _max: { errorClass: true },
  });
  const priorChainCount = priorAgg.length;
  const priorTotalCalls = priorAgg.reduce((s, r) => s + r._count._all, 0);
  const priorTotalCostCents = priorAgg.reduce(
    (s, r) => s + (r._sum.costCents ?? 0),
    0,
  );
  const priorTotalDurationMs = priorAgg.reduce(
    (s, r) => s + (r._sum.durationMs ?? 0),
    0,
  );
  const priorErrorChains = priorAgg.filter(
    (r) => r._max.errorClass !== null,
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    filter: { limit, source: source ?? null },
    stats: {
      chainCount: chains.length,
      totalCalls,
      totalCostCents,
      totalDurationMs,
      errorChains,
      errorRate: chains.length > 0 ? errorChains / chains.length : 0,
    },
    previous: {
      chainCount: priorChainCount,
      totalCalls: priorTotalCalls,
      totalCostCents: priorTotalCostCents,
      totalDurationMs: priorTotalDurationMs,
      errorChains: priorErrorChains,
    },
    chains: chains.map((c) => ({
      ...c,
      startedAt: c.startedAt.toISOString(),
      children: c.children.map((child) => ({
        ...child,
        startedAt: child.startedAt.toISOString(),
      })),
    })),
  };
}

interface AgentTraceRowView {
  id: string;
  label: string;
  source: string;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  costCents: number | null;
  toolCalls: number;
  errorClass: string | null;
  errorMessage: string | null;
  startedAt: string;
  envelope: ExplanationEnvelope | null;
}

export interface AgentTraceDetail {
  traceId: string;
  startedAt: string;
  rootLabel: string;
  rootSource: string;
  totalDurationMs: number;
  totalCostCents: number;
  hasError: boolean;
  consolidated: ExplanationEnvelope;
  rows: AgentTraceRowView[];
}

function dedupeBy<T>(items: T[], keyFn: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Full chain for one trace + per-row + consolidated explainability
 *  envelope. Throws ServiceError(404) for an unknown traceId. Lifted
 *  verbatim from app/api/system/agent-traces/[traceId]/route.ts. */
export async function buildAgentTraceDetail(
  traceId: string,
): Promise<AgentTraceDetail> {
  const chain = await getTraceChain(traceId);
  if (!chain) {
    throw new ServiceError(`trace "${traceId}" not found`, 404);
  }

  const rowsWithEnvelope: AgentTraceRowView[] = chain.children.map((c) => ({
    id: c.id,
    label: c.label,
    source: c.source,
    provider: c.provider,
    model: c.model,
    durationMs: c.durationMs,
    costCents: c.costCents,
    toolCalls: c.toolCalls,
    errorClass: c.errorClass,
    errorMessage: c.errorMessage,
    startedAt: c.startedAt.toISOString(),
    envelope: extractEnvelope(c.metadata),
  }));

  const consolidated: ExplanationEnvelope = {
    version: 1,
    policyId:
      rowsWithEnvelope.find((r) => r.envelope?.policyId != null)?.envelope
        ?.policyId ?? null,
    memoriesUsed: dedupeBy(
      rowsWithEnvelope.flatMap((r) => r.envelope?.memoriesUsed ?? []),
      (m) => m.id,
    ),
    factsAssumed: [
      ...new Set(
        rowsWithEnvelope.flatMap((r) => r.envelope?.factsAssumed ?? []),
      ),
    ],
    toolsCalled: rowsWithEnvelope.flatMap(
      (r) => r.envelope?.toolsCalled ?? [],
    ),
    reason:
      rowsWithEnvelope
        .map((r) => r.envelope?.reason)
        .filter((x): x is string => !!x)
        .join(" · ") || null,
  };

  return {
    traceId: chain.traceId,
    startedAt: chain.startedAt.toISOString(),
    rootLabel: chain.rootLabel,
    rootSource: chain.rootSource,
    totalDurationMs: chain.totalDurationMs,
    totalCostCents: chain.totalCostCents,
    hasError: chain.hasError,
    consolidated,
    rows: rowsWithEnvelope,
  };
}

// ════════════════════════ /system/chat-health ════════════════════════

export interface ChatHealthView {
  window: { hours: number; since: string };
  latency: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    requests24h: number;
  };
  cost: {
    totalCents24h: number;
    totalCents7d: number;
    avgPerTurnCents: number;
  };
  volume: { total: number; errors: number; errorRate: number };
  quality: {
    assistantTurns: number;
    regenSuggested: number;
    regenRate: number;
    avgQuality: number;
  };
  topErrors: Array<{ message: string; count: number; lastSeen: string | null }>;
  toolHealth: Array<{
    tool: string;
    calls: number;
    successRate: number;
    avgMs: number;
    failCount: number;
    lastCallAt: number | null;
    recentErrors: Array<{ message: string; at: number }>;
  }>;
  problemTools: Array<{
    tool: string;
    calls: number;
    successRate: number;
    avgMs: number;
    failCount: number;
    lastCallAt: number | null;
    recentErrors: Array<{ message: string; at: number }>;
  }>;
  providerMix: Array<{ model: string; count: number }>;
  blockedTools: ReturnType<typeof getBlockedTools>;
  promptCache: ReturnType<typeof getCacheStats>;
  generatedAt: string;
}

/** Chat-route operator rollup — latency, cost, volume, error rate,
 *  quality, tool health, provider mix. Lifted verbatim from
 *  app/api/system/chat-health/route.ts. */
export async function buildChatHealth(): Promise<ChatHealthView> {
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const since7d = new Date(Date.now() - 7 * 86400_000);

  const [
    chatLatency,
    chatCost,
    chatVolume,
    topErrors,
    toolHealth,
    qualityRows,
    providerMix,
  ] = await Promise.all([
    safeQuery(
      async () => {
        const rows = await prisma.$queryRaw<
          Array<{
            p50_ms: number | null;
            p95_ms: number | null;
            p99_ms: number | null;
            avg_ms: number | null;
            n: bigint;
          }>
        >`
          SELECT
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms)::float8 AS p50_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p95_ms,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p99_ms,
            AVG(duration_ms)::float8 AS avg_ms,
            COUNT(*)::bigint AS n
          FROM api_request_logs
          WHERE created_at >= ${since24h}
            AND path = '/api/ai/chat'
        `;
        const r = rows[0];
        return {
          p50: Math.round(Number(r?.p50_ms ?? 0)),
          p95: Math.round(Number(r?.p95_ms ?? 0)),
          p99: Math.round(Number(r?.p99_ms ?? 0)),
          avg: Math.round(Number(r?.avg_ms ?? 0)),
          requests24h: Number(r?.n ?? 0),
        };
      },
      { p50: 0, p95: 0, p99: 0, avg: 0, requests24h: 0 },
      { label: "chat-health.latency" },
    ),
    safeQuery(
      async () => {
        const rows = await prisma.$queryRaw<
          Array<{
            cost_24h: bigint | null;
            cost_7d: bigint | null;
            n_24h: bigint;
          }>
        >`
          SELECT
            COALESCE(SUM(cost_cents) FILTER (WHERE created_at >= ${since24h}), 0)::bigint AS cost_24h,
            COALESCE(SUM(cost_cents) FILTER (WHERE created_at >= ${since7d}), 0)::bigint AS cost_7d,
            COUNT(*) FILTER (WHERE created_at >= ${since24h})::bigint AS n_24h
          FROM ai_generations
          WHERE feature = 'chat'
        `;
        const r = rows[0];
        const calls24h = Number(r?.n_24h ?? 0);
        const cents24h = Number(r?.cost_24h ?? 0);
        return {
          totalCents24h: cents24h,
          totalCents7d: Number(r?.cost_7d ?? 0),
          avgPerTurnCents: calls24h > 0 ? cents24h / calls24h : 0,
        };
      },
      { totalCents24h: 0, totalCents7d: 0, avgPerTurnCents: 0 },
      { label: "chat-health.cost" },
    ),
    safeQuery(
      async () => {
        const rows = await prisma.$queryRaw<
          Array<{ total: bigint; errors: bigint }>
        >`
          SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS errors
          FROM api_request_logs
          WHERE created_at >= ${since24h}
            AND path = '/api/ai/chat'
        `;
        const r = rows[0];
        const total = Number(r?.total ?? 0);
        const errors = Number(r?.errors ?? 0);
        return {
          total,
          errors,
          errorRate: total > 0 ? errors / total : 0,
        };
      },
      { total: 0, errors: 0, errorRate: 0 },
      { label: "chat-health.volume" },
    ),
    safeQuery(
      async () => {
        const rows = await prisma.errorLog.groupBy({
          by: ["message"],
          where: {
            createdAt: { gte: since24h },
            OR: [
              { context: { path: ["source"], equals: "chat" } },
              { stack: { contains: "ai/chat" } },
            ],
          },
          _count: { id: true },
          _max: { createdAt: true },
          orderBy: { _count: { id: "desc" } },
          take: 5,
        });
        return rows.map((e) => ({
          message: e.message,
          count: e._count.id,
          lastSeen: e._max.createdAt?.toISOString() ?? null,
        }));
      },
      [] as Array<{ message: string; count: number; lastSeen: string | null }>,
      { label: "chat-health.errors" },
    ),
    safeQuery(
      async () => {
        const rows = await prisma.toolTelemetry.findMany({
          orderBy: { lastCallAt: "desc" },
          take: 20,
          select: {
            toolName: true,
            totalCalls: true,
            successCount: true,
            failCount: true,
            totalDurationMs: true,
            lastErrors: true,
            lastCallAt: true,
          },
        });
        return rows.map((r) => {
          const durationMs = Number(r.totalDurationMs);
          const successRate =
            r.totalCalls > 0 ? r.successCount / r.totalCalls : 0;
          const avgMs =
            r.totalCalls > 0 ? Math.round(durationMs / r.totalCalls) : 0;
          const errors =
            (r.lastErrors as Array<{ message: string; at: number }> | null) ??
            [];
          return {
            tool: r.toolName,
            calls: r.totalCalls,
            successRate,
            avgMs,
            failCount: r.failCount,
            lastCallAt: r.lastCallAt ? r.lastCallAt.getTime() : null,
            recentErrors: errors.slice(0, 2),
          };
        });
      },
      [] as Array<{
        tool: string;
        calls: number;
        successRate: number;
        avgMs: number;
        failCount: number;
        lastCallAt: number | null;
        recentErrors: Array<{ message: string; at: number }>;
      }>,
      { label: "chat-health.tools" },
    ),
    safeQuery(
      async () => {
        const rows = await prisma.chatMessage.findMany({
          where: {
            createdAt: { gte: since24h },
            role: "assistant",
          },
          select: { tokenUsage: true },
          take: 200,
        });
        let total = 0;
        let regenSuggested = 0;
        let qualitySum = 0;
        for (const r of rows) {
          total++;
          const tu = r.tokenUsage as Record<string, unknown> | null;
          const quality = tu?.quality as
            | { score?: number; regen?: boolean }
            | undefined;
          if (typeof quality?.score === "number") qualitySum += quality.score;
          if (quality?.regen === true) regenSuggested++;
        }
        return {
          assistantTurns: total,
          regenSuggested,
          regenRate: total > 0 ? regenSuggested / total : 0,
          avgQuality: total > 0 ? qualitySum / total : 0,
        };
      },
      { assistantTurns: 0, regenSuggested: 0, regenRate: 0, avgQuality: 0 },
      { label: "chat-health.quality" },
    ),
    safeQuery(
      async () => {
        const rows = await prisma.aiGeneration.groupBy({
          by: ["model"],
          where: { feature: "chat", createdAt: { gte: since24h } },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        });
        return rows.map((r) => ({ model: r.model, count: r._count.id }));
      },
      [] as Array<{ model: string; count: number }>,
      { label: "chat-health.provider" },
    ),
  ]);

  return {
    window: { hours: 24, since: since24h.toISOString() },
    latency: chatLatency,
    cost: chatCost,
    volume: chatVolume,
    quality: qualityRows,
    topErrors,
    toolHealth: toolHealth.sort((a, b) => b.calls - a.calls),
    problemTools: toolHealth.filter(
      (t) => t.calls >= 5 && t.successRate < 0.7,
    ),
    providerMix,
    blockedTools: getBlockedTools(),
    promptCache: getCacheStats(),
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════ /system/costs ═══════════════════════════

const COST_IMAGE_MODELS = new Set([
  "recraft-v4",
  "z-image-turbo",
  "flux-2-pro",
  "seedream-v4",
  "nano-banana-2",
  "qwen-image",
]);

export interface SystemCostsView {
  ok: boolean;
  window: { days: number };
  buildMs: number;
  budget: Awaited<ReturnType<typeof checkBudget>>;
  health: Awaited<ReturnType<typeof getProviderHealth>>;
  usage: Awaited<ReturnType<typeof getAiUsageStats>>;
  latency: Awaited<ReturnType<typeof getModelLatencyStats>>;
  latencyTrend: Awaited<ReturnType<typeof getModelLatencyTrend>>;
  calibration: unknown;
  slowestModels: Awaited<ReturnType<typeof getModelLatencyStats>>;
  errorProneModels: Awaited<ReturnType<typeof getModelLatencyStats>>;
  toolSupport: Array<{ model: string; calls: number; supportsTools: boolean }>;
  imageVsChat: {
    imageCalls: number;
    imageCostCents: number;
    chatCalls: number;
    chatCostCents: number;
  };
}

async function getImageVsChatToday(): Promise<{
  imageCalls: number;
  imageCostCents: number;
  chatCalls: number;
  chatCostCents: number;
}> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const rows = await prisma.aiGeneration
    .groupBy({
      by: ["model"],
      where: { createdAt: { gte: todayStart } },
      _count: { _all: true },
      _sum: { costCents: true },
    })
    .catch(
      () =>
        [] as Array<{
          model: string;
          _count: { _all: number };
          _sum: { costCents: number | null };
        }>,
    );

  let imageCalls = 0;
  let imageCostCents = 0;
  let chatCalls = 0;
  let chatCostCents = 0;
  for (const r of rows) {
    const isImage = COST_IMAGE_MODELS.has(r.model.toLowerCase());
    if (isImage) {
      imageCalls += r._count._all;
      imageCostCents += r._sum.costCents ?? 0;
    } else {
      chatCalls += r._count._all;
      chatCostCents += r._sum.costCents ?? 0;
    }
  }
  return { imageCalls, imageCostCents, chatCalls, chatCostCents };
}

/** Operator-grade cost + latency + provider-health rollup over a
 *  configurable window. Lifted verbatim from
 *  app/api/system/costs/route.ts. */
export async function buildSystemCosts(opts: {
  days?: number;
}): Promise<SystemCostsView> {
  const days = Math.max(1, Math.min(90, opts.days ?? 7));

  const t0 = Date.now();
  const [
    latency,
    latencyTrend,
    usage,
    health,
    budget,
    imageVsChat,
    calibration,
  ] = await Promise.all([
    getModelLatencyStats(days),
    getModelLatencyTrend(days),
    getAiUsageStats(days),
    getProviderHealth(),
    checkBudget(),
    getImageVsChatToday(),
    (async () => {
      try {
        const { getCalibrationStats } = await import(
          "@/lib/ai/outcome-calibration"
        );
        return await getCalibrationStats(30);
      } catch {
        return null;
      }
    })(),
  ]);
  const buildMs = Date.now() - t0;

  const toolSupport = latency.map((l) => ({
    model: l.model,
    calls: l.calls,
    supportsTools: true,
  }));

  const slowestModels = [...latency]
    .filter((l) => l.calls >= 5)
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, 10);

  const errorProneModels = [...latency]
    .filter((l) => l.calls >= 5)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10)
    .filter((l) => l.errorRate > 0);

  return {
    ok: true,
    window: { days },
    buildMs,
    budget,
    health,
    usage,
    latency,
    latencyTrend,
    calibration,
    slowestModels,
    errorProneModels,
    toolSupport,
    imageVsChat,
  };
}

// ═══════════════════ /system/cron-runs/[jobName] ═══════════════════

export interface CronRunHistory {
  jobName: string;
  sinceDays: number;
  counts: { total: number; success: number; fail: number };
  successRate: number | null;
  median: number | null;
  p95: number | null;
  runs: Array<{
    id: string;
    status: string;
    durationMs: number | null;
    errorPreview: string | null;
    createdAt: string;
  }>;
  generatedAt: string;
}

/** Per-job cron-run history · last N rows + success-rate / median / p95.
 *  Lifted verbatim from app/api/system/cron-runs/[jobName]/route.ts. */
export async function buildCronRunHistory(opts: {
  jobName: string;
  sinceDays?: number;
  limit?: number;
}): Promise<CronRunHistory> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const sinceDays = Math.min(Math.max(opts.sinceDays ?? 7, 1), 180);
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const rows = await prisma.cronJobLog.findMany({
    where: {
      jobName: { contains: opts.jobName },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      duration: true,
      error: true,
      createdAt: true,
    },
  });

  const succ = rows.filter((r) => r.status === "success");
  const fail = rows.filter((r) => r.status !== "success");
  const successRate =
    rows.length === 0
      ? null
      : Math.round((succ.length / rows.length) * 1000) / 10;

  const durations = succ
    .map((r) => r.duration)
    .filter((d): d is number => typeof d === "number")
    .sort((a, b) => a - b);
  const median =
    durations.length === 0
      ? null
      : (durations[Math.floor(durations.length / 2)] ?? null);
  const p95 =
    durations.length === 0
      ? null
      : (durations[Math.floor(durations.length * 0.95)] ?? null);

  return {
    jobName: opts.jobName,
    sinceDays,
    counts: {
      total: rows.length,
      success: succ.length,
      fail: fail.length,
    },
    successRate,
    median,
    p95,
    runs: rows.map((r) => ({
      id: r.id,
      status: r.status,
      durationMs: r.duration,
      errorPreview: r.error ? r.error.slice(0, 240) : null,
      createdAt: r.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════ /system/crons ═══════════════════════════

// NOTE: duplicate of config/crons.ts CronMode — should import the
// canonical type (this local copy is the exact drift hazard the
// 2026-05-30 manifest reconcile was about). Kept local for now; dedup
// is a follow-up.
type CronMode = "active" | "folded" | "retired" | "dormant";

export interface CronDeckRow {
  name: string;
  schedule: string | null;
  mode: CronMode;
  category: string;
  description: string;
  memory?: number;
  maxDuration?: number;
  foldedInto?: string;
  retireAfter?: string;
  addedAt?: string;
  path?: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailAt: string | null;
  success14d: number;
  fail14d: number;
  successRate: number;
  recentDurations: number[];
  lastRunAt: string | null;
  lastRunMs: number | null;
  lastStatus: "success" | "failed" | null;
  nextRunAt: string | null;
  drift: number | null;
}

export interface CronCommandDeck {
  rows: CronDeckRow[];
  summary: {
    active: number;
    disabled: number;
    folded: number;
    retired: number;
    runs24h: number;
    failures24h: number;
    drifted: number;
  };
  generatedAt: string;
}

function cronExprMatches(val: number, expr: string): boolean {
  if (expr === "*") return true;
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.slice(2), 10);
    return !Number.isNaN(step) && val % step === 0;
  }
  if (expr.includes(",")) {
    return expr.split(",").some((p) => cronExprMatches(val, p));
  }
  if (expr.includes("-")) {
    const [a, b] = expr.split("-").map((n) => parseInt(n, 10));
    return val >= a && val <= b;
  }
  return val === parseInt(expr, 10);
}

function nextRunFromCron(expr: string, now: Date): Date | null {
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, mon, dow] = parts;

  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < 365 * 24 * 60; i++) {
    if (
      cronExprMatches(candidate.getUTCMinutes(), min) &&
      cronExprMatches(candidate.getUTCHours(), hr) &&
      cronExprMatches(candidate.getUTCDate(), dom) &&
      cronExprMatches(candidate.getUTCMonth() + 1, mon) &&
      cronExprMatches(candidate.getUTCDay(), dow)
    ) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return null;
}

/** The live cron command-deck feed · manifest + per-job stats + drift +
 *  next-run countdown. Lifted verbatim from app/api/system/crons/route.ts.
 *  Distinct from `buildCronTree` (the fold-lineage view) — this carries
 *  the per-row `nextRunAt` + `drift` the control deck renders. */
export async function buildCronCommandDeck(): Promise<CronCommandDeck> {
  const [controls, stats, recent] = await Promise.all([
    listCronControls(),
    getCronStats(),
    prisma.cronJobLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 800,
      select: {
        jobName: true,
        status: true,
        duration: true,
        createdAt: true,
      },
    }),
  ]);

  const controlByName = new Map(controls.map((c) => [c.jobName, c]));
  const logsByName = new Map<
    string,
    { status: string; duration: number | null; createdAt: Date }[]
  >();
  for (const r of recent) {
    if (!logsByName.has(r.jobName)) logsByName.set(r.jobName, []);
    logsByName.get(r.jobName)!.push(r);
  }

  const now = new Date();
  const rows: CronDeckRow[] = CRONS.map((c): CronDeckRow => {
    const ctl = controlByName.get(c.name);
    const st = stats[c.name] ?? {
      lastSuccessAt: null,
      lastFailAt: null,
      success14d: 0,
      fail14d: 0,
    };
    const logs = (logsByName.get(c.name) ?? []).slice(0, 20).reverse();
    const total = st.success14d + st.fail14d;
    const successRate =
      total > 0 ? Math.round((st.success14d / total) * 100) : 100;

    let lastRunAt: string | null = null;
    let lastRunMs: number | null = null;
    let lastStatus: "success" | "failed" | null = null;
    const newest = logs[logs.length - 1];
    if (newest) {
      lastRunAt = newest.createdAt.toISOString();
      lastRunMs = newest.duration;
      lastStatus = newest.status === "success" ? "success" : "failed";
    }

    let nextRunAt: string | null = null;
    let drift: number | null = null;
    if (c.mode === "active" && c.schedule) {
      const next = nextRunFromCron(c.schedule, now);
      if (next) {
        nextRunAt = next.toISOString();
        if (lastRunAt) {
          const lastMs = new Date(lastRunAt).getTime();
          const expectedGap = next.getTime() - lastMs;
          const actualGap = now.getTime() - lastMs;
          if (actualGap > expectedGap * 1.5) {
            drift = Math.round((actualGap - expectedGap) / 60000);
          }
        }
      }
    }

    return {
      ...c,
      enabled: ctl?.enabled !== false,
      lastSuccessAt: st.lastSuccessAt,
      lastFailAt: st.lastFailAt,
      success14d: st.success14d,
      fail14d: st.fail14d,
      successRate,
      recentDurations: logs.map((l) => l.duration ?? 0),
      lastRunAt,
      lastRunMs,
      lastStatus,
      nextRunAt,
      drift,
    };
  });

  const summary = {
    active: rows.filter((r) => r.mode === "active").length,
    disabled: rows.filter((r) => !r.enabled).length,
    folded: rows.filter((r) => r.mode === "folded").length,
    retired: rows.filter((r) => r.mode === "retired").length,
    runs24h: recent.filter(
      (r) => r.createdAt.getTime() > now.getTime() - 24 * 3600_000,
    ).length,
    failures24h: recent.filter(
      (r) =>
        r.status === "failed" &&
        r.createdAt.getTime() > now.getTime() - 24 * 3600_000,
    ).length,
    drifted: rows.filter((r) => r.drift !== null && r.drift > 0).length,
  };

  return { rows, summary, generatedAt: now.toISOString() };
}

// ════════════════════ /system/deployment-truth ════════════════════

interface SecretCheck {
  name: string;
  configured: boolean;
  critical: boolean;
}

export interface DeploymentTruthView {
  generatedAt: string;
  build: {
    sha: string;
    shaShort: string;
    commitMessage: string | null;
    branch: string;
    deploymentId: string | null;
    env: string;
    buildTime: string | null;
    serverTime: string;
  };
  schema: {
    ok: boolean;
    reachable: boolean;
    issuesFound: number;
    topIssues: Array<{
      severity: string;
      expectationTable: string;
      problem: string;
    }>;
  };
  env: { checks: SecretCheck[]; missingCritical: number };
  nickPrime: {
    mode: "off" | "shadow" | "on" | "unknown";
    description: string;
  };
  cron: {
    last24hRuns: number;
    last24hSuccess: number;
    last24hFailures: number;
    successRate: number;
    oldestStaleJob: { jobName: string; lastSeenAt: string | null } | null;
  };
  health: "green" | "yellow" | "red";
}

const DEPLOYMENT_SECRET_CHECKS: Array<Omit<SecretCheck, "configured">> = [
  { name: "DATABASE_URL", critical: true },
  { name: "OPENAI_API_KEY", critical: false },
  { name: "ANTHROPIC_API_KEY", critical: false },
  { name: "OLLAMA_API_KEY", critical: false },
  { name: "CRON_SECRET", critical: true },
  { name: "TELEGRAM_WEBHOOK_SECRET", critical: false },
  { name: "STATENOUR_SYNC_KEY", critical: false },
  { name: "MAKE_WEBHOOK_SECRET", critical: false },
  { name: "GITHUB_TOKEN", critical: false },
];

function detectPromptMode(): DeploymentTruthView["nickPrime"] {
  const v = (process.env.NICK_PRIME_PROMPT ?? "").toLowerCase();
  if (v === "1" || v === "on") {
    return { mode: "on", description: "v2 prompt is production default" };
  }
  if (v === "shadow") {
    return {
      mode: "shadow",
      description: "v1 serves; v2 builds in parallel for parity logging",
    };
  }
  if (v === "" || v === "0" || v === "off") {
    return { mode: "off", description: "v1 prompt is the only path" };
  }
  return { mode: "unknown", description: `unrecognized value: ${v}` };
}

/** Live deployment-agreement check — code SHA + schema drift + env
 *  presence + prompt mode + cron health. 30s-cached. Lifted verbatim
 *  from app/api/system/deployment-truth/route.ts. */
export async function buildDeploymentTruth(): Promise<DeploymentTruthView> {
  return cached(
    "system_deployment_truth",
    30,
    async (): Promise<DeploymentTruthView> => {
      const [drift, cronStats, oldestStale] = await Promise.all([
        runSchemaDriftCheck().catch(
          (err): Awaited<ReturnType<typeof runSchemaDriftCheck>> => ({
            ok: false,
            reachable: false,
            checkedAt: new Date().toISOString(),
            expectationCount: 0,
            findings: [
              {
                severity: "high",
                expectation: {
                  kind: "table" as never,
                  table: "<sentinel>",
                } as never,
                problem:
                  err instanceof Error
                    ? err.message.slice(0, 200)
                    : String(err),
              },
            ],
          }),
        ),
        prisma.cronJobLog
          .groupBy({
            by: ["status"],
            where: {
              createdAt: { gte: new Date(Date.now() - 86_400_000) },
            },
            _count: { _all: true },
          })
          .catch(
            () => [] as Array<{ status: string; _count: { _all: number } }>,
          ),
        prisma.cronJobLog
          .groupBy({
            by: ["jobName"],
            _max: { createdAt: true },
          })
          .then((rows) => {
            const stale = rows
              .map((r) => ({
                jobName: r.jobName,
                lastSeenAt: r._max.createdAt?.toISOString() ?? null,
                ageMs: r._max.createdAt
                  ? Date.now() - r._max.createdAt.getTime()
                  : Number.POSITIVE_INFINITY,
              }))
              .filter((r) => r.ageMs > 24 * 3_600_000)
              .sort((a, b) => b.ageMs - a.ageMs);
            return stale[0]
              ? {
                  jobName: stale[0].jobName,
                  lastSeenAt: stale[0].lastSeenAt,
                }
              : null;
          })
          .catch(() => null),
      ]);

      const cronSuccess =
        cronStats.find((s) => s.status === "success")?._count._all ?? 0;
      const cronFailed =
        cronStats.find((s) => s.status === "failed")?._count._all ?? 0;
      const cronTotal = cronSuccess + cronFailed;
      const cronRate =
        cronTotal === 0
          ? 100
          : Math.round((cronSuccess / cronTotal) * 1000) / 10;

      const envChecks: SecretCheck[] = DEPLOYMENT_SECRET_CHECKS.map((s) => ({
        ...s,
        configured: !!process.env[s.name],
      }));
      const missingCritical = envChecks.filter(
        (c) => c.critical && !c.configured,
      ).length;

      const driftIssues = drift.findings.slice(0, 5).map((f) => ({
        severity: f.severity,
        expectationTable: f.expectation.table ?? "<unknown>",
        problem: f.problem,
      }));

      let health: "green" | "yellow" | "red" = "green";
      const hasHighDrift = drift.findings.some((f) => f.severity === "high");
      if (missingCritical > 0 || (hasHighDrift && drift.findings.length > 0)) {
        health = "red";
      } else if (
        drift.findings.length > 0 ||
        cronFailed > 0 ||
        oldestStale != null
      ) {
        health = "yellow";
      }

      // truth-substrate audit P0 (#11/#14): deploy identity from the canonical
      // Railway-first getDeployMeta(), not Vercel-only reads that showed
      // "dev"/"local"/"development" on Railway prod (this is the "deployment
      // TRUTH" surface — it must not lie about what is live).
      const deploy = getDeployMeta();

      return {
        generatedAt: new Date().toISOString(),
        build: {
          sha: deploy.sha ?? "unknown",
          shaShort: deploy.shaShort ?? "unknown",
          commitMessage: deploy.commitMessage
            ? deploy.commitMessage.slice(0, 200)
            : null,
          branch: deploy.branch ?? "local",
          deploymentId: deploy.deploymentId,
          env: deploy.env ?? "development",
          buildTime: deploy.buildTime,
          serverTime: new Date().toISOString(),
        },
        schema: {
          ok: drift.ok,
          reachable: drift.reachable,
          issuesFound: drift.findings.length,
          topIssues: driftIssues,
        },
        env: {
          checks: envChecks,
          missingCritical,
        },
        nickPrime: detectPromptMode(),
        cron: {
          last24hRuns: cronTotal,
          last24hSuccess: cronSuccess,
          last24hFailures: cronFailed,
          successRate: cronRate,
          oldestStaleJob: oldestStale,
        },
        health,
      };
    },
  );
}

// ══════════════════════════ /system/devices ══════════════════════════

type Staleness = "live" | "stale" | "lost";

export interface DeviceFleetRow {
  id: string;
  name: string;
  platform: string;
  deviceType: string;
  location: string | null;
  status: string;
  lastSeenAt: string | null;
  minutesSinceLastSeen: number | null;
  staleness: Staleness;
  pendingCommands: number;
  failedCommands24h: number;
  recentEvents24h: number;
}

export interface DeviceFleetView {
  rows: DeviceFleetRow[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byPlatform: Record<string, number>;
    byLocation: Record<string, number>;
    byType: Record<string, number>;
    byStaleness: Record<Staleness, number>;
    commandQueue: { pending: number; failed24h: number };
    agent: {
      status: "live" | "stale" | "dead" | "never";
      lastHeartbeatAt: string | null;
      minutesSilent: number | null;
    };
  };
  generatedAt: string;
}

function classifyStaleness(lastSeenAt: Date | null): {
  cls: Staleness;
  mins: number | null;
} {
  if (!lastSeenAt) return { cls: "lost", mins: null };
  const mins = Math.round((Date.now() - lastSeenAt.getTime()) / 60000);
  if (mins < 10) return { cls: "live", mins };
  if (mins < 60 * 6) return { cls: "stale", mins };
  return { cls: "lost", mins };
}

/** Fleet-level device health feed — SmartDevice + DeviceCommand +
 *  DeviceEvent composite. Lifted verbatim from
 *  app/api/system/devices/route.ts. */
export async function buildDeviceFleet(): Promise<DeviceFleetView> {
  const since24h = new Date(Date.now() - 24 * 3600_000);

  const [devices, pendingCmds, failedCmds24h, recentEvents24h, newestEvent] =
    await Promise.all([
      prisma.smartDevice.findMany({
        orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
      }),
      prisma.deviceCommand.groupBy({
        by: ["deviceId"],
        where: { status: "pending" },
        _count: { id: true },
      }),
      prisma.deviceCommand.groupBy({
        by: ["deviceId"],
        where: { status: "failed", createdAt: { gte: since24h } },
        _count: { id: true },
      }),
      prisma.deviceEvent.groupBy({
        by: ["deviceId"],
        where: { createdAt: { gte: since24h } },
        _count: { id: true },
      }),
      prisma.deviceEvent.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

  const pendingByDevice = new Map(
    pendingCmds.map((c) => [c.deviceId ?? "", c._count.id]),
  );
  const failedByDevice = new Map(
    failedCmds24h.map((c) => [c.deviceId ?? "", c._count.id]),
  );
  const eventsByDevice = new Map(
    recentEvents24h.map((e) => [e.deviceId ?? "", e._count.id]),
  );

  const rows: DeviceFleetRow[] = devices.map((d) => {
    const { cls, mins } = classifyStaleness(d.lastSeenAt);
    return {
      id: d.id,
      name: d.name,
      platform: d.platform,
      deviceType: d.deviceType,
      location: d.location,
      status: d.status,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      minutesSinceLastSeen: mins,
      staleness: cls,
      pendingCommands: pendingByDevice.get(d.id) ?? 0,
      failedCommands24h: failedByDevice.get(d.id) ?? 0,
      recentEvents24h: eventsByDevice.get(d.id) ?? 0,
    };
  });

  const byStatus = {
    ONLINE: 0,
    OFFLINE: 0,
    ERROR: 0,
    UNKNOWN: 0,
  } as Record<string, number>;
  const byPlatform: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byStaleness: Record<Staleness, number> = {
    live: 0,
    stale: 0,
    lost: 0,
  };

  for (const d of rows) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    byPlatform[d.platform] = (byPlatform[d.platform] ?? 0) + 1;
    const loc = d.location ?? "unknown";
    byLocation[loc] = (byLocation[loc] ?? 0) + 1;
    byType[d.deviceType] = (byType[d.deviceType] ?? 0) + 1;
    byStaleness[d.staleness] += 1;
  }

  const agentLastHeartbeatAt = newestEvent?.createdAt?.toISOString() ?? null;
  const agentMinutesSilent = newestEvent?.createdAt
    ? Math.round((Date.now() - newestEvent.createdAt.getTime()) / 60000)
    : null;
  const agentStatus: "live" | "stale" | "dead" | "never" =
    !agentLastHeartbeatAt
      ? "never"
      : agentMinutesSilent! < 15
        ? "live"
        : agentMinutesSilent! < 360
          ? "stale"
          : "dead";

  const commandQueue = {
    pending: [...pendingByDevice.values()].reduce((a, b) => a + b, 0),
    failed24h: [...failedByDevice.values()].reduce((a, b) => a + b, 0),
  };

  return {
    rows,
    summary: {
      total: rows.length,
      byStatus,
      byPlatform,
      byLocation,
      byType,
      byStaleness,
      commandQueue,
      agent: {
        status: agentStatus,
        lastHeartbeatAt: agentLastHeartbeatAt,
        minutesSilent: agentMinutesSilent,
      },
    },
    generatedAt: new Date().toISOString(),
  };
}
