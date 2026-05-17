"use client";

/**
 * NowPanel · the NOW-mode body of /tasks.
 *
 * Extracted from app/(mastery)/tasks/page.tsx (v10.0.529.16) as the
 * symmetric companion to v10.0.529.15's ProjectsPanel extraction. NOW
 * mode is the operator's daily driver — quick-add, the loop stream,
 * the done drawer, and the goal/project edit sheets all live here.
 *
 * Pre-extraction the `nowContent` JSX fragment + its associated NOW-
 * only state (8 vars + the `useCustomDomains` hook call) lived inside
 * TasksPage. Now they live where they're consumed. The parent still
 * owns everything that crosses modes: tasks/projects/goalsCache,
 * filter state (per brief directive: kindFilter/domainFilter/
 * searchQuery/sortKey stay in parent so PLAN/TRACK/LEARN/REVIEW
 * surfaces can read them if they ever need to), pinnedIds (shared
 * with ReviewWizard), expandedProject (deep-link target from PLAN's
 * goal cards), activeMode, wizardOpen, brain, newTask/voice/
 * generating (used by parent's addTask + genAi), aiTasks (used by
 * parent's genAi + adoptAi), and all the derived stats.
 *
 * Design notes ·
 *   · Panel owns: showDone (DoneDrawer expansion) · focusMode
 *     (NowOperatorBar + LoopStream DOING-only filter) · showFilters
 *     (NowOperatorBar + TaskFilters) · filterEditMode + addingDomain
 *     + newDomainInput (TaskFilters local UI state). The
 *     editingGoalForTaskId + editingProjectForTaskId pair (the two
 *     TaskEditSheet IIFEs · ~60 LOC of duplicated JSX) lifted into
 *     <useTaskEditModal> at v10.0.529.17 · LoopStream wires its row
 *     buttons to the hook's `openGoalEdit`/`openProjectEdit` and the
 *     panel just renders the hook's `modalElement` once at the tail.
 *     Also calls `useCustomDomains` here so the panel + the nested
 *     LoopStream stay in sync via the hook's synthetic StorageEvent
 *     (v10.0.529.13 contract).
 *   · Parent still owns: tasks (shared with ProjectsPanel +
 *     ReviewWizard), projects (shared with ProjectsPanel +
 *     ReviewWizard), goalsCache (shared with ProjectsPanel +
 *     ReviewWizard + LinkGoalPicker), goalLineage (precomputed in
 *     parent · LoopStream-only consumer · cheaper to thread than
 *     to recompute here), pinnedIds + sortKey + kindFilter +
 *     domainFilter + searchQuery (parent-owned per brief), brain
 *     + reviewSet + activeDomains + smartHeadline + doneSpark +
 *     doneGroups + waiting + done + active + doing + doneToday +
 *     overdue + onceCount + dailyCount + promiseCount + time bits
 *     (all derived from `tasks` in the parent · re-computing here
 *     would duplicate the work).
 *   · `onReload` is the single refresh callback boundary back to
 *     the parent. WaitingBand + TaskEditSheets + LoopStream all
 *     route through it. The parent's `load()` is the right thing
 *     to pass — it re-fetches tasks + missions + goals in one
 *     Promise.all, which keeps the panel's optimistic state in
 *     sync with everything else on the page.
 *   · No `React.memo` here — NowPanel re-renders precisely when
 *     `tasks` or any derived stat changes, which IS the time we
 *     want it to render. Memoizing would force shallow-equality
 *     work that always fails (Set/Map props swap on every parent
 *     reload).
 *   · Visual + behavior contract: 100% IDENTICAL to the pre-
 *     extraction inline JSX. No aesthetic shifts, no UX shifts.
 *     Only owner identity shifts.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCustomDomains } from "@/hooks/use-custom-domains";
import { useTaskEditModal } from "@/hooks/use-task-edit-modal";
import { LoopStream, type TaskSortKey } from "@/components/actions/loop-stream";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { ActiveFiltersStrip } from "@/components/ui/filter-chip-bar";
import { NowOperatorBar } from "@/components/actions/now-operator-bar";
import { NextMoveCard } from "@/components/actions/next-move-card";
import { QuickAddBar } from "@/components/actions/quick-add-bar";
import { TaskFilters } from "@/components/actions/task-filters";
import { AiSuggestionsBand, type AiTask } from "@/components/actions/ai-suggestions-band";
import { DoneDrawer } from "@/components/actions/done-drawer";
import { WaitingBand } from "@/components/actions/waiting-band";
import {
  daysSince as ds,
  type Task,
  type LoopKind,
  type Project,
  type GoalCacheEntry,
  type GoalLineageEntry,
} from "@/components/actions/shared";
import type { useVoiceInput } from "@/hooks/use-voice-input";

type KindFilter = "all" | LoopKind;

type VoiceController = ReturnType<typeof useVoiceInput>;

interface BrainContext {
  insights?: Array<{ text?: string }>;
  dailyFocus?: string;
  /** v10.0.274 · 8-axis self-model overall (0-100) */
  maturity?: number | null;
  /** v10.0.274 · weakest axis name when below 40 · null otherwise */
  weakAxis?: string | null;
}

