"use client";

import { Suspense, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { OmniCaptureModal } from "@/components/actions/omni-capture-modal";
import { NickSidePane } from "@/components/mastery/nick-side-pane";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionFeed } from "@/components/missions/mission-feed";
import { MissionsQuickAdd } from "@/components/missions/missions-quick-add";
import { NicksMorningBrief } from "@/components/missions/nicks-morning-brief";
import { TopMissionToday } from "@/components/missions/top-mission-today";
import { MissionsHealthStrip } from "@/components/missions/missions-health-strip";
import { HealthGovernorStrip } from "@/components/missions/health-governor-strip";
import { MissionsRescueStrip } from "@/components/missions/missions-rescue-strip";

import { useMissionSurfaceTelemetry } from "@/lib/telemetry/mission-surface";
import { ExecutionPanel } from "@/components/missions/execution-panel";
import { TaskFilters } from "@/components/actions/task-filters";
import { ActiveFiltersStrip } from "@/components/ui/filter-chip-bar";
import { HiddenRiskWarning } from "@/components/missions/hidden-risk-warning";
import { computeHiddenRiskSummary } from "@/lib/tasks/hidden-risk";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/ui";
import type { LevelUpPayload } from "@/lib/mastery/task-reward";
import type { Task } from "@/components/actions/shared";
import { useCustomDomains } from "@/hooks/use-custom-domains";

import { useMissionsData } from "./hooks/use-missions-data";
import { useMissionFilters } from "./hooks/use-mission-filters";
import { useExecutionFocus } from "./hooks/use-execution-focus";
import { useMissionActions } from "./hooks/use-mission-actions";
import { MissionDispatchProvider } from "./context/mission-dispatch-context";
import { useMissionUIStore } from "./state/use-mission-ui-store";
import { MissionModalsManager } from "./components/mission-modals-manager";

export default function MissionsPage() {
  return (
    <Suspense fallback={<MissionsPageSkeleton />}>
      <MissionsPageInner />
    </Suspense>
  );
}

