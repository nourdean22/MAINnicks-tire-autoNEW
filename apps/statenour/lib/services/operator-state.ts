/**
 * lib/services/operator-state.ts · explicit operator-state model
 * (task #22 step 5.3 · 2026-05-23 · per LeCun-lens consolidation).
 *
 * The LeCun "world model" move applied to statenour. Nick was
 * inferring the operator's state from chat text · which is the
 * autoregressive trap (the LLM guesses · sometimes confidently
 * wrong). This service consolidates the existing real-world signals
 * statenour already collects (TaskEvent log · completion rates ·
 * recent BrainMemory tags) into ONE explicit, queryable state
 * snapshot. Nick reads this state instead of inferring it.
 *
 * Five dimensions · each 0-1 normalized OR a discrete tag:
 *   · focus      · how locked-in right now (recent completion rate)
 *   · capacity   · how much energy/time is left in the day (7d baseline
 *                  minus today's completions, saturated)
 *   · drift      · scattered-ness (high status-change rate without
 *                  completion; many DOING tasks left started)
 *   · momentum   · recent 7d trend in completion rate (rising / flat /
 *                  falling)
 *   · mood       · qualitative tag derived from the above 4
 *
 * Inputs are READ-ONLY queries against existing Prisma tables ·
 * zero new schema · zero new categories. The whole thing is bounded
 * to ~3 prisma calls per snapshot (cheap; safe to call per-turn from
 * the system prompt builder).
 *
 * NOT in v1 · journal sentiment · mastery deltas · heart-rate-style
 * external signals. Those can layer in later as additional weighted
 * components without changing the public type. The v1 shape is
 * stable enough to consume from /chat · /tasks · /journal surfaces.
 */

import { prisma } from "@/lib/prisma";

// ── Types ──────────────────────────────────────────────────────

export type MoodTag = "energized" | "neutral" | "depleted" | "scattered";

export interface OperatorState {
  /** ISO timestamp of the snapshot. */
  ranAt: string;
  /** [0,1] · locked-in vs distracted in the last ~4h window. */
  focus: number;
  /** [0,1] · how much capacity remains today vs the operator's baseline. */
  capacity: number;
  /** [0,1] · drift / scatter risk · high = many open DOING tasks · few
   *  completions · low = clean flow. */
  drift: number;
  /** [0,1] · momentum · 7d completion-rate trend slope normalized. */
  momentum: number;
  /** Qualitative composite derived from the 4 numeric dimensions. */
  mood: MoodTag;
  /** [0,1] · how confident the snapshot is · low when data is sparse. */
  confidence: number;
  /**
   * Component signals · what fed into the calc · sorted by absolute
   * contribution. Useful for diagnostics + UI surfacing.
   */
  signals: Array<{
    source: string;
    value: number;
    weight: number;
  }>;
}

// ── Pure helpers · easy unit-test surface ──────────────────────

/** Saturate a number to [0,1]. NaN/Infinity → 0. */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Mood inference from the 4 numeric dimensions. Pure · easy to
 * unit-test the boundaries. Order matters: scattered (high drift)
 * wins over depleted (low capacity) wins over energized (high
 * focus + momentum) · neutral is the fallback.
 */
export function inferMood(input: {
  focus: number;
  capacity: number;
  drift: number;
  momentum: number;
}): MoodTag {
  if (input.drift >= 0.6) return "scattered";
  if (input.capacity <= 0.25) return "depleted";
  if (input.focus >= 0.6 && input.momentum >= 0.5) return "energized";
  return "neutral";
}

/**
 * Wave W Phase 3 · 2026-05-24 · landing-surface recommendation.
 *
 * Pure function · maps operator-state snapshot to ONE suggested
 * surface to start on. Used by the HQ "Today, start here →" chip ·
 * the chip is a hint, NOT an auto-redirect (reversibility · operator
 * still owns the click).
 *
 * Mapping rules (priority order · first match wins):
 *   1. drift >= 0.6 (scattered)        → /system  · triage the noise
 *   2. capacity <= 0.25 (depleted)     → /journal · reflect/recover
 *   3. mood == "energized" + momentum  → /tasks   · ride the wave
 *   4. focus < 0.3 + capacity > 0.5    → /brain/board · low-focus
 *                                          high-capacity = strategy
 *   5. fallback                         → /tasks   · default
 *
 * Pure · no side effects · easy to unit-test the boundaries.
 */
export type LandingSurface =
  | "/tasks"
  | "/journal"
  | "/system"
  | "/brain/board";

export interface LandingRecommendation {
  surface: LandingSurface;
  reason: string;
}

