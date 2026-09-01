import { useMemo } from "react";
import type { Task, Project } from "@/components/actions/shared";

export function useExecutionFocus(
  tasks: Task[],
  missions: Project[],
  queuedTaskId: string | null,
  activeTaskId?: string,
  /** Execution Deck (2026-09-01): the server-picked next move. One ordering
   *  brain — when the deck has an answer, focus mode agrees with the hero
   *  instead of re-deriving a different pick from the stale autoPriority
   *  column. The heuristic below survives only as the offline fallback. */
  deckHeroTaskId?: string | null,
) {
  const focusedTask = useMemo(() => {
    // 1. First choice: active task from CommandCenterState
    if (activeTaskId) {
      const doingTask = tasks.find((t) => t.id === activeTaskId);
      if (doingTask) return doingTask;
    }

    // 1.5 Second choice: a task queued by the operator (Queue next)
    if (queuedTaskId) {
      const queuedTask = tasks.find(
        (t) =>
          t.id === queuedTaskId &&
          t.status !== "DONE" &&
          t.status !== "WAITING" &&
          t.status !== "ARCHIVED"
      );
      if (queuedTask) return queuedTask;
    }

    // 2. The deck's decided move — same selector the hero shows.
    if (deckHeroTaskId) {
      const heroTask = tasks.find(
        (t) =>
          t.id === deckHeroTaskId &&
          t.status !== "DONE" &&
          t.status !== "WAITING" &&
          t.status !== "ARCHIVED",
      );
      if (heroTask) return heroTask;
    }

    // We only care about open (non-DONE, non-WAITING, non-ARCHIVED) tasks for focus recommendations
    const openTasks = tasks.filter((t) => t.status !== "DONE" && t.status !== "WAITING" && t.status !== "ARCHIVED");
    if (openTasks.length === 0) {
      // Fallback to any tasks that are not DONE or ARCHIVED if nothing else
      const anyNotDone = tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED");
      if (anyNotDone.length > 0) return anyNotDone[0];
      return null;
    }

    // Refined heuristic: prioritize AI-scored tasks.
    // Order: Overdue > AI autoPriority > Due Date > Oldest
    const now = Date.now();
    const sortedOpen = [...openTasks].sort((a, b) => {
      const isOverdueA = a.dueDate ? new Date(a.dueDate).getTime() < now : false;
      const isOverdueB = b.dueDate ? new Date(b.dueDate).getTime() < now : false;

      // 1. Overdue wins
      if (isOverdueA !== isOverdueB) {
        return isOverdueA ? -1 : 1;
      }
      if (isOverdueA && isOverdueB) {
        const timeA = new Date(a.dueDate!).getTime();
        const timeB = new Date(b.dueDate!).getTime();
        if (timeA !== timeB) return timeA - timeB;
      }

      // 2. AI autoPriority wins (canonical polarity: higher = more
      // urgent; unscored rows sink below every scored one)
      const priA = a.autoPriority ?? -Infinity;
      const priB = b.autoPriority ?? -Infinity;
      if (priA !== priB) {
        return priB - priA;
      }

      // 3. Due Date wins (future)
      const hasDueA = !!a.dueDate;
      const hasDueB = !!b.dueDate;
      if (hasDueA !== hasDueB) {
        return hasDueA ? -1 : 1;
      }
      if (hasDueA && hasDueB) {
        const timeA = new Date(a.dueDate!).getTime();
        const timeB = new Date(b.dueDate!).getTime();
        if (timeA !== timeB) return timeA - timeB;
      }

      // 4. Oldest wins
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });

    return sortedOpen[0] || null;
  }, [tasks, queuedTaskId, activeTaskId, deckHeroTaskId]);

  const focusedTaskMission = useMemo(() => {
    if (!focusedTask || !focusedTask.missionId) return null;
    return missions.find((m) => m.id === focusedTask.missionId) || null;
  }, [focusedTask, missions]);

  return { focusedTask, focusedTaskMission };
}
