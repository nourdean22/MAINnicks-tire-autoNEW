"use client";

import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { MissionRetroModal } from "@/components/missions/mission-retro-modal";
import { MissionEditDrawer } from "@/components/missions/mission-edit-drawer";
import { TaskEditSheet } from "@/components/missions/task-edit-sheet";
import { useMissionUIStore } from "../state/use-mission-ui-store";

export function MissionModalsManager({ missions, goals }: { missions: any[]; goals: { id: string; title: string }[] }) {
  const utils = trpc.useUtils();
  const retroState = useMissionUIStore((s) => s.retroState);
  const setRetroState = useMissionUIStore((s) => s.setRetroState);

  const missionEditOpen = useMissionUIStore((s) => s.missionEditOpen);
  const missionEditId = useMissionUIStore((s) => s.missionEditId);
  const missionEditInitial = useMissionUIStore((s) => s.missionEditInitial);
  const missionEditFocus = useMissionUIStore((s) => s.missionEditFocus);
  const closeMissionEdit = useMissionUIStore((s) => s.closeMissionEdit);

  const taskEditOpen = useMissionUIStore((s) => s.taskEditOpen);
  const taskEditTarget = useMissionUIStore((s) => s.taskEditTarget);
  const closeTaskEdit = useMissionUIStore((s) => s.closeTaskEdit);
  const taskEditFocus = useMissionUIStore((s) => s.taskEditFocus);

  return (
    <>
      {retroState && (
        <MissionRetroModal
          missionId={retroState.missionId}
          missionTitle={retroState.title}
          onClose={() => setRetroState(null)}
          onSaved={async () => {
            // Same invalidate set the other mutations use (see
            // use-mission-actions refetchAll): without it the mission
            // stayed visibly ACTIVE with zombie tasks for up to 30s.
            await Promise.all([
              utils.task.list.invalidate(),
              utils.task.missions.invalidate(),
              utils.task.deck.invalidate(),
              utils.operator.commandCenterState.invalidate(),
            ]);
            setRetroState(null);
            toast.success("Mission retro saved.");
          }}
        />
      )}

      <MissionEditDrawer
        key={missionEditId ?? "new"}
        open={missionEditOpen}
        onClose={closeMissionEdit}
        missionId={missionEditId}
        initial={missionEditInitial}
        goals={goals}
        focusField={missionEditFocus}
        onSaved={closeMissionEdit}
      />

      <TaskEditSheet
        key={taskEditTarget?.id ?? "none"}
        open={taskEditOpen}
        onClose={closeTaskEdit}
        task={taskEditTarget}
        missions={missions}
        goals={goals}
        focusField={taskEditFocus}
        onSaved={closeTaskEdit}
      />

    </>
  );
}
