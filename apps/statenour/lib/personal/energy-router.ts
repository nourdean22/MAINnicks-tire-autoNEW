/**
 * ENERGY ROUTER — match task effort to Nour's actual energy windows.
 *
 * v7 · BATCH 5 · Apr 28. Reads historical task-completion telemetry
 * to learn when Nour ships best (morning/post-coffee/afternoon/evening),
 * then suggests when to schedule each pending task.
 *
 * Insight: energy follows patterns. Morning = high focus, low admin.
 * Post-lunch = low focus, good for shop-floor. Evening = creative.
 * Recommends instead of rescheduling automatically.
 *
 * Output: per-task best-window suggestion + confidence.
 */

import { prisma } from "@/lib/prisma";
import { hourET } from "@/lib/utils/datetime";

interface TaskTelemetry {
  // The hour-of-day when each completed task was finished
  completionHour: number;
  effort: "M5" | "M15" | "M30" | "H1" | "H2" | "H4";
  energyRequired: "LOW" | "MEDIUM" | "HIGH";
  durationMinutes: number;
}

const HOURS_PER_WINDOW: Record<string, number[]> = {
  morning: [6, 7, 8, 9, 10, 11],
  afternoon: [12, 13, 14, 15, 16],
  evening: [17, 18, 19, 20],
  late: [21, 22, 23, 0, 1],
};

function windowForHour(h: number): string {
  for (const [name, hours] of Object.entries(HOURS_PER_WINDOW)) {
    if (hours.includes(h)) return name;
  }
  return "unknown";
}

/**
 * A recommendation must be backed by samples of the THING RECOMMENDED, not by
 * the size of the table it was filtered out of. Measured 2026-08-27: 124 DONE
 * tasks in 90d, of which HIGH-energy is **4**, spread 1/1/1/1 across the four
 * windows. The old `totalSamples < 10` gate passes at 124 and would have named
 * a "best window for high-energy work" off a single task.
 */
export const MIN_BAND_SAMPLES = 8;

export interface EnergyProfile {
  windows: Record<
    string,
    {
      /** Completions in this window. MEASURED — from `updatedAt`. */
      count: number;
      /**
       * Mean minutes over the effort band's expectation, or `null` when no
       * task in this window has a recorded duration. NOT zero — zero is a
       * task that took exactly as long as expected, and nothing here has ever
       * been timed. See `durationSamples`.
       */
      avgOverageMinutes: number | null;
      /** Rows that actually carried a duration. The divisor above. */
      overageSamples: number;
      highEnergyCount: number;
    }
  >;
  /** Null until HIGH-energy completions clear MIN_BAND_SAMPLES. */
  bestForHighEnergy: string | null;
  /** Null until LOW/MEDIUM completions clear MIN_BAND_SAMPLES. */
  bestForLowEnergy: string | null;
  /** Confidence in the COMPLETION-TIMING profile only. Durations are separate. */
  confidence: number;
  /** Completions observed — the sample count for timing. */
  totalSamples: number;
  /**
   * Completions with a real duration. **0 in production since inception**:
   * nothing writes `Task.actualMinutes`, and its NOT NULL default of 0 makes
   * the column look populated (268 of 268 rows non-null, 0 of 268 above zero).
   * Every overage figure is UNMEASURED until a writer exists.
   */
  durationSamples: number;
}

/**
 * Pull last 90d of completed tasks + their actualMinutes vs effort-band
 * to learn Nour's pattern. Returns a per-window profile.
 */
