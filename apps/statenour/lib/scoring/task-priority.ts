import { daysUntil } from "@/lib/utils/datetime";

// ── CANONICAL PRIORITY POLARITY ─────────────────────────────────────
// autoPriority / manualPriorityOverride are 0-100 where HIGHER = MORE
// URGENT. scoreTaskPriority below — the engine syncTaskPriorities uses
// to rewrite every open task — has always produced this scale, but a
// second convention (5/15/30/60, lower = hotter) leaked in through the
// nick-agent create path and split readers down the middle for months:
// the 8am MIT picker, the daily scheduler and Nick's own task ordering
// were all surfacing the LEAST urgent work. 2026-08-19: one scale,
// pinned by tests/lib/scoring/task-priority-polarity.test.ts. Import
// bands/labels from here — never hand-roll thresholds.
export const PRIORITY_CRITICAL_MIN = 80;
export const PRIORITY_HIGH_MIN = 60;
export const PRIORITY_MEDIUM_MIN = 40;

export type PriorityBand = "critical" | "high" | "medium" | "low";

export function priorityBandLabel(score: number | null | undefined): PriorityBand {
  const s = typeof score === "number" ? score : 50;
  if (s >= PRIORITY_CRITICAL_MIN) return "critical";
  if (s >= PRIORITY_HIGH_MIN) return "high";
  if (s >= PRIORITY_MEDIUM_MIN) return "medium";
  return "low";
}

/** Label → canonical score, for writers that only know a label. */
export function priorityFromLabel(p: unknown): number {
  return p === "critical" ? 90 : p === "high" ? 70 : p === "low" ? 30 : 50;
}

/** Sort comparator — most urgent first; unscored rows sink to the bottom. */
export function byPriorityDesc(
  a: { autoPriority?: number | null },
  b: { autoPriority?: number | null },
): number {
  return (b.autoPriority ?? -1) - (a.autoPriority ?? -1);
}

export type TaskPriorityCandidate = {
  id?: string;
  title: string;
  missionId: string;
  status: string;
  roiScore: number;
  frictionScore: number;
  energyRequired: string;
  dueDate?: string | Date | null;
  manualPriorityOverride?: number | null;
};

export type RankedMissionRef = {
  id: string;
  rank: number;
  rankScore: number;
};

export type TaskPriorityResult = {
  score: number;
  explanation: string;
  manual: boolean;
};

function getDueUrgency(dueDate: string | Date | null | undefined, now: Date) {
  const remaining = daysUntil(dueDate, now);

  if (remaining === null) {
    return 10;
  }

  if (remaining <= 0) {
    return 100;
  }

  if (remaining < 1) {
    return 90;
  }

  if (remaining === 1) {
    return 75;
  }

  if (remaining <= 3) {
    return 60;
  }

  if (remaining <= 7) {
    return 40;
  }

  return 10;
}

export function scoreTaskPriority(
  task: TaskPriorityCandidate,
  missionRankings: Map<string, RankedMissionRef>,
  now = new Date()
): TaskPriorityResult {
  if (typeof task.manualPriorityOverride === "number") {
    return {
      score: task.manualPriorityOverride,
      explanation: `Manual priority override ${task.manualPriorityOverride} set by operator.`,
      manual: true
    };
  }

  const mission = missionRankings.get(task.missionId);
  const dueUrgency = getDueUrgency(task.dueDate, now);
  const inverseFriction = Math.max(0, 100 - task.frictionScore);
  const missionWeight = !mission ? 10 : mission.rank === 1 ? 100 : mission.rank === 2 ? 70 : 50;
  const energyBonus = task.energyRequired === "LOW" ? 100 : task.energyRequired === "MEDIUM" ? 70 : 45;
  const score = Math.round(
    task.roiScore * 0.35 +
      inverseFriction * 0.2 +
      dueUrgency * 0.2 +
      missionWeight * 0.2 +
      energyBonus * 0.05
  );

  return {
    score,
    explanation: `ROI ${task.roiScore}, inverse friction ${inverseFriction}, due urgency ${dueUrgency}, mission weight ${missionWeight}, energy fit ${energyBonus}.`,
    manual: false
  };
}

export const computeTaskPriority = scoreTaskPriority;