export function chooseLanding(snapshot: {
  focus: number;
  capacity: number;
  drift: number;
  momentum: number;
  mood: MoodTag;
  confidence: number;
}): LandingRecommendation | null {
  // Low confidence · don't pretend to know · let operator land
  // wherever they normally land.
  if (snapshot.confidence < 0.3) return null;

  if (snapshot.drift >= 0.6) {
    return {
      surface: "/system",
      reason: "drift is high · triage open work before adding more",
    };
  }
  if (snapshot.capacity <= 0.25) {
    return {
      surface: "/journal",
      reason: "capacity is low · reflect before pushing more output",
    };
  }
  if (snapshot.mood === "energized" && snapshot.momentum >= 0.5) {
    return {
      surface: "/tasks",
      reason: "energy + momentum · ride the wave",
    };
  }
  if (snapshot.focus < 0.3 && snapshot.capacity > 0.5) {
    return {
      surface: "/brain/board",
      reason: "low focus, high capacity · use the multi-advisor board",
    };
  }
  // Neutral state · default to /tasks (the daily-driver) ·
  // operator chip can still show but with a soft "default" reason.
  return null;
}

// ── Component computations ─────────────────────────────────────

/**
 * Compute the focus dimension from recent TaskEvent activity.
 *   focus = completions(4h) / (completions(4h) + starts(4h))
 * High focus · most of what got started, got finished.
 * Low focus · started lots of things, finished little.
 *
 * Returns 0.5 (neutral) when there's no activity in the window
 * rather than a NaN that would skew the mood inference.
 */
export function computeFocus(events: Array<{ kind: string }>): number {
  let completions = 0;
  let starts = 0;
  for (const e of events) {
    if (e.kind === "completed" || e.kind === "checked") completions += 1;
    if (e.kind === "started") starts += 1;
  }
  const totalActivity = completions + starts;
  if (totalActivity === 0) return 0.5; // no signal · neutral
  return clamp01(completions / totalActivity);
}

/**
 * Compute the capacity dimension. The operator has a typical-day
 * completion baseline · this snapshot's `today` count compared to
 * that gives a "how much is left" reading.
 *
 *   ratio = today / baseline · capacity = 1 - clamp01(ratio)
 *
 * If today already exceeds baseline, capacity → 0 (saturated · the
 * operator is over-extending vs typical). If today is well under,
 * capacity stays high.
 *
 * Returns 0.5 when baseline is 0 (no history · neutral default).
 */
export function computeCapacity(input: {
  todayCompletions: number;
  baselineCompletions: number;
}): number {
  if (input.baselineCompletions <= 0) return 0.5;
  const ratio = input.todayCompletions / input.baselineCompletions;
  return clamp01(1 - ratio);
}

/**
 * Compute drift from the number of DOING tasks (started but not
 * completed) relative to recent completion volume.
 *
 *   drift = open_doing / max(1, recent_completions)
 *
 * High drift · many doings, few done · the operator started lots of
 * things and hasn't closed any. Low drift · doings get closed · clean
 * flow.
 *
 * Capped at 1.0 · 5+ DOING tasks always reads as fully-scattered.
 */
export function computeDrift(input: {
  openDoingCount: number;
  recentCompletions: number;
}): number {
  if (input.openDoingCount === 0) return 0;
  const denom = Math.max(1, input.recentCompletions);
  return clamp01(input.openDoingCount / denom);
}

/**
 * Compute momentum from a 7-day completion timeline.
 * Slope of completions/day across the 7-day window normalized to
 * [0,1] · 0.5 means flat · >0.5 rising · <0.5 falling.
 *
 * Simple regression: average of first 3 days vs average of last 3
 * days. Returns 0.5 when data is too sparse to compute a slope.
 */
export function computeMomentum(daily: number[]): number {
  if (daily.length < 6) return 0.5;
  const firstHalf = daily.slice(0, Math.floor(daily.length / 2));
  const secondHalf = daily.slice(-Math.floor(daily.length / 2));
  const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  if (avg1 === 0 && avg2 === 0) return 0.5;
  if (avg1 === 0) return 1.0; // started from nothing · max rise
  // Trend ratio · clamp to [0,1] with 0.5 as flat-baseline
  const ratio = avg2 / Math.max(0.1, avg1);
  // Map ratio space to [0,1] · ratio=1 → 0.5 · ratio=2 → 0.75 · etc
  return clamp01(0.5 + (Math.log10(ratio) * 0.5));
}

// ── Top-level snapshot ─────────────────────────────────────────

/**
 * Compute the current operator state from existing real-world
 * signals. Read-only · safe to call per-turn · ~3 prisma queries.
 *
 * `now` is injected so tests can freeze time without mocking Date.
 */