/**
 * v10.0.529.16 · GoalLineageEntry imported from shared.ts as the
 * single source of truth · was redeclared here + in loop-stream.tsx
 * + in page.tsx before the reviewer flagged the drift risk.
 *
 * v10.0.529.18 · DomainAgg + DoneGroups types removed · both
 * shapes are derived internally now (no cross-component contract).
 */

export interface NowPanelProps {
  // ── Data feed (parent owns · cross-mode) ──
  tasks: Task[];
  aiTasks: AiTask[];
  projects: Project[];
  goalsCache: GoalCacheEntry[];
  goalLineage: Map<string, GoalLineageEntry>;
  pinnedIds: Set<string>;
  isDrifting: boolean;
  brain: BrainContext | null;

  // ── Quick-add wiring (parent owns the input state + voice hook
  //    + the genAi + addTask handlers) ──
  newTask: string;
  setNewTask: (v: string | ((prev: string) => string)) => void;
  voice: VoiceController;
  generating: boolean;
  onAddTask: () => void;
  onGenAi: () => void;

  // ── AI suggestions adoption ──
  onAdoptAi: (t: AiTask) => Promise<void> | void;
  onAdoptAllAi: () => Promise<void> | void;

  // ── Filter state (parent-owned per brief directive · panel reads
  //    + threads them through TaskFilters + LoopStream + ActiveFiltersStrip) ──
  kindFilter: KindFilter;
  setKindFilter: (k: KindFilter) => void;
  domainFilter: string | null;
  setDomainFilter: (d: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  sortKey: TaskSortKey;
  setSortKey: (k: TaskSortKey) => void;

  // ── Derived stats (parent computes from `tasks` · panel renders) ──
  // v10.0.529.18 · `smartHeadline` / `doneSpark` / `activeDomains` /
  // `doneGroups` are derived internally now · they were display
  // concerns of NOW-mode being recomputed on every parent tick.
  reviewSet: Task[];
  active: Task[];
  doing: number;
  doneToday: number;
  overdue: number;
  onceCount: number;
  dailyCount: number;
  promiseCount: number;
  done: Task[];
  waiting: Task[];
  // Time bits · parent snapshots `new Date().getHours()` once per
  // render to avoid hydration mismatch · panel only reads the
  // already-derived display pieces.
  isAfternoon: boolean;
  hour12: number;
  ampm: string;

  // ── Wizard handoff (parent owns wizardOpen state · panel only
  //    fires setWizardOpen via NowOperatorBar). projects count is
  //    just for the footer "N projects" line. ──
  setWizardOpen: (open: boolean) => void;
  projectsCount: number;

  // ── LoopStream + parent-action callbacks · signatures match the
  //    LoopStream prop contract exactly so we can pass-through. ──
  onComplete: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onStart: (id: string) => void | Promise<void>;
  onPin: (id: string) => void;
  onBreakPromise: (id: string, reason: string) => void | Promise<void>;
  /** Single refresh boundary — parent's `load()`. Used by LoopStream
   *  review actions, WaitingBand unblock, and the TaskEditSheet
   *  pickers after a successful link/unlink. */
  onReload: () => Promise<void> | void;
}

export function NowPanel({
  tasks,
  aiTasks,
  projects,
  goalsCache,
  goalLineage,
  pinnedIds,
  isDrifting,
  brain,
  newTask,
  setNewTask,
  voice,
  generating,
  onAddTask,
  onGenAi,
  onAdoptAi,
  onAdoptAllAi,
  kindFilter,
  setKindFilter,
  domainFilter,
  setDomainFilter,
  searchQuery,
  setSearchQuery,
  sortKey,
  setSortKey,
  reviewSet,
  active,
  doing,
  doneToday,
  overdue,
  onceCount,
  dailyCount,
  promiseCount,
  done,
  waiting,
  isAfternoon,
  hour12,
  ampm,
  setWizardOpen,
  projectsCount,
  onComplete,
  onDelete,
  onStart,
  onPin,
  onBreakPromise,
  onReload,
}: NowPanelProps) {
  // ── State owned by this panel ──
  // None of these are read by PLAN / TRACK / LEARN / REVIEW modes,
  // so they live here. Mode-switch keystrokes in the filter input
  // or expand/collapse of the DoneDrawer no longer tick parent
  // state · the parent only re-renders when tasks / projects /
  // goalsCache or any derived stat actually changes.
  const [showDone, setShowDone] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterEditMode, setFilterEditMode] = useState(false);
  const [addingDomain, setAddingDomain] = useState(false);
  const [newDomainInput, setNewDomainInput] = useState("");
  // v10.0.529.17 · GOAL-EDIT + PROJECT-EDIT modal lifecycle (two
  // editing*ForTaskId useState cells + the TaskEditSheet IIFEs that
  // consumed them · ~60 LOC of near-identical JSX) collapsed into
  // <useTaskEditModal>. The hook owns the two cells + returns
  // `openGoalEdit`/`openProjectEdit` for LoopStream's row buttons to
  // call + a single `modalElement` we render once at the panel tail.
  const { openGoalEdit, openProjectEdit, modalElement: taskEditModal } =
    useTaskEditModal({ tasks, projects, goalsCache, onReload });
  // v10.0.529.13 · extracted hydrate + persist into `useCustomDomains`
  // hook so `loop-stream.tsx` can share the same source of truth
  // (cross-component sync via a synthetic StorageEvent). LoopStream
  // is rendered inside this panel, so calling the hook here keeps
  // both instances in sync via the storage event the hook fires.
  const { customDomains, setCustomDomains } = useCustomDomains();

