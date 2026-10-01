"use client";

/**
 * /missions — the Execution Deck (2026-09-01 rebuild).
 *
 * The working surface of the personal OS, complementary to Home's
 * Command Surface (Home = what needs judgment; here = do the work and
 * manage the queue). Section order is the attention order:
 *
 *   1 · NEXT MOVE — one decided action (server-picked, term-explained)
 *   2 · readiness line — dark cockpit: renders only on exception/unknown
 *   3 · DECIDE — the triage airlock (captures · classify · unattached)
 *   4 · capture — quick add (raw intake lands in triage, never today)
 *   5 · MISSIONS — finite user projects, WIP-capped (board + filters)
 *   6 · LANES — eternal domain queues; shop lane links out to the admin
 *   7 · RHYTHMS — habits off the board, rolling-window consistency
 *   8 · WAITING — blocked work + Nick's desk
 *   9 · DONE TODAY — evidence + close the day
 *
 * 2026-09-16 · Visible Transformation: NEXT MOVE spans the page as the
 * one display-type line; capture, decide and the board are ruled sections
 * under eyebrow headings (no cards); WAITING + DONE TODAY sit in a rail
 * separated by a hairline at >=1280px. Same data, same handlers.
 *
 * What left this page, deliberately: the LVL/XP pill (mis-aggregated,
 * reader-less — /stats keeps the character sheet), the on-page AI brief
 * (Home compiles THE brief), the always-on readiness strip, the RPG copy,
 * and the level-up modal. One celebration survives: the completion
 * sparkle on the row checkbox.
 */

import { Suspense, useCallback, useMemo } from "react";
import { toast } from "sonner";

import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { OmniCaptureModal } from "@/components/actions/omni-capture-modal";
import { NickSidePane } from "@/components/mastery/nick-side-pane";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionFeed } from "@/components/missions/mission-feed";
import { MissionsQuickAdd } from "@/components/missions/missions-quick-add";
import { DeckNextMove } from "@/components/missions/deck-next-move";
import { DeckReadinessLine } from "@/components/missions/deck-readiness-line";
import { DeckTriage } from "@/components/missions/deck-triage";
import { DeckLanes } from "@/components/missions/deck-lanes";
import { DeckRhythms } from "@/components/missions/deck-rhythms";
import { DeckWaiting } from "@/components/missions/deck-waiting";
import { DeckEvidence } from "@/components/missions/deck-evidence";

import { useMissionSurfaceTelemetry } from "@/lib/telemetry/mission-surface";
import { ExecutionPanel } from "@/components/missions/execution-panel";
import { TaskFilters } from "@/components/actions/task-filters";
import { ActiveFiltersStrip } from "@/components/ui/filter-chip-bar";
import { HiddenRiskWarning } from "@/components/missions/hidden-risk-warning";
import { computeHiddenRiskSummary } from "@/lib/tasks/hidden-risk";
import { cn } from "@/lib/utils";
import { StandardPage } from "@/components/layout/standard-page";
import { isUserProject } from "@/lib/services/mission-helpers";
import type { Task } from "@/components/actions/shared";
import { useCustomDomains } from "@/hooks/use-custom-domains";

import { useMissionsData } from "./hooks/use-missions-data";
import { useMissionFilters } from "./hooks/use-mission-filters";
import { useExecutionFocus } from "./hooks/use-execution-focus";
import { useMissionActions } from "./hooks/use-mission-actions";
import { MissionDispatchProvider } from "./context/mission-dispatch-context";
import { MissionInspectorActions } from "./components/mission-inspector-actions";
import { useMissionUIStore } from "./state/use-mission-ui-store";
import { MissionModalsManager } from "./components/mission-modals-manager";
import { missionBoardReadState } from "./mission-board-read-state";

export default function MissionsPage() {
  return (
    <Suspense fallback={<MissionsPageSkeleton />}>
      <MissionsPageInner />
    </Suspense>
  );
}

const HABIT_LOOPS_CLIENT = new Set(["DAILY", "WEEKLY"]);

