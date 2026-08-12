/**
 * Identity Snapshot — 8-axis rolling self-model. Apr 19.
 *
 * Nour asked for "a deepening model of who I am across all sessions."
 * This is the backbone: 8 numeric axes computed from the real data
 * we already capture (tasks, commitments, reflections, brain dumps,
 * chat_importance). Each axis has:
 *
 *   • value       — 0-100 normalized score
 *   • direction   — "rising" | "falling" | "stable" (vs last snapshot)
 *   • evidence    — 2-3 short strings the UI can show on hover
 *   • manual      — optional Nour-override that wins over computed value
 *   • updated_at  — last time the axis changed bucket
 *
 * Axes (chosen deliberately to match Nour's operating vocabulary):
 *   1. velocity          — how fast he closes tasks at his estimate
 *   2. patience_horizon  — how far out he commits to things
 *   3. promise_integrity — kept vs broken promises ratio
 *   4. dopamine_discipline — capture cadence / phone-idle rhythm
 *   5. business_vs_personal — task context distribution balance
 *   6. risk_appetite     — % of critical+high priority vs med+low
 *   7. social_battery    — distinct persons mentioned / week
 *   8. reflection_cadence — days between reflections, inverted
 *
 * Storage: BrainMemory category="identity_snapshot" key="current"
 * (latest) + key="history:YYYY-MM-DD" for daily rollup. No schema
 * change. Cron refresh-identity runs daily 04:30 to roll the bucket.
 *
 * Manual override policy: Nour can pin any axis via /api/identity
 * PATCH. Overrides persist until cleared. The computed value still
 * runs underneath and shows next to the override so he can see drift.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { cached, invalidate } from "@/lib/utils/cache";
import { today, toDateString } from "@/lib/utils/datetime";
import { logError } from "@/lib/utils/error-log";

export type AxisDirection = "rising" | "falling" | "stable";

export interface IdentityAxis {
  value: number;                      // 0-100 computed
  manual: number | null;              // 0-100 Nour-pinned override
  direction: AxisDirection;
  evidence: string[];                 // human-readable why-this-score
  updated_at: string;                 // ISO
}

export interface IdentitySnapshot {
  axes: {
    velocity: IdentityAxis;
    patience_horizon: IdentityAxis;
    promise_integrity: IdentityAxis;
    dopamine_discipline: IdentityAxis;
    business_vs_personal: IdentityAxis;
    risk_appetite: IdentityAxis;
    social_battery: IdentityAxis;
    reflection_cadence: IdentityAxis;
  };
  computed_at: string;
  data_horizon_days: number;
}

export type AxisKey = keyof IdentitySnapshot["axes"];

const AXIS_LABELS: Record<AxisKey, string> = {
  velocity: "Velocity",
  patience_horizon: "Patience horizon",
  promise_integrity: "Promise integrity",
  dopamine_discipline: "Dopamine discipline",
  business_vs_personal: "Business/personal split",
  risk_appetite: "Risk appetite",
  social_battery: "Social battery",
  reflection_cadence: "Reflection cadence",
};

export function axisLabel(key: AxisKey): string {
  return AXIS_LABELS[key];
}

// ── Axis computers ────────────────────────────────────────────────────

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Velocity — compares actualMinutes to effort-band expectations over
 * the last 30d. Higher = Nour tends to close tasks at or under the
 * estimate he sets. Lower = chronic overruns.
 */
async function computeVelocity(): Promise<Omit<IdentityAxis, "direction" | "manual" | "updated_at">> {
  const since = new Date(Date.now() - 30 * 86400_000);
  const tasks = await prisma.task.findMany({
    where: { status: "DONE", updatedAt: { gte: since }, actualMinutes: { gt: 0 }, deletedAt: null },
    select: { effort: true, actualMinutes: true },
    take: 200,
  });
  if (tasks.length < 3) {
    return { value: 50, evidence: [`only ${tasks.length} DONE tasks with time in 30d`] };
  }
  // Expected minutes by band (generous — rewards under-runs)
  const EXPECTED: Record<string, number> = {
    M5: 5, M15: 15, M30: 30, H1: 60, H2: 120, H4: 240, H8: 480,
  };
  let under = 0;
  let over = 0;
  for (const t of tasks) {
    const exp = EXPECTED[t.effort] ?? 60;
    if (t.actualMinutes <= exp) under++;
    else if (t.actualMinutes > exp * 1.3) over++;
  }
  const ratio = under / tasks.length;
  return {
    value: clamp(ratio * 100),
    evidence: [
      `${under}/${tasks.length} done at-or-under estimate`,
      over > 0 ? `${over} ran >30% over` : "no >30% overruns",
    ],
  };
}

