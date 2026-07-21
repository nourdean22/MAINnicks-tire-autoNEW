import type { Project, Task } from "@/components/actions/shared";
import { isUserProject, isGeneralAnchor } from "@/lib/services/mission-helpers";

export interface MissionFeedGroups {
  activeMissions: Project[];
  tasksByMission: Map<string, Task[]>;
  /** truth-substrate audit P1 (#19): GENERAL per-domain anchor buckets —
   *  CLASSIFIED tasks routed to a domain anchor, kept OUT of `unattached`. */
  domainGroups: { anchor: Project; tasks: Task[] }[];
  /** TRULY unclassified open tasks (no mission / inbox / inactive / unknown). */
  unattached: Task[];
}

/**
 * Pure grouping for MissionFeed. Extracted from the component's useMemo so it is
 * unit-testable without pulling the React "use client" boundary + lucide into the
 * test runner (and so the test can't drift from a hand-copied re-implementation).
 *
 * Three visible states (audit #19): user Projects (activeMissions/tasksByMission),
 * Domain buckets (domainGroups, from GENERAL anchors isUserProject discards), and
 * Unclassified (unattached). Previously states 2 and 3 were collapsed into one
 * "unattached" pile, mislabeling classified tasks as unclassified.
 */
export function groupMissionFeed(missions: Project[], tasks: Task[]): MissionFeedGroups {
  const activeMissions = missions
    .filter((m) => m.status === "ACTIVE" && isUserProject(m))
    .sort((a, b) => {
      // Operator's manual rank first (lower = higher; nulls sink), then imminent
      // deadline, then title for determinism.
      const aRank = a.manualRankOverride ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.manualRankOverride ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      const aDue = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bDue = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return a.title.localeCompare(b.title);
    });

  // Active GENERAL anchors — present on the missions prop (systemKind carried
  // through by listMissions/decorateMissions), just discarded by isUserProject.
  const anchorById = new Map(
    missions
      .filter((m) => m.status === "ACTIVE" && isGeneralAnchor(m))
      .map((m) => [m.id, m] as const),
  );

  const activeIds = new Set(activeMissions.map((m) => m.id));
  const tasksByMission = new Map<string, Task[]>();
  const domainBuckets = new Map<string, Task[]>();
  const unattached: Task[] = [];
  for (const task of tasks) {
    if (task.missionId && activeIds.has(task.missionId)) {
      const bucket = tasksByMission.get(task.missionId) ?? [];
      bucket.push(task);
      tasksByMission.set(task.missionId, bucket);
    } else if (task.missionId && anchorById.has(task.missionId) && task.status !== "DONE") {
      // Classified into a domain anchor — a real, VISIBLE bucket, not unattached.
      const bucket = domainBuckets.get(task.missionId) ?? [];
      bucket.push(task);
      domainBuckets.set(task.missionId, bucket);
    } else if (task.status !== "DONE") {
      // TRULY unclassified. Only OPEN tasks; done tasks without a mission = noise.
      unattached.push(task);
    }
  }

  const domainGroups = [...domainBuckets.entries()]
    .map(([id, groupTasks]) => ({ anchor: anchorById.get(id)!, tasks: groupTasks }))
    .filter((g) => g.anchor && g.tasks.length > 0)
    .sort((a, b) => a.anchor.title.localeCompare(b.anchor.title));

  return { activeMissions, tasksByMission, unattached, domainGroups };
}