function MissionsPageInner() {
  const telemetry = useMissionSurfaceTelemetry("missions");

  // Global UI State
  const executionModeActive = useMissionUIStore((s) => s.executionModeActive);
  const setExecutionModeActive = useMissionUIStore((s) => s.setExecutionModeActive);
  const queuedTaskId = useMissionUIStore((s) => s.queuedTaskId);
  const setQueuedTaskId = useMissionUIStore((s) => s.setQueuedTaskId);
  const openMissionEdit = useMissionUIStore((s) => s.openMissionEdit);

  // Data — one deck read + the raw lists the board's actions need.
  const { deckQuery, tasks, missions, tasksQuery, missionsQuery, ccStateQuery } = useMissionsData();
  const deck = deckQuery.data ?? null;
  const { customDomains, setCustomDomains } = useCustomDomains();

  const filters = useMissionFilters(tasks, missions);
  const actions = useMissionActions({ tasks, missions });

  // The board renders FINITE user projects only. Anchor-lane tasks live in
  // LANES, habits in RHYTHMS, mission-less tasks in the triage airlock —
  // so the board's task set excludes all three.
  const userProjectIds = useMemo(
    () => new Set(missions.filter((m) => m.status === "ACTIVE" && isUserProject(m)).map((m) => m.id)),
    [missions],
  );
  const boardTasks = useMemo(
    () =>
      filters.filteredTasks.filter(
        (t) =>
          userProjectIds.has(t.missionId) &&
          !HABIT_LOOPS_CLIENT.has(((t as { loopKind?: string }).loopKind ?? "").toUpperCase()),
      ),
    [filters.filteredTasks, userProjectIds],
  );
  const boardMissions = useMemo(
    () => filters.filteredMissions.filter((m) => isUserProject(m)),
    [filters.filteredMissions],
  );

  const { focusedTask, focusedTaskMission } = useExecutionFocus(
    tasks,
    missions,
    queuedTaskId,
    ccStateQuery.data?.commands?.active?.id,
    deck?.nextMove?.task.id ?? null,
  );

  const handleStartMove = useCallback(
    async (taskId: string) => {
      telemetry.event("deckStartMove", { taskId });
      setQueuedTaskId(taskId);
      await actions.handleStartTask(taskId);
      setExecutionModeActive(true);
    },
    [actions, setQueuedTaskId, setExecutionModeActive, telemetry],
  );

  const handlePickDifferent = useCallback(
    (taskId: string) => {
      telemetry.event("deckPickDifferent", { taskId });
      setQueuedTaskId(taskId);
      const alt = tasks.find((t) => t.id === taskId);
      toast.success(`“${alt?.title ?? "Task"}” is the move — start when ready.`);
    },
    [tasks, setQueuedTaskId, telemetry],
  );

  const handleUnblock = useCallback(
    (taskId: string) => {
      void actions.handleUpdateTaskFields(taskId, { waitingOn: null });
    },
    [actions],
  );

  const visibleTaskIds = useMemo(() => {
    const set = new Set<string>();
    if (executionModeActive) {
      if (focusedTask) set.add(focusedTask.id);
    } else {
      // Filters scope the BOARD; lanes, rhythms, triage and waiting render
      // regardless. A lane task is not "hidden risk" — it is on screen in
      // its lane — so only filter-hidden BOARD tasks count as hidden.
      for (const t of filters.filteredTasks) set.add(t.id);
      for (const t of tasks) {
        const habit = HABIT_LOOPS_CLIENT.has(((t as { loopKind?: string }).loopKind ?? "").toUpperCase());
        if (habit || !userProjectIds.has(t.missionId)) set.add(t.id);
      }
    }
    return set;
  }, [executionModeActive, focusedTask, filters.filteredTasks, tasks, userProjectIds]);

  const filterKey = `${filters.searchQuery}-${filters.domainFilter}-${filters.kindFilter}-${executionModeActive}`;

  const hiddenRiskSummary = useMemo(() => {
    return computeHiddenRiskSummary({
      allTasks: tasks,
      visibleTaskIds,
      filtersActive: filters.filtersActive,
      executionModeActive,
      now: new Date(),
      searchQuery: filters.searchQuery,
      kindFilter: filters.kindFilter,
      domainFilter: filters.domainFilter,
      missions,
    });
  }, [tasks, visibleTaskIds, filters.filtersActive, executionModeActive, filters.searchQuery, filters.kindFilter, filters.domainFilter, missions]);

  const handleQueueNext = useCallback((taskId: string) => {
    setQueuedTaskId(taskId);
    const task = tasks.find((t) => t.id === taskId);
    toast.success(`Queued “${task?.title || "task"}” next in Execution Mode.`);
  }, [tasks, setQueuedTaskId]);

  const boardReadState = missionBoardReadState({
    tasksData: tasksQuery.data,
    missionsData: missionsQuery.data,
    tasksErrored: tasksQuery.isError,
    missionsErrored: missionsQuery.isError,
  });

  const openBoardCount = boardTasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED").length;

  return (
    <MissionDispatchProvider actions={actions}>
      <MissionInspectorActions />
      <StandardPage
        eyebrow="Execution Deck"
        title="Missions"
        description="The work that needs you."
        width="workspace"
        rhythm="workspace"
        className="w-full"
        showHeader={!executionModeActive}
      >
        <HiddenRiskWarning
          summary={hiddenRiskSummary}
          executionModeActive={executionModeActive}
          filterKey={filterKey}
          onClearFilters={filters.handleClearFilters}
          onExitFocusMode={() => setExecutionModeActive(false)}
          onQueueNext={handleQueueNext}
        />

        {/* Completion outcome prompt — mounted OUTSIDE the exec-mode branch
            so handleCompleteTask can open it from the board AND from
            Execution Mode. Renders null when idle. */}
        {actions.outcomeDialog}

        {executionModeActive ? (
          focusedTask ? (
            <ExecutionPanel
              // Remount per task: the poll can swap focusedTask while an
              // abandon/block/snooze confirm is open — without a key the open
              // confirm silently rebinds to the NEW task.
              key={focusedTask.id}
              task={focusedTask}
              mission={focusedTaskMission}
              onComplete={actions.handleCompleteTask}
              onStart={actions.handleStartTask}
              onDelete={actions.handleDeleteTask}
              onEdit={actions.handleEditTask}
              onUpdateTask={actions.handleUpdateTaskFields}
              onPark={actions.handleParkTask}
              onExit={() => setExecutionModeActive(false)}
            />
          ) : (
            <div className="mx-auto max-w-xl border-l-2 border-edge py-4 pl-5 sm:pl-6">
              <p className="vt-eyebrow text-fg-secondary">execution</p>
              <h3 className="vt-verdict mt-3 max-w-[16ch]">Nothing left to execute</h3>
              <p className="mt-4 text-lg text-fg-secondary">The queue is clear. Close the day when you&apos;re ready.</p>
              <button
                onClick={() => setExecutionModeActive(false)}
                className="mt-6 inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
              >
                Back to the deck
              </button>
            </div>
          )
        ) : (
          // 2026-09-16 · Visible Transformation: the NEXT MOVE hero spans the
          // page above the board; below it, the deck on the left and the
          // WAITING / DONE rail on the right at >=1280px (section 5.4, 2026-09-08).
          <>
            {/* Pass the real promise — a `void` wrapper here made the modal
                clear its text + close while the create was still in flight,
                losing the capture on failure. */}
            <OmniCaptureModal onCapture={(text) => actions.handleQuickAdd(text)} />
            <NickSidePane
              page="missions"
              coachSurface="tasks"
              presets={["What's my next move and why?", "Which mission is stalling?", "Draft a plan for my top mission.", "What did I finish this week?"]}
            />
            <CoachEventBanner surface="tasks" />

            {/* 1 · NEXT MOVE — the one display line this page shouts */}
            {deckQuery.isLoading ? (
              <ShimmerSkeleton className="h-40 rounded-2xl" />
            ) : deckQuery.isError ? (
              <p className="border-l-2 border-rose-500/60 py-1 pl-4 text-[13px] text-rose-300/90">
                Deck unreadable — the read failed. State unknown, not empty.
              </p>
            ) : (
              deck && (
                <DeckNextMove
                  nextMove={deck.nextMove}
                  capacity={deck.capacity}
                  onStart={handleStartMove}
                  onPickDifferent={handlePickDifferent}
                />
              )
            )}

            {/* 2 · readiness — dark cockpit, speaks only on exception */}
            {deck && <DeckReadinessLine readiness={deck.readiness} />}

          <div className="space-y-10 xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start xl:gap-12 xl:space-y-0" data-missions-layout="deck">
          <div className="min-w-0 space-y-10" data-missions-column="deck">
            {/* 3 · DECIDE — the airlock */}
            {deck && (
              <DeckTriage
                triage={deck.triage}
                tasks={tasks}
                onEditTask={actions.handleEditTask}
                onSnoozeTask={(id, iso) => void actions.handleSnoozeTask(id, iso)}
                onDeleteTask={(id) => void actions.handleDeleteTask(id)}
              />
            )}

            {/* 4 · capture */}
            <section aria-labelledby="capture-heading">
              <div className="flex items-end justify-between gap-3 border-b border-edge pb-3">
                <h2 id="capture-heading" className="vt-eyebrow text-fg-secondary">
                  capture
                </h2>
                <span className="hidden font-mono text-[11px] text-fg-tertiary sm:block">
                  lands in decide · nothing is scheduled for today
                </span>
              </div>
              <div className="mt-1">
                <MissionsQuickAdd onSubmit={actions.handleQuickAdd} busy={actions.submitting} />
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2" aria-label="mission actions">
              <button
                type="button"
                onClick={() => {
                  openMissionEdit(null, undefined);
                  telemetry.event("createMissionOpen", { source: "button" });
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
              >
                + New mission
              </button>
              <button
                type="button"
                onClick={() => {
                  setExecutionModeActive(true);
                  telemetry.event("executionModeOpen", { source: "button" });
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
              >
                Focus
              </button>
              <button
                type="button"
                onClick={() => filters.setShowFilters((v) => !v)}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-1.5 rounded-control border px-4 text-[13px] font-medium transition-colors duration-[var(--motion-state)]",
                  filters.showFilters ? "border-edge-strong bg-surface-interactive text-fg" : "border-edge-default text-fg-secondary hover:border-edge-strong hover:text-fg"
                )}
              >
                {filters.showFilters ? "Close filters" : "Filters"}
              </button>
            </div>

            {filters.showFilters && (
              <TaskFilters
                showFilters={filters.showFilters}
                kindFilter={filters.kindFilter}
                setKindFilter={filters.setKindFilter}
                domainFilter={filters.domainFilter}
                setDomainFilter={filters.setDomainFilter}
                searchQuery={filters.searchQuery}
                setSearchQuery={filters.setSearchQuery}
                onceCount={filters.onceCount}
                dailyCount={filters.dailyCount}
                promiseCount={filters.promiseCount}
                activeCount={filters.activeCount}
                activeDomains={filters.activeDomains}
                customDomains={customDomains}
                setCustomDomains={setCustomDomains}
                addingDomain={filters.addingDomain}
                setAddingDomain={filters.setAddingDomain}
                newDomainInput={filters.newDomainInput}
                setNewDomainInput={filters.setNewDomainInput}
                filterEditMode={filters.filterEditMode}
                setFilterEditMode={filters.setFilterEditMode}
              />
            )}

            {filters.filtersActive && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ActiveFiltersStrip
                  filters={[
                    ...(filters.searchQuery.trim() ? [{ label: `search · "${filters.searchQuery.trim().slice(0, 20)}"`, onRemove: () => filters.setSearchQuery("") }] : []),
                    ...(filters.kindFilter !== "all" ? [{ label: `kind · ${filters.kindFilter}`, onRemove: () => filters.setKindFilter("all") }] : []),
                    ...(filters.domainFilter ? [{ label: `domain · ${filters.domainFilter}`, onRemove: () => filters.setDomainFilter(null) }] : []),
                  ]}
                  onClearAll={filters.handleClearFilters}
                />
              </div>
            )}

            {/* 5 · MISSIONS — finite projects, WIP-capped */}
            {/* data-selection-scope · 2026-09-15 · task rows carry data-entity, so
                j/k/Space/Enter/x work here (hooks/use-selection-keyboard.ts). */}
            <section aria-labelledby="mission-board-heading" className="space-y-4" data-selection-scope="missions">
              <div className="flex items-end justify-between gap-3 border-b border-edge pb-3">
                <h2 id="mission-board-heading" className="vt-eyebrow text-fg-secondary">
                  Active missions
                </h2>
                <span className="font-mono text-[11px] tabular-nums text-fg-tertiary">
                  {boardMissions.length} active · {openBoardCount} open
                  {deck ? ` · ${deck.missionSlotsOpen} slot${deck.missionSlotsOpen === 1 ? "" : "s"} open` : ""}
                </span>
              </div>
              {/* Unknown-is-not-empty (2026-08-19): a failed task/mission
                  read used to fall through to <EmptyMissions /> — a dead
                  fetch rendered as a cleared board. */}
              {boardReadState === "unreadable" ? (
                <p className="border-l-2 border-rose-500/60 py-1 pl-4 text-[13px] text-rose-300/90">
                  Board unreadable — reads failed. State unknown, not empty.
                </p>
              ) : (
                <>
                  {boardReadState === "stale" && (
                    <p className="border-l-2 border-amber-400/60 py-1 pl-4 text-[13px] text-amber-200/90">
                      Showing the last confirmed board — the latest refresh failed.
                    </p>
                  )}
                  <MissionFeed missions={boardMissions} tasks={boardTasks} />
                </>
              )}
            </section>

            {/* 6 · LANES */}
            {deck && <DeckLanes lanes={deck.lanes} tasks={tasks} />}

            {/* 7 · RHYTHMS */}
            {deck && <DeckRhythms rhythms={deck.rhythms} onComplete={(id) => void actions.handleCompleteTask(id)} />}

          </div>
          <aside
            aria-label="waiting and evidence"
            data-missions-column="context"
            className="space-y-10 border-t border-edge pt-8 xl:sticky xl:top-8 xl:border-l xl:border-t-0 xl:border-edge xl:pl-10 xl:pt-1"
          >
            {/* 8 · WAITING */}
            {deck && (
              <DeckWaiting
                waiting={deck.waiting}
                tasks={tasks}
                onEditTask={actions.handleEditTask}
                onUnblock={handleUnblock}
              />
            )}

            {/* 9 · DONE TODAY + close the day */}
            {deck && (
              <DeckEvidence
                evidence={deck.evidence}
                tasks={tasks}
                onSnoozeTask={(id, iso) => actions.handleSnoozeTask(id, iso)}
              />
            )}

            {deck && deck.unmeasured.length > 0 && (
              <p className="font-mono text-[11px] text-fg-tertiary">
                unmeasured this pass: {deck.unmeasured.join(" · ")}
              </p>
            )}
          </aside>
          </div>
          </>
        )}

        <MissionModalsManager missions={missions} />
      </StandardPage>
    </MissionDispatchProvider>
  );
}

function MissionsPageSkeleton() {
  // Same width as the page (max-w-5xl) — a narrower skeleton made the
  // layout visibly jump on hydrate.
  return (
    <div className="mx-auto w-full max-w-5xl space-y-3">
      <ShimmerSkeleton className="h-12 rounded-lg" />
      <ShimmerSkeleton className="h-40 rounded-2xl" />
      <ShimmerSkeleton className="h-24 rounded-lg" />
      <ShimmerSkeleton className="h-24 rounded-lg" />
    </div>
  );
}