/**
 * Patience horizon — median distance between commitment made-date and
 * deadline. Longer horizons = more patient planner.
 */
async function computePatienceHorizon(): Promise<Omit<IdentityAxis, "direction" | "manual" | "updated_at">> {
  const commits = await prisma.commitment.findMany({
    where: { deadline: { not: null }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { dateMade: true, deadline: true },
  });
  if (commits.length < 3) {
    return { value: 50, evidence: [`${commits.length} commitments with deadline`] };
  }
  const gaps: number[] = [];
  for (const c of commits) {
    if (!c.deadline) continue;
    try {
      const made = new Date(c.dateMade).getTime();
      const dead = new Date(c.deadline).getTime();
      const days = (dead - made) / 86400_000;
      if (days >= 0 && days < 180) gaps.push(days);
    } catch {
      // skip malformed
    }
  }
  if (gaps.length === 0) {
    return { value: 50, evidence: ["no parseable deadline gaps"] };
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  // Map: 0 days = 20, 3 days = 50, 14 days = 80, 30+ days = 95
  const value =
    median < 1 ? 20 :
    median < 3 ? 40 :
    median < 7 ? 60 :
    median < 14 ? 75 :
    median < 30 ? 85 : 95;
  return {
    value,
    evidence: [`median horizon ${Math.round(median)}d`, `${gaps.length} commitments sampled`],
  };
}

/**
 * Promise integrity — kept vs broken ratio in last 60d.
 */
// Exported for direct unit testing (same rationale as sanitizeDeadline in
// commitments.ts) — the status-vocabulary this reads is exactly the bug
// class worth pinning in isolation, without mocking computeIdentitySnapshot's
// other seven axis computers.
export async function computePromiseIntegrity(): Promise<Omit<IdentityAxis, "direction" | "manual" | "updated_at">> {
  const since = new Date(Date.now() - 60 * 86400_000);
  const commits = await prisma.commitment.findMany({
    where: { updatedAt: { gte: since }, deletedAt: null },
    select: { status: true },
  });
  if (commits.length < 3) {
    return { value: 60, evidence: [`only ${commits.length} commitments in 60d`] };
  }
  // 2026-08-12 · vocabulary-mismatch fix. "kept"/"done"/"fulfilled" are
  // legacy/aspirational status strings nothing in this codebase ever
  // writes — the two LIVE completion paths are the completeCommitment
  // chat tool (status "completed") and the blueprint verifyCommitment
  // service (status "verified"), and neither was recognized here. Prod
  // read (2026-08-12): 7 completed + 1 verified vs 1 broken — the old
  // filter counted 0 kept, forcing the ratio to 0/1 regardless of how
  // many promises were actually honored. "abandoned" deliberately stays
  // OUT of both buckets: most abandoned rows are declined machine-
  // PROPOSED commitments (dismissProposed), never something the
  // operator promised — counting them as broken would penalize
  // follow-through for the system's own over-suggestion.
  const kept = commits.filter((c) => c.status === "kept" || c.status === "done" || c.status === "fulfilled" || c.status === "completed" || c.status === "verified").length;
  const broken = commits.filter((c) => c.status === "broken" || c.status === "missed").length;
  const active = commits.filter((c) => c.status === "active").length;
  const resolved = kept + broken;
  if (resolved === 0) return { value: 60, evidence: [`${active} active · none resolved yet`] };
  const ratio = kept / resolved;
  return {
    value: clamp(ratio * 100),
    evidence: [`${kept} kept · ${broken} broken`, `${active} still active`],
  };
}

/**
 * Dopamine discipline — proxied by capture cadence. A healthy cadence
 * (5-15 captures/day clumped around focus sessions) = high. Either
 * extreme (compulsive capturing or weeks of silence) = low.
 */
async function computeDopamineDiscipline(): Promise<Omit<IdentityAxis, "direction" | "manual" | "updated_at">> {
  const since = new Date(Date.now() - 14 * 86400_000);
  const dumps = await prisma.brainDump.count({ where: { deletedAt: null, createdAt: { gte: since } } });
  const perDay = dumps / 14;
  // Sweet spot 4-12/day → 90. <1/day or >25/day → 40.
  let value = 60;
  const evidence: string[] = [`${dumps} captures / 14d = ${perDay.toFixed(1)}/day`];
  if (perDay < 1) { value = 40; evidence.push("thin capture stream"); }
  else if (perDay > 25) { value = 45; evidence.push("compulsive capture"); }
  else if (perDay >= 4 && perDay <= 12) { value = 88; evidence.push("healthy rhythm"); }
  else if (perDay >= 2 && perDay < 4) { value = 70; evidence.push("under-capturing"); }
  else { value = 65; evidence.push("borderline high capture"); }
  return { value, evidence };
}

/**
 * Business/personal split — 0 = all personal, 50 = balanced, 100 = all
 * business. Nour's vocabulary treats both extremes as unhealthy; the
 * UI will render this as a bar with a sweet-spot band around 50-70.
 */
async function computeBusinessPersonal(): Promise<Omit<IdentityAxis, "direction" | "manual" | "updated_at">> {
  const since = new Date(Date.now() - 14 * 86400_000);
  const tasks = await prisma.task.findMany({
    where: { status: "DONE", updatedAt: { gte: since }, deletedAt: null },
    select: { context: true },
    take: 300,
  });
  if (tasks.length < 5) {
    return { value: 60, evidence: [`only ${tasks.length} done tasks / 14d`] };
  }
  // TaskContext enum sample: DESK, OUT, PHONE, ERRAND, PERSONAL, BODY
  const personalContexts = new Set(["PERSONAL", "BODY", "ERRAND"]);
  const biz = tasks.filter((t) => !personalContexts.has(t.context)).length;
  const pct = (biz / tasks.length) * 100;
  return {
    value: clamp(pct),
    evidence: [`${biz}/${tasks.length} business · 14d window`],
  };
}

/**
 * Risk appetite — share of DONE tasks that were critical/high priority.
 * Higher = Nour goes after the big scary stuff.
 */
async function computeRiskAppetite(): Promise<Omit<IdentityAxis, "direction" | "manual" | "updated_at">> {
  const since = new Date(Date.now() - 21 * 86400_000);
  const tasks = await prisma.task.findMany({
    where: { status: "DONE", updatedAt: { gte: since }, autoPriority: { not: null }, deletedAt: null },
    select: { autoPriority: true },
    take: 200,
  });
  if (tasks.length < 5) {
    return { value: 50, evidence: [`only ${tasks.length} done tasks with priority`] };
  }
  const hot = tasks.filter((t) => (t.autoPriority ?? 100) < 40).length;
  return {
    value: clamp((hot / tasks.length) * 100),
    evidence: [`${hot}/${tasks.length} were critical/high`],
  };
}

/**
 * Social battery — distinct person names in chat_importance rows
 * (persisted by importance-scorer) over the last 14d.
 */
async function computeSocialBattery(): Promise<Omit<IdentityAxis, "direction" | "manual" | "updated_at">> {
  const since = new Date(Date.now() - 14 * 86400_000);
  // v10.0.65 · soft-delete bypass fix. The social-battery axis
  // weighted by chat_importance rows; soft-deleted rows would still
  // skew the axis until hard-deleted. Now: only live rows.
  const rows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.CHAT_IMPORTANCE, createdAt: { gte: since }, deletedAt: null },
    select: { content: true },
    take: 400,
  });
  if (rows.length === 0) {
    return { value: 50, evidence: ["no chat_importance rows yet"] };
  }
  const persons = new Set<string>();
  let malformed = 0;
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as { extracted?: { person?: string | null } };
      const p = parsed.extracted?.person;
      if (p) persons.add(p.toLowerCase());
    } catch {
      // skip · aggregated below — up to 400 rows/pass, and raw parse
      // errors can embed chat-derived content in their message
      malformed++;
    }
  }
  if (malformed > 0) {
    logError(
      "brain.identity-snapshot",
      new Error(`${malformed} malformed chat_importance rows skipped`),
      { fn: "computeSocialBattery", malformed, scanned: rows.length },
      "warn",
    );
  }
  // 0 → 20, 3 → 60, 8 → 90
  const n = persons.size;
  const value = n === 0 ? 20 : n <= 2 ? 50 : n <= 5 ? 70 : n <= 10 ? 85 : 95;
  return {
    value,
    evidence: [`${n} distinct people mentioned · 14d`],
  };
}

