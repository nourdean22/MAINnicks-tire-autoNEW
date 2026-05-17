"use client";

/**
 * useTaskEditModal · v10.0.529.17
 *
 * Collapses the two TaskEditSheet IIFEs that lived inline at the bottom
 * of <NowPanel>:
 *   1. editingGoalForTaskId  → LinkGoalPicker sheet
 *   2. editingProjectForTaskId → LinkProjectPicker sheet
 *
 * Both shared the same lifecycle:
 *   · find the task by id (return null if it's been deleted mid-edit)
 *   · render a TaskEditSheet with the matching eyebrow + picker
 *   · onLinked → close the sheet + fire the parent's reload
 *
 * Pre-extraction the two IIFEs duplicated that lifecycle inline at
 * now-panel.tsx:428-488 · ~60 LOC of near-identical JSX. The hook owns
 * the two `useState` cells + the `modalElement` JSX and returns simple
 * openers (`openGoalEdit(taskId)` / `openProjectEdit(taskId)`) so the
 * panel just wires LoopStream's row callbacks to the openers and drops
 * `{modalElement}` once at the panel's render tail.
 *
 * Behavior + visual contract: 100% identical to the pre-extraction
 * inline IIFEs. The hook's only job is to hide the duplication ·
 * NowPanel stays leaner, the modals stay in lockstep.
 *
 * Note · file is `.tsx` (not `.ts`) because the hook returns JSX in
 * `modalElement`. tsconfig has `"jsx": "react-jsx"` so the standard
 * convention is `.tsx` for any module that uses JSX syntax.
 */

import { useCallback, useState, type ReactNode } from "react";
import { TaskEditSheet } from "@/components/actions/task-edit-sheet";
import { LinkGoalPicker } from "@/components/actions/link-goal-picker";
import { LinkProjectPicker } from "@/components/actions/link-project-picker";
import type { Task, Project, GoalCacheEntry } from "@/components/actions/shared";

export interface UseTaskEditModalArgs {
  tasks: Task[];
  projects: Project[];
  goalsCache: GoalCacheEntry[];
  /** Parent's reload — fired after a successful link/unlink so the
   *  optimistic state stays in sync with everything else on the page. */
  onReload: () => Promise<void> | void;
}

export interface UseTaskEditModalResult {
  openGoalEdit: (taskId: string) => void;
  openProjectEdit: (taskId: string) => void;
  modalElement: ReactNode;
}

export function useTaskEditModal({
  tasks,
  projects,
  goalsCache,
  onReload,
}: UseTaskEditModalArgs): UseTaskEditModalResult {
  // Apr 27 · GOAL-EDIT — set when LoopStream's "change goal" row
  // button fires `onEditTaskGoal(id)`. Pickers stay direct children
  // of <TaskEditSheet> so the centered card + ✕ + eyebrow stay shared.
  const [editingGoalForTaskId, setEditingGoalForTaskId] = useState<string | null>(null);
  // May 02 · v10.0.146 · PROJECT-EDIT — twin of editingGoalForTaskId.
  const [editingProjectForTaskId, setEditingProjectForTaskId] = useState<string | null>(null);

  const openGoalEdit = useCallback((taskId: string) => {
    setEditingGoalForTaskId(taskId);
  }, []);
  const openProjectEdit = useCallback((taskId: string) => {
    setEditingProjectForTaskId(taskId);
  }, []);

  // v10.0.327 · Stage C · GOAL-EDIT + PROJECT-EDIT modal shells
  // collapsed to <TaskEditSheet>. Twin sheets share the same backdrop
  // + centered card + title row + ✕ button · pickers (LinkGoalPicker /
  // LinkProjectPicker) stay direct children. v10.0.529.17 · lifted out
  // of <NowPanel> into this hook to kill the duplicated IIFE structure.
  const goalSheet = (() => {
    if (!editingGoalForTaskId) return null;
    const editingTask = tasks.find((t) => t.id === editingGoalForTaskId);
    if (!editingTask) return null;
    return (
      <TaskEditSheet
        isOpen={true}
        onClose={() => setEditingGoalForTaskId(null)}
        eyebrow="Change linked goal"
        taskTitle={editingTask.title}
      >
        <LinkGoalPicker
          key={editingGoalForTaskId}
          projectId={editingTask.missionId || editingGoalForTaskId}
          projectTitle={editingTask.title}
          taskIdsWithoutGoal={[editingGoalForTaskId]}
          goals={goalsCache}
          currentGoalId={editingTask.goalId ?? null}
          allowUnlink={!!editingTask.goalId}
          defaultOpen={true}
          triggerLabel={editingTask.goalId ? "switch goal" : "pick a goal"}
          onLinked={() => {
            setEditingGoalForTaskId(null);
            void onReload();
          }}
          onClose={() => setEditingGoalForTaskId(null)}
        />
      </TaskEditSheet>
    );
  })();

  const projectSheet = (() => {
    if (!editingProjectForTaskId) return null;
    const editingTask = tasks.find((t) => t.id === editingProjectForTaskId);
    if (!editingTask) return null;
    return (
      <TaskEditSheet
        isOpen={true}
        onClose={() => setEditingProjectForTaskId(null)}
        eyebrow={editingTask.missionId ? "Change mission" : "Link to mission"}
        taskTitle={editingTask.title}
      >
        <LinkProjectPicker
          key={editingProjectForTaskId}
          taskId={editingProjectForTaskId}
          taskTitle={editingTask.title}
          projects={projects.map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            domain: p.domain,
          }))}
          currentProjectId={editingTask.missionId ?? null}
          allowLeave={!!editingTask.missionId}
          onLinked={() => {
            setEditingProjectForTaskId(null);
            void onReload();
          }}
          onClose={() => setEditingProjectForTaskId(null)}
        />
      </TaskEditSheet>
    );
  })();

  const modalElement = (
    <>
      {goalSheet}
      {projectSheet}
    </>
  );

  return { openGoalEdit, openProjectEdit, modalElement };
}
