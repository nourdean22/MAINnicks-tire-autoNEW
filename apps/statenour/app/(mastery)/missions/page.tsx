"use client";

/**
 * /missions · Wave AA · 2026-05-28 · the new top-level execution surface.
 *
 * Replaces the 1457-LOC /tasks page with a mission-led IA · missions are
 * the rows, tasks unfold inside each card. Operator's request (Wave AA
 * brainstorm): "change the task page to missions and make the missions
 * lead and the to do list feeds into the missions."
 *
 * What this page IS:
 *   · MissionsQuickAdd at top · single capture input
 *   · MissionFeed · grouped mission cards with inline tasks
 *   · CoachEventBanner · Nick-noticed events (kaizen-B kept)
 *   · NickSidePane FAB · Nick chat one tap away (kaizen-B kept)
 *   · OmniCaptureModal · ⌘K omni-capture (kaizen-B kept)
 *
 * What this page IS NOT (deleted from old /tasks):
 *   · KommandoShell pill nav (TODAY · GOALS · TRENDS · CAPTURE)
 *   · "first move wins the day" smart headline
 *   · `@dania · daily: ... · ... by fri · @health · /30m` ghost hint
 *   · TaskFilters band · SortDropdown · ActiveFiltersStrip
 *   · MoveFrame 3-card HUD (mission cards surface next move inside)
 *   · MissionScoreboard widget (the page IS the scoreboard)
 *   · IntelPanel drawer with 6 children (Phase 4 will telemetry-prune)
 *
 * Phase 1A scope: layout + redirect + data wire-up. Phase 1B adds the
 * AI auto-classify of new tasks → missions. Phase 2 layers Nick's pick
 * + morning brief + auto-decompose. Phase 3 adds retro capture +
 * complete-mission cascade. Phase 4 ships telemetry instrumentation
 * for the data-driven prune.
 */

import { Suspense, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { logger as rootLogger } from "@/lib/logger";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { OmniCaptureModal } from "@/components/actions/omni-capture-modal";
import { NickSidePane } from "@/components/mastery/nick-side-pane";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionFeed } from "@/components/missions/mission-feed";
import { MissionsQuickAdd } from "@/components/missions/missions-quick-add";
import { NicksMorningBrief } from "@/components/missions/nicks-morning-brief";
import { MissionRetroModal } from "@/components/missions/mission-retro-modal";
import { MissionEditDrawer } from "@/components/missions/mission-edit-drawer";
import { TaskEditSheet } from "@/components/missions/task-edit-sheet";
import { useMissionSurfaceTelemetry } from "@/lib/telemetry/mission-surface";
import type { Project, Task } from "@/components/actions/shared";

const log = rootLogger.withSurface("missions/page");

export default function MissionsPage() {
  return (
    <Suspense fallback={<MissionsPageSkeleton />}>
      <MissionsPageInner />
    </Suspense>
  );
}