/**
 * Reflection cadence — inverted days-since-last-reflection, averaged
 * over last 5. Lower gap = higher score.
 */
async function computeReflectionCadence(): Promise<Omit<IdentityAxis, "direction" | "manual" | "updated_at">> {
  const reflections = await prisma.reflection.findMany({
    where: { deletedAt: null }, // v10.0.68
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { createdAt: true },
  });
  if (reflections.length === 0) {
    return { value: 20, evidence: ["no reflections on record"] };
  }
  // Compute avg gap (in days)
  const gaps: number[] = [];
  for (let i = 0; i < reflections.length - 1; i++) {
    const gap =
      (reflections[i].createdAt.getTime() - reflections[i + 1].createdAt.getTime()) / 86400_000;
    if (gap >= 0 && gap < 60) gaps.push(gap);
  }
  const latestGap = (Date.now() - reflections[0].createdAt.getTime()) / 86400_000;
  gaps.push(latestGap);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  // 0d → 95, 1d → 85, 3d → 70, 7d → 50, 14d → 30, 30d → 15
  const value =
    avg <= 1 ? 90 :
    avg <= 3 ? 75 :
    avg <= 7 ? 55 :
    avg <= 14 ? 35 :
    avg <= 30 ? 20 : 10;
  return {
    value,
    evidence: [`avg gap ${avg.toFixed(1)}d`, `last reflected ${latestGap.toFixed(1)}d ago`],
  };
}

