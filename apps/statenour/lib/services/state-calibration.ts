/**
 * lib/services/state-calibration.ts · Wave H · M1 (2026-05-23).
 *
 * The Closed-Loop Calibrated Brain · operator-state-conditioned
 * supervised signal on Nick's outputs.
 *
 * Stack:
 *   · OperatorState (Wave 5.3) · deterministic 5-dim snapshot of focus,
 *     capacity, drift, momentum, mood.
 *   · suggestion-loop (Wave H upgrade) · every action/outcome row now
 *     stamps the operator state at write-time into metadata.
 *   · judge-eval (Phase V/W + Wave C) · LLM-as-judge V1↔V2 scores
 *     with ground-truth ChatMessage.feedbackScore calibration.
 *
 * Move: join the three lanes to answer "does Nick's hit rate change
 * with operator state?" If yes (it should, per LeCun's world-model
 * thesis) the matrix shows it. Two-dimensional grid:
 *
 *   rows: mood (energized · neutral · depleted · scattered)
 *   cols: suggestion kind (task · goal · sms · reflection · ...)
 *   cells: net-positive rate per cell · "of suggestions in this state,
 *          what % went +1?" computed from action/outcome pairs.
 *
 * Output is shaped so the dashboard can render:
 *   · the grid itself
 *   · per-row totals (mood-level hit rate)
 *   · per-col totals (kind-level hit rate)
 *   · sample-size labels per cell (n=12 vs n=0 styling differs)
 *
 * Read-only · best-effort · degrades to empty grid on DB error.
 */

import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";
import type { MoodTag } from "@/lib/services/operator-state";

const log = rootLogger.withSurface("services/state-calibration");

export const ALL_MOODS: MoodTag[] = ["energized", "neutral", "depleted", "scattered"];

/** Distinct suggestion kinds we expect to see · derived from
 *  lib/brain/suggestion-loop.ts SuggestionKind enum. New ones land
 *  in `(other)` until added here. */
export const ALL_KINDS = [
  "task",
  "goal",
  "sms",
  "reflection",
  "decision",
  "purchase",
  "weak-axis",
  "stuck-task",
  "overdue",
  "stalled-goal",
  "pattern",
  "drift",
  "broken-promise",
  "stale-pin",
  "research",
  "orphan-nudge",
  "unresolved-reflection",
  "contradiction",
  "other",
] as const;
export type KindKey = (typeof ALL_KINDS)[number];

export interface CalibrationCell {
  mood: MoodTag;
  kind: KindKey;
  /** Total suggestions in this cell (acted + dismissed · denominators). */
  total: number;
  /** Count where event="acted" (operator engaged with the suggestion). */
  acted: number;
  /** Count where event="dismissed" (operator rejected the suggestion). */
  dismissed: number;
  /** acted / total · -1 when total === 0. */
  hitRatePct: number;
}

export interface CalibrationReport {
  generatedAt: string;
  /** Days window for the rollup. */
  sinceDays: number;
  /** Total rows processed (across all cells). */
  totalRows: number;
  /** 4 × N flattened grid (mood × kind cells). */
  cells: CalibrationCell[];
  /** Per-mood roll-up across all kinds. */
  byMood: Array<{
    mood: MoodTag;
    total: number;
    acted: number;
    hitRatePct: number;
    /** 2026-05-23 · UI #2 · daily hit-rate samples for the sparkline ·
     *  one value per day in the window · NaN-rejected · gaps backfilled
     *  with the previous day's rate so the sparkline is continuous. */
    trend: number[];
  }>;
  /** Per-kind roll-up across all moods. */
  byKind: Array<{
    kind: KindKey;
    total: number;
    acted: number;
    hitRatePct: number;
    /** 2026-05-23 · UI #2 · same daily trend as byMood.trend. */
    trend: number[];
  }>;
  /** Rows without an operatorStateSnapshot (legacy data · pre-Wave-H).
   *  2026-05-24 · Wave N · split into 3 diagnostic counters so prod
   *  triage knows WHICH failure mode is climbing:
   *  · `unstamped` · operatorStateSnapshot === null → genuine pre-Wave-H
   *    rows OR a regression in the upstream writer (should be 0 for
   *    new rows after Wave H).
   *  · `malformed` · snapshot exists but `mood` is not a string · means
   *    schema drift on the snapshot shape · indicates a BUG in
   *    `formatOperatorStateSnapshot`.
   *  · `unknownMood` · `mood` is a string but not in `ALL_MOODS` · means
   *    someone added a new mood enum value but didn't extend the report
   *    classifier · indicates DRIFT between the operator-state module
   *    and this report.
   */
  unstamped: number;
  malformed: number;
  unknownMood: number;
}

