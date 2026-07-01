"use client";

import { toast } from "sonner";
import { MissionRetroModal } from "@/components/missions/mission-retro-modal";
import { MissionEditDrawer } from "@/components/missions/mission-edit-drawer";
import { TaskEditSheet } from "@/components/missions/task-edit-sheet";
import { LevelUpModal } from "@/components/missions/level-up-modal";
import { XpParticle } from "@/components/missions/xp-particle";
import { useMissionUIStore } from "../state/use-mission-ui-store";

export function MissionModalsManager({ missions }: { missions: any[] }) {
  const retroState = useMissionUIStore((s) => s.retroState);
  const setRetroState = useMissionUIStore((s) => s.setRetroState);

  const levelUpState = useMissionUIStore((s) => s.levelUpState);
  const setLevelUpState = useMissionUIStore((s) => s.setLevelUpState);

  const xpParticle = useMissionUIStore((s) => s.xpParticle);

  const missionEditOpen = useMissionUIStore((s) => s.missionEditOpen);
  const missionEditId = useMissionUIStore((s) => s.missionEditId);
  const missionEditInitial = useMissionUIStore((s) => s.missionEditInitial);
  const closeMissionEdit = useMissionUIStore((s) => s.closeMissionEdit);

  const taskEditOpen = useMissionUIStore((s) => s.taskEditOpen);
  const taskEditTarget = useMissionUIStore((s) => s.taskEditTarget);
  const closeTaskEdit = useMissionUIStore((s) => s.closeTaskEdit);

  return (
    <>
      {retroState && (
        <MissionRetroModal
          missionId={retroState.missionId}
          missionTitle={retroState.title}
          onClose={() => setRetroState(null)}
          onSaved={async () => {
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
        onSaved={closeMissionEdit}
      />

      <TaskEditSheet
        key={taskEditTarget?.id ?? "none"}
        open={taskEditOpen}
        onClose={closeTaskEdit}
        task={taskEditTarget}
        missions={missions}
        onSaved={closeTaskEdit}
      />

      {levelUpState && (
        <LevelUpModal
          newLevel={levelUpState.newLevel}
          tierName={levelUpState.tierName}
          tierEmoji={levelUpState.tierEmoji}
          onClose={() => setLevelUpState(null)}
        />
      )}

      {xpParticle.xp > 0 && (
        <div className="fixed inset-0 pointer-events-none z-[9999]" aria-hidden="true">
          <XpParticle xp={xpParticle.xp} triggerKey={xpParticle.key} />
        </div>
      )}
    </>
  );
}