// ── Snapshot orchestration ───────────────────────────────────────────

// 2026-08-06 · read cache for the "current" row. See loadIdentitySnapshot()
// for why, and computeIdentitySnapshot() + setManualOverride() for the two
// invalidation points. Both writers of this row MUST invalidate.
const IDENTITY_CACHE_KEY = "identity_snapshot_current";
const IDENTITY_CACHE_TTL_S = 300; // 5 min

/**
 * 2026-08-06 · exported so resetBrainState can drop this cache.
 *
 * `identity_snapshot` is one of the categories resetBrainState deletes, so
 * without this the operator wipes their brain and /chat keeps rendering the
 * deleted self-model for up to 5 minutes. The two in-module invalidations
 * (computeIdentitySnapshot, setManualOverride) cannot cover that path
 * because the reset deletes the row directly without going through either.
 *
 * Same shape as invalidateQualitativeIdentityCache() — both are called from
 * lib/services/brain-domain.ts. Partial by design: this clears the calling
 * instance's L1 plus the shared L2 key; a sibling Railway replica's L1 ages
 * out on the TTL.
 */
export function invalidateIdentitySnapshotCache(): void {
  invalidate(IDENTITY_CACHE_KEY);
}

interface StoredAxisOverride {
  manual: number | null;
}

type StoredOverrides = Partial<Record<AxisKey, StoredAxisOverride>>;

async function loadCurrentOverrides(): Promise<StoredOverrides> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
    select: { content: true },
  }).catch(() => null);
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.content) as IdentitySnapshot;
    const out: StoredOverrides = {};
    for (const k of Object.keys(parsed.axes) as AxisKey[]) {
      if (parsed.axes[k]?.manual != null) {
        out[k] = { manual: parsed.axes[k]!.manual };
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function loadPreviousValues(): Promise<Partial<Record<AxisKey, number>>> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
    select: { content: true },
  }).catch(() => null);
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.content) as IdentitySnapshot;
    const out: Partial<Record<AxisKey, number>> = {};
    for (const k of Object.keys(parsed.axes) as AxisKey[]) {
      out[k] = parsed.axes[k]?.value;
    }
    return out;
  } catch {
    return {};
  }
}

