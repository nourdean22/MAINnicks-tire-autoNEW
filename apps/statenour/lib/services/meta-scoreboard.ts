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
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { queryNickBatch } from "@/lib/nickstire/query";
import { readNickRevenue } from "@/lib/nickstire/revenue";
import { startOfDayET } from "@/lib/utils/datetime";

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
  /**
   * 2026-08-19 · unknown-is-not-zero: `false` means the read FAILED and
   * `value`/`display` are placeholders, not measurements. Absent =
   * measured (back-compat with pinned snapshots). A failed instrument
   * renders as "—" and surfaces as an anomaly — it never renders as a
   * calm zero (the fleet-truth rule: unknown never counts as healthy).
   */
  measured?: boolean;
}

/** Instrument-failure card — a read that threw, surfaced loudly. */
function unmeasured(
  key: string,
  label: string,
  why: string,
  link: string | null,
): ScoreboardNumber {
  return {
    key,
    label,
    value: 0,
    unit: "",
    display: "—",
    delta7d: null,
    trend: "flat",
    anomalous: true,
    why,
    link,
    measured: false,
  };
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
  // Source of truth = the SAME live bridge query the top ticker reads
  // (lib/services/ultron-ticker.ts → queryNickBatch "revenue_today"), so
  // /scoreboard and the ticker can never disagree. nickstire returns
  // { totalDollars, invoiceCount } in DOLLARS. Falls back to the mirrored
  // ceo_business_context audit event when the bridge is unreachable.
  //
  // 2026-05-29 bugfix: the old code read `revenue.todayCents`/`cents`
  // (cents) — keys that don't exist on nickstire's v2 payload — so the
  // `?? 0` silently floored revenue to $0 on the scoreboard while the
  // ticker showed the real number (e.g. $2,772 · 5 jobs). Root cause:
  // payload-key drift between the sync shape and this reader.
  let dollars: number | null = null;
  try {
    const batch = await queryNickBatch([{ query: "revenue_today" }]);
    const live = (
      batch.revenue_today as { data?: Record<string, unknown> } | undefined
    )?.data;
    if (live && typeof live.totalDollars === "number") {
      dollars = Math.round(live.totalDollars);
    }
  } catch {
    // bridge unreachable · fall through to the pushed-event mirror below
  }
  // 2026-08-19 · unknown-is-not-zero: the mirror fallback used to read
  // the latest ceo_business_context row with NO recency bound — a
  // week-old payload rendered as "Revenue today" with a flat trend.
  // The mirror is now honest about its age, and no-data renders as "—",
  // never as $0.
  let mirrorAgeHours: number | null = null;
  if (dollars === null) {
    const ev = await prisma.auditEvent
      .findFirst({
        where: { eventType: "ceo_business_context" },
        orderBy: { createdAt: "desc" },
        select: { payload: true, createdAt: true },
      })
      .catch(() => null);
    if (ev) {
      const ctx = (ev.payload ?? {}) as Record<string, unknown>;
      dollars = readNickRevenue(ctx.revenue ?? ctx.revenueToday).todayDollars;
      mirrorAgeHours = Math.floor((Date.now() - ev.createdAt.getTime()) / 3_600_000);
    }
  }
  if (dollars === null) {
    return unmeasured(
      "revenue_today",
      "Revenue today",
      "bridge unreachable and no mirrored payload — revenue is UNKNOWN, not $0",
      "/business?tab=money",
    );
  }
  const mirrorIsStale = mirrorAgeHours !== null && mirrorAgeHours >= 24;
  return {
    key: "revenue_today",
    label: "Revenue today",
    value: dollars,
    unit: "$",
    display: `$${dollars.toLocaleString()}`,
    delta7d: null,
    trend: "flat",
    anomalous: mirrorIsStale,
    why: mirrorIsStale
      ? `bridge unreachable — this figure is a mirror from ${Math.floor((mirrorAgeHours ?? 0) / 24)}d ago, not today`
      : null,
    link: "/business?tab=money",
    ...(mirrorIsStale ? { measured: false } : {}),
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
    .catch(() => null);
  if (n === null) {
    return unmeasured(
      "open_tasks",
      "Open tasks",
      "task count unreadable — instrument failure, not an empty board",
      "/missions",
    );
  }
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
    link: "/missions",
  };
}

async function pickActiveCommitments(): Promise<ScoreboardNumber> {
  const n = await prisma.commitment
    .count({ where: { status: { in: ["active", "in_progress"] }, deletedAt: null } })
    .catch(() => null);
  if (n === null) {
    return unmeasured(
      "active_commitments",
      "Active commitments",
      "commitment count unreadable — instrument failure, not zero promises",
      "/missions?filter=commitments",
    );
  }
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
    link: "/missions?filter=commitments",
  };
}

// 2026-05-29 · Sam pass · "Drift alerts" (unresolved_alerts) removed from
// the outcomes scoreboard. It answered "is the machine ok," not "am I
// winning" — system-health plumbing belongs on /system. Drift recovery
// still reaches the operator via the CoachEventBanner (drift-recovery
// events) + /system/logs.

