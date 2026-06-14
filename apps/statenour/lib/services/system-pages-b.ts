/**
 * lib/services/system-pages-b.ts · Phase B.7b (2026-05-22 ·
 * legacy-modernizer REST→tRPC system-pages slice · sub-slice B).
 *
 * The shared services the REMAINING `app/(mastery)/system/*` page
 * surfaces delegate to (sub-slice A's `system-pages.ts` covered the
 * first ~13 files). Each function was inline in its REST route handler
 * (no shared module) until this slice; the logic is lifted here
 * byte-for-byte so the legacy `/api/system/*` route AND the new
 * `system.*` tRPC procedure call the SAME function · drift between the
 * two transports structurally impossible.
 *
 * Every function returns an explicit, shallow interface. Several read
 * Prisma rows whose models carry `Json` columns (BrainMemory `content`,
 * SystemMetric `tags`, EntityAudit `before`/`after`, AutonomousAction
 * `payload`); the interfaces type those columns `unknown` (or project
 * them to scalar strings) so Prisma's recursive `JsonValue` machinery
 * never leaks into the `AppRouter` type — the TS2589 firewall the
 * migration roadmap mandates (the `system` router is already the
 * largest, near TypeScript's instantiation-depth ceiling). Every
 * `Date` is stringified inside the service so the procedure's public
 * type stays scalar.
 *
 * Routes covered:
 *   buildVapiCallStats     ← app/api/system/vapi-calls/route.ts
 *   buildToolStats         ← app/api/system/tools/stats/route.ts
 *   buildRoutePerformance  ← app/api/system/performance/route.ts
 *   listPoliciesView       ← app/api/system/policies/route.ts
 *   updatePolicyFields     ← app/api/system/policies/[id]/route.ts (PATCH)
 *   listPolicyFiresView    ← app/api/system/policies/[id]/fires/route.ts
 *   applyPowerSetting      ← app/api/system/power/route.ts (POST)
 *   buildPromptDiagnostics ← app/api/system/prompt/route.ts
 *   buildReposOverview     ← app/api/system/repos/route.ts
 *   buildSchemaHistory     ← app/api/system/schema-history/route.ts
 *   buildTireStockRequests ← app/api/system/tire-stock-requests/route.ts
 *   buildActorActivity     ← app/api/audit/entity/route.ts (actor-firehose)
 *   buildSystemLogs        ← app/api/system/logs/route.ts
 *
 * (power GET keeps using the pre-existing `getPowerSettings` service ·
 * repo-briefing keeps using `getEcosystemDigest` · both already shared
 * and already return string-typed shapes.)
 */

import { prisma } from "@/lib/prisma";
import { sanitizeError, redactSensitive } from "@/lib/utils/sanitize-error";
import { cached } from "@/lib/utils/cache";
import { logger as rootLogger } from "@/lib/logger";
import { ServiceError } from "@/lib/utils/service-error";
import { nourTools } from "@/lib/ai/tools";
import {
  TOOL_FAMILIES,
  FAMILY_DISPLAY,
  assertToolFamiliesInSync,
  type ToolFamily,
} from "@/lib/ai/tool-families";
import { getToolStats } from "@/lib/ai/tool-telemetry";
import {
  listPolicies,
  getPolicy,
  getPolicyFireHistory,
  setApprovalClass,
  setEnabled,
  updateNotes,
  type PolicySurface,
  type ApprovalClass,
} from "@/lib/automation/policy";
import {
  getPowerSettings,
  setPowerSetting,
  type PowerSettings,
} from "@/lib/services/power-panel";
import { setCronEnabled } from "@/lib/services/cron-control";
import { CRONS } from "@/config/crons";
import { buildSystemPrompt, detectTopicTier } from "@/lib/ai/system-prompt";
import {
  detectContentDeepIntent,
  getBusinessKnowledge,
} from "@/lib/ai/business-knowledge";
import { detectContentIntentAsync } from "@/lib/ai/content-intent";
import { getCacheStats } from "@/lib/ai/system-prompt-cache";
import { getProviderStatus } from "@/lib/ai/provider";
import { REPOS, type RepoEntry } from "@/config/repos";
import {
  listRecentSchemaChanges,
  getSchemaLedgerStats,
  type ChangeEnvironment,
} from "@/lib/db/schema-ledger";
import { getActorActivity, type AuditAction } from "@/lib/db/entity-audit";

const log = rootLogger.withSurface("services/system-pages-b");

// ════════════════════════ /system/vapi-calls ════════════════════════

interface VapiCall {
  id: string;
  status?: string;
  endedReason?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  customer?: { number?: string };
  cost?: number;
  costBreakdown?: { total?: number };
}

/** VAPI call analytics rollup. All scalars — the upstream VAPI JSON is
 *  reduced to counts + a flat most-recent object inside the service. */
export interface VapiCallStatsView {
  windowDays: number;
  sinceIso: string;
  totalCalls: number;
  byStatus: Record<string, number>;
  byEndedReason: Record<string, number>;
  avgDurationSec: number;
  mostRecent: {
    id: string;
    createdAt?: string;
    status?: string;
    endedReason?: string | null;
    durationSec: number | null;
  } | null;
  totalCostUsd: number;
  error?: string;
}

/** VAPI call analytics · proxies VAPI's /call list endpoint with
 *  aggregations. Lifted verbatim from app/api/system/vapi-calls/route.ts.
 *  The VAPI key stays server-side. `days` is clamped 1-90. */