function classifyKind(raw: unknown): KindKey {
  if (typeof raw !== "string") return "other";
  return (ALL_KINDS as readonly string[]).includes(raw)
    ? (raw as KindKey)
    : "other";
}

function classifyMood(raw: unknown): MoodTag | null {
  if (typeof raw !== "string") return null;
  if (
    raw === "energized" ||
    raw === "neutral" ||
    raw === "depleted" ||
    raw === "scattered"
  ) {
    return raw;
  }
  return null;
}

function emptyGrid(sinceDays: number): CalibrationReport {
  return {
    generatedAt: new Date().toISOString(),
    sinceDays,
    totalRows: 0,
    cells: [],
    byMood: ALL_MOODS.map((mood) => ({
      mood,
      total: 0,
      acted: 0,
      hitRatePct: -1,
      trend: [],
    })),
    byKind: ALL_KINDS.map((kind) => ({
      kind,
      total: 0,
      acted: 0,
      hitRatePct: -1,
      trend: [],
    })),
    unstamped: 0,
    malformed: 0,
    unknownMood: 0,
  };
}

/**
 * 2026-05-23 · UI #2 · helper · bin (date, acted, total) tuples into
 * daily hit-rate samples for sparklines. Groups by ISO date string
 * (UTC) · forward-fills gaps with the previous day's rate so the
 * sparkline is continuous (no zig-zag-through-zero artifacts when a
 * day has no samples). Returns array sized to `sinceDays`.
 */
function buildDailyTrend(
  samples: Array<{ day: string; acted: number; total: number }>,
  sinceDays: number,
  now: Date = new Date(),
): number[] {
  if (samples.length === 0) return [];
  // Build a date→{acted,total} map · keys are YYYY-MM-DD UTC.
  const dayMap = new Map<string, { acted: number; total: number }>();
  for (const s of samples) {
    const cur = dayMap.get(s.day) ?? { acted: 0, total: 0 };
    cur.acted += s.acted;
    cur.total += s.total;
    dayMap.set(s.day, cur);
  }
  // Walk the day range · forward-fill from previous-day rate.
  const trend: number[] = [];
  let lastRate = 0;
  for (let i = sinceDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const bucket = dayMap.get(key);
    if (bucket && bucket.total > 0) {
      lastRate = (bucket.acted / bucket.total) * 100;
    }
    trend.push(Number(lastRate.toFixed(1)));
  }
  return trend;
}

