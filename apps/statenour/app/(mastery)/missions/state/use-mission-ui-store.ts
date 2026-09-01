import { create } from "zustand";
import type { Task } from "@/components/actions/shared";

interface MissionUIState {
  retroState: { missionId: string; title: string } | null;
  missionEditOpen: boolean;
  missionEditId: string | null;
  missionEditInitial: any;
  taskEditOpen: boolean;
  taskEditTarget: Task | null;
  executionModeActive: boolean;
  queuedTaskId: string | null;

  setRetroState: (state: { missionId: string; title: string } | null) => void;
  openMissionEdit: (id?: string | null, initial?: any) => void;
  closeMissionEdit: () => void;
  openTaskEdit: (task: Task | null) => void;
  closeTaskEdit: () => void;
  setExecutionModeActive: (active: boolean) => void;
  setQueuedTaskId: (id: string | null) => void;
}

export const useMissionUIStore = create<MissionUIState>((set) => ({
  retroState: null,
  missionEditOpen: false,
  missionEditId: null,
  missionEditInitial: undefined,
  taskEditOpen: false,
  taskEditTarget: null,
  executionModeActive: false,
  queuedTaskId: null,

  setRetroState: (retroState) => set({ retroState }),
  openMissionEdit: (id = null, initial = undefined) =>
    set({ missionEditOpen: true, missionEditId: id, missionEditInitial: initial }),
  closeMissionEdit: () => set({ missionEditOpen: false, missionEditId: null, missionEditInitial: undefined }),
  openTaskEdit: (task) => set({ taskEditOpen: true, taskEditTarget: task }),
  closeTaskEdit: () => set({ taskEditOpen: false, taskEditTarget: null }),
  setExecutionModeActive: (executionModeActive) => set({ executionModeActive }),
  setQueuedTaskId: (queuedTaskId) => set({ queuedTaskId }),
}));
