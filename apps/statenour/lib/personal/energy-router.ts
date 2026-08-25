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

export interface EnergyProfile {
  /** Per-window completion stats: count + avg duration overage */
  windows: Record<string, { count: number; avgOverageMinutes: number; highEnergyCount: number }>;
  /** The window where high-energy tasks tend to complete on time */
  bestForHighEnergy: string | null;
  /** The window for admin/low-energy tasks */
  bestForLowEnergy: string | null;
  /** Confidence based on sample size */
  confidence: number;
  totalSamples: number;
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
        actualMinutes: { gt: 0 },
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
  const windows: EnergyProfile["windows"] = {
    morning: { count: 0, avgOverageMinutes: 0, highEnergyCount: 0 },
    afternoon: { count: 0, avgOverageMinutes: 0, highEnergyCount: 0 },
    evening: { count: 0, avgOverageMinutes: 0, highEnergyCount: 0 },
    late: { count: 0, avgOverageMinutes: 0, highEnergyCount: 0 },
  };

  for (const t of tasks) {
    const window = windowForHour(hourET(t.updatedAt));
    if (!(window in windows)) continue;
    const exp = expected[t.effort] ?? 30;
    const overage = t.actualMinutes - exp;
    const slot = windows[window];
    const newCount = slot.count + 1;
    slot.avgOverageMinutes = (slot.avgOverageMinutes * slot.count + overage) / newCount;
    slot.count = newCount;
    if (t.energyRequired === "HIGH") slot.highEnergyCount++;
  }

  // Best for high energy = window with most HIGH-energy completions AND
  // lowest overage (i.e. completes on time)
  let bestHigh: string | null = null;
  let bestHighScore = -Infinity;
  for (const [name, slot] of Object.entries(windows)) {
    if (slot.highEnergyCount === 0) continue;
    const score = slot.highEnergyCount - Math.abs(slot.avgOverageMinutes) / 30;
    if (score > bestHighScore) {
      bestHighScore = score;
      bestHigh = name;
    }
  }

  // Best for low energy = window with most LOW-energy completions
  let bestLow: string | null = null;
  let bestLowScore = -Infinity;
  for (const [name, slot] of Object.entries(windows)) {
    const lowCount = slot.count - slot.highEnergyCount;
    if (lowCount === 0) continue;
    const score = lowCount - Math.abs(slot.avgOverageMinutes) / 30;
    if (score > bestLowScore) {
      bestLowScore = score;
      bestLow = name;
    }
  }

  return {
    windows,
    bestForHighEnergy: bestHigh,
    bestForLowEnergy: bestLow,
    confidence: Math.min(1, tasks.length / 50),
    totalSamples: tasks.length,
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
  if (profile.totalSamples < 10) {
    return {
      window: energyRequired === "HIGH" ? "morning" : "afternoon",
      reason: "default — not enough data to learn pattern yet",
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
  // MEDIUM — pick window with best avg-overage
  let best = "afternoon";
  let bestOverage = Infinity;
  for (const [name, slot] of Object.entries(profile.windows)) {
    if (slot.count > 0 && Math.abs(slot.avgOverageMinutes) < bestOverage) {
      bestOverage = Math.abs(slot.avgOverageMinutes);
      best = name;
    }
  }
  return {
    window: best,
    reason: `lowest overage (${bestOverage.toFixed(0)}min) in ${best} window`,
    confidence: profile.confidence * 0.7,
  };
}
