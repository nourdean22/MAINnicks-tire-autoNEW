import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import type { Project, Task } from "@/components/actions/shared";
import { withTaskGoals, type GoalRow, type GoalTask } from "@/lib/missions/task-goal";

/**
 * Execution Deck (2026-09-01): the page's data story is one server-composed
 * deck read plus the two raw lists the board's actions and filters need.
 *
 * Removed from the old five-poll setup, deliberately:
 *  · system.healthSummary: its read performed a bodyTracking UPSERT on
 *    every 30s poll (a write-on-read), and its only consumer here was a
 *    decorative "AUTONOMIC" chip that belongs on /system.
 *  · operator.characterSheet: fed a header LVL/XP pill that summed five
 *    per-domain levels (baseline floors included) into a number nothing
 *    read. /stats keeps the honest per-stat sheet.
 *  · task.byId(?taskId=): fetched and discarded. W8a (2026-11-03): ?taskId= is read
 *    again, by useOpenTaskFromUrl below, which opens that task's sheet once (the goal
 *    card's "Next:" and the hero's move link here with goalId + taskId).
 * task.list also slows 15s → 30s: the deck carries the fresh-scored
 * ordering now, so the raw list only feeds actions/filters.
 *
 * 2026-11-02 (job nour-os-interconnect W3) · task.goals joins: goal titles for the
 * chips, the align picker and the pace lineage hidden-risk reads. Every task carries
 * goal (lib/missions/task-goal taskGoal: own goalId, else the mission's goal).
 */
/**
 * W8a (audit A top-2): /missions?taskId=<id> opens that task's edit sheet once the tasks land. Applied once per
 * id; an id that matches no task (deleted, filtered out) opens nothing and leaves the URL alone.
 */
export function useOpenTaskFromUrl(tasks: readonly Task[], open: (task: Task) => void) {
  const taskId = useSearchParams().get("taskId") || null;
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!taskId || applied.current === taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    applied.current = taskId;
    open(task);
  }, [taskId, tasks, open]);
}

export function useMissionsData() {
  const utils = trpc.useUtils();

  const deckQuery = trpc.task.deck.useQuery(undefined, {
    staleTime: 20_000,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

  const tasksQuery = trpc.task.list.useQuery(
    {},
    {
      refetchInterval: 30_000,
      refetchOnWindowFocus: false,
    },
  );

  const missionsQuery = trpc.task.missions.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const ccStateQuery = trpc.operator.commandCenterState.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const goalsQuery = trpc.task.goals.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const goals = useMemo<GoalRow[] | undefined>(
    () => (goalsQuery.data?.goals as GoalRow[] | undefined),
    [goalsQuery.data],
  );
  const activeGoals = useMemo(
    () => (goals ?? []).filter((g) => g.status === "active").map((g) => ({ id: g.id, title: g.title })),
    [goals],
  );

  const missions = useMemo<Project[]>(
    () => (missionsQuery.data ?? []) as Project[],
    [missionsQuery.data],
  );

  const tasks = useMemo<GoalTask[]>(
    () => withTaskGoals((tasksQuery.data ?? []) as Task[], missions, goals, goalsQuery.isError ? "failed" : goals ? "ok" : "loading"),
    [tasksQuery.data, missions, goals, goalsQuery.isError],
  );

  return {
    utils,
    deckQuery,
    tasksQuery,
    missionsQuery,
    ccStateQuery,
    goalsQuery,
    goals,
    activeGoals,
    tasks,
    missions,
  };
}