export async function buildVapiCallStats(opts: {
  days?: number;
}): Promise<VapiCallStatsView> {
  const days = Math.max(1, Math.min(90, opts.days ?? 7));
  const since = new Date(Date.now() - days * 86_400_000);

  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (!apiKey) {
    return {
      windowDays: days,
      sinceIso: since.toISOString(),
      totalCalls: 0,
      byStatus: {},
      byEndedReason: {},
      avgDurationSec: 0,
      mostRecent: null,
      totalCostUsd: 0,
      error: "VAPI_API_KEY not set on server",
    };
  }

  try {
    // 2026-05-23 · Wave C · S1 · was a fetch with no AbortSignal ·
    // a stalled VAPI API hung the /system dashboard render for the
    // full Next.js function timeout (60s) before erroring, blanking
    // the entire page. 8s timeout matches the bridge.ts:59 pattern
    // already in use elsewhere in this file.
    const r = await fetch(
      `https://api.vapi.ai/call?limit=100&createdAtGt=${encodeURIComponent(
        since.toISOString(),
      )}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!r.ok) {
      log.warn("vapi_call_list_failed", { status: r.status });
      return {
        windowDays: days,
        sinceIso: since.toISOString(),
        totalCalls: 0,
        byStatus: {},
        byEndedReason: {},
        avgDurationSec: 0,
        mostRecent: null,
        totalCostUsd: 0,
        error: `VAPI returned ${r.status}`,
      };
    }
    const calls = (await r.json()) as VapiCall[];

    const byStatus: Record<string, number> = {};
    const byEndedReason: Record<string, number> = {};
    let durationSum = 0;
    let durationCount = 0;
    let costSum = 0;

    for (const c of calls) {
      const s = c.status ?? "(unknown)";
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      const er = c.endedReason ?? "(none)";
      byEndedReason[er] = (byEndedReason[er] ?? 0) + 1;
      if (c.startedAt && c.endedAt) {
        const durMs =
          new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime();
        if (durMs > 0) {
          durationSum += durMs;
          durationCount += 1;
        }
      }
      const cost = c.costBreakdown?.total ?? c.cost ?? 0;
      if (typeof cost === "number") costSum += cost;
    }

    const mostRecent = calls[0]
      ? {
          id: calls[0].id,
          createdAt: calls[0].createdAt,
          status: calls[0].status,
          endedReason: calls[0].endedReason,
          durationSec:
            calls[0].startedAt && calls[0].endedAt
              ? Math.round(
                  (new Date(calls[0].endedAt).getTime() -
                    new Date(calls[0].startedAt).getTime()) /
                    1000,
                )
              : null,
        }
      : null;

    return {
      windowDays: days,
      sinceIso: since.toISOString(),
      totalCalls: calls.length,
      byStatus,
      byEndedReason,
      avgDurationSec:
        durationCount > 0
          ? Math.round(durationSum / durationCount / 1000)
          : 0,
      mostRecent,
      totalCostUsd: Number(costSum.toFixed(2)),
    };
  } catch (err) {
    log.error("vapi_call_fetch_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      windowDays: days,
      sinceIso: since.toISOString(),
      totalCalls: 0,
      byStatus: {},
      byEndedReason: {},
      avgDurationSec: 0,
      mostRecent: null,
      totalCostUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════ /system/tools (stats) ═══════════════════════

interface ToolRow {
  name: string;
  description: string;
  family: ToolFamily;
  familyLabel: string;
  mutates: boolean;
  cost: "cheap" | "medium" | "expensive";
  tags: string[];
  registered: boolean;
  liveInToolset: boolean;
  telemetry?: {
    totalCalls: number;
    successRate: number;
    avgDurationMs: number;
    failCount: number;
    lastCallAt?: number;
  };
}

interface FamilyRollup {
  family: ToolFamily;
  label: string;
  color: string;
  toolCount: number;
  mutatingCount: number;
  expensiveCount: number;
}

export interface ToolStatsView {
  totalTools: number;
  totalRegistered: number;
  drift: {
    inToolsetMissingFromRegistry: string[];
    inRegistryMissingFromToolset: string[];
  };
  tools: ToolRow[];
  families: FamilyRollup[];
  generatedAt: string;
}

/** Tool registry + family rollup · joins the static TOOL_FAMILIES
 *  metadata with live tool availability + BrainMemory-backed telemetry.
 *  Lifted verbatim from app/api/system/tools/stats/route.ts. */
export async function buildToolStats(): Promise<ToolStatsView> {
  const liveTools = new Set(Object.keys(nourTools));
  const regTools = new Set(Object.keys(TOOL_FAMILIES));

  const telemetryRows = await getToolStats(200).catch(() => []);
  const telemetryByName = new Map(
    telemetryRows.map((t) => [
      t.toolName,
      {
        totalCalls: t.totalCalls,
        successRate: t.successRate,
        avgDurationMs: t.avgDurationMs,
        failCount: t.failCount,
        lastCallAt: t.lastCallAt,
      },
    ]),
  );

  const allNames = new Set<string>([...liveTools, ...regTools]);
  const rows: ToolRow[] = [];

  for (const name of allNames) {
    const meta = TOOL_FAMILIES[name];
    const live = liveTools.has(name);
    const registered = regTools.has(name);
    const telemetry = telemetryByName.get(name);
    rows.push({
      name,
      description: meta?.description ?? "(no registry entry)",
      family: meta?.family ?? ("meta" as ToolFamily),
      familyLabel:
        FAMILY_DISPLAY[meta?.family ?? ("meta" as ToolFamily)].label,
      mutates: meta?.mutates ?? false,
      cost: meta?.cost ?? "medium",
      tags: meta?.tags ?? [],
      registered,
      liveInToolset: live,
      telemetry,
    });
  }

  rows.sort((a, b) => {
    const at = a.telemetry?.totalCalls ?? -1;
    const bt = b.telemetry?.totalCalls ?? -1;
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name);
  });

  const familyRollup: FamilyRollup[] = (
    Object.keys(FAMILY_DISPLAY) as ToolFamily[]
  )
    .map((fam) => {
      const inFam = rows.filter((r) => r.family === fam);
      return {
        family: fam,
        label: FAMILY_DISPLAY[fam].label,
        color: FAMILY_DISPLAY[fam].color,
        toolCount: inFam.length,
        mutatingCount: inFam.filter((r) => r.mutates).length,
        expensiveCount: inFam.filter((r) => r.cost === "expensive").length,
      };
    })
    .sort(
      (a, b) =>
        FAMILY_DISPLAY[a.family].priority - FAMILY_DISPLAY[b.family].priority,
    );

  const sync = assertToolFamiliesInSync();

  return {
    totalTools: liveTools.size,
    totalRegistered: regTools.size,
    drift: {
      inToolsetMissingFromRegistry: sync.missingFromRegistry,
      inRegistryMissingFromToolset: sync.missingFromTools,
    },
    tools: rows,
    families: familyRollup,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════ /system/performance ═══════════════════════

interface PerfRow {
  path: string;
  method: string;
  requests: number;
  errors: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
  slow: boolean;
}

export interface RoutePerformanceView {
  window: { hours: number; since: string };
  slowThresholdMs: number;
  summary: {
    totalRoutes: number;
    slowRoutes: number;
    errorRoutes: number;
    totalRequests: number;
    totalErrors: number;
  };
  routes: PerfRow[];
  generatedAt: string;
}

const SLOW_P95_MS = 2000;

/** Per-route latency percentiles · reads api_request_logs via Postgres
 *  percentile_cont. Lifted verbatim from app/api/system/performance/
 *  route.ts. `hours` clamped 1-720 · `minRequests` floored at 1. */
export async function buildRoutePerformance(opts: {
  hours?: number;
  minRequests?: number;
}): Promise<RoutePerformanceView> {
  const hours = Math.min(720, Math.max(1, opts.hours ?? 24));
  const since = new Date(Date.now() - hours * 3_600_000);
  const minRequests = Math.max(1, opts.minRequests ?? 5);

  const rows = await prisma.$queryRaw<
    Array<{
      path: string;
      method: string;
      requests: bigint;
      errors: bigint;
      p50_ms: number | null;
      p95_ms: number | null;
      p99_ms: number | null;
      avg_ms: number | null;
      max_ms: number | null;
    }>
  >`
    SELECT
      path,
      method,
      COUNT(*)::bigint AS requests,
      COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS errors,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p95_ms,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p99_ms,
      AVG(duration_ms)::float8 AS avg_ms,
      MAX(duration_ms)::float8 AS max_ms
    FROM api_request_logs
    WHERE created_at >= ${since}
    GROUP BY path, method
    HAVING COUNT(*) >= ${minRequests}
    ORDER BY percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) DESC
    LIMIT 200
  `;

  const result: PerfRow[] = rows.map((r) => {
    const reqs = Number(r.requests);
    const errs = Number(r.errors);
    const p95 = Number(r.p95_ms ?? 0);
    return {
      path: r.path,
      method: r.method,
      requests: reqs,
      errors: errs,
      errorRate: reqs > 0 ? errs / reqs : 0,
      p50Ms: Math.round(Number(r.p50_ms ?? 0)),
      p95Ms: Math.round(p95),
      p99Ms: Math.round(Number(r.p99_ms ?? 0)),
      avgMs: Math.round(Number(r.avg_ms ?? 0)),
      maxMs: Math.round(Number(r.max_ms ?? 0)),
      slow: p95 > SLOW_P95_MS,
    };
  });

  const summary = {
    totalRoutes: result.length,
    slowRoutes: result.filter((r) => r.slow).length,
    errorRoutes: result.filter((r) => r.errorRate > 0.05).length,
    totalRequests: result.reduce((s, r) => s + r.requests, 0),
    totalErrors: result.reduce((s, r) => s + r.errors, 0),
  };

  return {
    window: { hours, since: since.toISOString() },
    slowThresholdMs: SLOW_P95_MS,
    summary,
    routes: result,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════ /system/policies ═══════════════════════════

/** One automation-policy row. The `inputs` Json column is typed
 *  `unknown` so the recursive JsonValue stays out of the AppRouter
 *  (TS2589 firewall). Every Date is projected to an ISO string. */
export interface PolicyView {
  id: string;
  surface: PolicySurface;
  name: string;
  objective: string;
  trigger: string;
  inputs: unknown;
  approvalClass: ApprovalClass;
  rollback: string | null;
  successMetric: string;
  owner: string;
  enabled: boolean;
  lastFiredAt: string | null;
  lastResult: string | null;
  fireCount: number;
  notes: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PoliciesListView {
  count: number;
  policies: PolicyView[];
}

function policyRecordToView(p: {
  id: string;
  surface: PolicySurface;
  name: string;
  objective: string;
  trigger: string;
  inputs: unknown;
  approvalClass: ApprovalClass;
  rollback: string | null;
  successMetric: string;
  owner: string;
  enabled: boolean;
  lastFiredAt: Date | null;
  lastResult: string | null;
  fireCount: number;
  notes: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}): PolicyView {
  return {
    id: p.id,
    surface: p.surface,
    name: p.name,
    objective: p.objective,
    trigger: p.trigger,
    inputs: p.inputs,
    approvalClass: p.approvalClass,
    rollback: p.rollback,
    successMetric: p.successMetric,
    owner: p.owner,
    enabled: p.enabled,
    lastFiredAt: p.lastFiredAt?.toISOString() ?? null,
    lastResult: p.lastResult,
    fireCount: p.fireCount,
    notes: p.notes,
    tags: p.tags,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** The AutomationPolicy registry feed · optional surface / approval /
 *  enabled filters. Wraps the shared `listPolicies` service (which the
 *  legacy REST route also calls) and projects every `Date` to an ISO
 *  string so the page's string-typed `Policy` interface matches. */
export async function listPoliciesView(opts: {
  surface?: PolicySurface;
  approvalClass?: ApprovalClass;
  enabledOnly?: boolean;
}): Promise<PoliciesListView> {
  const policies = await listPolicies({
    surface: opts.surface,
    approvalClass: opts.approvalClass,
    enabledOnly: opts.enabledOnly,
  });
  return {
    count: policies.length,
    policies: policies.map(policyRecordToView),
  };
}

/** Operator-facing policy edit · the multi-field PATCH. Each field is
 *  applied sequentially through the service-layer setters (so the audit
 *  log captures separate events) — mirrors the REST route verbatim.
 *  Throws ServiceError(404) for an unknown policy id. */
export async function updatePolicyFields(opts: {
  id: string;
  approvalClass?: ApprovalClass;
  enabled?: boolean;
  notes?: string | null;
}): Promise<PolicyView> {
  let result = await getPolicy(opts.id);
  if (!result) {
    throw new ServiceError(`policy "${opts.id}" not found`, 404);
  }
  if (typeof opts.approvalClass === "string") {
    result = await setApprovalClass(opts.id, opts.approvalClass);
  }
  if (typeof opts.enabled === "boolean") {
    result = await setEnabled(opts.id, opts.enabled);
  }
  if (opts.notes !== undefined) {
    result = await updateNotes(opts.id, opts.notes);
  }
  return policyRecordToView(result);
}

/** One policy-fire history row · `firedAt` projected to an ISO string,
 *  the `metadata` Json column typed `unknown` (TS2589 firewall). */
export interface PolicyFireView {
  id: string;
  policyId: string;
  firedAt: string;
  result: string;
  resultMessage: string | null;
  durationMs: number | null;
  metadata: unknown;
}

export interface PolicyFiresListView {
  fires: PolicyFireView[];
  count: number;
}

/** Chronological fire history for one policy. Wraps the shared
 *  `getPolicyFireHistory` service the legacy REST route also calls and
 *  stringifies the `firedAt` Date. */
export async function listPolicyFiresView(opts: {
  policyId: string;
  limit?: number;
  offset?: number;
}): Promise<PolicyFiresListView> {
  const fires = await getPolicyFireHistory(opts.policyId, {
    limit: opts.limit,
    offset: opts.offset,
  });
  return {
    fires: fires.map((f) => ({
      id: f.id,
      policyId: f.policyId,
      firedAt: f.firedAt.toISOString(),
      result: f.result,
      resultMessage: f.resultMessage,
      durationMs: f.durationMs,
      metadata: f.metadata,
    })),
    count: fires.length,
  };
}

// ════════════════════════════ /system/power ════════════════════════════

/** Persist a single power-panel setting. The `pauseAllCrons` pseudo-
 *  setting also fans out to every active cron's kill-switch (so
 *  /system/crons respects it) — mirrors the REST POST handler verbatim.
 *  Returns the fresh full settings snapshot. */
export async function applyPowerSetting(opts: {
  key: keyof PowerSettings;
  value: string | number | boolean;
  note?: string;
}): Promise<{ settings: PowerSettings }> {
  if (opts.key === "pauseAllCrons") {
    const enable = !opts.value;
    await Promise.all(
      CRONS.filter((c) => c.mode === "active").map((c) =>
        setCronEnabled(c.name, enable, "bulk via /system/power"),
      ),
    );
  }
  await setPowerSetting(opts.key, opts.value as never, opts.note);
  const settings = await getPowerSettings();
  return { settings };
}

// ════════════════════════════ /system/prompt ════════════════════════════

type PromptTier = "core" | "business" | "personal" | "strategy" | "full";

const VENICE_LIMIT = 65_000;

export interface PromptDiagnosticsView {
  ok: boolean;
  tier: { requested: string; detected: string; slot: string };
  size: {
    chars: number;
    words: number;
    tokensEst: number;
    veniceLimit: number;
    utilization: number;
    truncating: boolean;
    overBy: number;
  };
  knowledge: {
    moduleChars: number;
    contentEngineLoaded: boolean;
    deepEngineLoaded: boolean;
  };
  intent: {
    isContent: boolean;
    confidence: number;
    rawScore: number;
    reasons: string[];
    embedSimilarity?: number;
    usedEmbedding: boolean;
  };
  sections: Array<{ title: string; chars: number; lines: number }>;
  sectionCount: number;
  buildMs: number;
  cache: ReturnType<typeof getCacheStats>;
  providers: ReturnType<typeof getProviderStatus>["providers"];
  headPreview: string;
  tailPreview: string;
}

/** Live system-prompt diagnostics · builds the prompt that WOULD be
 *  served right now for a tier + sample message and breaks it down.
 *  Lifted verbatim from app/api/system/prompt/route.ts. */
export async function buildPromptDiagnostics(opts: {
  tier?: PromptTier;
  msg?: string;
}): Promise<PromptDiagnosticsView> {
  const tierParam: PromptTier = opts.tier ?? "full";
  const msg = opts.msg ?? "";

  const detectedTier =
    msg && tierParam === "full" ? detectTopicTier(msg) : tierParam;

  const t0 = Date.now();
  const prompt = await buildSystemPrompt(detectedTier, msg || null);
  const buildMs = Date.now() - t0;

  const intentDetail = await detectContentIntentAsync(msg);
  const isContent = intentDetail.isContent;
  const isDeep = isContent && detectContentDeepIntent(msg);
  const slot = isDeep ? "deep" : isContent ? "content" : "default";

  const knowledgeOnly = getBusinessKnowledge(
    detectedTier === "personal"
      ? "chat"
      : detectedTier === "core"
        ? "core"
        : (detectedTier as "business" | "strategy" | "full"),
    msg || null,
  );

  const sectionLines = prompt.split("\n");
  const sections: Array<{ title: string; chars: number; lines: number }> = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of sectionLines) {
    if (/^#{1,3}\s/.test(line)) {
      if (current) {
        const body = current.lines.join("\n");
        sections.push({
          title: current.title,
          chars: body.length,
          lines: current.lines.length,
        });
      }
      current = {
        title: line.replace(/^#{1,3}\s/, "").slice(0, 90),
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    const body = current.lines.join("\n");
    sections.push({
      title: current.title,
      chars: body.length,
      lines: current.lines.length,
    });
  }
  const topSections = [...sections]
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 25);

  const tokensEst = Math.round(prompt.length / 3.5);
  const wordsEst = prompt.trim().split(/\s+/).length;

  const overBy = prompt.length - VENICE_LIMIT;
  const truncating = overBy > 0;
  const utilization = Math.round((prompt.length / VENICE_LIMIT) * 100);

  return {
    ok: true,
    tier: {
      requested: tierParam,
      detected: detectedTier,
      slot,
    },
    size: {
      chars: prompt.length,
      words: wordsEst,
      tokensEst,
      veniceLimit: VENICE_LIMIT,
      utilization,
      truncating,
      overBy: Math.max(0, overBy),
    },
    knowledge: {
      moduleChars: knowledgeOnly.length,
      contentEngineLoaded: isContent,
      deepEngineLoaded: isDeep,
    },
    intent: {
      isContent: intentDetail.isContent,
      confidence: intentDetail.confidence,
      rawScore: intentDetail.rawScore,
      reasons: intentDetail.reasons,
      embedSimilarity: intentDetail.embedSimilarity,
      usedEmbedding: intentDetail.usedEmbedding,
    },
    sections: topSections,
    sectionCount: sections.length,
    buildMs,
    cache: getCacheStats(),
    providers: getProviderStatus().providers,
    headPreview: prompt.slice(0, 1500),
    tailPreview: prompt.slice(-800),
  };
}

// ════════════════════════════ /system/repos ════════════════════════════

interface LiveRepoData {
  name: string;
  lastCommitSha: string | null;
  lastCommitMessage: string | null;
  lastCommitAt: string | null;
  defaultBranch: string | null;
  fetchOk: boolean;
  fetchError: string | null;
}

interface RepoPayload extends RepoEntry {
  live: LiveRepoData | null;
  health: "green" | "yellow" | "red" | "gray";
  lastCommitAgeHours: number | null;
}

export interface ReposOverviewView {
  generatedAt: string;
  liveDataAvailable: boolean;
  repos: RepoPayload[];
  summary: {
    total: number;
    active: number;
    monitored: number;
    archived: number;
    green: number;
    yellow: number;
    red: number;
    gray: number;
  };
}

/** Pull live state from GitHub for one repo. Best-effort — any error
 *  resolves to fetchOk=false with the error message. */
async function fetchGithubState(
  fullName: string,
  token: string,
): Promise<LiveRepoData> {
  const base: LiveRepoData = {
    name: fullName,
    lastCommitSha: null,
    lastCommitMessage: null,
    lastCommitAt: null,
    defaultBranch: null,
    fetchOk: false,
    fetchError: null,
  };
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      next: { revalidate: 60 },
    });
    if (!repoRes.ok) {
      base.fetchError = `${repoRes.status} ${repoRes.statusText}`;
      return base;
    }
    const repoJson = (await repoRes.json()) as {
      default_branch?: string;
      pushed_at?: string;
    };
    base.defaultBranch = repoJson.default_branch ?? null;

    if (repoJson.default_branch) {
      const commitRes = await fetch(
        `https://api.github.com/repos/${fullName}/commits/${repoJson.default_branch}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          next: { revalidate: 60 },
        },
      );
      if (commitRes.ok) {
        const commitJson = (await commitRes.json()) as {
          sha?: string;
          commit?: { message?: string; committer?: { date?: string } };
        };
        base.lastCommitSha = commitJson.sha?.slice(0, 7) ?? null;
        base.lastCommitMessage =
          commitJson.commit?.message?.split("\n")[0]?.slice(0, 80) ?? null;
        base.lastCommitAt = commitJson.commit?.committer?.date ?? null;
        base.fetchOk = true;
      } else {
        base.fetchError = `commit fetch ${commitRes.status}`;
      }
    } else {
      base.fetchError = "no default branch";
    }
  } catch (err) {
    base.fetchError = err instanceof Error ? err.message : String(err);
  }
  return base;
}

