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

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { logger as rootLogger } from "@/lib/logger";
import { formatReward, type TaskReward, type LevelUpPayload } from "@/lib/mastery/task-reward";
import { LevelUpModal } from "@/components/missions/level-up-modal";
import { XpParticle } from "@/components/missions/xp-particle";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { OmniCaptureModal } from "@/components/actions/omni-capture-modal";
import { NickSidePane } from "@/components/mastery/nick-side-pane";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionFeed } from "@/components/missions/mission-feed";
import { MissionsQuickAdd } from "@/components/missions/missions-quick-add";
import { NicksMorningBrief } from "@/components/missions/nicks-morning-brief";
import { TopMissionToday } from "@/components/missions/top-mission-today";
import { MissionsHealthStrip } from "@/components/missions/missions-health-strip";
import { MissionsRescueStrip } from "@/components/missions/missions-rescue-strip";
import { MissionRetroModal } from "@/components/missions/mission-retro-modal";
import { MissionEditDrawer } from "@/components/missions/mission-edit-drawer";
import { TaskEditSheet } from "@/components/missions/task-edit-sheet";
import { useMissionSurfaceTelemetry } from "@/lib/telemetry/mission-surface";
import { daysSince, type Project, type Task } from "@/components/actions/shared";
import { isUserProject } from "@/lib/services/mission-helpers";
import { ExecutionPanel } from "@/components/missions/execution-panel";
import { useCustomDomains } from "@/hooks/use-custom-domains";
import { TaskFilters } from "@/components/actions/task-filters";
import { ActiveFiltersStrip } from "@/components/ui/filter-chip-bar";
import { AlertTriangle } from "lucide-react";
import { HiddenRiskWarning } from "@/components/missions/hidden-risk-warning";
import { computeHiddenRiskSummary } from "@/lib/tasks/hidden-risk";
import { cn } from "@/lib/utils";

type KindFilter = "all" | "ONCE" | "DAILY" | "PROMISE";

const log = rootLogger.withSurface("missions/page");

export default function MissionsPage() {
  return (
    <Suspense fallback={<MissionsPageSkeleton />}>
      <MissionsPageInner />
    </Suspense>
  );
}

function MissionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskIdParam = searchParams.get("taskId");

  const utils = trpc.useUtils();
  const tasksQuery = trpc.task.list.useQuery(
    {},
    { refetchOnWindowFocus: false },
  );
  const missionsQuery = trpc.task.missions.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const healthQuery = trpc.system.healthSummary.useQuery(undefined, {
    refetchInterval: 30000,
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

  const taskDetailQuery = trpc.task.byId.useQuery(
    { id: taskIdParam ?? "" },
    { enabled: !!taskIdParam && !tasksQuery.isLoading && !tasks.some((t) => t.id === taskIdParam) }
  );

  const createTask = trpc.task.create.useMutation();
  const updateTask = trpc.task.update.useMutation();
  // WEEKLY completion routes through the unified checkTask service (it
  // lazy-loads recurringDays + computes the next scheduled weekday, which
  // the client doesn't carry). See handleCompleteTask.
  const checkTaskMut = trpc.task.check.useMutation();
  const deleteTaskMut = trpc.task.delete.useMutation();
  const createMission = trpc.task.createMission.useMutation();
  // Wave AJ · 2026-05-28 · ↑/↓ reorder mutations · server resolves the
  // swap math + ranks · client just calls (id, direction) + refetches.
  const reorderMissionMut = trpc.task.reorderMission.useMutation();
  const reorderTaskMut = trpc.task.reorderTask.useMutation();
  const decomposeTask = trpc.task.decompose.useMutation();

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

  // Dopamine loop · level-up modal state · triggered when a task
  // completion pushes the operator's overall XP past a level boundary.
  const [levelUpState, setLevelUpState] = useState<LevelUpPayload | null>(null);

  // Dopamine loop · floating XP particles state
  const [xpParticle, setXpParticle] = useState<{ xp: number; key: number }>({ xp: 0, key: 0 });

  // wave-AB.c · CRUD drawer state · mission edit (and create) + task edit.
  const [missionEditOpen, setMissionEditOpen] = useState(false);
  const [missionEditId, setMissionEditId] = useState<string | null>(null);
  const [missionEditInitial, setMissionEditInitial] = useState<
    React.ComponentProps<typeof MissionEditDrawer>["initial"]
  >(undefined);
  const [taskEditOpen, setTaskEditOpen] = useState(false);
  const [taskEditTarget, setTaskEditTarget] = useState<Task | null>(null);

  // Execution Mode state & selectors
  const [executionModeActive, setExecutionModeActive] = useState(false);

  // ── Search & Filter State ──
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [addingDomain, setAddingDomain] = useState(false);
  const [newDomainInput, setNewDomainInput] = useState("");
  const [filterEditMode, setFilterEditMode] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);

  // Custom domains hook
  const { customDomains, setCustomDomains } = useCustomDomains();

  // Queue Next focused task ID state
  const [queuedTaskId, setQueuedTaskId] = useState<string | null>(null);

  const clearTaskIdParam = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("taskId");
    const newUrl = params.toString() ? `/missions?${params.toString()}` : "/missions";
    router.replace(newUrl, { scroll: false });
  }, [router]);

  // Handle deep-linked task from query params
  useEffect(() => {
    if (taskIdParam) {
      if (tasks.length > 0) {
        const localTask = tasks.find((t) => t.id === taskIdParam);
        if (localTask) {
          setTaskEditTarget(localTask);
          setTaskEditOpen(true);
          clearTaskIdParam();
          return;
        }
      }

      if (taskDetailQuery.data) {
        setTaskEditTarget(taskDetailQuery.data as Task);
        setTaskEditOpen(true);
        clearTaskIdParam();
      } else if (taskDetailQuery.isSuccess && !taskDetailQuery.data) {
        toast.error("Linked task not found.");
        clearTaskIdParam();
      } else if (taskDetailQuery.isError) {
        toast.error("Failed to load linked task.");
        clearTaskIdParam();
      }
    }
  }, [taskIdParam, tasks, taskDetailQuery.data, taskDetailQuery.isSuccess, taskDetailQuery.isError, clearTaskIdParam]);

  // Memoized selector for the focused task in Execution Mode
  const focusedTask = useMemo(() => {
    // 1. First choice: a task that is currently in "DOING" status
    const doingTask = tasks.find((t) => t.status === "DOING");
    if (doingTask) return doingTask;

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

    // We only care about open (non-DONE, non-WAITING, non-ARCHIVED) tasks for focus recommendations
    const openTasks = tasks.filter((t) => t.status !== "DONE" && t.status !== "WAITING" && t.status !== "ARCHIVED");
    if (openTasks.length === 0) {
      // Fallback to any tasks that are not DONE or ARCHIVED if nothing else
      const anyNotDone = tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED");
      if (anyNotDone.length > 0) return anyNotDone[0];
      return null;
    }

    // Helper: is the project a real user mission?
    const userMissions = missions.filter((m) => m.status === "ACTIVE" && isUserProject(m));

    // 2. Second choice: first open task of the Top Mission Today
    const picks = userMissions.map((m) => {
      const tasksForMission = openTasks.filter((t) => t.missionId === m.id);
      const days = m.deadline
        ? Math.round((new Date(m.deadline).getTime() - Date.now()) / 86400000)
        : null;
      return {
        mission: m,
        openTasks: tasksForMission.length,
        daysToDeadline: days,
      };
    }).filter((p) => p.openTasks > 0);

    if (picks.length > 0) {
      const sorted = [...picks].sort((a, b) => {
        const aD = a.daysToDeadline ?? 99_999;
        const bD = b.daysToDeadline ?? 99_999;
        if (aD !== bD) return aD - bD;
        return b.openTasks - a.openTasks;
      });
      const topMission = sorted[0]?.mission;
      if (topMission) {
        const taskForTop = openTasks.find((t) => t.missionId === topMission.id);
        if (taskForTop) return taskForTop;
      }
    }

    // 3. Third choice: first task of any active user mission
    for (const mission of userMissions) {
      const taskForMission = openTasks.find((t) => t.missionId === mission.id);
      if (taskForMission) return taskForMission;
    }

    // 4. Fallback: first open task in the general list
    return openTasks[0] || null;
  }, [tasks, missions, queuedTaskId]);

  const focusedTaskMission = useMemo(() => {
    if (!focusedTask || !focusedTask.missionId) return null;
    return missions.find((m) => m.id === focusedTask.missionId) || null;
  }, [focusedTask, missions]);

  // ── Filtered Tasks & Missions ──
  const filteredTasks = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return tasks.filter((t) => {
      const mission = missions.find((m) => m.id === t.missionId);
      const missionTitle = mission?.title.toLowerCase() || t.mission?.title.toLowerCase() || "";
      const domain = mission?.domain?.toLowerCase() || t.mission?.domain?.toLowerCase() || "other";

      if (query) {
        const matchesTitle = t.title.toLowerCase().includes(query);
        const matchesMission = missionTitle.includes(query);
        if (!matchesTitle && !matchesMission) return false;
      }

      if (kindFilter !== "all" && t.loopKind !== kindFilter) return false;

      if (domainFilter) {
        if (domain !== domainFilter.toLowerCase()) return false;
      }

      return true;
    });
  }, [tasks, missions, searchQuery, kindFilter, domainFilter]);

  const filteredMissions = useMemo(() => {
    const hasActiveFilter = !!(searchQuery.trim() || domainFilter || kindFilter !== "all");
    if (!hasActiveFilter) return missions;

    return missions.filter((m) => {
      if (m.status !== "ACTIVE" || !isUserProject(m)) return false;

      if (domainFilter && m.domain?.toLowerCase() !== domainFilter.toLowerCase()) {
        return false;
      }

      const query = searchQuery.toLowerCase().trim();
      const missionTasks = tasks.filter((t) => t.missionId === m.id);

      const missionMatchesSearch = !query || m.title.toLowerCase().includes(query);

      const hasMatchingTask = missionTasks.some((t) => {
        if (query && !t.title.toLowerCase().includes(query)) return false;
        if (kindFilter !== "all" && t.loopKind !== kindFilter) return false;
        return true;
      });

      return missionMatchesSearch || hasMatchingTask;
    });
  }, [missions, tasks, searchQuery, domainFilter, kindFilter]);

  // ── Filter helper counts ──
  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED"), [tasks]);
  const onceCount = useMemo(() => activeTasks.filter((t) => !t.loopKind || t.loopKind === "ONCE").length, [activeTasks]);
  const dailyCount = useMemo(() => activeTasks.filter((t) => t.loopKind === "DAILY").length, [activeTasks]);
  const promiseCount = useMemo(() => activeTasks.filter((t) => t.loopKind === "PROMISE").length, [activeTasks]);
  const activeCount = activeTasks.length;

  const activeDomains = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of activeTasks) {
      const mission = missions.find((m) => m.id === t.missionId);
      const d = mission?.domain?.toLowerCase() || t.mission?.domain?.toLowerCase() || "other";
      counts[d] = (counts[d] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [activeTasks, missions]);

  // ── Hidden High-Risk Detection ──
  const visibleTaskIds = useMemo(() => {
    const set = new Set<string>();
    if (executionModeActive) {
      if (focusedTask) {
        set.add(focusedTask.id);
      }
    } else {
      for (const t of filteredTasks) {
        set.add(t.id);
      }
    }
    return set;
  }, [executionModeActive, focusedTask, filteredTasks]);

  const filtersActive = !!(searchQuery.trim() || domainFilter || kindFilter !== "all");
  const filterKey = `${searchQuery}-${domainFilter}-${kindFilter}-${executionModeActive}`;

  const hiddenRiskSummary = useMemo(() => {
    return computeHiddenRiskSummary({
      allTasks: tasks,
      visibleTaskIds,
      filtersActive,
      executionModeActive,
      now: new Date(),
      searchQuery,
      kindFilter,
      domainFilter,
      missions,
    });
  }, [tasks, visibleTaskIds, filtersActive, executionModeActive, searchQuery, kindFilter, domainFilter, missions]);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setDomainFilter(null);
    setKindFilter("all");
  }, []);

  const handleQueueNext = useCallback((taskId: string) => {
    setQueuedTaskId(taskId);
    const task = tasks.find(t => t.id === taskId);
    toast.success(`Queued “${task?.title || "task"}” next in Execution Mode.`);
  }, [tasks]);

  // ── Mutation wrappers · invalidate task + mission queries on success ──
  const refetchAll = useCallback(async () => {
    await Promise.all([
      utils.task.list.invalidate(),
      utils.task.missions.invalidate(),
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
      // Wave AL · 2026-05-28 · recurring tasks · DAILY loopKind tasks
      // never reach DONE forever · they're a habit, not a one-shot.
      // On complete:
      //   · streakCount++
      //   · lastCompletedAt = now
      //   · status = WAITING + snoozedUntil = tomorrow 00:00 local
      // The existing task-resurface cron auto-flips WAITING→READY
      // when snoozedUntil ≤ now · the task reappears tomorrow.
      const loopKind = (task as unknown as { loopKind?: string } | undefined)
        ?.loopKind;
      const isDaily = loopKind === "DAILY";
      const isWeekly = loopKind === "WEEKLY";
      const isRecurring = isDaily || isWeekly;
      let xpAdded = 0;
      try {
        telemetry.event("completeTask", { taskId: id, isDaily });
        if (isDaily) {
          const tomorrow = new Date();
          tomorrow.setHours(0, 0, 0, 0);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const currentStreak =
            (task as unknown as { streakCount?: number } | undefined)
              ?.streakCount ?? 0;
          const res = await updateTask.mutateAsync({
            id,
            fields: {
              status: "WAITING",
              snoozedUntil: tomorrow.toISOString(),
              lastCompletedAt: new Date().toISOString(),
              streakCount: currentStreak + 1,
            },
          });
          // Wire 4 · DAILY now credits per-day stat XP server-side; surface the
          // real reward, falling back to the client-known streak if absent.
          const dailyReward = (res as unknown as { reward?: TaskReward }).reward ?? {
            xpCredited: null,
            goalLifted: false,
            streak: currentStreak + 1,
          };
          const dailyMsg = formatReward(dailyReward);
          if (dailyMsg) {
            toast.success(dailyMsg, {
              duration: 4500,
              action: { label: "Stats", onClick: () => router.push("/stats") },
            });
          }
          if (dailyReward.levelUp) setLevelUpState(dailyReward.levelUp);
          if (dailyReward.xpCredited) xpAdded = dailyReward.xpCredited;
        } else if (isWeekly) {
          // 2026-06-09 · WEEKLY completes through the unified task.check service
          // (it computes nextWeekdayOccurrence(recurringDays) + parks the task
          // WAITING until its next weekday — the client can't, recurringDays is
          // lazy-loaded server-side). CheckTaskResult carries the typed reward.
          const res = await checkTaskMut.mutateAsync({ id, action: "complete" });
          const msg = formatReward(res.reward);
          if (msg) {
            toast.success(msg, {
              duration: 4500,
              action: { label: "Stats", onClick: () => router.push("/stats") },
            });
          }
          if (res.reward?.levelUp) setLevelUpState(res.reward.levelUp);
          if (res.reward?.xpCredited) xpAdded = res.reward.xpCredited;
        } else {
          // ONCE/PROMISE → status DONE via updateTask (unchanged semantics). The
          // service attaches `reward` at runtime on the DONE transition (same
          // cast pattern as autoLearn), so read it via a cast.
          const res = await updateTask.mutateAsync({ id, fields: { status: "DONE" } });
          const reward = (res as unknown as { reward?: TaskReward }).reward;
          const msg = formatReward(reward);
          if (msg) {
            toast.success(msg, {
              duration: 4500,
              action: { label: "Stats", onClick: () => router.push("/stats") },
            });
          }
          if (reward?.levelUp) setLevelUpState(reward.levelUp);
          if (reward?.xpCredited) xpAdded = reward.xpCredited;
        }
        if (xpAdded > 0) {
          setXpParticle({ xp: xpAdded, key: Date.now() });
        }
        await refetchAll();

        // Phase 3 · cascade · if this was the last open task in an
        // active mission, prompt the operator to mark the mission
        // complete + capture a retro. Wave AL · DAILY tasks come back
        // tomorrow · they don't actually "close" the mission · skip
        // the cascade so the retro prompt doesn't fire incorrectly.
        if (wasOpen && task?.missionId && !isRecurring) {
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
    [tasks, missions, updateTask, checkTaskMut, refetchAll, telemetry],
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
      if (submitting) return;
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

        // Create the task; the server classifies it (mission + goal + stats)
        // via enrichTaskLinkage right after the write.
        telemetry.event("addTask", {
          source: "quickAdd",
          missionId: null,
          classifierConfidence: null,
        });
        const created = (await createTask.mutateAsync({
          title: text,
          missionId: null,
          status: "READY",
          originSource: "missions-page:quickAdd",
        })) as { id: string } | null;
        await refetchAll();

        if (!created?.id) {
          // No id back · the task may still have been created · stop
          // here so we don't try to update a phantom row.
          return;
        }

        // 2026-06-01 · server-side enrichTaskLinkage (fire-and-forget on
        // create) now classifies the task to mission + goal + statHints —
        // strictly more than the old client-side mission-only classify, and
        // it runs on every creation path. We just refetch shortly so the
        // attached mission surfaces in the list. (Removed the redundant
        // client classify + its /api/ai/classify-task-mission route.)
        setTimeout(() => {
          void refetchAll();
        }, 2500);
      } finally {
        setSubmitting(false);
      }
    },
    [createTask, createMission, refetchAll, telemetry, submitting],
  );

  // ── Loading ──
  if (tasksQuery.isLoading || missionsQuery.isLoading) {
    return <MissionsPageSkeleton />;
  }

  if (executionModeActive) {
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

        {/* Hidden risk warning banner */}
        <HiddenRiskWarning
          summary={hiddenRiskSummary}
          executionModeActive={executionModeActive}
          filterKey={filterKey}
          onClearFilters={handleClearFilters}
          onExitFocusMode={() => setExecutionModeActive(false)}
          onQueueNext={handleQueueNext}
        />

        {focusedTask ? (
          <ExecutionPanel
            task={focusedTask}
            mission={focusedTaskMission}
            onComplete={handleCompleteTask}
            onStart={handleStartTask}
            onDelete={handleDeleteTask}
            onEdit={(task) => {
              setTaskEditTarget(task);
              setTaskEditOpen(true);
              telemetry.event("editTaskOpen", { taskId: task.id });
            }}
            onUpdateTask={handleUpdateTaskFields}
            onExit={() => setExecutionModeActive(false)}
          />
        ) : (
          <div className="space-y-4 max-w-xl mx-auto py-12 text-center">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 border border-zinc-800 text-zinc-400 text-xl font-bold">
              ✓
            </span>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                All Tasks Completed
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                You have no open tasks left to execute. Great work!
              </p>
            </div>
            <button
              onClick={() => setExecutionModeActive(false)}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Exit Focus Mode
            </button>
          </div>
        )}

        {/* task edit sheet · pass live mission list so the
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

      {/* Wave AO · 2026-05-28 · Sam-parity with /goals · the ONE
       *  mission that needs operator attention right now (DOING tasks
       *  first · then deadline urgency · then open-count). Self-hides
       *  when nothing qualifies. */}
      <TopMissionToday missions={missions} tasks={tasks} />

      {/* Wave AO · 2026-05-28 · 1-glance triage chip per active mission ·
       *  in_flight (amber) · healthy (green) · behind (gold) · stalled
       *  (rose) · idle (zinc) · done (faint gold). Tap a chip → tooltip
       *  shows full title + state. Self-hides on empty. */}
      <MissionsHealthStrip missions={missions} tasks={tasks} />

      {/* Wire 2 · read-only rescue suggestions + GENERAL-anchor open-counts.
       *  Self-hides when nothing needs attention. Never moves a task. */}
      <MissionsRescueStrip />

      {/* Hidden risk warning banner */}
      <HiddenRiskWarning
        summary={hiddenRiskSummary}
        executionModeActive={executionModeActive}
        filterKey={filterKey}
        onClearFilters={handleClearFilters}
        onExitFocusMode={() => setExecutionModeActive(false)}
        onQueueNext={handleQueueNext}
      />

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
        <button
          type="button"
          onClick={() => {
            setExecutionModeActive(true);
            telemetry.event("executionModeOpen", { source: "button" });
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-amber-400 hover:bg-amber-500/10"
        >
          ⚡ Execution Mode
        </button>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] transition-colors",
            showFilters
              ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
              : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
          )}
        >
          {showFilters ? "✕ Close Filters" : "⚙️ Filters"}
        </button>
        <span className="text-[10px] font-mono text-[var(--text-tertiary)]/70">
          or type{" "}
          <code className="px-1 rounded bg-[var(--bg-raised)]/10 text-[var(--text-tertiary)]">
            create mission &lt;name&gt;
          </code>{" "}
          above
        </span>
      </div>

      {showFilters && (
        <TaskFilters
          showFilters={showFilters}
          kindFilter={kindFilter}
          setKindFilter={setKindFilter}
          domainFilter={domainFilter}
          setDomainFilter={setDomainFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onceCount={onceCount}
          dailyCount={dailyCount}
          promiseCount={promiseCount}
          activeCount={activeCount}
          activeDomains={activeDomains}
          customDomains={customDomains}
          setCustomDomains={setCustomDomains}
          addingDomain={addingDomain}
          setAddingDomain={setAddingDomain}
          newDomainInput={newDomainInput}
          setNewDomainInput={setNewDomainInput}
          filterEditMode={filterEditMode}
          setFilterEditMode={setFilterEditMode}
        />
      )}

      {/* Active filters summary chip bar */}
      {filtersActive && (
        <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
          <ActiveFiltersStrip
            filters={[
              ...(searchQuery.trim() ? [{ label: `search · "${searchQuery.trim().slice(0, 20)}"`, onRemove: () => setSearchQuery("") }] : []),
              ...(kindFilter !== "all" ? [{ label: `kind · ${kindFilter}`, onRemove: () => setKindFilter("all") }] : []),
              ...(domainFilter ? [{ label: `domain · ${domainFilter}`, onRemove: () => setDomainFilter(null) }] : []),
            ]}
            onClearAll={handleClearFilters}
          />
        </div>
      )}

      {/* Mission cards + unattached section */}
      <MissionFeed
        missions={filteredMissions}
        tasks={filteredTasks}
        onAddTask={handleAddTask}
        onCompleteTask={handleCompleteTask}
        onStartTask={handleStartTask}
        onDeleteTask={handleDeleteTask}
        onCompleteMission={handleCompleteMission}
        onArchiveMission={handleArchiveMission}
        onDecomposeTask={handleDecomposeTask}
        autonomicHealth={healthQuery.data?.autonomic}
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
        // Wave AV · 2026-05-28 · DAILY task snooze · pill in the row's
        // meta strip opens a popover with 2 presets. We translate the
        // tap into the existing task.update mutation + the WAITING flip
        // the task-resurface cron expects. Empty string = clear snooze.
        onSnoozeTask={async (taskId, snoozedUntilIso) => {
          try {
            const clearing = !snoozedUntilIso;
            telemetry.event("snoozeTask", {
              taskId,
              clearing,
              snoozedUntil: snoozedUntilIso || null,
            });
            await updateTask.mutateAsync({
              id: taskId,
              fields: {
                // null clears the snooze · ISO sets the wake time
                snoozedUntil: snoozedUntilIso || null,
                // WAITING parks it for the cron · READY brings it back
                status: clearing ? "READY" : "WAITING",
              },
            });
            await refetchAll();
            toast.success(clearing ? "Snooze cleared." : "Task snoozed.");
          } catch (err) {
            log.error("snoozeTask_failed", { err });
            toast.error("Could not update snooze.");
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

      {/* Dopamine loop · level-up celebration modal */}
      {levelUpState && (
        <LevelUpModal
          newLevel={levelUpState.newLevel}
          tierName={levelUpState.tierName}
          tierEmoji={levelUpState.tierEmoji}
          onClose={() => setLevelUpState(null)}
        />
      )}

      {/* Dopamine loop · floating XP particle animation overlay */}
      {xpParticle.xp > 0 && (
        <div className="fixed inset-0 pointer-events-none z-[9999]" aria-hidden="true">
          <XpParticle xp={xpParticle.xp} triggerKey={xpParticle.key} />
        </div>
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