export async function currentOperatorState(
  now: Date = new Date(),
): Promise<OperatorState> {
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  // Query 1 · recent TaskEvent kinds for focus + drift.
  const recentEvents = await prisma.taskEvent
    .findMany({
      where: {
        createdAt: { gte: fourHoursAgo },
        kind: { in: ["completed", "checked", "started"] },
      },
      select: { kind: true },
      take: 200,
    })
    .catch(() => [] as Array<{ kind: string }>);

  // Query 2 · today's completion count vs 7d baseline for capacity.
  const completionsBy7d = await prisma.taskEvent
    .findMany({
      where: {
        createdAt: { gte: sevenDaysAgo },
        kind: { in: ["completed", "checked"] },
      },
      select: { createdAt: true },
      take: 500,
    })
    .catch(() => [] as Array<{ createdAt: Date }>);

  // Query 3 · current DOING-status task count for drift.
  const openDoingCount = await prisma.task
    .count({
      where: {
        status: "DOING",
        deletedAt: null,
      },
    })
    .catch(() => 0);

  // Bucket completions into daily counts for momentum + today.
  const dailyCompletions: number[] = new Array(7).fill(0);
  let todayCompletions = 0;
  for (const e of completionsBy7d) {
    const ageDays = Math.floor(
      (now.getTime() - e.createdAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (ageDays >= 0 && ageDays < 7) {
      // Index 6 = today · 0 = 7 days ago
      const idx = 6 - ageDays;
      dailyCompletions[idx] += 1;
    }
    if (e.createdAt >= startOfToday) todayCompletions += 1;
  }
  // Baseline · average of the prior 6 days (excludes today).
  const priorDays = dailyCompletions.slice(0, 6);
  const baselineCompletions =
    priorDays.reduce((a, b) => a + b, 0) / Math.max(1, priorDays.length);

  // Compose components.
  const focus = computeFocus(recentEvents);
  const capacity = computeCapacity({ todayCompletions, baselineCompletions });
  const recentCompletionsCount = recentEvents.filter(
    (e) => e.kind === "completed" || e.kind === "checked",
  ).length;
  const drift = computeDrift({
    openDoingCount,
    recentCompletions: recentCompletionsCount,
  });
  const momentum = computeMomentum(dailyCompletions);
  const mood = inferMood({ focus, capacity, drift, momentum });

  // Confidence · high when we have data across multiple windows ·
  // low when most queries returned empty (e.g. fresh install).
  const dataPoints = recentEvents.length + completionsBy7d.length;
  const confidence = clamp01(dataPoints / 20); // 20+ data points = full confidence

  // Diagnostics · which signal contributed how much. Useful for
  // /system/operator-state surface (a future slice).
  const signals = [
    { source: "task_events_4h", value: recentEvents.length, weight: 0.3 },
    {
      source: "completions_today",
      value: todayCompletions,
      weight: 0.2,
    },
    {
      source: "completions_7d_baseline",
      value: Math.round(baselineCompletions * 10) / 10,
      weight: 0.2,
    },
    { source: "open_doing_count", value: openDoingCount, weight: 0.3 },
  ];

  return {
    ranAt: now.toISOString(),
    focus,
    capacity,
    drift,
    momentum,
    mood,
    confidence,
    signals,
  };
}

/**
 * 2026-05-23 · task #22 step 5.4 · format the operator state into a
 * system-prompt-ready block. Used by AI surfaces that want to give
 * Nick explicit grounding in the operator's current state INSTEAD
 * of having him infer it from chat text (the autoregressive trap
 * the LeCun-lens consolidation is correcting).
 *
 * Block shape · ~5 lines · ~120 chars · cheap to include in the
 * system prompt. Numbers are presented as percentages because that's
 * how operators reason about state.
 *
 * Confidence is included so Nick can soften his use of the block
 * when the model is uncertain (e.g. fresh-install · no data yet).
 *
 * NOT wired into `lib/ai/system-prompt.ts` in this slice. The chat
 * path is off-limits per the operator's standing directive. This
 * formatter is consumed by:
 *   · /api/system/operator-state (this slice · diagnostic)
 *   · A future opt-in slice that adds operator-state to a SPECIFIC
 *     AI surface (e.g. /api/ai/page-insight) when the operator
 *     greenlights it
 */
export function formatOperatorStateBlock(state: OperatorState): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const confLabel =
    state.confidence < 0.3
      ? "low"
      : state.confidence < 0.7
        ? "moderate"
        : "high";
  return [
    `OPERATOR STATE (${confLabel}-confidence snapshot · use this instead of inferring state from text):`,
    `  mood: ${state.mood}`,
    `  focus: ${pct(state.focus)}   capacity: ${pct(state.capacity)}   drift: ${pct(state.drift)}   momentum: ${pct(state.momentum)}`,
    `Tone rules:`,
    `  · mood=depleted → no discipline lectures · no pep-talk cheerleading · steady · short reply`,
    `  · mood=scattered → cut the list · one concrete next thing · don't enumerate`,
    `  · mood=energized → match the energy · move fast · skip preamble`,
    `  · mood=neutral → default editorial tone`,
  ].join("\n");
}

/** Exported for tests · all the pure functions in one place. */
export const __testInternals = {
  clamp01,
};
