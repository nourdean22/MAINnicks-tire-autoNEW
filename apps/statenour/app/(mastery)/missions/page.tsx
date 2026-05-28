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
      try {
        telemetry.event("completeTask", { taskId: id });
        await updateTask.mutateAsync({
          id,
          fields: { status: "DONE" },
        });
        await refetchAll();

        // Phase 3 · cascade · if this was the last open task in an
        // active mission, prompt the operator to mark the mission
        // complete + capture a retro.
        if (wasOpen && task?.missionId) {
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

  // ── Quick-add submit · Phase 1A: unattached task or new mission ──
  // Phase 1B will call /api/ai/classify-task-mission here and attach to
  // the best-fit mission silently (or surface a chip if confidence < 60%).
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

        // Phase 1B · AI classifier · attaches the new task to the
        // best-fit mission silently (or surfaces a chip if conf < 60%).
        let attachMissionId: string | null = null;
        let attachConfidence: number | null = null;
        let attachRationale: string | null = null;
        try {
          const res = await fetch("/api/ai/classify-task-mission", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskTitle: text,
              missions: missions
                .filter((m) => m.status === "ACTIVE")
                .map((m) => ({
                  id: m.id,
                  title: m.title,
                  domain: m.domain ?? null,
                })),
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              missionId: string | null;
              confidence: number;
              rationale?: string;
            };
            if (data.missionId && data.confidence >= 0.6) {
              attachMissionId = data.missionId;
            } else if (data.missionId) {
              attachMissionId = data.missionId;
              attachConfidence = data.confidence;
              attachRationale = data.rationale ?? null;
            }
          }
        } catch (classifyErr) {
          log.warn("classify_failed_falling_back_to_unattached", {
            err:
              classifyErr instanceof Error
                ? classifyErr.message
                : String(classifyErr),
          });
        }

        telemetry.event("addTask", {
          source: "quickAdd",
          missionId: attachMissionId,
          classifierConfidence: attachConfidence,
        });
        await createTask.mutateAsync({
          title: text,
          missionId: attachMissionId,
          status: "READY",
          originSource: attachMissionId
            ? attachConfidence === null
              ? "missions-page:classifier-high-conf"
              : "missions-page:classifier-low-conf"
            : "missions-page:unattached",
          metadata: attachConfidence !== null
            ? {
                classifierConfidence: attachConfidence,
                classifierRationale: attachRationale,
              }
            : undefined,
        });
        await refetchAll();

        if (attachMissionId && attachConfidence !== null) {
          const mission = missions.find((m) => m.id === attachMissionId);
          toast.message(
            `Attached to “${mission?.title ?? "mission"}” · ${Math.round(
              attachConfidence * 100,
            )}% confident · tap to change`,
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [createTask, createMission, missions, refetchAll, telemetry],
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