function MissionsPageInner() {
  const searchParams = useSearchParams();
  const taskIdParam = searchParams.get("taskId");
  const telemetry = useMissionSurfaceTelemetry("missions");

  // Global UI State
  const executionModeActive = useMissionUIStore((s) => s.executionModeActive);
  const setExecutionModeActive = useMissionUIStore((s) => s.setExecutionModeActive);
  const queuedTaskId = useMissionUIStore((s) => s.queuedTaskId);
  const setQueuedTaskId = useMissionUIStore((s) => s.setQueuedTaskId);
  const openMissionEdit = useMissionUIStore((s) => s.openMissionEdit);

  // Data
  const { tasks, missions, statsQuery, healthQuery, ccStateQuery, tasksQuery, missionsQuery } = useMissionsData(taskIdParam);
  const { customDomains, setCustomDomains } = useCustomDomains();

  // Extracted logic
  const filters = useMissionFilters(tasks, missions);
  const actions = useMissionActions({ tasks, missions });

  const { focusedTask, focusedTaskMission } = useExecutionFocus(
    tasks,
    missions,
    queuedTaskId,
    ccStateQuery.data?.commands?.active?.id
  );

  const handleQueueNext = useCallback((taskId: string) => {
    setQueuedTaskId(taskId);
    const task = tasks.find((t) => t.id === taskId);
    toast.success(`Queued “${task?.title || "task"}” next in Execution Mode.`);
  }, [tasks, setQueuedTaskId]);

  const visibleTaskIds = useMemo(() => {
    const set = new Set<string>();
    if (executionModeActive) {
      if (focusedTask) set.add(focusedTask.id);
    } else {
      for (const t of filters.filteredTasks) set.add(t.id);
    }
    return set;
  }, [executionModeActive, focusedTask, filters.filteredTasks]);

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

  const stats = statsQuery.data ?? [];
  const totalLevel = stats.reduce((s: number, x: any) => s + (x.level || 0), 0);
  const totalXp = Math.round(stats.reduce((s: number, x: any) => s + (x.xp || 0), 0));
  const dailyTasks = tasks.filter((t) => t.loopKind === "DAILY" && t.status !== "DONE" && t.status !== "ARCHIVED");
  const maxStreak = dailyTasks.length > 0 ? Math.max(...dailyTasks.map((t) => (t as any).streakCount ?? 0)) : 0;

  return (
    <MissionDispatchProvider actions={actions}>
      <div className="mx-auto w-full max-w-5xl space-y-5 pb-[env(safe-area-inset-bottom,0px)]">
        {!executionModeActive && (
          <PageHeader
            eyebrow="Mastery Loop"
            title="Missions & Tasks"
            description="Deploy your focus, complete active campaigns, and level up your character sheet."
            actions={
              statsQuery.isLoading ? (
                <div className="h-8 w-32 rounded bg-zinc-900/50 animate-pulse border border-zinc-800" />
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-[var(--gold)]/20 bg-[var(--gold)]/[0.03] backdrop-blur-md px-3 py-1.5 text-xs font-mono text-[var(--gold)]/90">
                  <div className="flex items-center gap-1.5 pr-2 border-r border-[var(--gold)]/10">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Lvl</span>
                    <span className="font-bold tabular-nums text-white">{totalLevel}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-0.5 pr-2 border-r border-[var(--gold)]/10">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">XP</span>
                    <span className="font-bold tabular-nums text-white">{totalXp.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-amber-500 animate-pulse">🔥</span>
                    <span className="font-bold tabular-nums text-white">{maxStreak}d</span>
                  </div>
                </div>
              )
            }
          />
        )}

        <HiddenRiskWarning
          summary={hiddenRiskSummary}
          executionModeActive={executionModeActive}
          filterKey={filterKey}
          onClearFilters={filters.handleClearFilters}
          onExitFocusMode={() => setExecutionModeActive(false)}
          onQueueNext={handleQueueNext}
        />

        {executionModeActive ? (
          focusedTask ? (
            <ExecutionPanel
              // Remount per task: the 15s poll can swap focusedTask while an
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
              onExit={() => setExecutionModeActive(false)}
            />
          ) : (
            <div className="space-y-4 max-w-xl mx-auto py-12 text-center">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 border border-zinc-800 text-zinc-400 text-xl font-bold">✓</span>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">All Tasks Completed</h3>
                <p className="text-xs text-[var(--text-secondary)]">You have no open tasks left to execute. Great work!</p>
              </div>
              <button
                onClick={() => setExecutionModeActive(false)}
                className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Exit Focus Mode
              </button>
            </div>
          )
        ) : (
          <>
            {/* Pass the real promise — a `void` wrapper here made the modal
                clear its text + close while the create was still in flight,
                losing the capture on failure. */}
            <OmniCaptureModal onCapture={(text) => actions.handleQuickAdd(text)} />
            <NickSidePane
              page="missions"
              coachSurface="tasks"
              presets={["Which mission should I push today?", "Which mission is stalling?", "What's the next move across all my missions?", "Summarize my week so far."]}
            />
            <CoachEventBanner surface="tasks" />
            <section aria-labelledby="today-focus-heading" className="space-y-3">
              <div className="flex items-end justify-between gap-3 px-1">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--gold)]/80">
                    today · focus deck
                  </p>
                  <h2 id="today-focus-heading" className="mt-1 text-base font-semibold tracking-tight text-[var(--text-primary)]">
                    Choose the next move
                  </h2>
                </div>
                <span className="hidden text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--text-tertiary)] sm:block">
                  one clear move at a time
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <NicksMorningBrief tasks={tasks} missions={missions} />
                <TopMissionToday missions={missions} tasks={tasks} />
              </div>
            </section>

            <Suspense fallback={<div className="h-16 w-full animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/50" />}>
              <HealthGovernorStrip />
            </Suspense>

            <section aria-label="board signals" className="grid gap-3 sm:grid-cols-2">
              <MissionsHealthStrip missions={missions} tasks={tasks} />
              <MissionsRescueStrip tasks={tasks} />
            </section>

            <section aria-labelledby="capture-heading" className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                    capture
                  </p>
                  <h2 id="capture-heading" className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    Add a task or mission
                  </h2>
                </div>
                <span className="hidden text-[10px] font-mono text-[var(--text-tertiary)] sm:block">
                  keep it actionable
                </span>
              </div>
              <div className="mt-3">
                <MissionsQuickAdd onSubmit={actions.handleQuickAdd} busy={actions.submitting} />
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2 px-1" aria-label="mission actions">
              <button
                type="button"
                onClick={() => {
                  openMissionEdit(null, undefined);
                  telemetry.event("createMissionOpen", { source: "button" });
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]/90 transition-colors hover:bg-[var(--gold)]/[0.08]"
              >
                + new mission
              </button>
              <button
                type="button"
                onClick={() => {
                  setExecutionModeActive(true);
                  telemetry.event("executionModeOpen", { source: "button" });
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] text-amber-400 transition-colors hover:bg-amber-500/10"
              >
                ⚡ Execution Mode
              </button>
              <button
                type="button"
                onClick={() => filters.setShowFilters((v) => !v)}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] transition-colors",
                  filters.showFilters ? "border-amber-500/50 bg-amber-500/10 text-amber-400" : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                )}
              >
                {filters.showFilters ? "✕ Close Filters" : "⚙️ Filters"}
              </button>
              <span className="text-[10px] font-mono text-[var(--text-tertiary)]/70">
                or type <code className="px-1 rounded bg-[var(--bg-raised)]/10 text-[var(--text-tertiary)]">create mission &lt;name&gt;</code> above
              </span>
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
              <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
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

            <section aria-labelledby="mission-board-heading" className="space-y-3">
              <div className="flex items-end justify-between gap-3 px-1">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                    execution board
                  </p>
                  <h2 id="mission-board-heading" className="mt-1 text-base font-semibold tracking-tight text-[var(--text-primary)]">
                    Active campaigns
                  </h2>
                </div>
                <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                  {filters.filteredTasks.length} visible tasks
                </span>
              </div>
              {/* Unknown-is-not-empty (2026-08-19): a failed task/mission
                  read used to fall through to <EmptyMissions /> — a dead
                  fetch rendered as a cleared board. */}
              {(tasksQuery.isError || missionsQuery.isError) ? (
                <div className="p-6 rounded-xl border border-dashed border-rose-500/30 bg-rose-500/[0.04] text-center">
                  <p className="text-[11px] font-mono uppercase tracking-widest text-rose-300/80">
                    Board unreadable — reads failed. State unknown, not empty.
                  </p>
                </div>
              ) : (
                <MissionFeed
                  missions={filters.filteredMissions}
                  tasks={filters.filteredTasks}
                  autonomicHealth={healthQuery.data?.autonomic}
                />
              )}
            </section>
          </>
        )}

        <MissionModalsManager missions={missions} />
      </div>
    </MissionDispatchProvider>
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