function direction(prev: number | undefined, next: number): AxisDirection {
  if (prev == null) return "stable";
  const delta = next - prev;
  if (Math.abs(delta) < 4) return "stable";
  return delta > 0 ? "rising" : "falling";
}

/**
 * Compute + persist a fresh snapshot. Preserves manual overrides.
 * Also writes a history row keyed "history:YYYY-MM-DD" so we keep a
 * timeline Nour can scrub (future UI).
 */
export async function computeIdentitySnapshot(): Promise<IdentitySnapshot> {
  const [overrides, prev] = await Promise.all([loadCurrentOverrides(), loadPreviousValues()]);
  const now = new Date();
  const iso = now.toISOString();

  const [
    velocity,
    patience,
    promise,
    dopamine,
    bizPersonal,
    risk,
    social,
    reflection,
  ] = await Promise.all([
    computeVelocity(),
    computePatienceHorizon(),
    computePromiseIntegrity(),
    computeDopamineDiscipline(),
    computeBusinessPersonal(),
    computeRiskAppetite(),
    computeSocialBattery(),
    computeReflectionCadence(),
  ]);

  const build = (key: AxisKey, computed: { value: number; evidence: string[] }): IdentityAxis => ({
    value: Math.round(computed.value),
    manual: overrides[key]?.manual ?? null,
    direction: direction(prev[key], computed.value),
    evidence: computed.evidence,
    updated_at: iso,
  });

  const snapshot: IdentitySnapshot = {
    axes: {
      velocity: build("velocity", velocity),
      patience_horizon: build("patience_horizon", patience),
      promise_integrity: build("promise_integrity", promise),
      dopamine_discipline: build("dopamine_discipline", dopamine),
      business_vs_personal: build("business_vs_personal", bizPersonal),
      risk_appetite: build("risk_appetite", risk),
      social_battery: build("social_battery", social),
      reflection_cadence: build("reflection_cadence", reflection),
    },
    computed_at: iso,
    data_horizon_days: 30,
  };

  const payload = JSON.stringify(snapshot);
  // ET day-key (Cleveland). UTC slice rolled to the next calendar day
  // after 8pm ET → two history rows for one ET day. today() is ET-correct.
  const todayKey = today();
  await Promise.all([
    prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
      create: {
        category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
        key: "current",
        content: payload,
        confidence: 0.7,
        source: "identity_snapshot",
      },
      update: { content: payload, lastSeen: now },
    }),
    prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: `history:${todayKey}` } },
      create: {
        category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
        key: `history:${todayKey}`,
        content: payload,
        confidence: 0.7,
        source: "identity_snapshot",
      },
      update: { content: payload, lastSeen: now },
    }),
  ]);

  // v10.0.63 · brain-bus producer · emit score.logged so the brain
  // pipeline + chat search can subscribe to snapshot rolls.
  // Dedupes per day-source so the daily refresh cron + manual mastery
  // engagement both surface, but a hot loop doesn't double-record.
  void (async () => {
    const { emitScoreLogged } = await import("@/lib/db/brain-bus-emit");
    await emitScoreLogged({
      date: todayKey,
      snapshot,
      source: "identity-snapshot:compute",
    });
  })();

  // Apr 19 · Synthetic backfill for sparklines. On the very first
  // compute there's only one history point, which renders as nothing.
  // We seed the previous 6 days with slightly-perturbed values so the
  // sparkline is immediately readable. Only seeds if no history exists.
  const existingHistory = await prisma.brainMemory.count({
    where: { deletedAt: null, category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: { startsWith: "history:" } },
  }).catch(() => 999);
  if (existingHistory <= 1) {
    await seedSyntheticHistory(snapshot, now);
  }

  // 2026-08-06 · the "current" row just moved — drop the read cache so
  // the next loadIdentitySnapshot() serves THIS snapshot rather than the
  // one it replaced. Re-entrant-safe: when we're called from inside
  // loadIdentitySnapshot's own cache-miss path, cached() writes the
  // returned value after this line runs, so the entry it leaves behind
  // is the fresh snapshot.
  invalidate(IDENTITY_CACHE_KEY);

  return snapshot;
}

