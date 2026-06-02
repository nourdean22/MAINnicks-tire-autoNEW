/**
 * Sleep analyzer engine · 2026-06-02
 *
 * Ports the `sleep-analyzer` skill's methodology (average + consistency +
 * short-night load + sleep-debt vs a target + trend/direction) GROUNDED in the
 * operator's own logged sleep. No sleep-stage / wearable data is assumed,
 * nothing is fabricated, and a thin window is reported honestly — matching
 * statenour's grounded-vs-fabricated ethos.
 *
 * Data sources (the operator's OWN logs · Decimals normalized via Number()):
 *   · PersonalDailyLog.sleepHours (Decimal? -> Number) — the primary nightly value
 *   · BodyTracking.sleepHours (Float?)                  — fallback when the
 *     daily-log night is missing (the /body check-in is single-table)
 * Per night, the daily-log value wins; the body value backfills. The two are
 * merged by date so a night is counted ONCE.
 *
 * Architecture (mirrors mental-health.ts / goal.ts / trends.ts EXACTLY): a pure
 * core `computeSleep(input, now)` (unit-tested, no IO, `now` injected for
 * determinism) + a thin IO wrapper `analyzeSleep({days})` (prisma reads ->
 * compute). The agent tool (lib/ai/tools/brain.ts) lazy-imports the wrapper.
 * No model call.
 */
import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