async function pickMasteryTopMover(): Promise<ScoreboardNumber | null> {
  const recent = await prisma.masteryScore
    .findMany({ orderBy: { date: "desc" }, take: 100 })
    .catch(() => null);
  if (recent === null) {
    return unmeasured(
      "mastery_top_mover",
      "Mastery · top mover",
      "mastery scores unreadable — the mover is unknown, not absent",
      "/stats",
    );
  }
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
    link: "/stats",
  };
}

// ── Anomaly detectors · only surface when triggered ─────────────────

// 2026-05-29 · Sam pass · "Failed crons · 24h" removed from the outcomes
// scoreboard. Cron health is pure system plumbing — it lives on
// /system/crons, not the "what matters now" board.

async function detectStaleGoalSurge(): Promise<ScoreboardNumber | null> {
  // 2026-08-19 · a failed read used to floor to 0 and silently suppress
  // this anomaly forever. A detector that cannot see must say so.
  const stale = await prisma.brainMemory
    .count({ where: { category: BRAIN_CATEGORIES.GOAL_PRUNE_CANDIDATE, deletedAt: null } })
    .catch(() => null);
  if (stale === null) {
    return unmeasured(
      "stale_goals",
      "Stale goals · review",
      "stale-goal check unreadable — the detector is blind, not clear",
      "/stats",
    );
  }
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
    why: `${stale} goals haven't moved in 30+ days · open /stats to prune`,
    link: "/stats",
  };
}

async function detectCallbacksWaiting(): Promise<ScoreboardNumber | null> {
  // 2026-08-19 · read FAILURE now surfaces (a blind detector must say
  // so); a genuinely absent mirror row (sync never pushed) stays quiet
  // as before — absence of the lane is not an instrument fault here.
  const ev = await prisma.auditEvent
    .findFirst({
      where: { eventType: "ceo_business_context" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    })
    .catch(() => "read_failed" as const);
  if (ev === "read_failed") {
    return unmeasured(
      "callbacks_pending",
      "Customer callbacks waiting",
      "callback mirror unreadable — waiting customers are unknown, not zero",
      "/customer-360",
    );
  }
  const ctx = (ev?.payload ?? {}) as Record<string, unknown>;
  const cb = (ctx.callbacks ?? {}) as Record<string, unknown>;
  // The pushed ceo_business_context payload (nickstire statenourSync.ts)
  // emits callbacks:{ total, new, completed, thisWeek } — there is NO
  // `pendingCount` (that key belongs to the LIVE bridge ShopSnapshot, a
  // different contract). Reading pendingCount here floored to 0, so this
  // "callbacks waiting" anomaly NEVER fired even as callbacks piled up —
  // the same payload-key-drift class as the revenue-$0 bug. `new` is the
  // unhandled-callback signal; old keys kept as defensive fallbacks.
  const pending = Number(cb.new ?? cb.pendingCount ?? cb.pending ?? 0);
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

// 2026-05-29 · Sam pass · "Alert surge" removed from the outcomes
// scoreboard. It counted the same unresolved driftAlerts as the former
// "Drift alerts" anchor — system-health plumbing, now /system-only.

// ── Composer ────────────────────────────────────────────────────────

const ANCHOR_COUNT = 5;
const MAX_NUMBERS = 10;

export async function buildMetaScoreboard(): Promise<MetaScoreboardSnapshot> {
  const [anchors, anomalies, lastBrief, pinnedRow] = await Promise.all([
    Promise.all([
      pickRevenueToday(),
      pickOpenTasks(),
      pickActiveCommitments(),
      pickMasteryTopMover(),
    ]).then((r) => r.filter((n): n is ScoreboardNumber => n !== null)),
    Promise.all([
      detectStaleGoalSurge(),
      detectCallbacksWaiting(),
    ]).then((r) => r.filter((n): n is ScoreboardNumber => n !== null)),
    prisma.brainMemory
      .findFirst({
        where: { category: BRAIN_CATEGORIES.MORNING_BRIEF },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      })
      .catch(() => null),
    // Phase A.3 · latest brief-time pinned scoreboard snapshot.
    // 2026-08-19 · bounded to TODAY (ET): without the bound, a missed
    // morning-brief run silently served an older day's pin as the
    // "Δ since brief" baseline — stale data dressed as current.
    prisma.brainMemory
      .findFirst({
        where: {
          category: BRAIN_CATEGORIES.SCOREBOARD_PINNED,
          deletedAt: null,
          updatedAt: { gte: startOfDayET() },
        },
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
    // Any anomalous card counts — including a failed-instrument anchor
    // (measured:false). A board that cannot read itself is not "calm".
    state: numbers.some((n) => n.anomalous) ? "alive" : "calm",
    pinnedAt: pinnedRow?.updatedAt?.toISOString() ?? null,
    pinnedNumbers,
  };
}