/**
 * One-time backfill: writes 6 synthetic history points for days t-6
 * through t-1 so sparklines are readable from day one. Each axis gets
 * small random walk ±5 points from today's computed value, clamped
 * to 0-100. Source tagged so it's clear these are synthetic.
 */
async function seedSyntheticHistory(current: IdentitySnapshot, now: Date): Promise<void> {
  for (let daysBack = 6; daysBack >= 1; daysBack--) {
    const date = new Date(now.getTime() - daysBack * 86400_000);
    const dateKey = toDateString(date); // ET day-key, matches todayKey above
    const synthetic: IdentitySnapshot = {
      ...current,
      computed_at: date.toISOString(),
      axes: Object.fromEntries(
        (Object.entries(current.axes) as Array<[AxisKey, IdentityAxis]>).map(([k, a]) => {
          // Random walk — stays within ±8 of today's value
          const delta = Math.round((Math.random() - 0.5) * 16);
          const value = Math.max(0, Math.min(100, (a.manual ?? a.value) + delta));
          return [
            k,
            {
              ...a,
              value,
              manual: null,
              direction: "stable" as AxisDirection,
              evidence: ["(backfill seed)"],
              updated_at: date.toISOString(),
            },
          ];
        }),
      ) as IdentitySnapshot["axes"],
    };
    // v10.0.38 — only INSERT; never overwrite existing rows. Pre-fix
    // the empty `update: {}` arm meant if real computed history ever
    // landed at the same dateKey, the synthetic seed silently won
    // (no-op update). Real backfill from a future identity-cron run
    // would never replace the seed. Now: skip if a row already
    // exists at this date — the seed is for first-run only.
    const existing = await prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: `history:${dateKey}` } },
        select: { id: true },
      })
      .catch(() => null);
    if (!existing) {
      await prisma.brainMemory
        .create({
          data: {
            category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
            key: `history:${dateKey}`,
            content: JSON.stringify(synthetic),
            confidence: 0.4, // lower — it's synthetic
            source: "identity_snapshot_synthetic",
          },
        })
        .catch(() => {});
    }
  }
}

/**
 * Load the current snapshot without recomputing. If none exists,
 * computes one on demand.
 *
 * 2026-08-06 · CACHED 5 min via the shared cached() helper. This sits on
 * the /chat per-turn hot path — buildIdentityContextBlock() fired on
 * 1417/1417 measured turns — and the row it reads is a slowly-changing
 * constant: the refresh-identity cron rolls it once a day at 04:30, and
 * the operator pins an axis by hand. Both of those writers invalidate
 * (computeIdentitySnapshot, setManualOverride), so a consumer never waits
 * out the TTL to see a real change.
 *
 * A cache MISS still pays the lazy-compute fallback below in full — the
 * cache caps how OFTEN that query storm fires, it does not remove it.
 */
export async function loadIdentitySnapshot(): Promise<IdentitySnapshot> {
  return cached(IDENTITY_CACHE_KEY, IDENTITY_CACHE_TTL_S, async () => {
    const row = await prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
      select: { content: true },
    });
    if (row) {
      try {
        return JSON.parse(row.content) as IdentitySnapshot;
      } catch (err) {
        // fall through
        logError("brain.identity-snapshot", err, { fn: "loadIdentitySnapshot", key: "current" }, "warn");
      }
    }
    return computeIdentitySnapshot();
  });
}

/**
 * Load the last N days of history:YYYY-MM-DD rows so the panel can
 * render a sparkline per axis. Returns rows in chronological order.
 */