function MissionsPageInner() {
  const utils = trpc.useUtils();
  const tasksQuery = trpc.task.list.useQuery(
    {},
    { refetchOnWindowFocus: false },
  );
  const missionsQuery = trpc.task.missions.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // wave-AA-audit · derived arrays wrapped in useMemo so the useCallback
  // dependencies below stay stable across renders. Pre-fix, the bare
  // `(data ?? []) as T[]` recreated a new array reference every render,
  // which made every handler recompile on every parent state change —
  // breaking the React.memo at child render sites + producing the
  // "could make dependencies change on every render" warnings.
  const tasks = useMemo<Task[]>(
    () => (tasksQuery.data ?? []) as Task[],
    [tasksQuery.data],
  );
  const missions = useMemo<Project[]>(
    () => (missionsQuery.data ?? []) as Project[],
    [missionsQuery.data],
  );

  const createTask = trpc.task.create.useMutation();
  const updateTask = trpc.task.update.useMutation();
  const deleteTaskMut = trpc.task.delete.useMutation();
  const createMission = trpc.task.createMission.useMutation();
  // Wave AJ · 2026-05-28 · ↑/↓ reorder mutations · server resolves the
  // swap math + ranks · client just calls (id, direction) + refetches.
  const reorderMissionMut = trpc.task.reorderMission.useMutation();
  const reorderTaskMut = trpc.task.reorderTask.useMutation();

  // Telemetry · Phase 4 · mark surface-mount + capture mutation events
  // so the 2-week prune analysis has signal. Silent no-op when telemetry
  // is disabled (offline / dev).
  const telemetry = useMissionSurfaceTelemetry("missions");

  // Phase 3 · retro modal state · opens when operator completes a
  // mission. Persists the just-completed mission id + title so the modal
  // can render its prompt + dispatch the retro capture.
  const [retroState, setRetroState] = useState<{
    missionId: string;
    title: string;
  } | null>(null);

  // wave-AB.c · CRUD drawer state · mission edit (and create) + task edit.
  const [missionEditOpen, setMissionEditOpen] = useState(false);
  const [missionEditId, setMissionEditId] = useState<string | null>(null);
  const [missionEditInitial, setMissionEditInitial] = useState<
    React.ComponentProps<typeof MissionEditDrawer>["initial"]
  >(undefined);
  const [taskEditOpen, setTaskEditOpen] = useState(false);
  const [taskEditTarget, setTaskEditTarget] = useState<Task | null>(null);

  // ── Mutation wrappers · invalidate task + mission queries on success ──
  const refetchAll = useCallback(async () => {
    await Promise.all([
      utils.task.list.invalidate(),
      utils.task.missions.invalidate(),
    ]);
  }, [utils]);

  const handleAddTask = useCallback(
    async ({ title, missionId }: { title: string; missionId: string }) => {
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
      }
    },
    [createTask, refetchAll, telemetry],
  );

  const handleCompleteTask = useCallback(
    async (id: string) => {
      const task = tasks.find((t) => t.id === id);
      const wasOpen = task && task.status !== "DONE";
      // Wave AL · 2026-05-28 · recurring tasks · DAILY loopKind tasks
      // never reach DONE forever · they're a habit, not a one-shot.
      // On complete:
      //   · streakCount++
      //   · lastCompletedAt = now
      //   · status = WAITING + snoozedUntil = tomorrow 00:00 local
      // The existing task-resurface cron auto-flips WAITING→READY
      // when snoozedUntil ≤ now · the task reappears tomorrow.
      const isDaily =
        (task as unknown as { loopKind?: string } | undefined)?.loopKind ===
        "DAILY";
      try {
        telemetry.event("completeTask", { taskId: id, isDaily });
        if (isDaily) {
          const tomorrow = new Date();
          tomorrow.setHours(0, 0, 0, 0);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const currentStreak =
            (task as unknown as { streakCount?: number } | undefined)
              ?.streakCount ?? 0;
          await updateTask.mutateAsync({
            id,
            fields: {
              status: "WAITING",
              snoozedUntil: tomorrow.toISOString(),
              lastCompletedAt: new Date().toISOString(),
              streakCount: currentStreak + 1,
            },
          });
        } else {
          await updateTask.mutateAsync({
            id,
            fields: { status: "DONE" },
          });
        }
        await refetchAll();

        // Phase 3 · cascade · if this was the last open task in an
        // active mission, prompt the operator to mark the mission
        // complete + capture a retro. Wave AL · DAILY tasks come back
        // tomorrow · they don't actually "close" the mission · skip
        // the cascade so the retro prompt doesn't fire incorrectly.
        if (wasOpen && task?.missionId && !isDaily) {
          const mission = missions.find((m) => m.id === task.missionId);
          if (mission && mission.status === "ACTIVE") {
            const remaining = tasks.filter(
              (t) =>
                t.id !== id &&
                t.missionId === task.missionId &&
                t.status !== "DONE",
            );
            if (remaining.length === 0) {
              setRetroState({ missionId: mission.id, title: mission.title });
            }
          }
        }
      } catch (err) {
        log.error("completeTask_failed", { err });
        toast.error("Could not complete task.");
      }
    },
    [tasks, missions, updateTask, refetchAll, telemetry],
  );

  const handleStartTask = useCallback(
    async (id: string) => {
      try {
        telemetry.event("startTask", { taskId: id });
        await updateTask.mutateAsync({
          id,
          fields: { status: "DOING" },
        });
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

  const handleCompleteMission = useCallback(
    (missionId: string) => {
      const mission = missions.find((m) => m.id === missionId);
      if (!mission) return;
      telemetry.event("completeMission", { missionId });
      setRetroState({ missionId, title: mission.title });
    },
    [missions, telemetry],
  );

  const handleArchiveMission = useCallback(
    async (missionId: string) => {
      try {
        telemetry.event("archiveMission", { missionId });
        // Use the create mutation surface · the same `record<string,unknown>`
        // shape supports status changes through the legacy POST path.
        // wave-AA-audit · "Archive" semantics map to MissionStatus.KILLED
        // (operator decided not to pursue), not PAUSED (might resume).
        // MissionStatus enum only has ACTIVE/PAUSED/COMPLETE/KILLED ·
        // we reserve COMPLETE for "shipped" (the retro flow sets it).
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

  // ── Quick-add submit · wave-AA-audit follow-up · background classifier.
  // Pre-fix · the classifier ran SYNCHRONOUSLY before the create, adding
  // ~500ms of perceived latency to every quick-add. Operator's response
  // was just to wait through it · sloppy UX.
  //
  // Post-fix · two-phase pattern:
  //   1. Create immediately as unattached · refetch · operator sees the
  //      task land in the "Unattached" section in <100ms.
  //   2. Fire the classifier in the background (no await on the outer
  //      handler · the operator can type the next thing). On success,
  //      update the task's missionId via the tRPC update mutation +
  //      refetch · the task animates from Unattached into its mission
  //      card on the next render.
  //
  // The optimistic path is correct even when the classifier returns null
  // (low-signal task, model failure): the task simply stays in Unattached
  // and the operator drags it manually. Telemetry records both paths so
  // the Phase 4 prune analysis can verify classifier hit-rate over time.
  const [submitting, setSubmitting] = useState(false);
  const handleQuickAdd = useCallback(
    async (text: string) => {
      setSubmitting(true);
      try {
        const isMissionRequest =
          /^(create|new|start)\s+mission\s*:?\s*/i.test(text);
        if (isMissionRequest) {
          const title = text.replace(
            /^(create|new|start)\s+mission\s*:?\s*/i,
            "",
          ).trim();
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

        // ── PHASE 1 · CREATE OPTIMISTICALLY (unattached) ──
        // We need the created task's id to attach it after classify ·
        // createTaskFromAPI returns the view model with `id`.
        telemetry.event("addTask", {
          source: "quickAdd",
          missionId: null,
          classifierConfidence: null,
        });
        const created = (await createTask.mutateAsync({
          title: text,
          missionId: null,
          status: "READY",
          originSource: "missions-page:quickAdd-pre-classify",
        })) as { id: string } | null;
        await refetchAll();

        if (!created?.id) {
          // No id back · the task may still have been created · stop
          // here so we don't try to update a phantom row.
          return;
        }

        // ── PHASE 2 · BACKGROUND CLASSIFY + ATTACH ──
        // The void async block intentionally escapes the handler's
        // try/finally · the operator's submitting state cleared above.
        const newTaskId = created.id;
        const missionsSnapshot = missions
          .filter((m) => m.status === "ACTIVE")
          .map((m) => ({
            id: m.id,
            title: m.title,
            domain: m.domain ?? null,
          }));
        void (async () => {
          if (missionsSnapshot.length === 0) return;
          let attachMissionId: string | null = null;
          let attachConfidence = 0;
          try {
            const res = await fetch("/api/ai/classify-task-mission", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                taskTitle: text,
                missions: missionsSnapshot,
              }),
            });
            if (!res.ok) return;
            const data = (await res.json()) as {
              missionId: string | null;
              confidence: number;
              rationale?: string;
            };
            if (!data.missionId) return;
            attachMissionId = data.missionId;
            attachConfidence = data.confidence ?? 0;
          } catch (classifyErr) {
            log.warn("background_classify_failed", {
              taskId: newTaskId,
              err:
                classifyErr instanceof Error
                  ? classifyErr.message
                  : String(classifyErr),
            });
            return;
          }

          try {
            await updateTask.mutateAsync({
              id: newTaskId,
              fields: { missionId: attachMissionId },
            });
            await refetchAll();

            telemetry.event("classifierAttach", {
              taskId: newTaskId,
              missionId: attachMissionId,
              classifierConfidence: attachConfidence,
            });

            if (attachConfidence < 0.6) {
              const mission = missionsSnapshot.find(
                (m) => m.id === attachMissionId,
              );
              toast.message(
                `Attached to “${mission?.title ?? "mission"}” · ${Math.round(
                  attachConfidence * 100,
                )}% confident · tap to change`,
              );
            }
          } catch (updateErr) {
            log.warn("background_attach_update_failed", {
              taskId: newTaskId,
              err:
                updateErr instanceof Error
                  ? updateErr.message
                  : String(updateErr),
            });
          }
        })();
      } finally {
        setSubmitting(false);
      }
    },
    [createTask, createMission, missions, refetchAll, telemetry, updateTask],
  );

  // ── Loading ──
  if (tasksQuery.isLoading || missionsQuery.isLoading) {
    return <MissionsPageSkeleton />;
  }

  return (
    <div className="space-y-4 max-w-3xl pb-[env(safe-area-inset-bottom,0px)]">
      {/* ⌘K omni-capture · kaizen-B kept */}
      <OmniCaptureModal onCapture={(text) => void handleQuickAdd(text)} />

      {/* Nick chat FAB · kaizen-B kept */}
      <NickSidePane
        page="missions"
        coachSurface="tasks"
        presets={[
          "Which mission should I push today?",
          "Which mission is stalling?",
          "What's the next move across all my missions?",
          "Summarize my week so far.",
        ]}
      />

      {/* Coach Channel · kaizen-B kept · self-hides when zero events */}
      <CoachEventBanner surface="tasks" />

      {/* Nick's morning brief · Phase 2 · cross-mission pace summary */}
      <NicksMorningBrief tasks={tasks} missions={missions} />

      {/* Single quick-add input at top */}
      <MissionsQuickAdd onSubmit={handleQuickAdd} busy={submitting} />

      {/* wave-AB.c · explicit "+ new mission" button so the operator
       *  doesn't have to type the "create mission X" magic phrase. */}
      <div className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => {
            setMissionEditId(null);
            setMissionEditInitial(undefined);
            setMissionEditOpen(true);
            telemetry.event("createMissionOpen", { source: "button" });
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]/90 hover:bg-[var(--gold)]/[0.08]"
        >
          + new mission
        </button>
        <span className="text-[10px] font-mono text-[var(--text-tertiary)]/70">
          or type{" "}
          <code className="px-1 rounded bg-[var(--bg-raised)]/10 text-[var(--text-tertiary)]">
            create mission &lt;name&gt;
          </code>{" "}
          above
        </span>
      </div>

      {/* Mission cards + unattached section */}
      <MissionFeed
        missions={missions}
        tasks={tasks}
        onAddTask={handleAddTask}
        onCompleteTask={handleCompleteTask}
        onStartTask={handleStartTask}
        onDeleteTask={handleDeleteTask}
        onCompleteMission={handleCompleteMission}
        onArchiveMission={handleArchiveMission}
        onEditMission={(missionId) => {
          const m = missions.find((mm) => mm.id === missionId);
          if (!m) return;
          setMissionEditId(missionId);
          setMissionEditInitial({
            title: m.title,
            status: m.status,
            domain: m.domain ?? null,
            description: m.description ?? null,
            deadline: m.deadline ?? null,
          });
          setMissionEditOpen(true);
          telemetry.event("editMissionOpen", { missionId });
        }}
        onEditTask={(task) => {
          setTaskEditTarget(task);
          setTaskEditOpen(true);
          telemetry.event("editTaskOpen", { taskId: task.id });
        }}
        onMoveMission={async (missionId, direction) => {
          try {
            telemetry.event("reorderMission", { missionId, direction });
            const res = await reorderMissionMut.mutateAsync({
              missionId,
              direction,
            });
            if (res.ok) await refetchAll();
          } catch (err) {
            log.error("reorderMission_failed", { err });
            toast.error("Could not reorder mission.");
          }
        }}
        onMoveTask={async (taskId, direction) => {
          try {
            telemetry.event("reorderTask", { taskId, direction });
            const res = await reorderTaskMut.mutateAsync({
              taskId,
              direction,
            });
            if (res.ok) await refetchAll();
          } catch (err) {
            log.error("reorderTask_failed", { err });
            toast.error("Could not reorder task.");
          }
        }}
      />

      {/* Phase 3 retro modal · opens when a mission is completed (either
       *  via explicit "complete mission" tap OR via cascade when the last
       *  open task is ticked done). */}
      {retroState && (
        <MissionRetroModal
          missionId={retroState.missionId}
          missionTitle={retroState.title}
          onClose={() => setRetroState(null)}
          onSaved={async () => {
            await refetchAll();
            setRetroState(null);
            toast.success("Mission retro saved.");
          }}
        />
      )}

      {/* wave-AB.c · mission edit/create drawer · key forces remount on
       *  target switch so useState initializers re-seed cleanly. */}
      <MissionEditDrawer
        key={missionEditId ?? "new"}
        open={missionEditOpen}
        onClose={() => setMissionEditOpen(false)}
        missionId={missionEditId}
        initial={missionEditInitial}
        onSaved={() => {
          setMissionEditOpen(false);
          void refetchAll();
        }}
      />

      {/* wave-AB.c · task edit sheet · pass live mission list so the
       *  operator can reassign tasks between missions inline. */}
      <TaskEditSheet
        key={taskEditTarget?.id ?? "none"}
        open={taskEditOpen}
        onClose={() => setTaskEditOpen(false)}
        task={taskEditTarget}
        missions={missions}
        onSaved={() => {
          setTaskEditOpen(false);
          void refetchAll();
        }}
      />
    </div>
  );
}

function MissionsPageSkeleton() {
  return (
    <div className="space-y-3 max-w-3xl">
      <ShimmerSkeleton className="h-12 rounded-lg" />
      <ShimmerSkeleton className="h-24 rounded-lg" />
      <ShimmerSkeleton className="h-24 rounded-lg" />
      <ShimmerSkeleton className="h-24 rounded-lg" />
    </div>
  );
}
