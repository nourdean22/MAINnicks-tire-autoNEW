import type { DriftLevel } from "@/lib/domain";

export type DriftSignalInput = {
  recentCompletionCount: number;
  readyDoingCount: number;
  staleTaskCount: number;
  driftIncidents: number;
};

const interventions: Record<DriftLevel, string> = {
  LOW: "Stay on the rail: finish one READY task before opening anything new.",
  MEDIUM: "Pause intake for one block, close an overdue task, and clear one stale task.",
  HIGH: "Stop adding work for 30 minutes, finish the smallest overdue task, and log the drift trigger immediately."
};

export function assessDriftState(input: DriftSignalInput) {
  let score = 0;

  if (input.recentCompletionCount <= 1) {
    score += 2;
  } else if (input.recentCompletionCount <= 3) {
    score += 1;
  }

  if (input.readyDoingCount >= 8) {
    score += 2;
  } else if (input.readyDoingCount >= 5) {
    score += 1;
  }

  if (input.staleTaskCount >= 4) {
    score += 2;
  } else if (input.staleTaskCount >= 2) {
    score += 1;
  }

  if (input.driftIncidents >= 4) {
    score += 3;
  } else if (input.driftIncidents >= 2) {
    score += 2;
  } else if (input.driftIncidents >= 1) {
    score += 1;
  }

  let level: DriftLevel = "LOW";

  if (score >= 6) {
    level = "HIGH";
  } else if (score >= 3) {
    level = "MEDIUM";
  }

  return {
    level,
    score,
    intervention: interventions[level]
  };
}

export function detectDrift(
  tasks: Array<{
    id: string;
    status: string;
    lastTouchedAt?: string | Date | null;
    updatedAt: string | Date;
  }>,
  latestLog: { driftIncidents?: number | null } | null,
  now = new Date()
) {
  const ageInDays = (value?: string | Date | null) => {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  };

  const recentCompletionCount = tasks.filter((task) => task.status === "DONE" && (ageInDays(task.updatedAt) ?? 99) <= 2).length;
  const readyDoingCount = tasks.filter((task) => task.status === "READY" || task.status === "DOING").length;
  const staleTaskCount = tasks.filter((task) => !["DONE", "ARCHIVED"].includes(task.status) && (ageInDays(task.lastTouchedAt ?? task.updatedAt) ?? 0) >= 7).length;
  const driftIncidents = latestLog?.driftIncidents ?? 0;
  const assessment = assessDriftState({
    recentCompletionCount,
    readyDoingCount,
    staleTaskCount,
    driftIncidents
  });

  return {
    driftScore: assessment.score * 10,
    driftLevel: assessment.level,
    recommendedIntervention: assessment.intervention,
    avoidToday:
      assessment.level === "HIGH"
        ? "Avoid opening new work before one overdue task closes."
        : staleTaskCount > 0
          ? "Avoid touching stale work without either moving it or killing it."
          : "Avoid low-value context switching.",
    signals: [
      ...(recentCompletionCount <= 1 ? [{ key: "no_recent_completion" as const, points: 30 }] : []),
      ...(readyDoingCount >= 5 ? [{ key: "too_many_open" as const, points: readyDoingCount >= 8 ? 25 : 15 }] : []),
      ...(staleTaskCount >= 2 ? [{ key: "stale_tasks" as const, points: staleTaskCount >= 5 ? 25 : 15 }] : []),
      ...(driftIncidents >= 1 ? [{ key: "daily_log" as const, points: driftIncidents >= 3 ? 30 : 15 }] : [])
    ]
  };
}