export async function buildStateCalibration(
  options?: { sinceDays?: number },
): Promise<CalibrationReport> {
  const sinceDays = options?.sinceDays ?? 30;

  try {
    const { prisma } = await import("@/lib/prisma");
    const since = new Date(Date.now() - sinceDays * 86_400_000);

    // Pull every action row in window. Outcome rows (positive/negative)
    // are NOT joined here · this report measures the action layer
    // (acted vs dismissed) per state · the outcome layer is a separate
    // future report. We sample up to 5000 rows · the suggestion-loop
    // writes ~1 row per chip interaction, so 30d × ~50 chips/day = ~1500
    // typical.
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.SUGGESTION_LOOP,
        deletedAt: null,
        createdAt: { gte: since },
        // Only action rows · key pattern: sugg:<id>:action:<event>
        key: { contains: ":action:" },
      },
      take: 5000,
      // 2026-05-23 · UI #2 · need createdAt to bucket by day for sparklines.
      select: { key: true, metadata: true, createdAt: true },
    });

    if (rows.length === 0) return emptyGrid(sinceDays);

    // Initialize 4 × N grid · zero counts.
    const cellMap = new Map<string, CalibrationCell>();
    const byMoodMap = new Map<
      MoodTag,
      { total: number; acted: number }
    >();
    const byKindMap = new Map<KindKey, { total: number; acted: number }>();
    let unstamped = 0;
    let malformed = 0;
    let unknownMood = 0;

    for (const mood of ALL_MOODS) {
      byMoodMap.set(mood, { total: 0, acted: 0 });
      for (const kind of ALL_KINDS) {
        cellMap.set(`${mood}::${kind}`, {
          mood,
          kind,
          total: 0,
          acted: 0,
          dismissed: 0,
          hitRatePct: -1,
        });
      }
    }
    for (const kind of ALL_KINDS) {
      byKindMap.set(kind, { total: 0, acted: 0 });
    }

    // 2026-05-23 · UI #2 · per-day trend bins · separate maps so the
    // sparkline data builds in one pass alongside the totals.
    const moodDailyMap = new Map<
      MoodTag,
      Array<{ day: string; acted: number; total: number }>
    >();
    const kindDailyMap = new Map<
      KindKey,
      Array<{ day: string; acted: number; total: number }>
    >();
    for (const mood of ALL_MOODS) moodDailyMap.set(mood, []);
    for (const kind of ALL_KINDS) kindDailyMap.set(kind, []);

    type Meta = {
      suggestionKind?: unknown;
      event?: unknown;
      operatorStateSnapshot?: { mood?: unknown } | null;
    };

    for (const row of rows) {
      const meta = (row.metadata ?? {}) as Meta;
      const snap = meta.operatorStateSnapshot ?? null;
      const kind = classifyKind(meta.suggestionKind);
      const event = typeof meta.event === "string" ? meta.event : null;
      // 2026-05-24 · Wave N · the pre-Wave-N code wrote everything that
      // wasn't a valid mood into `unstamped` · prod diagnosis couldn't
      // tell "we have legacy rows" from "the snapshot writer broke"
      // from "we added a new mood enum and forgot to update this file."
      // Now: 3 buckets · the counter that climbs tells you the bug.
      if (snap === null) {
        unstamped++;
        continue;
      }
      if (typeof snap.mood !== "string") {
        malformed++;
        continue;
      }
      const mood = classifyMood(snap.mood);
      if (!mood) {
        unknownMood++;
        continue;
      }
      const cell = cellMap.get(`${mood}::${kind}`);
      if (!cell) continue;
      cell.total++;
      const moodTotals = byMoodMap.get(mood)!;
      moodTotals.total++;
      const kindTotals = byKindMap.get(kind)!;
      kindTotals.total++;
      const acted = event === "acted" ? 1 : 0;
      if (event === "acted") {
        cell.acted++;
        moodTotals.acted++;
        kindTotals.acted++;
      } else if (event === "dismissed") {
        cell.dismissed++;
      }
      // Record daily bucket entry for both per-mood + per-kind series.
      const day = row.createdAt.toISOString().slice(0, 10);
      moodDailyMap.get(mood)!.push({ day, acted, total: 1 });
      kindDailyMap.get(kind)!.push({ day, acted, total: 1 });
    }

    // Finalize hit rates.
    const cells = Array.from(cellMap.values()).map((c) => ({
      ...c,
      hitRatePct:
        c.total === 0
          ? -1
          : Number(((c.acted / c.total) * 100).toFixed(1)),
    }));
    const byMood = ALL_MOODS.map((mood) => {
      const t = byMoodMap.get(mood)!;
      return {
        mood,
        total: t.total,
        acted: t.acted,
        hitRatePct:
          t.total === 0
            ? -1
            : Number(((t.acted / t.total) * 100).toFixed(1)),
        trend: buildDailyTrend(moodDailyMap.get(mood)!, sinceDays),
      };
    });
    const byKind = ALL_KINDS.map((kind) => {
      const t = byKindMap.get(kind)!;
      return {
        kind,
        total: t.total,
        acted: t.acted,
        hitRatePct:
          t.total === 0
            ? -1
            : Number(((t.acted / t.total) * 100).toFixed(1)),
        trend: buildDailyTrend(kindDailyMap.get(kind)!, sinceDays),
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      sinceDays,
      totalRows: rows.length,
      cells,
      byMood,
      byKind,
      unstamped,
      malformed,
      unknownMood,
    };
  } catch (e) {
    log.warn("calibration_build_failed", {
      err: (e as Error).message?.slice(0, 200),
    });
    return emptyGrid(sinceDays);
  }
}