  // v10.0.429 · explicit sort key for the loop stream persists to
  // localStorage so operator's preference survives reloads. Parent
  // owns sortKey state (per brief) · panel mirrors persistence in
  // a local effect so the contract stays where the UI lives.
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("tasks:sortKey", sortKey);
  }, [sortKey]);

  // ── NOW-mode derived display ──
  // v10.0.529.18 · these four derivations moved here from page.tsx
  // because they're consumed only by NOW-mode children. Page-level
  // re-renders triggered by filter ticks / drift state / edit sheets
  // no longer walk these inputs · each memo fires on its own minimal
  // slice. doneGroups in particular was an unmemoized IIFE before.

  // v10.0.529.82 · Wave 26 · B2 · stuck DOING detector. Tasks with
  // startedAt > 2h ago are stalled · the operator gets a chip prompt
  // to reframe or break them down. Data was already captured · this
  // is the read-side surface.
  const stuckDoing = useMemo(() => {
    const now = Date.now();
    return active.filter((t) => {
      if (t.status !== "DOING" || !t.startedAt) return false;
      const startedMs = new Date(t.startedAt).getTime();
      const hoursSince = (now - startedMs) / 3_600_000;
      return hoursSince > 2;
    });
  }, [active]);

  // Smart contextual headline — time + performance + energy aware so
  // it never reads the same two visits in a row.
  const smartHeadline = useMemo(() => {
    // v10.0.529.82 · Wave 26 · C1 · energy-aware headline. Adds late-
    //   day branch when heavy tasks are still open — operator gets
    //   "wrong time for them" prompt instead of generic "evening push".
    //   v10.0.529.73 · Wave 19 vocab pass · simpler, more direct English ·
    //   dropped "loops" (jargon) · "kill" → "drop" (less hostile) ·
    //   "high-leverage" → "biggest wins" (plain) · all-lowercase to match
    //   the editorial contract used by /system + /settings + /chat copy.
    const h = new Date().getHours();
    const total = active.length + doneToday;
    const pct = total > 0 ? Math.round((doneToday / total) * 100) : 0;
    const heavyOpen = active.filter((t) => t.energyRequired === "HIGH").length;

    if (pct >= 100) return "everything closed · clean slate";
    if (pct >= 80) return "almost done · close it out";
    if (overdue >= 3 && h >= 18)
      return `${overdue} overdue · do them or drop them`;
    if (overdue >= 3) return `${overdue} stacking up · start with the oldest`;
    if (doneToday >= 5) return `${doneToday} done · momentum is real`;
    // v26 · C1 · evening + heavy-task overflow signal
    if (heavyOpen >= 2 && h >= 17)
      return `${heavyOpen} heavy tasks open · wrong time for them · save for morning?`;
    if (doneToday > 0 && h >= 18)
      return `${doneToday} down · ${active.length} open · wind down or sprint?`;
    if (doneToday > 0) return `${doneToday} done · ${active.length} to go`;
    if (h >= 20) return `${active.length} open · pick one tonight or plan tomorrow`;
    if (h >= 17) return `${active.length} open · evening push or tomorrow's setup?`;
    if (h >= 12) return `${active.length} open · afternoon — biggest wins only`;
    if (h >= 6) return `${active.length} open · first move wins the day`;
    return `${active.length} open · night owl mode`;
  }, [active.length, doneToday, overdue]);

  // 14-day done sparkline · feeds NowOperatorBar. Walks all `done`
  // rows (subset of tasks) and buckets by day-bucket index 0-13.
  const doneSpark = useMemo(() => {
    const buckets: number[] = new Array(14).fill(0);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (const t of done) {
      const when = t.updatedAt || t.lastTouchedAt;
      if (!when) continue;
      const d = new Date(when);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const daysAgo = Math.round((todayStart.getTime() - dayStart.getTime()) / 86_400_000);
      if (daysAgo >= 0 && daysAgo < 14) buckets[13 - daysAgo]++;
    }
    return buckets;
  }, [done]);

  // Unique domains across active loops · feeds TaskFilters chip row.
  // Sorted by count desc so the most-used domain comes first.
  const activeDomains = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of active) {
      const d = t.mission?.domain?.toLowerCase() || "other";
      counts[d] = (counts[d] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [active]);

  // Group done tasks for the drawer · today / yesterday / this week
  // / older. Pre-v10.0.529.18 this was an unmemoized IIFE in page.tsx
  // walking `done[]` every render.
  const doneGroups = useMemo(() => {
    const today: Task[] = [];
    const yest: Task[] = [];
    const week: Task[] = [];
    const older: Task[] = [];
    for (const t of done) {
      const d = ds(t.updatedAt || t.lastTouchedAt);
      if (d === 0) today.push(t);
      else if (d === 1) yest.push(t);
      else if (d <= 7) week.push(t);
      else older.push(t);
    }
    return { today, yest, week, older };
  }, [done]);

  // ── Render ──
  return (
    <div className="space-y-3">

      {/* v10.0.529.80 · Wave 24 · #4 · NextMoveCard · finds the
          operator's weakest mastery axis + suggests 3 candidate moves
          (existing inbox tasks tagged with that domain · pattern
          threads · or a create-daily prompt). Sits ABOVE the operator
          bar so it answers "where do I aim today?" before the smart
          headline ever fires. Auto-hides when no mastery data yet. */}
      <NextMoveCard />

      {/* ═══ OPERATOR BAR ═══
          Replaces the old "CommandDeck" dashboard that Nour called
          "dumb and generic." Every pixel above the NEXT MOVE hero
          must earn its place. This bar has exactly 3 things:
            1. Smart headline — time + performance aware, never generic
            2. Quick-add input — the #1 action on the page
            3. Filters — behind a toggle so they don't clutter */}
      <div className="space-y-2">
        {/* ── Header row · extracted to <NowOperatorBar /> in v10.0.311
            as Stage A of the deferred nowContent extraction. Component
            owns smart headline + weak-axis pulse + status counters
            (open/done/overdue/sparkline/DOING focus chip) + filter
            toggle + refresh button. ~130 LOC of inline JSX → 1 typed
            component call below. */}
        <NowOperatorBar
          smartHeadline={smartHeadline}
          stuckDoing={stuckDoing}
          reviewSet={reviewSet}
          setWizardOpen={setWizardOpen}
          brain={brain}
          active={active}
          doneToday={doneToday}
          isAfternoon={isAfternoon}
          hour12={hour12}
          ampm={ampm}
          overdue={overdue}
          doneSpark={doneSpark}
          doing={doing}
          focusMode={focusMode}
          setFocusMode={setFocusMode}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          load={onReload}
        />

        {/* ── Quick-add — always visible, the primary action ──
            v10.0.325 · Stage B.1 of /tasks decomposition · ~130 LOC of
            inline JSX → `<QuickAddBar>` component call. quickAddParsed
            useMemo moved INSIDE the component since it only depends on
            newTask. May 02 v10.0.145 drift-gate behavior preserved · the
            input is always visible regardless of drift state. */}
        <QuickAddBar
          newTask={newTask}
          setNewTask={setNewTask}
          voice={voice}
          onAdd={onAddTask}
          onGenAi={onGenAi}
          generating={generating}
        />

        {/* ── Filters — v10.0.326 · Stage B.2 of /tasks decomposition ·
            ~295 LOC of inline JSX (expanded panel + collapsed-state
            indicator chips) → 1 typed component call. Filter state
            stays in the parent (drives the active filtered list);
            TaskFilters owns just the UI rendering + setter wiring. */}
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
          activeCount={active.length}
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

        {/* v10.0.328 · Stage C.2 · AiSuggestionsBand · ~44 LOC inline
            JSX (header + per-row priority chip + adopt buttons) → 1
            typed component call. Drift-gate behavior preserved (v10.0.145). */}
        <AiSuggestionsBand
          tasks={aiTasks}
          onAdopt={onAdoptAi}
          onAdoptAll={async () => {
            await onAdoptAllAi();
            toast.success("Added new tasks");
          }}
        />
      </div>

      {/* v10.0.436 · refactored to shared SortDropdown · same 9 modes ·
          consistent with /brain/wisdom + /system/skills */}
      <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
        <ActiveFiltersStrip
          filters={[
            ...(searchQuery.trim() ? [{ label: `search · "${searchQuery.trim().slice(0, 20)}"`, onRemove: () => setSearchQuery("") }] : []),
            ...(kindFilter !== "all" ? [{ label: `kind · ${kindFilter}`, onRemove: () => setKindFilter("all") }] : []),
            ...(domainFilter ? [{ label: `domain · ${domainFilter}`, onRemove: () => setDomainFilter(null) }] : []),
            ...(sortKey !== "urgency" ? [{ label: `sort · ${sortKey}`, onRemove: () => setSortKey("urgency") }] : []),
          ]}
          onClearAll={() => { setSearchQuery(""); setKindFilter("all"); setDomainFilter(null); setSortKey("urgency"); }}
        />
        <SortDropdown<TaskSortKey>
          value={sortKey}
          onChange={setSortKey}
          defaultValue="urgency"
          ariaLabel="Sort tasks"
          options={[
            { value: "urgency", label: "urgency · default" },
            { value: "title-asc", label: "title · A→Z" },
            { value: "title-desc", label: "title · Z→A" },
            { value: "due-soonest", label: "due · soonest" },
            { value: "due-latest", label: "due · latest" },
            { value: "created-newest", label: "created · newest" },
            { value: "created-oldest", label: "created · oldest" },
            { value: "effort-shortest", label: "effort · shortest" },
            { value: "effort-longest", label: "effort · longest" },
          ]}
        />
      </div>

      {/* ═══ LOOP STREAM — the one unified list ═══ */}
      <LoopStream
        // Apr 26 · F12 — focus mode hides everything except DOING.
        tasks={focusMode ? active.filter((t) => t.status === "DOING") : active}
        onComplete={onComplete}
        onDelete={onDelete}
        onStart={onStart}
        onPin={onPin}
        onBreakPromise={onBreakPromise}
        pinnedIds={pinnedIds}
        kindFilter={kindFilter}
        domainFilter={domainFilter}
        searchQuery={searchQuery}
        sortKey={sortKey}
        goalLineage={goalLineage}
        onReviewChange={onReload}
        onEditTaskGoal={openGoalEdit}
        onEditTaskMission={openProjectEdit}
      />

      {/* v10.0.529.17 · GOAL-EDIT + PROJECT-EDIT modal pair (twin
          TaskEditSheet IIFEs · ~60 LOC) collapsed into
          <useTaskEditModal>. The hook returns a single `modalElement`
          fragment that renders whichever sheet is open · null when
          neither is. Visual + behavior contract unchanged. */}
      {taskEditModal}

      {/* Apr 26 · F3 — WAITING band. Tasks parked behind a blocker
          stay visible-but-quiet under the main stream. Tap "unblock"
          to flip them back to READY. Hidden when no waiting tasks. */}
      {!focusMode && <WaitingBand tasks={waiting} onChange={onReload} />}

      {/* Projects block lives in PLAN mode (projectsContent). */}

      {/* ═══ DONE drawer · v10.0.329 · Stage C.3 · ~70 LOC inline JSX
          (header button + grouped list + per-row trash) → 1 typed
          component call. Drift-gate stays here so the drawer
          hides when isDrifting. */}
      <DoneDrawer
        visible={!isDrifting && done.length > 0}
        showDone={showDone}
        onToggle={() => setShowDone(!showDone)}
        doneGroups={doneGroups}
        onDelete={onDelete}
      />

      <p className="text-[8px] text-zinc-800 text-center">
        Auto-refreshes every 60s · {projectsCount} projects
      </p>
    </div>
  );
}
