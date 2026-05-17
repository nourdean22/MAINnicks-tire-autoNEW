import { daysUntil } from "@/lib/utils/datetime";

export type MissionRankingCandidate = {
  id: string;
  title: string;
  domain?: string;
  status: string;
  priority: number;
  roiScore: number;
  neglectCost: number;
  deadline?: string | Date | null;
  manualRankOverride?: number | null;
};

export type RankedMission = MissionRankingCandidate & {
  rank: number;
  rankScore: number;
  manual: boolean;
  isManualOverride?: boolean;
  deadlinePressure: number;
  explanation: string;
};

function getDeadlinePressure(deadline: string | Date | null | undefined, now: Date) {
  const remaining = daysUntil(deadline, now);

  if (remaining === null) {
    return 0;
  }

  if (remaining <= 0) {
    return 100;
  }

  if (remaining <= 3) {
    return 90;
  }

  if (remaining <= 7) {
    return 70;
  }

  if (remaining <= 14) {
    return 45;
  }

  return 15;
}

export function rankMissions(missions: MissionRankingCandidate[], now = new Date()) {
  const rankedMissions = missions
    .filter((mission) => mission.status === "ACTIVE")
    .map((mission) => {
      const manual = typeof mission.manualRankOverride === "number";
      const deadlinePressure = getDeadlinePressure(mission.deadline, now);
      const normalizedPriority = Math.min(Math.max(mission.priority, 1), 10) * 10;
      const automatedScore = Math.round(
        normalizedPriority * 0.35 + mission.roiScore * 0.3 + mission.neglectCost * 0.25 + deadlinePressure * 0.1
      );
      const rankScore = manual ? 1000 + (mission.manualRankOverride || 0) : automatedScore;

      return {
        ...mission,
        rank: 0,
        rankScore,
        manual,
        isManualOverride: manual,
        deadlinePressure,
        explanation: manual
          ? `Manual override ${mission.manualRankOverride} set by operator.`
          : `Priority ${normalizedPriority}, ROI ${mission.roiScore}, neglect ${mission.neglectCost}, deadline pressure ${deadlinePressure}.`
      } satisfies RankedMission;
    })
    .sort((left, right) => {
      if (right.rankScore !== left.rankScore) {
        return right.rankScore - left.rankScore;
      }

      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }

      return left.title.localeCompare(right.title);
    })
    .map((mission, index) => ({
      ...mission,
      rank: index + 1
    }));

  return {
    rankedMissions,
    primaryMission: rankedMissions[0] || null,
    secondaryMission: rankedMissions[1] || null
  };
}
