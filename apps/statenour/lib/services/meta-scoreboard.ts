/**
 * lib/services/meta-scoreboard.ts · Phase A.2 (2026-05-18)
 *
 * The "What matters now" meta-scoreboard.
 *
 * Per brainstorm Decisions 5-7 (ADR-0010 follow-up):
 *   · Single meta-page shows 5-10 numbers that ACTUALLY move the
 *     operator
 *   · Nick picks them daily based on what's anomalous · static when
 *     calm · alive when something matters
 *   · Brief (Phase 5) writes a baseline picked-set once at 6am · this
 *     service hydrates that + adds anomaly deltas
 *   · Anchor numbers when nothing is anomalous so the page never feels
 *     dead
 *
 * Implementation philosophy: cheap · pure-function · no AI calls in
 * the read path. Anchors always present · anomalies displace when
 * triggered.
 *
 * Distinct from `lib/services/scoreboard.ts` (existing surface for
 * personal-mastery daily score capture · different concern). This
 * service composes the META view: ops + mastery + customer + system
 * health in one place.
 *
 * See: ADR-0011 · /scoreboard page · brief integration
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/meta-scoreboard");

export type Trend = "up" | "down" | "flat";

export interface ScoreboardNumber {
  key: string;
  label: string;
  value: number;
  /** Display unit · "$" · "%" · "" for raw count */
  unit: string;
  /** Pretty-printed value */
  display: string;
  delta7d: number | null;
  trend: Trend;
  /** Whether Nick picked this as anomalous vs a static anchor */
  anomalous: boolean;
  /** One-liner narration · only set for anomalous picks */
  why: string | null;
  /** Optional drill-down URL */
  link: string | null;
}

export interface MetaScoreboardSnapshot {
  numbers: ScoreboardNumber[];
  composedAt: string;
  lastBriefAt: string | null;
  state: "calm" | "alive";
  /** Phase A.3 · whether today's brief pinned a scoreboard snapshot
   *  at 10:00 UTC. When present, page can render "Δ since brief"
   *  annotations · operator knows what mattered when brief fired. */
  pinnedAt: string | null;
  /** Phase A.3 · brief-time picks (subset of current numbers · may
   *  differ from live numbers if state flipped between brief + now) */
  pinnedNumbers: ScoreboardNumber[] | null;
}

// ── Anchor pickers · cheap reads · always present ───────────────────

async function pickRevenueToday(): Promise<ScoreboardNumber> {
  const ev = await prisma.auditEvent
    .findFirst({
      where: { eventType: "ceo_business_context" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    })
    .catch(() => null);
  const ctx = (ev?.payload ?? {}) as Record<string, unknown>;
  const rev = (ctx.revenue ?? ctx.revenueToday ?? {}) as Record<string, unknown>;
  const cents = Number(rev.todayCents ?? rev.cents ?? 0);
  const dollars = Math.round(cents / 100);
  return {
    key: "revenue_today",
    label: "Revenue today",
    value: dollars,
    unit: "$",
    display: `$${dollars.toLocaleString()}`,
    delta7d: null,
    trend: "flat",
    anomalous: false,
    why: null,
    link: "/financial",
  };
}

async function pickOpenTasks(): Promise<ScoreboardNumber> {
  const n = await prisma.task
    .count({
      where: {
        status: { in: ["INBOX", "READY", "DOING"] },
        deletedAt: null,
      },
    })
    .catch(() => 0);
  return {
    key: "open_tasks",
    label: "Open tasks",
    value: n,
    unit: "",
    display: n.toString(),
    delta7d: null,
    trend: "flat",
    anomalous: false,
    why: null,
    link: "/tasks",
  };
}

async function pickActiveCommitments(): Promise<ScoreboardNumber> {
  const n = await prisma.commitment
    .count({ where: { status: { in: ["active", "in_progress"] } } })
    .catch(() => 0);
  return {
    key: "active_commitments",
    label: "Active commitments",
    value: n,
    unit: "",
    display: n.toString(),
    delta7d: null,
    trend: "flat",
    anomalous: false,
    why: null,
    link: "/tasks?filter=commitments",
  };
}

async function pickUnresolvedAlerts(): Promise<ScoreboardNumber> {
  const n = await prisma.driftAlert
    .count({ where: { resolved: false } })
    .catch(() => 0);
  return {
    key: "unresolved_alerts",
    label: "Drift alerts",
    value: n,
    unit: "",
    display: n.toString(),
    delta7d: null,
    trend: n > 0 ? "down" : "flat",
    anomalous: false,
    why: null,
    link: "/system/logs?view=grouped",
  };
}

async function pickMasteryTopMover(): Promise<ScoreboardNumber | null> {
  const recent = await prisma.masteryScore
    .findMany({ orderBy: { date: "desc" }, take: 100 })
    .catch(() => []);
  if (recent.length === 0) return null;
  const latestByDomain = new Map<string, { score: number; date: string }>();
  for (const r of recent) {
    if (!latestByDomain.has(r.domain)) {
      latestByDomain.set(r.domain, { score: Number(r.score), date: r.date });
    }
  }
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const older = await prisma.masteryScore
    .findMany({
      where: { date: { lte: cutoff } },
      orderBy: { date: "desc" },
      take: 100,
    })
    .catch(() => []);
  const olderByDomain = new Map<string, number>();
  for (const r of older) {
    if (!olderByDomain.has(r.domain)) {
      olderByDomain.set(r.domain, Number(r.score));
    }
  }
  let best: { domain: string; delta: number; score: number } | null = null;
  for (const [domain, { score }] of latestByDomain) {
    const prior = olderByDomain.get(domain) ?? score;
    const delta = score - prior;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = { domain, delta, score };
    }
  }
  if (!best || Math.abs(best.delta) < 0.3) return null;
  return {
    key: `mastery_${best.domain}`,
    label: `Mastery · ${best.domain}`,
    value: Math.round(best.score * 10) / 10,
    unit: "",
    display: best.score.toFixed(1),
    delta7d: Math.round(best.delta * 100) / 100,
    trend: best.delta > 0 ? "up" : "down",
    anomalous: false,
    why: null,
    link: "/goals",
  };
}

