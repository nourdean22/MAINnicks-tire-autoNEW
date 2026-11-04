import { create } from "zustand";
import type { Task } from "@/components/actions/shared";

interface MissionUIState {
  retroState: { missionId: string; title: string } | null;
  missionEditOpen: boolean;
  missionEditId: string | null;
  missionEditInitial: any;
  /** The field the mission editor opens at (the card's "align to goal" opens at goal). */
  missionEditFocus: "goal" | null;
  taskEditOpen: boolean;
  taskEditTarget: Task | null;
  /** The field the task editor opens at (the row's "Align to goal" opens at goal). */
  taskEditFocus: "goal" | null;
  executionModeActive: boolean;
  queuedTaskId: string | null;

  setRetroState: (state: { missionId: string; title: string } | null) => void;
  openMissionEdit: (id?: string | null, initial?: any, focus?: "goal" | null) => void;
  closeMissionEdit: () => void;
  openTaskEdit: (task: Task | null, focus?: "goal" | null) => void;
  closeTaskEdit: () => void;
  setExecutionModeActive: (active: boolean) => void;
  setQueuedTaskId: (id: string | null) => void;
}

export const useMissionUIStore = create<MissionUIState>((set) => ({
  retroState: null,
  missionEditOpen: false,
  missionEditId: null,
  missionEditInitial: undefined,
  missionEditFocus: null,
  taskEditOpen: false,
  taskEditTarget: null,
  taskEditFocus: null,
  executionModeActive: false,
  queuedTaskId: null,

  setRetroState: (retroState) => set({ retroState }),
  openMissionEdit: (id = null, initial = undefined, focus = null) =>
    set({ missionEditOpen: true, missionEditId: id, missionEditInitial: initial, missionEditFocus: focus }),
  closeMissionEdit: () => set({ missionEditOpen: false, missionEditId: null, missionEditInitial: undefined, missionEditFocus: null }),
  openTaskEdit: (task, focus = null) => set({ taskEditOpen: true, taskEditTarget: task, taskEditFocus: focus }),
  closeTaskEdit: () => set({ taskEditOpen: false, taskEditTarget: null, taskEditFocus: null }),
  setExecutionModeActive: (executionModeActive) => set({ executionModeActive }),
  setQueuedTaskId: (queuedTaskId) => set({ queuedTaskId }),
}));