// ── pure stats helpers (same shape as the sibling analyzers) ────────────
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
/** OLS slope of y over x. 0 when x has no spread (single point / flat time). */
function slope(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
const MS_PER_DAY = 86_400_000;

/** Minimum logged nights for a reliable read (a thinner window is directional). */
const MIN_NIGHTS = 5;
/** A "short" night — the operator's logs treat <6h as a sleep-deprivation marker. */
const SHORT_NIGHT_H = 6;
/** Sleep-debt target — debt accrues as max(0, TARGET - hours) per night. */
const TARGET_HOURS = 7.5;

// ── types ────────────────────────────────────────────────────────────────
export type SleepDirection = "improving" | "stable" | "declining";

/** One normalized night: a Date (the log date) + hours slept. */
export interface SleepNight {
  date: Date;
  hours: number;
}

/** A raw daily-log night before merge (sleepHours may be null). */
export interface DailySleepRow {
  logDate: Date;
  sleepHours: number | null;
}
/** A raw body night before merge (date is YYYY-MM-DD; sleepHours may be null). */
export interface BodySleepRow {
  date: string;
  sleepHours: number | null;
}

export interface SleepAnalysis {
  window: { days: number };
  dataCompleteness: {
    nights: number;
    fromDailyLog: number;
    fromBodyFallback: number;
    sufficient: boolean;
    note: string;
  };
  /** null only when zero nights were logged. */
  sleep: {
    avgHours: number;
    consistencySD: number; // SD of nightly hours — lower = more regular
    consistency: "regular" | "variable" | "erratic";
    shortNights: number; // count of nights < SHORT_NIGHT_H
    shortNightPct: number; // 0-1
    sleepDebtHours: number; // sum of nightly max(0, TARGET - hours)
    targetHours: number;
    perMonthChange: number; // slope * 30, hours per 30 days
    direction: SleepDirection;
    bestNight: { date: string; hours: number };
    worstNight: { date: string; hours: number };
  } | null;
  guidance: string[];
}

/** Higher hours is better → rising = improving. Threshold mirrors the
 *  sibling analyzers' 0.5/30d "notable" bar. */
function directionOf(perMonth: number): SleepDirection {
  if (perMonth >= 0.5) return "improving";
  if (perMonth <= -0.5) return "declining";
  return "stable";
}

/**
 * Merge daily-log + body nights by date. Daily-log value wins; body backfills
 * a missing night. Returns nights sorted ascending + the per-source counts.
 */
function mergeNights(
  daily: DailySleepRow[],
  body: BodySleepRow[],
): { nights: SleepNight[]; fromDailyLog: number; fromBodyFallback: number } {
  const byDate = new Map<string, { hours: number; fromBody: boolean }>();
  // daily-log first — it's authoritative
  let fromDailyLog = 0;
  for (const d of daily) {
    if (d.sleepHours == null) continue;
    const key = toDateString(d.logDate);
    if (!byDate.has(key)) {
      byDate.set(key, { hours: d.sleepHours, fromBody: false });
      fromDailyLog += 1;
    }
  }
  // body fallback — only fills a date the daily log didn't cover
  let fromBodyFallback = 0;
  for (const b of body) {
    if (b.sleepHours == null) continue;
    if (byDate.has(b.date)) continue;
    byDate.set(b.date, { hours: b.sleepHours, fromBody: true });
    fromBodyFallback += 1;
  }
  const nights: SleepNight[] = [...byDate.entries()]
    .map(([date, v]) => ({ date: new Date(date), hours: v.hours }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return { nights, fromDailyLog, fromBodyFallback };
}

/**
 * Pure analysis core — synthetic-testable, `now` accepted for signature
 * parity with the sibling analyzers (sleep math is `now`-independent; the
 * param keeps the call shape uniform and future-proof).
 */
export function computeSleep(
  args: {
    daily: DailySleepRow[];
    body: BodySleepRow[];
    days: number;
  },
  _now: Date,
): SleepAnalysis {
  const { daily, body, days } = args;
  const { nights, fromDailyLog, fromBodyFallback } = mergeNights(daily, body);
  const n = nights.length;
  const sufficient = n >= MIN_NIGHTS;

  const dataCompleteness = {
    nights: n,
    fromDailyLog,
    fromBodyFallback,
    sufficient,
    note: sufficient
      ? `Based on ${n} logged night(s) over ~${days} days${fromBodyFallback > 0 ? ` (${fromBodyFallback} filled from body tracking)` : ""}.`
      : n === 0
        ? "No sleep logged in this window. Log nightly hours (daily check-in or /body) so Nick can read your sleep."
        : `Only ${n} night(s) logged — need >=${MIN_NIGHTS} for a reliable read. Treat this as directional, not conclusive.`,
  };

  if (n === 0) {
    return {
      window: { days },
      dataCompleteness,
      sleep: null,
      guidance: [
        "Log nightly sleep hours so Nick can track average, consistency, and sleep debt.",
      ],
    };
  }

  const hours = nights.map((x) => x.hours);
  const avgHours = round(mean(hours), 1);
  const consistencySD = round(stdev(hours), 2);
  const consistency =
    consistencySD > 1.5 ? "erratic" : consistencySD >= 0.75 ? "variable" : "regular";
  const shortNights = hours.filter((h) => h < SHORT_NIGHT_H).length;
  const shortNightPct = round(shortNights / n);
  const sleepDebtHours = round(
    hours.reduce((acc, h) => acc + Math.max(0, TARGET_HOURS - h), 0),
    1,
  );

  const t0 = nights[0].date.getTime();
  const xsDays = nights.map((x) => (x.date.getTime() - t0) / MS_PER_DAY);
  const perMonthChange = round(slope(xsDays, hours) * 30, 2);
  const direction = directionOf(perMonthChange);

  // best/worst — extreme nights, reported with their date for context.
  let best = nights[0];
  let worst = nights[0];
  for (const x of nights) {
    if (x.hours > best.hours) best = x;
    if (x.hours < worst.hours) worst = x;
  }

  // ── grounded guidance (derived from the metrics — never invented) ──
  const guidance: string[] = [];
  if (shortNightPct >= 0.5) {
    guidance.push(
      `${Math.round(shortNightPct * 100)}% of nights were under ${SHORT_NIGHT_H}h — you're running a recurring short-sleep pattern.`,
    );
  }
  if (sleepDebtHours >= 7) {
    guidance.push(
      `Accumulated sleep debt of ${sleepDebtHours}h vs a ${TARGET_HOURS}h target across this window.`,
    );
  }
  if (consistency === "erratic") {
    guidance.push(
      `Sleep timing is erratic (SD ${consistencySD}h) — a steadier schedule usually beats chasing total hours.`,
    );
  }
  if (direction === "declining") {
    guidance.push(`Sleep is trending down (${perMonthChange}h/mo) — worth watching.`);
  } else if (direction === "improving") {
    guidance.push(`Sleep is trending up (+${perMonthChange}h/mo) — keep it going.`);
  }
  if (!sufficient) {
    guidance.push(`Log at least ${MIN_NIGHTS} nights to unlock a reliable read.`);
  }
  if (guidance.length === 0) {
    guidance.push(
      `Sleep looks steady (~${avgHours}h avg, ${consistency} timing). Keep logging so Nick can catch a slip early.`,
    );
  }

  return {
    window: { days },
    dataCompleteness,
    sleep: {
      avgHours,
      consistencySD,
      consistency,
      shortNights,
      shortNightPct,
      sleepDebtHours,
      targetHours: TARGET_HOURS,
      perMonthChange,
      direction,
      bestNight: { date: toDateString(best.date), hours: round(best.hours, 1) },
      worstNight: { date: toDateString(worst.date), hours: round(worst.hours, 1) },
    },
    guidance,
  };
}

/**
 * IO wrapper — reads the operator's own logs and runs the pure core.
 * Each read degrades to [] on error so the tool never throws (mirrors the
 * other brain-tool readers).
 */
export async function analyzeSleep({
  days = 30,
}: { days?: number } = {}): Promise<SleepAnalysis> {
  const since = daysAgo(days);
  const sinceStr = toDateString(since);
  const [dailyRaw, bodyRaw] = await Promise.all([
    prisma.personalDailyLog
      .findMany({
        where: { logDate: { gte: since } },
        orderBy: { logDate: "asc" },
        select: { logDate: true, sleepHours: true },
      })
      .catch((): never[] => []),
    prisma.bodyTracking
      .findMany({
        where: { date: { gte: sinceStr } },
        orderBy: { date: "asc" },
        select: { date: true, sleepHours: true },
      })
      .catch((): never[] => []),
  ]);

  const daily: DailySleepRow[] = dailyRaw.map((d) => ({
    logDate: d.logDate,
    sleepHours: d.sleepHours == null ? null : Number(d.sleepHours),
  }));
  const body: BodySleepRow[] = bodyRaw.map((b) => ({
    date: b.date,
    sleepHours: b.sleepHours,
  }));

  return computeSleep({ daily, body, days }, new Date());
}