/** Compute the health color for a repo given manifest + live state. */
function computeRepoHealth(
  repo: RepoEntry,
  live: LiveRepoData | null,
  ageHours: number | null,
): "green" | "yellow" | "red" | "gray" {
  if (repo.status === "archived" || repo.status === "dead") return "gray";
  if (repo.status === "stale") return "red";
  if (live && !live.fetchOk) return "yellow";
  if (ageHours != null && ageHours > 30 * 24) return "yellow";
  return "green";
}

/** Live REPO-MAP · reads config/repos.ts + (when GITHUB_TOKEN is set)
 *  augments each monitored repo with live GitHub state. 60s-cached.
 *  Lifted verbatim from app/api/system/repos/route.ts. */
export async function buildReposOverview(): Promise<ReposOverviewView> {
  const token = process.env.GITHUB_TOKEN;
  const liveDataAvailable = !!token;

  const repos = await cached(
    "system_repos_live",
    60,
    async (): Promise<RepoPayload[]> => {
      const enriched = await Promise.all(
        REPOS.map(async (repo) => {
          let live: LiveRepoData | null = null;
          if (token && repo.monitored && repo.fullName) {
            live = await fetchGithubState(repo.fullName, token);
          }

          const ageHours =
            live?.lastCommitAt != null
              ? Math.round(
                  (Date.now() - new Date(live.lastCommitAt).getTime()) /
                    3_600_000,
                )
              : null;

          const health = computeRepoHealth(repo, live, ageHours);

          return {
            ...repo,
            live,
            health,
            lastCommitAgeHours: ageHours,
          };
        }),
      );
      return enriched;
    },
  );

  const summary = {
    total: repos.length,
    active: repos.filter((r) => r.status === "active").length,
    monitored: repos.filter((r) => r.monitored).length,
    archived: repos.filter(
      (r) => r.status === "archived" || r.status === "dead",
    ).length,
    green: repos.filter((r) => r.health === "green").length,
    yellow: repos.filter((r) => r.health === "yellow").length,
    red: repos.filter((r) => r.health === "red").length,
    gray: repos.filter((r) => r.health === "gray").length,
  };

  return {
    generatedAt: new Date().toISOString(),
    liveDataAvailable,
    repos,
    summary,
  };
}