export async function buildEnergyProfile(): Promise<EnergyProfile> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const tasks = await prisma.task
    .findMany({
      where: {
        status: "DONE",
        updatedAt: { gte: since },
        // NO `actualMinutes: { gt: 0 }` HERE. That filter is what made this
        // module dark: it is true for zero rows, so `buildEnergyProfile` never
        // saw a single task and every caller got totalSamples: 0.
        //
        // The filter conflated two different questions. WHEN a task completed
        // is recorded for all 124 DONE rows in the window. HOW LONG it took is
        // recorded for none. Gating the first on the second threw away a real
        // signal to protect one that does not exist — and the protection was
        // illusory anyway, because `actualMinutes` defaults to 0, so removing
        // the filter without the `overageSamples` split below would compute
        // `0 - expected` and report every task finishing 15 minutes EARLY.
      },
      select: {
        effort: true,
        energyRequired: true,
        actualMinutes: true,
        updatedAt: true,
        startedAt: true,
      },
      take: 1000,
    })
    .catch(() => [] as Array<{ effort: string; energyRequired: string; actualMinutes: number; updatedAt: Date; startedAt: Date | null }>);

  const expected: Record<string, number> = { M5: 5, M15: 15, M30: 30, H1: 60, H2: 120, H4: 240 };
  const blank = () => ({
    count: 0,
    avgOverageMinutes: null as number | null,
    overageSamples: 0,
    highEnergyCount: 0,
  });
  const windows: EnergyProfile["windows"] = {
    morning: blank(),
    afternoon: blank(),
    evening: blank(),
    late: blank(),
  };

  let durationSamples = 0;
  for (const t of tasks) {
    const window = windowForHour(hourET(t.updatedAt));
    if (!(window in windows)) continue;
    const slot = windows[window];
    slot.count++;
    if (t.energyRequired === "HIGH") slot.highEnergyCount++;

    // Overage is accumulated ONLY from tasks that were actually timed, and
    // averaged over `overageSamples` — never over `count`. Dividing by the
    // completion count would silently dilute a handful of real durations with
    // rows that carry no measurement at all.
    if (t.actualMinutes > 0) {
      const exp = expected[t.effort] ?? 30;
      const overage = t.actualMinutes - exp;
      const prior = slot.avgOverageMinutes ?? 0;
      slot.avgOverageMinutes = (prior * slot.overageSamples + overage) / (slot.overageSamples + 1);
      slot.overageSamples++;
      durationSamples++;
    }
  }

  // Best for high energy = window with most HIGH-energy completions AND
  // lowest overage (i.e. completes on time)
  let bestHigh: string | null = null;
  let bestHighScore = -Infinity;
  // A window's score may only be adjusted by an overage it actually measured.
  // `?? 0` here is not a fallback value — it is "no adjustment", which is the
  // correct behaviour when nothing was timed.
  const penalty = (slot: EnergyProfile["windows"][string]) =>
    slot.overageSamples > 0 ? Math.abs(slot.avgOverageMinutes ?? 0) / 30 : 0;

  // Gate on the BAND's own total, not the table's. With 4 HIGH-energy
  // completions spread 1/1/1/1, "best window" is a coin flip dressed as a
  // finding — so it stays null and the caller renders nothing.
  const highTotal = Object.values(windows).reduce((n, s) => n + s.highEnergyCount, 0);
  if (highTotal >= MIN_BAND_SAMPLES) {
    for (const [name, slot] of Object.entries(windows)) {
      if (slot.highEnergyCount === 0) continue;
      const score = slot.highEnergyCount - penalty(slot);
      if (score > bestHighScore) {
        bestHighScore = score;
        bestHigh = name;
      }
    }
  }

  // Best for low energy = window with most non-HIGH completions, same gate.
  let bestLow: string | null = null;
  let bestLowScore = -Infinity;
  const lowTotal = Object.values(windows).reduce((n, s) => n + (s.count - s.highEnergyCount), 0);
  if (lowTotal >= MIN_BAND_SAMPLES) {
    for (const [name, slot] of Object.entries(windows)) {
      const lowCount = slot.count - slot.highEnergyCount;
      if (lowCount === 0) continue;
      const score = lowCount - penalty(slot);
      if (score > bestLowScore) {
        bestLowScore = score;
        bestLow = name;
      }
    }
  }

  return {
    windows,
    bestForHighEnergy: bestHigh,
    bestForLowEnergy: bestLow,
    confidence: Math.min(1, tasks.length / 50),
    totalSamples: tasks.length,
    durationSamples,
  };
}

/**
 * Recommend a window for a single pending task based on its energy
 * requirement + Nour's profile.
 */
export function recommendWindow(
  energyRequired: "LOW" | "MEDIUM" | "HIGH",
  profile: EnergyProfile,
): { window: string; reason: string; confidence: number } {
  // This gate stays, but it is the WEAKER of the two. Clearing it means the
  // table is big enough to be worth reading — not that the band being asked
  // about has any samples. `bestForHighEnergy` / `bestForLowEnergy` carry that
  // second gate (MIN_BAND_SAMPLES) and are null when it is unmet, which is why
  // the branches below check them before speaking.
  if (profile.totalSamples < 10) {
    return {
      window: energyRequired === "HIGH" ? "morning" : "afternoon",
      reason: "default — not enough completions recorded yet to learn a pattern",
      confidence: 0.3,
    };
  }
  if (energyRequired === "HIGH" && profile.bestForHighEnergy) {
    return {
      window: profile.bestForHighEnergy,
      reason: `${profile.windows[profile.bestForHighEnergy]?.highEnergyCount ?? 0} HIGH-energy tasks completed in ${profile.bestForHighEnergy} window historically`,
      confidence: profile.confidence,
    };
  }
  if (energyRequired === "LOW" && profile.bestForLowEnergy) {
    return {
      window: profile.bestForLowEnergy,
      reason: `${(profile.windows[profile.bestForLowEnergy]?.count ?? 0) - (profile.windows[profile.bestForLowEnergy]?.highEnergyCount ?? 0)} LOW-energy tasks completed in ${profile.bestForLowEnergy} window`,
      confidence: profile.confidence,
    };
  }
  // MEDIUM — by lowest measured overage, which requires a measured overage.
  // The previous version ranked on `avgOverageMinutes` unconditionally and
  // printed "lowest overage (15min)" from a column of zeros: a fabricated
  // number, quoted to the minute, in the reason string of a live suggestion.
  let best: string | null = null;
  let bestOverage = Infinity;
  for (const [name, slot] of Object.entries(profile.windows)) {
    if (slot.overageSamples === 0 || slot.avgOverageMinutes === null) continue;
    if (Math.abs(slot.avgOverageMinutes) < bestOverage) {
      bestOverage = Math.abs(slot.avgOverageMinutes);
      best = name;
    }
  }
  if (best === null) {
    // Fall back to the busiest window — a real fact about completion timing —
    // and say that is what it is, rather than implying a duration finding.
    let busiest = "afternoon";
    let mostCount = -1;
    for (const [name, slot] of Object.entries(profile.windows)) {
      if (slot.count > mostCount) {
        mostCount = slot.count;
        busiest = name;
      }
    }
    return {
      window: busiest,
      reason: `most completions (${mostCount}) land in ${busiest}; task durations are UNMEASURED, so this is timing only`,
      confidence: profile.confidence * 0.5,
    };
  }
  return {
    window: best,
    reason: `lowest measured overage (${bestOverage.toFixed(0)}min over ${profile.windows[best]?.overageSamples ?? 0} timed tasks) in ${best} window`,
    confidence: profile.confidence * 0.7,
  };
}
