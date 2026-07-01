import { create } from "zustand";
import type { LevelUpPayload } from "@/lib/mastery/task-reward";
import type { Task } from "@/components/actions/shared";

interface MissionUIState {
  retroState: { missionId: string; title: string } | null;
  levelUpState: LevelUpPayload | null;
  xpParticle: { xp: number; key: number };
  missionEditOpen: boolean;
  missionEditId: string | null;
  missionEditInitial: any;
  taskEditOpen: boolean;
  taskEditTarget: Task | null;
  executionModeActive: boolean;
  queuedTaskId: string | null;

  setRetroState: (state: { missionId: string; title: string } | null) => void;
  setLevelUpState: (state: LevelUpPayload | null) => void;
  triggerXpParticle: (xp: number) => void;
  openMissionEdit: (id?: string | null, initial?: any) => void;
  closeMissionEdit: () => void;
  openTaskEdit: (task: Task | null) => void;
  closeTaskEdit: () => void;
  setExecutionModeActive: (active: boolean) => void;
  setQueuedTaskId: (id: string | null) => void;
}

export const useMissionUIStore = create<MissionUIState>((set) => ({
  retroState: null,
  levelUpState: null,
  xpParticle: { xp: 0, key: 0 },
  missionEditOpen: false,
  missionEditId: null,
  missionEditInitial: undefined,
  taskEditOpen: false,
  taskEditTarget: null,
  executionModeActive: false,
  queuedTaskId: null,

  setRetroState: (retroState) => set({ retroState }),
  setLevelUpState: (levelUpState) => set({ levelUpState }),
  triggerXpParticle: (xp) =>
    set((state) => ({ xpParticle: { xp, key: state.xpParticle.key + 1 } })),
  openMissionEdit: (id = null, initial = undefined) =>
    set({ missionEditOpen: true, missionEditId: id, missionEditInitial: initial }),
  closeMissionEdit: () => set({ missionEditOpen: false, missionEditId: null, missionEditInitial: undefined }),
  openTaskEdit: (task) => set({ taskEditOpen: true, taskEditTarget: task }),
  closeTaskEdit: () => set({ taskEditOpen: false, taskEditTarget: null }),
  setExecutionModeActive: (executionModeActive) => set({ executionModeActive }),
  setQueuedTaskId: (queuedTaskId) => set({ queuedTaskId }),
}));
