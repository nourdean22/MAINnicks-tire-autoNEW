import { useCallback, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { logger as rootLogger } from "@/lib/logger";
import { formatReward, type TaskReward, type LevelUpPayload } from "@/lib/mastery/task-reward";
import type { Task, Project } from "@/components/actions/shared";
import { useMissionSurfaceTelemetry } from "@/lib/telemetry/mission-surface";
import { useRouter } from "next/navigation";
import { useMissionUIStore } from "../state/use-mission-ui-store";

const log = rootLogger.withSurface("missions/actions");

export interface MissionActionsParams {
  tasks: Task[];
  missions: Project[];
}

export function useMissionActions({ tasks, missions }: MissionActionsParams) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const telemetry = useMissionSurfaceTelemetry("missions");

  const setRetroState = useMissionUIStore((s) => s.setRetroState);
  const setLevelUpState = useMissionUIStore((s) => s.setLevelUpState);
  const triggerXpParticle = useMissionUIStore((s) => s.triggerXpParticle);
  const openTaskEdit = useMissionUIStore((s) => s.openTaskEdit);
  const openMissionEdit = useMissionUIStore((s) => s.openMissionEdit);

  const createTask = trpc.task.create.useMutation();
  const updateTask = trpc.task.update.useMutation();
  const checkTaskMut = trpc.task.check.useMutation();
  const deleteTaskMut = trpc.task.delete.useMutation();
  const createMission = trpc.task.createMission.useMutation();
  const decomposeTask = trpc.task.decompose.useMutation();
  const reorderMissionMut = trpc.task.reorderMission.useMutation();
  const reorderTaskMut = trpc.task.reorderTask.useMutation();

  const [isAddingTask, setIsAddingTask] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      utils.task.list.invalidate(),
      utils.task.missions.invalidate(),
      utils.operator.characterSheet.invalidate(),
      utils.operator.commandCenterState.invalidate(),
    ]);
  }, [utils]);

  const handleAddTask = useCallback(
    async ({ title, missionId }: { title: string; missionId: string }) => {
      if (isAddingTask) return;
      setIsAddingTask(true);
      try {
        telemetry.event("addTask", { missionId, source: "card" });
        await createTask.mutateAsync({
          title,
          missionId: missionId === "inbox" ? null : missionId,
          status: "READY",
          originSource: "missions-page:card-add",
        });
        await refetchAll();
      } catch (err) {
        log.error("addTask_failed", { err });
        toast.error("Could not add task. Try again.");
      } finally {
        setIsAddingTask(false);
      }
    },
    [createTask, refetchAll, telemetry, isAddingTask],
  );

  const handleCompleteTask = useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id);
      const wasOpen = task && task.status !== "DONE";
      const loopKind = (task as unknown as { loopKind?: string } | undefined)?.loopKind;
      const isDaily = loopKind === "DAILY";
      const isWeekly = loopKind === "WEEKLY";
      const isRecurring = isDaily || isWeekly;
      let xpAdded = 0;
      try {
        telemetry.event("completeTask", { taskId: id, isDaily });
        if (isRecurring) {
          // Streak + lastCompletedAt are server-authoritative via task.check
          // (same-day idempotency included) — never write streakCount from
          // the client: the polled cache can be 15s stale, so a client-side
          // `streak + 1` clobbers concurrent writers (chat/Telegram/voice)
          // and double-bumps across day boundaries.
          const res = await checkTaskMut.mutateAsync({ id, action: "complete" });
          if (isDaily) {
            // Presentation only: checkTask leaves DAILY status READY; the
            // board hides a checked daily until tomorrow via WAITING +
            // snoozedUntil (the resurface cron flips it back). No streak
            // fields in this write.
            const tomorrow = new Date();
            tomorrow.setHours(0, 0, 0, 0);
            tomorrow.setDate(tomorrow.getDate() + 1);
            await updateTask.mutateAsync({
              id,
              fields: { status: "WAITING", snoozedUntil: tomorrow.toISOString() },
            });
          }
          const msg = formatReward(res.reward);
          if (msg) {
            toast.success(msg, { duration: 4500, action: { label: "Stats", onClick: () => router.push("/stats") } });
          }
          if (res.reward?.levelUp) setLevelUpState(res.reward.levelUp);
          if (res.reward?.xpCredited) xpAdded = res.reward.xpCredited;
        } else {
          const res = await updateTask.mutateAsync({ id, fields: { status: "DONE" } });
          const reward = (res as unknown as { reward?: TaskReward }).reward;
          const msg = formatReward(reward);
          if (msg) {
            toast.success(msg, { duration: 4500, action: { label: "Stats", onClick: () => router.push("/stats") } });
          }
          if (reward?.levelUp) setLevelUpState(reward.levelUp);
          if (reward?.xpCredited) xpAdded = reward.xpCredited;
        }
        if (xpAdded > 0) triggerXpParticle(xpAdded);
        await refetchAll();

        if (wasOpen && task?.missionId && !isRecurring) {
          const mission = missions.find((m) => m.id === task.missionId);
          if (mission && mission.status === "ACTIVE") {
            const remaining = tasks.filter((t) => t.id !== id && t.missionId === task.missionId && t.status !== "DONE");
            if (remaining.length === 0) setRetroState({ missionId: mission.id, title: mission.title });
          }
        }
      } catch (err) {
        log.error("completeTask_failed", { err });
        toast.error("Could not complete task.");
      }
    },
    [tasks, missions, updateTask, checkTaskMut, refetchAll, telemetry, router, setLevelUpState, triggerXpParticle, setRetroState],
  );

  const handleStartTask = useCallback(
    async (id: string) => {
      try {
        telemetry.event("startTask", { taskId: id });
        await updateTask.mutateAsync({ id, fields: { status: "DOING" } });
        await refetchAll();
      } catch (err) {
        log.error("startTask_failed", { err });
        toast.error("Could not start task.");
      }
    },
    [updateTask, refetchAll, telemetry],
  );

  const handleDeleteTask = useCallback(
    async (id: string) => {
      try {
        telemetry.event("deleteTask", { taskId: id });
        await deleteTaskMut.mutateAsync({ id });
        await refetchAll();
      } catch (err) {
        log.error("deleteTask_failed", { err });
        toast.error("Could not delete task.");
      }
    },
    [deleteTaskMut, refetchAll, telemetry],
  );

  const handleUpdateTaskFields = useCallback(
    async (id: string, fields: any) => {
      try {
        await updateTask.mutateAsync({ id, fields });
        await refetchAll();
      } catch (err) {
        log.error("updateTaskFields_failed", { err });
        toast.error("Could not update task.");
      }
    },
    [updateTask, refetchAll],
  );

  const handleEditTask = useCallback(
    (task: Task) => {
      openTaskEdit(task);
      telemetry.event("editTaskOpen", { taskId: task.id });
    },
    [openTaskEdit, telemetry],
  );

  const handleEditMission = useCallback(
    (missionId: string) => {
      const mission = missions.find((m) => m.id === missionId);
      if (!mission) return;
      openMissionEdit(missionId, {
        title: mission.title,
        status: mission.status,
        domain: mission.domain ?? null,
        description: mission.description ?? null,
        deadline: mission.deadline ?? null,
      });
      telemetry.event("editMissionOpen", { missionId });
    },
    [missions, openMissionEdit, telemetry],
  );

  const handleSnoozeTask = useCallback(
    async (taskId: string, snoozedUntilIso: string) => {
      try {
        const clearing = !snoozedUntilIso;
        telemetry.event("snoozeTask", { taskId, clearing, snoozedUntil: snoozedUntilIso || null });
        await updateTask.mutateAsync({
          id: taskId,
          fields: {
            snoozedUntil: snoozedUntilIso || null,
            status: clearing ? "READY" : "WAITING",
          },
        });
        await refetchAll();
        toast.success(clearing ? "Snooze cleared." : "Task snoozed.");
      } catch (err) {
        log.error("snoozeTask_failed", { err });
        toast.error("Could not update snooze.");
      }
    },
    [updateTask, refetchAll, telemetry],
  );

  const handleDecomposeTask = useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id);
      const promise = decomposeTask.mutateAsync({ taskId: id });
      
      toast.promise(promise, {
        loading: `Decomposing “${task?.title || "task"}” into subtasks...`,
        success: (res) => {
          void refetchAll();
          return `Successfully created ${res.subtasksCount} subtasks!`;
        },
        error: (err) => `Failed to decompose task: ${err instanceof Error ? err.message : String(err)}`,
      });
    },
    [decomposeTask, tasks, refetchAll],
  );

  const handleCompleteMission = useCallback(
    (missionId: string) => {
      const mission = missions.find((m) => m.id === missionId);
      if (!mission) return;
      telemetry.event("completeMission", { missionId });
      setRetroState({ missionId, title: mission.title });
    },
    [missions, telemetry, setRetroState],
  );

  const handleArchiveMission = useCallback(
    async (missionId: string) => {
      try {
        telemetry.event("archiveMission", { missionId });
        await fetch(`/api/missions/${missionId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "KILLED" }),
        });
        await refetchAll();
        toast.success("Mission archived");
      } catch (err) {
        log.error("archiveMission_failed", { err });
        toast.error("Could not archive mission.");
      }
    },
    [refetchAll, telemetry],
  );

  const handleMoveMission = useCallback(
    async (missionId: string, direction: "up" | "down") => {
      try {
        telemetry.event("reorderMission", { missionId, direction });
        const res = await reorderMissionMut.mutateAsync({ missionId, direction });
        if (res.ok) await refetchAll();
      } catch (err) {
        log.error("reorderMission_failed", { err });
        toast.error("Could not reorder mission.");
      }
    },
    [reorderMissionMut, refetchAll, telemetry],
  );

  const handleMoveTask = useCallback(
    async (taskId: string, direction: "up" | "down") => {
      try {
        telemetry.event("reorderTask", { taskId, direction });
        const res = await reorderTaskMut.mutateAsync({ taskId, direction });
        if (res.ok) await refetchAll();
      } catch (err) {
        log.error("reorderTask_failed", { err });
        toast.error("Could not reorder task.");
      }
    },
    [reorderTaskMut, refetchAll, telemetry],
  );

  const handleQuickAdd = useCallback(
    async (text: string) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        const isMissionRequest = /^(create|new|start)\s+mission\s*:?\s*/i.test(text);
        if (isMissionRequest) {
          const title = text.replace(/^(create|new|start)\s+mission\s*:?\s*/i, "").trim();
          if (!title) {
            toast.error("Give the mission a name.");
            return;
          }
          telemetry.event("createMission", { source: "quickAdd" });
          await createMission.mutateAsync({ title, status: "ACTIVE" });
          await refetchAll();
          toast.success(`Mission “${title}” created.`);
          return;
        }

        telemetry.event("addTask", { source: "quickAdd", missionId: null, classifierConfidence: null });
        const created = (await createTask.mutateAsync({
          title: text,
          missionId: null,
          status: "READY",
          originSource: "missions-page:quickAdd",
        })) as { id: string } | null;
        await refetchAll();

        if (!created?.id) return;
        setTimeout(() => void refetchAll(), 2500);
      } catch (err) {
        // Toast here AND rethrow: callers (MissionsQuickAdd / OmniCapture)
        // rely on the rejection to keep the typed text for retry — a
        // swallowed failure here means silently lost captures.
        log.error("quickAdd_failed", { err });
        toast.error("Could not capture. Try again.");
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [createTask, createMission, refetchAll, telemetry, submitting],
  );

  return {
    handleAddTask,
    handleCompleteTask,
    handleStartTask,
    handleDeleteTask,
    handleUpdateTaskFields,
    handleEditTask,
    handleSnoozeTask,
    handleDecomposeTask,
    handleCompleteMission,
    handleArchiveMission,
    handleMoveMission,
    handleMoveTask,
    handleQuickAdd,
    handleEditMission,
    submitting,
  };
}
