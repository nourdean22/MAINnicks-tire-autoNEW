"use client";

/**
 * useGoalProjectBridge · v10.0.529.17
 *
 * Materializes the three derived maps that linked the three layers
 * (LifeGoal / Mission / Task) on /tasks. The layers live in separate
 * sections but never cross-reference at the data-model level — the
 * linkage is derived by walking tasks: a Mission "serves" a Goal if
 * any of its tasks carries both `goalId` and `missionId`.
 *
 * Outputs:
 *   · goalLineage    — Map<goalId, GoalLineageEntry> · per-row rollup
 *                      (title + horizon + domain + paceKind) that
 *                      LoopStream consumes to bump urgency on rows
 *                      whose goal is behind/missed/needs.
 *   · goalToProjects — Map<goalId, PlanLinkedProjectChip[]> ·
 *                      sorted by openCount desc. (Historically the
 *                      KommandoPlan goal cards rendered these chips;
 *                      that surface — now GoalBoard on /goals — was
 *                      trimmed of its project-link manager, so this
 *                      output currently has no consumer.)
 *   · projectToGoals — Map<missionId, Set<goalId>> · ProjectsPanel
 *                      uses this to label cards with the goal(s) they
 *                      serve, and to bucket "orphan" projects (no
 *                      goal linkage).
 *   · goalTitles     — Record<goalId, title> · cheap id→title lookup
 *                      threaded into ProjectsPanel for breadcrumb chips
 *                      (avoids the full PlanLinkedProjectChip cost when
 *                      we only need the title).
 *
 * Pre-extraction these three useMemos lived inline in page.tsx at
 * lines ~144 (goalTitles) + ~829 (goalLineage) + ~930
 * (goalToProjects / projectToGoals). All four are pure derivations
 * from (tasks, projects, goalsCache) · no UI · perfectly portable.
 * Lifting them here:
 *   1. drops ~60 LOC from page.tsx
 *   2. makes the goal↔project bridge a named domain primitive
 *      (one search reveals it · easier to reason about)
 *   3. keeps the existing memoization keys (each useMemo depends on
 *      its own minimal slice · re-renders stay surgical)
 */

import { useMemo } from "react";
import { computePace } from "@/lib/brain/goal-pace";
import type {
  Task,
  Project,
  GoalCacheEntry,
  GoalLineageEntry,
  PlanLinkedProjectChip,
} from "@/components/actions/shared";

export interface UseGoalProjectBridgeResult {
  goalLineage: Map<string, GoalLineageEntry>;
  goalToProjects: Map<string, PlanLinkedProjectChip[]>;
  projectToGoals: Map<string, Set<string>>;
  goalTitles: Record<string, string>;
}

export function useGoalProjectBridge(
  tasks: Task[],
  projects: Project[],
  goalsCache: GoalCacheEntry[],
): UseGoalProjectBridgeResult {
  // Apr 20 bridge · page-level cache of goal rows · feeds Project→Goal
  // breadcrumb chips (title lookup). Cheap derived shape kept separate
  // from goalLineage so consumers that only need titles don't pull the
  // paceKind compute.
  const goalTitles = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of goalsCache) m[g.id] = g.title;
    return m;
  }, [goalsCache]);

  // Apr 27 · build pace-aware lineage data so LoopStream can:
  //   1. bump urgency on tasks linked to behind/missed goals
  //   2. paint a small chip on the row when the linked goal is under
  //      pace pressure
  // v10.0.423 · drives off goalsCache (single source). v10.0.529.16 ·
  // explicit Map<string, GoalLineageEntry> annotation · type imported
  // from shared.ts so any future field addition catches mismatches at
  // the producer instead of only at the LoopStream consumer.
  const goalLineage = useMemo<Map<string, GoalLineageEntry>>(
    () =>
      new Map(
        goalsCache.map((g) => [
          g.id,
          {
            title: g.title,
            horizon: g.horizon || undefined,
            domain: g.domain,
            paceKind: computePace({
              currentValue: g.currentValue ?? 0,
              targetValue: g.targetValue ?? 0,
              deadline: g.deadline ?? null,
              createdAt: g.createdAt ?? null,
            }).kind,
          },
        ])
      ),
    [goalsCache]
  );

  // Apr 20 · goal↔project linkage derived by walking tasks · a Mission
  // "serves" a Goal if any of its tasks carries both goalId + missionId.
  // Feeds:
  //   • KommandoPlan → goal cards show linked project chips
  //   • Projects list → each card shows the goal(s) it serves
  //   • Orphan projects bucket — Missions with zero goal linkage
  const { goalToProjects, projectToGoals } = useMemo(() => {
    const g2p = new Map<string, Map<string, { open: number; total: number }>>();
    const p2g = new Map<string, Set<string>>();
    for (const t of tasks) {
      if (!t.goalId || !t.missionId) continue;
      if (!g2p.has(t.goalId)) g2p.set(t.goalId, new Map());
      const projMap = g2p.get(t.goalId)!;
      const prev = projMap.get(t.missionId) || { open: 0, total: 0 };
      prev.total++;
      if (["INBOX", "READY", "DOING"].includes(t.status)) prev.open++;
      projMap.set(t.missionId, prev);

      if (!p2g.has(t.missionId)) p2g.set(t.missionId, new Set());
      p2g.get(t.missionId)!.add(t.goalId);
    }
    // Materialize goalToProjects with project titles pulled from the
    // projects list so the chips render real names, not IDs.
    const goalToProjects = new Map<string, PlanLinkedProjectChip[]>();
    for (const [goalId, projMap] of g2p.entries()) {
      const chips: PlanLinkedProjectChip[] = [];
      for (const [projId, counts] of projMap.entries()) {
        const proj = projects.find((p) => p.id === projId);
        chips.push({
          id: projId,
          title: proj?.title || "(unknown mission)",
          openCount: counts.open,
          totalCount: counts.total,
        });
      }
      chips.sort((a, b) => b.openCount - a.openCount);
      goalToProjects.set(goalId, chips);
    }
    return { goalToProjects, projectToGoals: p2g };
  }, [tasks, projects]);

  return { goalLineage, goalToProjects, projectToGoals, goalTitles };
}