// ── Anomaly detectors · only surface when triggered ─────────────────

async function detectCronFailureBurst(): Promise<ScoreboardNumber | null> {
  const since24h = new Date(Date.now() - 86_400_000);
  const failed = await prisma.cronJobLog
    .count({ where: { status: "failed", createdAt: { gte: since24h } } })
    .catch(() => 0);
  if (failed < 3) return null;
  return {
    key: "cron_failures_24h",
    label: "Failed crons · 24h",
    value: failed,
    unit: "",
    display: failed.toString(),
    delta7d: null,
    trend: "down",
    anomalous: true,
    why: `${failed} cron runs failed in last 24h · expected ~0`,
    link: "/system/crons",
  };
}

async function detectStaleGoalSurge(): Promise<ScoreboardNumber | null> {
  const stale = await prisma.brainMemory
    .count({ where: { category: "goal_prune_candidate", deletedAt: null } })
    .catch(() => 0);
  if (stale < 3) return null;
  return {
    key: "stale_goals",
    label: "Stale goals · review",
    value: stale,
    unit: "",
    display: stale.toString(),
    delta7d: null,
    trend: "down",
    anomalous: true,
    why: `${stale} goals haven't moved in 30+ days · open /goals to prune`,
    link: "/goals",
  };
}

async function detectCallbacksWaiting(): Promise<ScoreboardNumber | null> {
  const ev = await prisma.auditEvent
    .findFirst({
      where: { eventType: "ceo_business_context" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    })
    .catch(() => null);
  const ctx = (ev?.payload ?? {}) as Record<string, unknown>;
  const cb = (ctx.callbacks ?? {}) as Record<string, unknown>;
  const pending = Number(cb.pendingCount ?? cb.pending ?? 0);
  if (pending < 1) return null;
  return {
    key: "callbacks_pending",
    label: "Customer callbacks waiting",
    value: pending,
    unit: "",
    display: pending.toString(),
    delta7d: null,
    trend: "down",
    anomalous: true,
    why: `${pending} customer${pending === 1 ? "" : "s"} waiting for a callback`,
    link: "/customer-360",
  };
}

async function detectUnresolvedAlertSurge(): Promise<ScoreboardNumber | null> {
  const n = await prisma.driftAlert
    .count({ where: { resolved: false } })
    .catch(() => 0);
  if (n < 10) return null; // only "anomalous" when 10+ pile up
  return {
    key: "alert_surge",
    label: "Alert surge",
    value: n,
    unit: "",
    display: n.toString(),
    delta7d: null,
    trend: "down",
    anomalous: true,
    why: `${n} drift alerts unresolved · operator review needed`,
    link: "/system/logs?view=grouped",
  };
}

// ── Composer ────────────────────────────────────────────────────────

const ANCHOR_COUNT = 5;
const MAX_NUMBERS = 10;

export async function buildMetaScoreboard(): Promise<MetaScoreboardSnapshot> {
  const [anchors, anomalies, lastBrief, pinnedRow] = await Promise.all([
    Promise.all([
      pickRevenueToday(),
      pickOpenTasks(),
      pickActiveCommitments(),
      pickUnresolvedAlerts(),
      pickMasteryTopMover(),
    ]).then((r) => r.filter((n): n is ScoreboardNumber => n !== null)),
    Promise.all([
      detectCronFailureBurst(),
      detectStaleGoalSurge(),
      detectCallbacksWaiting(),
      detectUnresolvedAlertSurge(),
    ]).then((r) => r.filter((n): n is ScoreboardNumber => n !== null)),
    prisma.brainMemory
      .findFirst({
        where: { category: "morning_brief" },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      })
      .catch(() => null),
    // Phase A.3 · latest brief-time pinned scoreboard snapshot
    prisma.brainMemory
      .findFirst({
        where: { category: "scoreboard_pinned", deletedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true, metadata: true },
      })
      .catch(() => null),
  ]).catch((err) => {
    log.warn("snapshot_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    throw err;
  });

  // Anomalies always at top · anchors fill the rest up to MAX_NUMBERS
  const numbers: ScoreboardNumber[] = [
    ...anomalies,
    ...anchors.slice(0, Math.max(ANCHOR_COUNT, MAX_NUMBERS - anomalies.length)),
  ].slice(0, MAX_NUMBERS);

  // Phase A.3 · decode pinned numbers from BrainMemory metadata
  let pinnedNumbers: ScoreboardNumber[] | null = null;
  const pinnedMeta = pinnedRow?.metadata as
    | { numbers?: ScoreboardNumber[] }
    | null
    | undefined;
  if (pinnedMeta?.numbers && Array.isArray(pinnedMeta.numbers)) {
    pinnedNumbers = pinnedMeta.numbers;
  }

  return {
    numbers,
    composedAt: new Date().toISOString(),
    lastBriefAt: lastBrief?.updatedAt?.toISOString() ?? null,
    state: anomalies.length > 0 ? "alive" : "calm",
    pinnedAt: pinnedRow?.updatedAt?.toISOString() ?? null,
    pinnedNumbers,
  };
}

export { ANCHOR_COUNT, MAX_NUMBERS };
