"use client";

/**
 * /missions: the Execution Deck (2026-09-01 rebuild).
 *
 * The working surface of the personal OS, complementary to Home's
 * Command Surface (Home = what needs judgment; here = do the work and
 * manage the queue). Section order is the attention order:
 *
 *   1 · NEXT MOVE: one decided action from live missions (readiness line under it on exception)
 *   2 · RHYTHMS: the habit list, ticked in place (42 of 54 completions in 14 d were habits)
 *   3 · DECIDE: one count line that opens the airlock, Waiting, and the closed-mission review
 *   4 · MISSIONS: finite user projects, with capture and the domain lanes folded in
 *   5 · DONE TODAY: evidence + close the day
 *
 * 2026-10-23 rebuild (job 2026-10-23-bdnick-pro-rebuild): five sections on first
 * paint, every count read from the deck set it renders; see lib/missions/deck.ts.
 *
 * 2026-09-16 · Visible Transformation: NEXT MOVE spans the page as the
 * one display-type line; capture, decide and the board are ruled sections
 * under eyebrow headings (no cards); WAITING + DONE TODAY sit in a rail
 * separated by a hairline at >=1280px. Same data, same handlers.
 *
 * What left this page, deliberately: the LVL/XP pill (mis-aggregated,
 * reader-less: /stats keeps the character sheet), the on-page AI brief
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
import { DeckDecide } from "@/components/missions/deck-decide";
import { DeckLanes } from "@/components/missions/deck-lanes";
import { DeckRhythms } from "@/components/missions/deck-rhythms";
import { DeckEvidence } from "@/components/missions/deck-evidence";
import { ReadFailed } from "@/components/ui/read-failed";

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

import { trpc } from "@/lib/trpc/client";
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

  // Data: one deck read + the raw lists the board's actions need.
  const { deckQuery, tasks, missions, tasksQuery, missionsQuery, ccStateQuery } = useMissionsData();
  const deck = deckQuery.data ?? null;
  const { customDomains, setCustomDomains } = useCustomDomains();

  const filters = useMissionFilters(tasks, missions);
  const actions = useMissionActions({ tasks, missions });

  // The board renders FINITE user projects only. Anchor-lane tasks live in
  // LANES, habits in RHYTHMS, mission-less tasks in the triage airlock, 
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
    deckQuery.isError ? null : (deck?.focusOrder ?? null),
  );

  // 2026-10-02 · the deck's pick is a ledgered recommendation (lib/missions/
  // deck.ts ledgerNextMoveShown). Starting the hero is `accepted`; picking an
  // alternate is `dismissed`. Fire-and-forget beside the action: the 2-week
  // client telemetry below stays as the surface-usage instrument; this is the
  // durable learning row (docs/design/outcome-ledger-coverage-2026-10-02.md §5).
  // No id (the bounded ledger write answered late) → send the summary the row
  // was ledgered under and the server decides by content (audit 2026-10-10,
  // 06-F2); it must match nextMoveLedgerSummary in lib/missions/deck.ts.
  const decideRecommendation = trpc.operator.recordRecommendationDecision.useMutation();
  const recordDeckDecision = useCallback(
    (decision: "accepted" | "dismissed", resultRef: string | null) => {
      const nextMove = deck?.nextMove;
      if (!nextMove) return;
      const target = nextMove.ledgerId
        ? { ledgerId: nextMove.ledgerId }
        : { summary: `${nextMove.kind === "resume" ? "resume" : "next move"}: ${nextMove.task.title}` };
      decideRecommendation.mutate({ ...target, decision, ...(resultRef ? { resultRef } : {}) });
    },
    [deck?.nextMove, decideRecommendation],
  );

  const handleStartMove = useCallback(
    async (taskId: string) => {
      telemetry.event("deckStartMove", { taskId });
      if (taskId === deck?.nextMove?.task.id) recordDeckDecision("accepted", `task:${taskId}`);
      setQueuedTaskId(taskId);
      await actions.handleStartTask(taskId);
      setExecutionModeActive(true);
    },
    [actions, setQueuedTaskId, setExecutionModeActive, telemetry, deck?.nextMove?.task.id, recordDeckDecision],
  );

  const handlePickDifferent = useCallback(
    (taskId: string) => {
      telemetry.event("deckPickDifferent", { taskId });
      // Never `task:<alt>` on a dismissal: on the HERO's row it let the
      // alternate's completion rating close the dismissed recommendation as
      // useful. The reason `alternative` keeps it out of CORRECTION_WHERE
      // (choosing another move is not a verdict on this one, audit 06-F5).
      recordDeckDecision("dismissed", "dismiss:alternative");
      setQueuedTaskId(taskId);
      const alt = tasks.find((t) => t.id === taskId);
      toast.success(`“${alt?.title ?? "Task"}” is the move. Start when ready.`);
    },
    [tasks, setQueuedTaskId, telemetry, recordDeckDecision],
  );

  const handleUnblock = useCallback(
    (taskId: string) => {
      const t = tasks.find((x) => x.id === taskId);
      void actions.handleUpdateTaskFields(taskId, { waitingOn: null, ...(t?.status === "WAITING" ? { status: "READY" } : {}) });
    },
    [actions, tasks],
  );

  const visibleTaskIds = useMemo(() => {
    const set = new Set<string>();
    if (executionModeActive) {
      if (focusedTask) set.add(focusedTask.id);
    } else {
      // Filters scope the BOARD; lanes, rhythms, triage and waiting render
      // regardless. A lane task is not "hidden risk": it is on screen in
      // its lane: so only filter-hidden BOARD tasks count as hidden.
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

  // The rhythm row knows an id; the task editor needs the whole task. If task.list has not answered, say
  // so rather than leave a dead title.
  const handleEditRhythm = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        toast.error("That rhythm is not loaded yet. Try again in a moment.");
        return;
      }
      actions.handleEditTask(task);
    },
    [tasks, actions],
  );

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
  const boardCounted = boardReadState === "ready" || boardReadState === "stale";

  // The deck's one order and live set (lib/missions/deck.ts taskOrder): the cards and close-the-day read it.
  const taskRank = useMemo(() => new Map((deck?.taskOrder ?? []).map((id, i) => [id, i])), [deck?.taskOrder]);
  const liveIds = useMemo(() => new Set(deck?.taskOrder ?? []), [deck?.taskOrder]);

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

        {/* Completion outcome prompt: mounted OUTSIDE the exec-mode branch
            so handleCompleteTask can open it from the board AND from
            Execution Mode. Renders null when idle. */}
        {actions.outcomeDialog}

        {executionModeActive ? (
          focusedTask ? (
            <ExecutionPanel
              // Remount per task: the poll can swap focusedTask while an
              // abandon/block/snooze confirm is open: without a key the open
              // confirm silently rebinds to the NEW task.
              key={focusedTask.id}
              task={focusedTask}
              mission={focusedTaskMission}
              onComplete={async (id) => { await actions.handleCompleteTask(id); }}
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
            {/* Pass the real promise: a `void` wrapper here made the modal
                clear its text + close while the create was still in flight,
                losing the capture on failure. */}
            <OmniCaptureModal onCapture={(text) => actions.handleQuickAdd(text)} />
            <NickSidePane
              page="missions"
              coachSurface="tasks"
              presets={["What's my next move and why?", "Which mission is stalling?", "Draft a plan for my top mission.", "What did I finish this week?"]}
            />
            <CoachEventBanner surface="tasks" />

            {/* 1 · NEXT MOVE: the one display line this page shouts */}
            {deckQuery.isLoading ? (
              <ShimmerSkeleton className="h-40 rounded-surface" />
            ) : deckQuery.isError ? (
              <ReadFailed onRetry={() => void deckQuery.refetch()}>
                Deck unreadable: the read failed, so the state is unknown, not empty.
              </ReadFailed>
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

            {/* 2 · readiness: dark cockpit, speaks only on exception */}
            {deck && <DeckReadinessLine readiness={deck.readiness} />}

            {/* 2 · RHYTHMS: second on the page because ticking habits is the main job here */}
            {deck && (
              <DeckRhythms
                rhythms={deck.rhythms}
                onComplete={(id, loopKind) => actions.handleCompleteTask(id, { loopKind })}
                onEdit={handleEditRhythm}
                onAdd={actions.handleAddRhythm}
              />
            )}

            {/* W2 (2026-10-16): the deck's two mode controls sit in one compact strip under the hero,
                so the capture row below is the page's one capture control. 44px targets. */}
            <div role="group" className="flex flex-wrap items-center gap-2 border-b border-edge pb-4" aria-label="deck controls">
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
                aria-expanded={filters.showFilters}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-1.5 rounded-control border px-4 text-[13px] font-medium transition-colors duration-[var(--motion-state)]",
                  filters.showFilters ? "border-edge-strong bg-surface-interactive text-fg" : "border-edge-default text-fg-secondary hover:border-edge-strong hover:text-fg"
                )}
              >
                {filters.showFilters ? "Close filters" : "Filters"}
              </button>
            </div>

            {/* The filter panel and the active-filter chips open right under their control. */}
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

          <div className="space-y-10 xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start xl:gap-12 xl:space-y-0" data-missions-layout="deck">
          <div className="min-w-0 space-y-10" data-missions-column="deck">
            {/* 3 · DECIDE: one count line; the queue, Waiting and the closed-mission review open under it */}
            {deck && (
              <DeckDecide
                triage={deck.triage}
                waiting={deck.waiting}
                closed={deck.closed}
                tasks={tasks}
                onEditTask={actions.handleEditTask}
                onSnoozeTask={actions.handleSnoozeTask}
                onDeleteTask={actions.handleDeleteTask}
                onUnblock={handleUnblock}
                unmeasured={deck.unmeasured}
                onRetry={() => void deckQuery.refetch()}
              />
            )}

            {/* 4 · MISSIONS: finite projects; capture and the domain lanes fold in here */}
            {/* data-selection-scope · task rows carry data-entity, so j/k/Space/Enter/x work here. */}
            <section aria-labelledby="mission-board-heading" className="space-y-4" data-selection-scope="missions">
              <div className="flex items-end justify-between gap-3 border-b border-edge pb-3">
                <h2 id="mission-board-heading" className="vt-eyebrow text-fg-secondary">
                  missions
                </h2>
                <div className="flex items-center gap-3">
                  {/* A count is a claim: shown only once the board has answered. */}
                  {boardCounted && (
                    <span className="font-mono text-[11px] tabular-nums text-fg-tertiary">
                      {boardMissions.length} active · {openBoardCount} open
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      openMissionEdit(null, undefined);
                      telemetry.event("createMissionOpen", { source: "button" });
                    }}
                    className="inline-flex min-h-[44px] items-center rounded-control px-2 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg"
                  >
                    New mission
                  </button>
                </div>
              </div>
              <div>
                <MissionsQuickAdd onSubmit={actions.handleQuickAdd} busy={actions.submitting} />
                <p className="mt-2 font-mono text-[11px] text-fg-tertiary">
                  captures file themselves when Nick is sure; the rest wait in decide
                </p>
              </div>
              {/* Unknown is not empty: a failed task/mission read never renders as a cleared board. */}
              {boardReadState === "unreadable" ? (
                <ReadFailed
                  onRetry={() => {
                    void tasksQuery.refetch();
                    void missionsQuery.refetch();
                  }}
                >
                  Board unreadable: the reads failed, so the state is unknown, not empty.
                </ReadFailed>
              ) : boardReadState === "loading" ? (
                <div role="status" className="space-y-2" aria-busy aria-label="loading the board">
                  <ShimmerSkeleton className="h-12 rounded-surface" />
                  <ShimmerSkeleton className="h-12 rounded-surface" />
                  <ShimmerSkeleton className="h-12 rounded-surface" />
                </div>
              ) : (
                <>
                  {boardReadState === "stale" && (
                    <p className="border-l-2 border-amber-400/60 py-1 pl-4 text-[13px] text-amber-200/90">
                      Showing the last confirmed board. The latest refresh failed.
                    </p>
                  )}
                  <MissionFeed missions={boardMissions} tasks={boardTasks} taskRank={taskRank} />
                </>
              )}
              {deck && <DeckLanes lanes={deck.lanes} tasks={tasks} onEditMission={actions.handleEditMission} />}
            </section>
          </div>
          <aside
            aria-label="done today"
            data-missions-column="context"
            className="space-y-10 border-t border-edge pt-8 xl:sticky xl:top-8 xl:border-l xl:border-t-0 xl:border-edge xl:pl-10 xl:pt-1"
          >
            {/* 5 · DONE TODAY + close the day */}
            {deck && (
              <DeckEvidence
                evidence={deck.evidence}
                tasks={tasks}
                tasksState={tasksQuery.isError ? "error" : tasksQuery.data === undefined ? "loading" : "ready"}
                liveIds={liveIds}
                onSnoozeTask={actions.handleSnoozeTask}
                onRetry={() => void tasksQuery.refetch()}
              />
            )}

            {deck && deck.unmeasured.length > 0 && (
              <p className="font-mono text-[11px] text-fg-tertiary">
                not read this pass: {deck.unmeasured.join(" · ")}
              </p>
            )}
          </aside>
          </div>          </>
        )}

        <MissionModalsManager missions={missions} />
      </StandardPage>
    </MissionDispatchProvider>
  );
}

function MissionsPageSkeleton() {
  // Same width as the page (max-w-5xl): a narrower skeleton made the
  // layout visibly jump on hydrate.
  return (
    <div className="mx-auto w-full max-w-5xl space-y-3">
      <ShimmerSkeleton className="h-12 rounded-surface" />
      <ShimmerSkeleton className="h-40 rounded-surface" />
      <ShimmerSkeleton className="h-24 rounded-surface" />
      <ShimmerSkeleton className="h-24 rounded-surface" />
    </div>
  );
}