// ═══════════════════════ /system/schema-history ═══════════════════════

interface LedgerEntryView {
  id: string;
  changeKey: string;
  title: string;
  reason: string;
  changeType: string;
  method: string;
  environment: string;
  destructive: boolean;
  status: string;
  appliedAt: string | null;
  appliedBy: string | null;
  approvedBy: string | null;
  rollbackPlan: string | null;
  createdAt: string;
}

export interface SchemaHistoryView {
  generatedAt: string;
  stats: {
    totalChanges: number;
    appliedLast24h: number;
    appliedLast7d: number;
    pendingPlanned: number;
    failedLast24h: number;
    destructiveLast30d: number;
  };
  entries: LedgerEntryView[];
}

/** SchemaChangeLedger operator feed · 6-axis summary + recent entries.
 *  Lifted verbatim from app/api/system/schema-history/route.ts. `limit`
 *  clamped 1-200 inside `listRecentSchemaChanges`. Every `Date` is
 *  projected to an ISO string here. */
export async function buildSchemaHistory(opts: {
  limit?: number;
  environment?: ChangeEnvironment;
}): Promise<SchemaHistoryView> {
  const [stats, entries] = await Promise.all([
    getSchemaLedgerStats(),
    listRecentSchemaChanges({
      limit: opts.limit,
      environment: opts.environment,
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    stats,
    entries: entries.map((e) => ({
      id: e.id,
      changeKey: e.changeKey,
      title: e.title,
      reason: e.reason,
      changeType: e.changeType,
      method: e.method,
      environment: e.environment,
      destructive: e.destructive,
      status: e.status,
      appliedAt: e.appliedAt?.toISOString() ?? null,
      appliedBy: e.appliedBy,
      approvedBy: e.approvedBy,
      rollbackPlan: e.rollbackPlan,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

// ════════════════════ /system/tire-stock-requests ════════════════════

interface SizeAgg {
  size: string;
  count: number;
}

interface TireRequestRow {
  id: string;
  capturedAt: string | null;
  size: string;
  quantity: number;
  callerName: string | null;
  callerPhone: string | null;
  vehicle: string | null;
  urgency: string;
  notes: string | null;
}

export interface TireStockRequestsView {
  windowDays: number;
  sinceIso: string;
  totalRequests: number;
  urgentCount: number;
  urgencyRate: number;
  topSizes: SizeAgg[];
  dailyHistogram: Array<{ date: string; count: number; urgent: number }>;
  recent: TireRequestRow[];
}

/** Used-tire stock-check log · reads BrainMemory(category=
 *  "tire_stock_request") rows and aggregates. The Json `content`
 *  column is JSON.parsed + projected to scalar fields inside the
 *  service — no Prisma Json reaches the procedure. Lifted verbatim
 *  from app/api/system/tire-stock-requests/route.ts. `days` clamped
 *  1-365. */
export async function buildTireStockRequests(opts: {
  days?: number;
}): Promise<TireStockRequestsView> {
  const days = Math.max(1, Math.min(365, opts.days ?? 30));
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.brainMemory.findMany({
    where: {
      category: "tire_stock_request",
      createdAt: { gte: since },
      deletedAt: null,
    },
    select: { id: true, content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const sizeBuckets = new Map<string, number>();
  const dailyMap = new Map<string, { count: number; urgent: number }>();
  let urgentCount = 0;
  const recent: TireRequestRow[] = [];

  for (const r of rows) {
    let parsed:
      | {
          tireSize?: string;
          quantity?: number;
          callerName?: string | null;
          callerPhone?: string | null;
          vehicle?: {
            year?: string | number | null;
            make?: string | null;
            model?: string | null;
          };
          urgency?: string;
          notes?: string | null;
          capturedAt?: string;
        }
      | null = null;
    try {
      parsed = JSON.parse(r.content);
    } catch {
      log.warn("tire_stock_parse_failed", { id: r.id });
      continue;
    }
    if (!parsed) continue;

    const size = (parsed.tireSize ?? "(unknown)").trim();
    sizeBuckets.set(size, (sizeBuckets.get(size) ?? 0) + 1);
    const isUrgent = parsed.urgency === "urgent";
    if (isUrgent) urgentCount += 1;

    const dayKey = (parsed.capturedAt ?? r.createdAt.toISOString()).slice(
      0,
      10,
    );
    const dayBucket = dailyMap.get(dayKey) ?? { count: 0, urgent: 0 };
    dayBucket.count += 1;
    if (isUrgent) dayBucket.urgent += 1;
    dailyMap.set(dayKey, dayBucket);

    if (recent.length < 25) {
      const v = parsed.vehicle ?? {};
      const vehStr =
        [v.year, v.make, v.model].filter(Boolean).join(" ").trim() || null;
      recent.push({
        id: r.id,
        capturedAt: parsed.capturedAt ?? r.createdAt.toISOString(),
        size,
        quantity: parsed.quantity ?? 1,
        callerName: parsed.callerName ?? null,
        callerPhone: parsed.callerPhone ?? null,
        vehicle: vehStr,
        urgency: parsed.urgency ?? "normal",
        notes: parsed.notes ?? null,
      });
    }
  }

  const topSizes: SizeAgg[] = Array.from(sizeBuckets.entries())
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const dailyHistogram: Array<{
    date: string;
    count: number;
    urgent: number;
  }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const dayKey = d.toISOString().slice(0, 10);
    const v = dailyMap.get(dayKey) ?? { count: 0, urgent: 0 };
    dailyHistogram.push({ date: dayKey, ...v });
  }

  return {
    windowDays: days,
    sinceIso: since.toISOString(),
    totalRequests: rows.length,
    urgentCount,
    urgencyRate:
      rows.length > 0
        ? Number(((urgentCount / rows.length) * 100).toFixed(1))
        : 0,
    topSizes,
    dailyHistogram,
    recent,
  };
}

// ══════════════════ /system/history · actor firehose ══════════════════

interface ActorActivityEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  reason: string | null;
  source: string | null;
  createdAt: string;
}

export interface ActorActivityView {
  count: number;
  entries: ActorActivityEntry[];
  mode: "actor-firehose";
}

/** Recent entity-audit activity by one actor across all entities ·
 *  the /system/history firehose mode. Wraps the shared
 *  `getActorActivity` service the legacy REST route also calls. The
 *  AuditEntry `before`/`after` Json columns are dropped (the page's
 *  `FirehoseEntry` shape never reads them) and `createdAt` is
 *  stringified — no Prisma Json reaches the procedure. */
export async function buildActorActivity(opts: {
  actor: string;
  action?: AuditAction;
  since?: Date;
  limit?: number;
}): Promise<ActorActivityView> {
  const entries = await getActorActivity(opts.actor, {
    limit: opts.limit,
    since: opts.since,
  });
  // The REST route's actor-firehose branch passed `action` straight
  // through to `getActorActivity`, which does NOT accept it — so the
  // legacy `?action=` param was a silent no-op on the firehose path.
  // Preserved here: `action` is accepted at the boundary for shape
  // parity with the page's call but not applied (matching legacy
  // behavior · the page sends it but the firehose never filtered).
  void opts.action;
  return {
    count: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      entityType: e.entityType,
      entityId: e.entityId,
      action: e.action,
      actor: e.actor,
      reason: e.reason,
      source: e.source,
      createdAt: e.createdAt.toISOString(),
    })),
    mode: "actor-firehose" as const,
  };
}

// ════════════════════════════ /system/logs ════════════════════════════

type LogLevel = "error" | "warn" | "info" | "success" | "metric";
type LogSource = "errors" | "crons" | "metrics" | "actions" | "requests";

/** One unified-log row. The `meta` bag carries scalar/array values
 *  projected from the source rows — the SystemMetric `tags` /
 *  ErrorLog `context` Json columns are nested under `meta` typed
 *  `unknown` so the recursive JsonValue stays out of the AppRouter
 *  (TS2589 firewall). */
export interface SystemLogEntry {
  id: string;
  ts: string;
  source: LogSource;
  level: LogLevel;
  label: string;
  detail: string | null;
  meta?: Record<string, unknown>;
}

export interface SystemLogsView {
  entries: SystemLogEntry[];
  summary: {
    total: number;
    byLevel: Record<string, number>;
    bySource: Record<string, number>;
    sinceMs: number;
  };
  generatedAt: string;
}

/** Unified live tail across ErrorLog + CronJobLog + SystemMetric +
 *  AutonomousAction + ApiRequestLog. Lifted verbatim from
 *  app/api/system/logs/route.ts. `limit` clamped 10-500, `sinceMs`
 *  clamped 60s-24h. */
export async function buildSystemLogs(opts: {
  limit?: number;
  sinceMs?: number;
  level?: LogLevel;
  sources?: LogSource[];
}): Promise<SystemLogsView> {
  const limit = Math.min(500, Math.max(10, opts.limit ?? 200));
  const sinceMs = Math.min(
    86400_000,
    Math.max(60_000, opts.sinceMs ?? 3600_000),
  );
  const since = new Date(Date.now() - sinceMs);
  const levelFilter = opts.level ?? null;
  const sourceFilter = opts.sources ?? [];

  const wants = (s: LogSource) =>
    sourceFilter.length === 0 || sourceFilter.includes(s);
  const perSource = Math.max(
    20,
    Math.ceil(limit / Math.max(1, sourceFilter.length || 5)),
  );

  const [errors, crons, metrics, actions, requests] = await Promise.all([
    wants("errors")
      ? prisma.errorLog.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
    wants("crons")
      ? prisma.cronJobLog.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
    wants("metrics")
      ? prisma.systemMetric.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
    wants("actions")
      ? prisma.autonomousAction.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
    wants("requests")
      ? prisma.apiRequestLog.findMany({
          where: {
            createdAt: { gte: since },
            OR: [{ statusCode: { gte: 400 } }, { durationMs: { gte: 3000 } }],
          },
          orderBy: { createdAt: "desc" },
          take: perSource,
        })
      : [],
  ]);

  const entries: SystemLogEntry[] = [];

  for (const r of errors as Array<{
    id: string;
    createdAt: Date;
    level: string;
    message: string;
    stack: string | null;
    context: unknown;
  }>) {
    const sanitizedMsg = sanitizeError(r.message);
    entries.push({
      id: `err:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "errors",
      level:
        r.level === "fatal" || r.level === "error"
          ? "error"
          : r.level === "warn"
            ? "warn"
            : "info",
      label: sanitizedMsg.slice(0, 140),
      detail: r.stack ? sanitizeError(r.stack).slice(0, 300) : null,
      meta: { fullMessage: sanitizedMsg, context: redactSensitive(r.context) },
    });
  }

  for (const r of crons as Array<{
    id: string;
    createdAt: Date;
    jobName: string;
    status: string;
    duration: number | null;
    error: string | null;
  }>) {
    entries.push({
      id: `cron:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "crons",
      level: r.status === "failed" ? "error" : "success",
      label: `${r.jobName} · ${r.status}${
        r.duration != null ? ` · ${r.duration}ms` : ""
      }`,
      detail: r.error ? sanitizeError(r.error) : null,
      meta: { jobName: r.jobName, status: r.status, durationMs: r.duration },
    });
  }

  for (const r of metrics as Array<{
    id: string;
    createdAt: Date;
    metric: string;
    value: number;
    unit: string;
    tags: unknown;
    source: string;
  }>) {
    entries.push({
      id: `met:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "metrics",
      level: "metric",
      label: `${r.metric} = ${r.value}${r.unit || ""} [${r.source}]`,
      detail: null,
      meta: { tags: redactSensitive(r.tags), source: r.source, unit: r.unit },
    });
  }

  for (const r of actions as Array<{
    id: string;
    createdAt: Date;
    ruleName: string;
    actionType: string;
    result: string | null;
    error: string | null;
    approval: string;
  }>) {
    const failed = r.result === "failed";
    entries.push({
      id: `act:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "actions",
      level: failed ? "error" : r.approval === "pending" ? "warn" : "success",
      label: `${r.ruleName} · ${r.actionType} · ${r.result ?? "—"}`,
      detail: r.error ? sanitizeError(r.error) : null,
      meta: { ruleName: r.ruleName, approval: r.approval, result: r.result },
    });
  }

  for (const r of requests as Array<{
    id: string;
    createdAt: Date;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number | null;
    error: string | null;
  }>) {
    const isError = r.statusCode >= 500;
    const isSlow = (r.durationMs ?? 0) >= 3000;
    const level: LogLevel = isError
      ? "error"
      : r.statusCode >= 400 || isSlow
        ? "warn"
        : "info";
    const sanitizedPath = sanitizeError(r.path);
    entries.push({
      id: `req:${r.id}`,
      ts: r.createdAt.toISOString(),
      source: "requests",
      level,
      label: `${r.method} ${sanitizedPath} · ${r.statusCode}${
        r.durationMs ? ` · ${r.durationMs}ms${isSlow ? " ⚠ slow" : ""}` : ""
      }`,
      detail: r.error ? sanitizeError(r.error) : null,
      meta: {
        method: r.method,
        path: sanitizedPath,
        statusCode: r.statusCode,
        durationMs: r.durationMs,
      },
    });
  }

  let filtered = entries;
  if (levelFilter) {
    filtered = filtered.filter((e) => e.level === levelFilter);
  }

  filtered.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  filtered = filtered.slice(0, limit);

  const summary = {
    total: filtered.length,
    byLevel: filtered.reduce<Record<string, number>>((acc, e) => {
      acc[e.level] = (acc[e.level] ?? 0) + 1;
      return acc;
    }, {}),
    bySource: filtered.reduce<Record<string, number>>((acc, e) => {
      acc[e.source] = (acc[e.source] ?? 0) + 1;
      return acc;
    }, {}),
    sinceMs,
  };

  return {
    entries: filtered,
    summary,
    generatedAt: new Date().toISOString(),
  };
}
