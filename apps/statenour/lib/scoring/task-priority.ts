import { daysUntil } from "@/lib/utils/datetime";

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