export async function loadIdentityHistory(days = 30): Promise<Array<{
  date: string;
  axes: Partial<Record<AxisKey, number>>;
}>> {
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
      key: { startsWith: "history:" },
    },
    orderBy: { key: "asc" },
    take: days,
    select: { key: true, content: true },
  });
  const out: Array<{ date: string; axes: Partial<Record<AxisKey, number>> }> = [];
  let malformed = 0;
  for (const r of rows) {
    const date = r.key.replace("history:", "");
    try {
      const parsed = JSON.parse(r.content) as IdentitySnapshot;
      const axes: Partial<Record<AxisKey, number>> = {};
      for (const k of Object.keys(parsed.axes) as AxisKey[]) {
        axes[k] = parsed.axes[k].manual ?? parsed.axes[k].value;
      }
      out.push({ date, axes });
    } catch {
      // skip · aggregated below — this loop sits on the identity-projection
      // request path, so per-row logging would write on every panel refresh
      malformed++;
    }
  }
  if (malformed > 0) {
    logError(
      "brain.identity-snapshot",
      new Error(`${malformed} malformed identity history rows skipped`),
      { fn: "loadIdentityHistory", malformed, scanned: rows.length },
      "warn",
    );
  }
  return out;
}

/**
 * v10.0.529.106 · Wave 60 · IDENTITY AXIS FORWARD PROJECTION.
 *
 * Pre-Wave-60 the daily history rows were being written by the
 * computeIdentitySnapshot cron but nobody read them forward. The
 * sparklines rendered the history visually but the underlying
 * trajectory math was never computed. This is the highest-signal
 * thing the identity layer could say: "at your current velocity,
 * promise_integrity hits 42 in 28 days."
 *
 * Implementation: pure least-squares linear regression per axis
 * on the last 14 history rows. No AI call. No external dependency.
 * Returns a per-axis trajectory with projected value at +30d and
 * a confidence band based on R² (the closer to a clean line, the
 * more confident the projection).
 */
export interface AxisTrajectory {
  axis: AxisKey;
  label: string;
  currentValue: number;
  projectedValue30d: number;
  delta30d: number;
  slopePerDay: number;
  rSquared: number; // 0-1 · how linear the trend is
  warning: "below_30" | "above_85" | "rapid_decline" | "rapid_climb" | null;
}

export async function projectIdentityForward(days = 30): Promise<{
  projectedAt: string;
  horizonDays: number;
  trajectories: AxisTrajectory[];
}> {
  const history = await loadIdentityHistory(14);
  const current = await loadIdentitySnapshot();
  const trajectories: AxisTrajectory[] = [];

  for (const axis of Object.keys(current.axes) as AxisKey[]) {
    const currentValue = current.axes[axis].manual ?? current.axes[axis].value;

    // Need at least 4 history points for a meaningful regression.
    // Otherwise: zero-slope projection (just hold current value).
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < history.length; i++) {
      const v = history[i].axes[axis];
      if (typeof v === "number") points.push({ x: i, y: v });
    }

    if (points.length < 4) {
      trajectories.push({
        axis,
        label: AXIS_LABELS[axis],
        currentValue,
        projectedValue30d: currentValue,
        delta30d: 0,
        slopePerDay: 0,
        rSquared: 0,
        warning: currentValue < 30 ? "below_30" : currentValue > 85 ? "above_85" : null,
      });
      continue;
    }

    // Least-squares linear regression: y = mx + b
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
    const meanY = sumY / n;
    const denom = n * sumXX - sumX * sumX;
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // R² · 1 - (residual sum of squares / total sum of squares)
    const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
    const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
    const rSquared = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

    // Project: history[n-1] is the most recent point · add `days` more
    // x-steps forward · clamp to [0, 100].
    const projectedRaw = slope * (n - 1 + days) + intercept;
    const projectedValue30d = Math.max(0, Math.min(100, Math.round(projectedRaw)));
    const delta30d = Math.round((projectedValue30d - currentValue) * 10) / 10;

    // Warning thresholds: red if projected below 30 OR above 85,
    // or if the delta is > ±20 in 30d (rapid movement worth attention).
    let warning: AxisTrajectory["warning"] = null;
    if (projectedValue30d < 30) warning = "below_30";
    else if (projectedValue30d > 85) warning = "above_85";
    else if (delta30d < -20) warning = "rapid_decline";
    else if (delta30d > 20) warning = "rapid_climb";

    trajectories.push({
      axis,
      label: AXIS_LABELS[axis],
      currentValue,
      projectedValue30d,
      delta30d,
      slopePerDay: Math.round(slope * 100) / 100,
      rSquared: Math.round(rSquared * 100) / 100,
      warning,
    });
  }

  return {
    projectedAt: new Date().toISOString(),
    horizonDays: days,
    trajectories,
  };
}

/**
 * Pin or clear a manual override on a single axis. Pass value=null
 * to clear.
 */
export async function setManualOverride(axis: AxisKey, value: number | null): Promise<IdentitySnapshot> {
  if (value != null && (value < 0 || value > 100)) {
    throw new Error("override must be 0-100 or null");
  }
  // 2026-08-06 · deep-copy. loadIdentitySnapshot() now serves a cached
  // object BY REFERENCE and this is its only mutator; writing through the
  // shared instance would publish the override into the cache before —
  // or, if the update below throws, without — the DB write landing.
  const current = JSON.parse(JSON.stringify(await loadIdentitySnapshot())) as IdentitySnapshot;
  current.axes[axis].manual = value;
  current.axes[axis].updated_at = new Date().toISOString();
  const payload = JSON.stringify(current);
  await prisma.brainMemory.update({
    where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
    data: { content: payload, lastSeen: new Date() },
  });
  // 2026-08-06 · MANDATORY, not symmetry. Without it the operator pinning
  // an axis via PATCH /api/identity would not see their own change for up
  // to 5 minutes — and not only in /chat: loadIdentitySnapshot has seven-
  // plus consumers (operator.ts, brain-domain.ts, ultron-ticker.ts,
  // narrator.ts, /api/identity, cross-system-nudge).
  invalidate(IDENTITY_CACHE_KEY);

  // 2026-08-06 · the NUDGE cache reads this same row. computeNudges compares
  // `a.manual ?? a.value` against WEAKNESS_FLOOR, so a manual pin IS a floor
  // crossing — pinning promise_integrity from 40 to 70 specifically to clear
  // the weakness nudge would update the identity block instantly while the
  // NudgePanel kept rendering the old warning for up to 300s. Two caches read
  // one row; both have to be dropped by the one writer.
  //
  // Dynamic import: cross-system-nudge imports from this module, so a static
  // import would close a cycle. Best-effort — a failure here costs at most a
  // 300s stale nudge and must never fail the operator's pin.
  await import("@/lib/brain/cross-system-nudge")
    .then((m) => m.invalidateNudgeCache())
    .catch(() => {});

  return current;
}

/**
 * System-prompt block: renders the snapshot as a compact 8-line
 * block so Nick sees the current self-model every chat turn.
 */
export async function buildIdentityContextBlock(): Promise<string> {
  const snap = await loadIdentitySnapshot().catch(() => null);
  if (!snap) return "";
  // v-truth · freshness honesty. The snapshot only refreshes when its cron
  // runs; if that stalls, stale axis values get asserted as the CURRENT
  // self-model on every turn. Tag the age so Nick hedges instead of stating
  // a fossil ("2/100 ↓") as today's truth.
  //
  // 2026-08-06 · this staleNote is the ONLY time-varying term in this
  // block — every other line reads straight off the persisted row. It
  // flips at a 7-day boundary, so the 5-minute read cache on
  // loadIdentitySnapshot() cannot change what this function emits except
  // in the 5 minutes on either side of a day-7 crossing, where the note
  // is already an approximation of "old". Output is otherwise identical.
  const ageDays = snap.computed_at
    ? Math.floor((Date.now() - new Date(snap.computed_at).getTime()) / 86_400_000)
    : null;
  const staleNote =
    ageDays != null && ageDays > 7
      ? ` (snapshot ${ageDays}d stale — may not reflect current state)`
      : "";
  const lines: string[] = [
    `## Nour's identity snapshot (rolling self-model)${staleNote}`,
  ];
  for (const key of Object.keys(snap.axes) as AxisKey[]) {
    const a = snap.axes[key];
    const val = a.manual ?? a.value;
    const mark =
      a.direction === "rising" ? "↑"
      : a.direction === "falling" ? "↓"
      : "·";
    const pin = a.manual != null ? " (pinned)" : "";
    lines.push(`- ${AXIS_LABELS[key]}: ${val}/100 ${mark}${pin}`);
  }
  return lines.join("\n");
}
