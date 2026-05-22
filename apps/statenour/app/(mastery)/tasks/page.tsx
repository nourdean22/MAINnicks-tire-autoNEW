"use client";

// Phase B follow-up · 2026-05-18 PM · second attempt at the
// useSearchParams() prerender fix. First attempt added
// `export const dynamic = "force-dynamic"` to this page · that does
// NOT take effect on "use client" pages (route segment config is
// only honored by Server Components). Railway Agent caught it after
// the build kept failing identically.
//
// Real fix: wrap TasksPageInner in <Suspense> from the exported
// outer TasksPage component. The Suspense boundary lets Next.js
// build the page shell statically while useSearchParams() resolves
// at runtime · which is what we want for an authenticated client
// page that needs ?goalId= from the URL.
//
// See ADR-0014 (Railway recovery) for the full multi-layer
// diagnosis chain.

/**
 * Actions page · /tasks
 *
 * The execution surface — today's loops + the context bands around
 * them. Renders <NowPanel> directly (the daily LoopStream).
 *
 * History · this page used to host the KommandoShell tab system
 * (NOW · PLAN · TRACK). 2026-05-21 the shell was dismantled: TRACK
 * was distributed to /scoreboard + /learn (Phase 1), the PLAN goal-
 * authoring surface was relocated to /goals as <GoalBoard> (Phase 2),
 * and the shell itself was deleted (Phase 3). /tasks is now a single
 * NOW surface — no tabs, no mode state.
 *
 * Owns the page-level data feed (tasks · projects · goalsCache ·
 * brain) + execution state (filters · pinnedIds · wizard). Goal ↔
 * project ↔ task lineage still derives via useGoalProjectBridge —
 * `goalLineage` feeds LoopStream's cross-goal urgency bump.
 *
 * Each task row carries a `loopKind` field (ONCE | DAILY | PROMISE)
 * that drives streak / promise / one-shot behavior in LoopStream.
 *
 * Endpoints feeding this page: /api/tasks · /api/missions ·
 * /api/goals · /api/actions-brain · /api/ai/tasks.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { logger as rootLogger } from "@/lib/logger";

// `log` is a structured logger — but on the client (this file) it
// only writes to the browser console; it does NOT reach /system/logs.
// For operator-visible failure telemetry use reportClientError()
// (imported below) — it posts to /api/errors → /system/logs.
const log = rootLogger.withSurface("tasks/page");
import { toast } from "sonner";
// v10.0.529.15 · Button / Input / cn / Loader2 / Brain dropped here ·
// they lived inside the projectsContent fragment, now in <ProjectsPanel>.
// v10.0.529.16 · the NOW-mode imports all moved into <NowPanel>:
// ProjectDetail / project-momentum helpers / suggestGoalsForProject /
// Sparkline / AnimatedCounter / NowOperatorBar / QuickAddBar / TaskFilters /
// TaskEditSheet / AiSuggestionsBand / DoneDrawer / Link*Picker / LoopStream /
// SortDropdown / ActiveFiltersStrip / WaitingBand / useCustomDomains / ageLabel / domainClass.
import { useVoiceInput } from "@/hooks/use-voice-input";
// MitContract removed Apr 15 — Nour asked for it out. The "one
// thing that matters today" concept is still alive via the
// Review mode's "today's MIT" field in the morning brief and
// via the LoopStream's NEXT MOVE hero card, which always picks
// the top-ranked loop to do next. If he ever wants a sticky MIT
// back, re-import from @/components/actions/mit-contract.
// v10.0.529.17 · computePace import removed · goalLineage useMemo (the
// only consumer here) lifted into useGoalProjectBridge alongside the
// other two derived maps. The hook now owns the pace-aware compute.
import { type TaskSortKey } from "@/components/actions/loop-stream";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
// v10.0.529.xx · client-error telemetry · routes swallowed catch-block
// failures to /api/errors → /system/logs. lib/logger is console-only
// on the client, so log.error() here never reached the operator.
import { reportClientError } from "@/components/ui/client-error-telemetry";
// KommandoShell dismantle · Phase 3 (2026-05-21) · <ProjectsPanel> was
// the PLAN-tab Missions block · removed with the shell, and the
// projects-panel.tsx file was deleted in the 2026-05-21 dead-code
// sweep. Mission-create now lives on /goals (GoalBoard's "Plan it" →
// MilestonesFlow).
import { NowPanel } from "@/components/actions/now-panel";
// IntelPanel (2026-05-21) · the "powerful underneath" disclosure that
// folds the six intel/reflection widgets below the execution surface ·
// see its docstring for the simple-on-top rationale.
import { IntelPanel } from "@/components/actions/intel-panel";
import { type AiTask } from "@/components/actions/ai-suggestions-band";
import { ActionsContextBand } from "@/components/actions/actions-context-band";
// TRACK consolidation (2026-05-21) · Nick's time-of-day brief · rehomed
// here from the deleted /tasks TRACK tab — a "what to do right now"
// surface belongs on the execute page. Self-collapses when empty.
import { DailyBriefSection } from "@/components/actions/daily-brief-section";
import { TodaysCompound } from "@/components/actions/todays-compound";
// Phase E (2026-05-18 PM) · OperatorPulse · forward-looking intelligence
// strip · "right now the move is X · pace is Y · drift is Z". Pairs with
// TodaysCompound (backward-looking) above the work surface. ONE component
// shared with /goals + /scoreboard + / home · the intelligence overlay
// the three surfaces were missing post-Phase-D.
import { OperatorPulse } from "@/components/operator/operator-pulse";
// v10.0.529.99 · Tasks-page Elon+Ilya move · mount the existing
// NickSuggestions chip strip at the top of /tasks so Nick's curated
// next-action chip surfaces in the same context as the task list.
// Tap navigates to /chat?q=... (the standalone fallback path) ·
// dismiss-X + tap both fire the supervised-signal loop captured by
// the e9fe26b3 + 0dda5695 + b41022a9 chain. Second-surface coverage
// of the same Nick aggregator.
import { NickSuggestions } from "@/components/chat/nick-suggestions";
// Phase G (2026-05-18 PM) · CompoundChain · the see-your-work-compound
// visualization. task → goal → axis → scoreboard chain · grouped by
// axis · reads like prose ("Today · 3 tasks compounded · Business
// ↑0.3 · 2 goals lifted").
import { CompoundChain } from "@/components/operator/compound-chain";
import { useGoalProjectBridge } from "@/hooks/use-goal-project-bridge";
import { useTaskDerivedState } from "@/hooks/use-task-derived-state";
import { useOncePerSession } from "@/hooks/use-once-per-session";
// v10.0.529.17 · PlanLinkedProjectChip + GoalLineageEntry no longer
// referenced at this top level · the two maps + the lineage entry shape
// are owned by useGoalProjectBridge now. The hook re-exports nothing —
// page.tsx only consumes via destructure so the type info stays internal.
// v10.0.29 — ReviewSheet was replaced by ReviewWizard but the
// import + render call were left behind. setReviewOpen(true) is
// never called anywhere; the sheet was dead UI. Removed.
import { ReviewWizard } from "@/components/actions/review-wizard";
import { useNourState } from "@/lib/state/nour-state";
import { notifyDataChanged, onDataChanged } from "@/lib/events/data-change";
import {
  type Task,
  type LoopKind,
  type Project,
  type GoalCacheEntry,
} from "@/components/actions/shared";
import { parseQuickAdd } from "@/lib/loops/quick-add-parser";

// Phase SS.4 (2026-05-19 AM) · authedFetch removed · /tasks page is
// now 100% on tRPC across all reads + mutations. The page-local
// load() function keeps its scheduling logic (debounced reload ·
// visibility-change · interval · event-bus · AbortSignal) but the
// fetch sites all flow through trpc utils/mutations.
import { trpc } from "@/lib/trpc/client";
// Phase SS.1 (2026-05-19 AM) · createTask helper replaced by
// trpc.task.create mutation · the legacy `@/lib/services/client/tasks`
// helper stays in place for other pages (project-detail, plan-spawn)
// that haven't migrated yet. This page now uses the typed mutation
// directly.
// v10.0.424 · debounced reload · coalesces 5 reload triggers into 1.
import { useDebouncedReload } from "@/hooks/use-debounced-reload";
type KindFilter = "all" | LoopKind;

// AiTask interface lives in @/components/actions/ai-suggestions-band so
// the band can stay self-typed · imported above with a `type` modifier.

// v10.0.529.15 · Project + GoalCacheEntry types moved to shared.ts
// so page.tsx + projects-panel + ProjectCard all import the same
// definition. Eliminates the manual-mirror drift risk the reviewer
// flagged. Imports threaded next to the existing shared imports.

// v10.0.423 · `Goal` interface DELETED · merged into GoalCacheEntry below
// (single source of truth for goal data on this page). Pace fields now
// live in the cache shape · paceKind computed in goalLineage useMemo.

// v10.0.529.15 · `PlanQuestion` local type moved into <ProjectsPanel>
// along with the clarify-questions state it described.

// ─── Page ──────────────────────────────────────────────

// Outer page · Suspense boundary required because the inner
// component calls useSearchParams() (Phase B's ?goalId= filter).
// Per Next.js 16 docs, useSearchParams in a client component MUST
// be wrapped in <Suspense> for static prerender to succeed.
export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksPageInner />
    </Suspense>
  );
}

function TasksPageInner() {
  const nourState = useNourState();
  // v10.0.529.17 · `driftOverride` was aspirational dead state ·
  // pre-fix it lived as `useState(false)` with a `setDriftOverride`
  // setter that was destructured but never called anywhere. The
  // intended feature ("snooze drift mode" button) never landed. Drift
  // state is now a pure read off `useNourState`. If the snooze UX is
  // ever resurrected, lift it back into a local state cell + wire a
  // visible toggle — don't reintroduce silent dead code.
  const isDrifting = nourState.currentState === "drift";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [aiTasks, setAiTasks] = useState<AiTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  // v10.0.423 · `goals` state DELETED · was a parallel store of /api/goals
  // alongside `goalsCache`. Both fetched the same data. goalsCache now
  // carries the pace fields too (targetValue + deadline + createdAt) so
  // the goalLineage useMemo can compute paceKind without a second store.
  // Net: 1 fewer state, 1 fewer fetch, ~45 fewer lines.
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [newTask, setNewTask] = useState("");
  // Apr 26 · F9 — voice input on quick-add. Tap mic to record, tap
  // again to stop + transcribe via Whisper. Transcript appends to
  // any existing text in the input so Nour can dictate then refine.
  // Continuous mode (long-press, see haptic in chat composer) is
  // not enabled here — quick-add tasks rarely need rapid-fire dictation.
  const voice = useVoiceInput(
    (text) => setNewTask((prev) => (prev ? `${prev.trim()} ${text}` : text)),
    () => {
      /* no auto-send on the tasks page — user reviews + taps + */
    }
  );
  // v10.0.529.16 · editingGoalForTaskId + editingProjectForTaskId lifted
  // into <NowPanel> with the TaskEditSheet IIFEs they drive.
  // Apr 20 bridge · page-level cache of goal rows · feeds the goal↔
  // project bridge (goalLineage → LoopStream urgency bump) + the
  // LinkGoalPicker (full row shape with horizon/domain). v10.0.529.15 ·
  // GoalCacheEntry type lives in shared.ts.
  const [goalsCache, setGoalsCache] = useState<GoalCacheEntry[]>([]);
  // v10.0.529.17 · goalTitles useMemo lifted into useGoalProjectBridge
  // alongside the other two derived maps. See the bridge destructure
  // further down where `tasks` + `projects` are first in scope.

  // v10.0.423 · loadGoalsCache + standalone useEffect REMOVED · the
  // load() pass below is the single /api/goals fetch.
  // v10.0.529.16 · `lastRefresh` state dropped — set but never read.
  // v10.0.529.16 · showDone lifted into <NowPanel> (NOW-only).
  // KommandoShell dismantle · Phase 3 (2026-05-21) · `newProjectTitle`
  // dropped — it only seeded the PLAN-tab project-create form (via the
  // removed handlePlanGoal). Mission-create now lives on /goals.
  // Filter state lives here · NowPanel reads it · one source of truth
  // instead of poking at NowPanel internals.
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // v10.0.429 · explicit sort key for the loop stream. Default is
  // "urgency" (auto-priority + goal-pace bump · the historical
  // behavior). v10.0.529.16 · localStorage persistence effect lives
  // inside <NowPanel> alongside the SortDropdown that owns it.
  const [sortKey, setSortKey] = useState<TaskSortKey>(() => {
    if (typeof window === "undefined") return "urgency";
    const saved = localStorage.getItem("tasks:sortKey");
    const valid: TaskSortKey[] = [
      "urgency", "title-asc", "title-desc",
      "due-soonest", "due-latest",
      "created-newest", "created-oldest",
      "effort-shortest", "effort-longest",
    ];
    return saved && valid.includes(saved as TaskSortKey) ? (saved as TaskSortKey) : "urgency";
  });
  // v10.0.529.16 · useCustomDomains hook + filterEditMode + addingDomain
  // + newDomainInput + showFilters + focusMode all lifted into <NowPanel>
  // (NOW-only UI state). LoopStream's own useCustomDomains call still
  // syncs via the hook's synthetic StorageEvent contract.
  // KommandoShell dismantle · Phase 3 (2026-05-21) · `activeMode` state
  // dropped — it gated the 60s poll to the NOW/PLAN tabs. With the
  // shell gone /tasks is a single NOW surface, so the poll just runs
  // unconditionally below.
  // Brain focus snapshot from /api/actions-brain — shape is loose
  // because the endpoint composes multiple upstream sources; we only
  // read `insights[0].text` and `dailyFocus` from it.
  const [brain, setBrain] = useState<{
    insights?: Array<{ text?: string }>;
    dailyFocus?: string;
    /** v10.0.274 · 8-axis self-model overall (0-100) */
    maturity?: number | null;
    /** v10.0.274 · weakest axis name when below 40 · null otherwise */
    weakAxis?: string | null;
  } | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("pinned_actions") || "[]"));
    } catch {
      return new Set();
    }
  });

  // ── Load ─────────────────────────────────────────────

  // Phase B (2026-05-18) · /goals → /tasks?goalId=X cross-link.
  // Read URL params · forward to /api/tasks fetch · banner shows
  // active filter with X-to-clear. Surgical augmentation · no
  // refactor of the 1181-LOC core.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filterGoalId = searchParams?.get("goalId") ?? null;
  const filterMissionId = searchParams?.get("missionId") ?? null;
  const taskFetchUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (filterGoalId) params.set("goalId", filterGoalId);
    if (filterMissionId) params.set("missionId", filterMissionId);
    return params.toString() ? `/api/tasks?${params}` : "/api/tasks";
  }, [filterGoalId, filterMissionId]);
  const clearFilter = useCallback(() => {
    router.push(pathname ?? "/tasks");
  }, [router, pathname]);

  // Phase PP (2026-05-19 AM) · tRPC migration · imperative-fetch via
  // utils inside the existing load() function (JJ/MM pattern). The
  // page already has its own scheduling discipline (debounced reload ·
  // visibility-change · interval · event-bus · AbortSignal) so we
  // KEEP load() intact and only swap the 4 authedFetch sites for
  // typed `utils.task.X.fetch()` calls.
  const utils = trpc.useUtils();

  // Phase RR (2026-05-19 AM) · tRPC migration · 4 task-write mutations
  // (check · start · breakPromise · delete). Each carries the same
  // server-side effects (TaskEvent emit · brain-bus · auto-learn ·
  // skill-reinforce · reality-gap writeback) since they delegate to
  // the same lib/services/task-actions.ts module the REST routes do.
  const checkMutation = trpc.task.check.useMutation();
  const startMutation = trpc.task.start.useMutation();
  const breakPromiseMutation = trpc.task.breakPromise.useMutation();
  const deleteMutation = trpc.task.delete.useMutation();

  // Phase SS.1 (2026-05-19 AM) · tRPC migration · 2 create mutations.
  // create wraps createTaskFromAPI (inbox-default + service +
  // Telegram-notify) · createMission wraps the missions service.
  const createTaskMutation = trpc.task.create.useMutation();
  const createMissionMutation = trpc.task.createMission.useMutation();

  // Phase SS.2 (2026-05-19 AM) · AI grading mutation · fire-and-forget
  // after createTask · structured AI response delegates to a shared
  // service so REST + tRPC can't drift on the model output shape.
  const scoreMutation = trpc.task.score.useMutation();

  // Phase SS.3 (2026-05-19 AM) · AI task generation mutation · the
  // service returns a discriminated union (ok/providers_failed/parse_failed)
  // typed across both transports so the page can show structured
  // failure toasts without HTTP-status sniffing.
  const aiGenerateMutation = trpc.task.aiGenerate.useMutation();

  // Phase SS.4 (2026-05-19 AM) · bulk-spawn NOW tasks from project
  // plans · once-per-session fire-and-forget on mount when the
  // operator has no active tasks but does have projects with un-
  // spawned phases. Typed result includes totalTasksSpawned which
  // drives the soft toast surface.
  const backfillMutation = trpc.task.backfill.useMutation();

  const loadingRef = useRef(false);
  // v10.0.118 audit fix · mounted-ref so genAi() and other async
  // work can short-circuit setState calls if user navigates away
  // mid-fetch. load() has its own loadingRef guard but genAi did not.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // v10.0.424 · load() now accepts an AbortSignal · the debounced
  // reload hook fires it before kicking off a new fetch, so we bail
  // before mutating state if the caller has moved on.
  const load = useCallback(async (signal?: AbortSignal) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      // Phase PP (2026-05-19 AM) · tRPC migration · the 3 Promise.all
      // reads (tasks/missions/goals) move to typed `utils.task.X.fetch()`
      // imperative calls. Same Promise.all shape · same parallel
      // dispatch · same abort-signal semantics. The type-safe shapes
      // eliminate the Envelope<unknown> dance that pre-fix required
      // because the routes returned different envelope styles.
      // Break-up the chained promise types · TypeScript's deep inference
      // on `utils.task.list.fetch().catch()` was hitting the
      // "instantiation excessively deep" guard. Splitting the calls
      // out + widening the catch fallback to `unknown` lets us shape-
      // narrow at the consumer site.
      const tasksPromise: Promise<unknown> = utils.task.list
        .fetch({
          goalId: filterGoalId ?? undefined,
          missionId: filterMissionId ?? undefined,
        })
        .catch((err: unknown) => {
          reportClientError(err, { source: "tasks.load.tasks" });
          return [] as Task[];
        });
      const missionsPromise: Promise<unknown> = utils.task.missions
        .fetch()
        .catch((err: unknown) => {
          reportClientError(err, { source: "tasks.load.missions" });
          return [] as Project[];
        });
      const goalsPromise: Promise<unknown> = utils.task.goals
        .fetch()
        .catch((err: unknown) => {
          reportClientError(err, { source: "tasks.load.goals" });
          return { goals: [] as GoalCacheEntry[] };
        });
      const [tasksRaw, missionsRaw, goalsRaw] = await Promise.all([
        tasksPromise,
        missionsPromise,
        goalsPromise,
      ]);

      // v10.0.424 · honor abort · don't overwrite state if caller bailed.
      if (signal?.aborted) return;
      setTasks(Array.isArray(tasksRaw) ? (tasksRaw as Task[]) : []);

      // Mission list shape: tRPC procedure returns Project[] directly.
      // Old REST returned either Project[] OR {missions: Project[]}.
      // Handle both for safety (the route currently returns array).
      const missionsList: Project[] = Array.isArray(missionsRaw)
        ? (missionsRaw as Project[])
        : ((missionsRaw as { missions?: Project[] })?.missions ?? []);

      // v10.0.154 · use the unified inbox helper instead of a string
      // !== "Inbox" check. Pre-fix, the bare "Inbox" was filtered but
      // auto-created per-domain inboxes ("Inbox - business", "Inbox -
      // personal") leaked through and were treated as user projects,
      // which made the count disagree with the cap (which counted them
      // too) and with Track/Stats (which didn't filter at all).
      const { isUserProject } = await import("@/lib/services/mission-helpers");
      setProjects(
        missionsList.filter((p) => p.status === "ACTIVE" && isUserProject(p)),
      );

      // Phase PP · goals come back already-shaped from the tRPC procedure
      // (`{goals: GoalCacheEntry[]}`) · no envelope unwrap needed. Type-
      // safe shape means the prior 5-way union (raw array, {goals:[]},
      // {data:{goals:[]}}, envelope, undefined) is gone.
      const goalList = (goalsRaw as { goals?: GoalCacheEntry[] })?.goals ?? [];
      setGoalsCache(
        goalList
          .filter((g): g is GoalCacheEntry => Boolean(g?.id && g?.title))
          .map((g) => ({
            id: g.id,
            title: g.title,
            horizon: g.horizon ?? null,
            domain: g.domain,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
            progress: g.progress,
            currentValue: g.currentValue,
            targetValue: g.targetValue,
            deadline: g.deadline,
            status: g.status,
            linkedActiveCount: g.linkedActiveCount,
            linkedDoneCount: g.linkedDoneCount,
            loopsThisWeek: g.loopsThisWeek,
          })),
      );
      // Brain focus line (non-blocking) · Phase PP migrates to
      // utils.task.actionsBrain.fetch() · same fire-and-forget shape.
      utils.task.actionsBrain
        .fetch()
        .then((d) => {
          if (d?.data) setBrain(d.data);
        })
        .catch((): void => {});
    } catch (err) {
      log.error("load_failed", { error: err instanceof Error ? err.message : String(err) });
      reportClientError(err, { source: "tasks.load" });
    } finally {
      // v10.0.29 — moved into finally. Pre-v10.0.29 this was outside
      // the try/catch, so any error in the catch block (e.g., a toast
      // re-throwing) would leave the page stuck in the loading state
      // skeleton forever. Now setLoading(false) always runs.
      setLoading(false);
      loadingRef.current = false;
    }
    // Phase B (2026-05-18) · taskFetchUrl in deps so URL filter
    // changes re-trigger the load · operator clicks "5 tasks →" on
    // /goals and lands here with the filtered set immediately.
  }, [taskFetchUrl]);

  // v10.0.424 · debounced reload · 250ms coalesce · in-flight abort.
  // Replaces 3 of the 5 reload triggers (mount + interval + event-bus).
  // Visibility-change + manual call sites still call load() directly
  // since they signal explicit operator intent (came back to tab,
  // confirmed an action) where debouncing would feel sluggish.
  const reload = useDebouncedReload(load, { debounceMs: 250 });

  useEffect(() => {
    reload();
  }, [reload]);

  // 60s background refresh of tasks/missions/goals. KommandoShell
  // dismantle · Phase 3 (2026-05-21) · the prior `activeMode` gate
  // (poll only on the NOW/PLAN tabs) is gone — /tasks is now a single
  // NOW surface, so the poll always runs.
  useEffect(() => {
    const i = setInterval(reload, 60_000);
    return () => clearInterval(i);
  }, [reload]);

  // Cross-surface event bus — refresh whenever task data changes.
  // v10.0.424 · debounced so a chat NL action that fires 3 events
  // in 50ms (decision + brain-dump + task) only triggers ONE fetch.
  useEffect(() => {
    return onDataChanged(["tasks", "missions", "goals", "projects", "any"], (e) => {
      if (e.source === "tasks-page") return;
      reload();
    });
  }, [reload]);

  // Apr 27 · auto-backfill — once per session, when NOW is empty
  // but PLAN has projects with un-spawned plans, silently spawn the
  // first phase of each non-stale project. Idempotent (server skips
  // already-spawned steps), staleness-filtered (server skips plans
  // > 90d old + projects whose goals are all zombies), no UI noise
  // unless something actually got spawned.
  //
  // v10.0.529.18 · sessionStorage gate + condition + fire extracted
  // into <useOncePerSession>. Computes activeCount inline because
  // `active` is derived further down the component body.
  useOncePerSession(
    "nour:tasks:autobackfill-ran",
    () => {
      if (projects.length === 0) return false;
      const activeCount = tasks.filter((t) =>
        ["INBOX", "READY", "DOING"].includes(t.status),
      ).length;
      return activeCount <= 5;
    },
    async () => {
      try {
        // Phase SS.4 · tRPC migration · typed result · no Envelope/
        // unwrap dance · totalTasksSpawned reads directly off the
        // mutation response.
        const result = await backfillMutation.mutateAsync({
          firstPhaseOnly: true,
        });
        const spawned = result.totalTasksSpawned ?? 0;
        if (spawned > 0) {
          toast.success(
            `Backfilled ${spawned} task${spawned === 1 ? "" : "s"} from your plans`,
          );
          notifyDataChanged("tasks", {
            source: "tasks-page",
            detail: "auto-backfill",
          });
          await load();
        }
      } catch (err) {
        // Silent to the user — backfill is opportunistic, a failure
        // still lets the page render normally — but report it so a
        // persistently-failing backfill is visible in /system/logs.
        reportClientError(err, { source: "tasks.autoBackfill" });
      }
    },
    [projects.length, tasks.length],
  );

  // Apr 26 · F7 — visibility refresh. Tab-away then return = stale
  // counts for up to 60s otherwise. visibilitychange fires the
  // moment the tab becomes visible, so when Nour comes back from
  // chat / a phone call / another tab, the page is current.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [load]);

  // Auto-gen AI tasks once per day (skipped if user has 5+ open)
  useEffect(() => {
    if (loading || generating) return;
    const key = "ai_tasks_last_gen";
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    try {
      if (localStorage.getItem(key) === today) return;
    } catch {}
    const openCount = tasks.filter((t) => ["INBOX", "READY", "DOING"].includes(t.status)).length;
    if (openCount >= 5) return;
    try {
      localStorage.setItem(key, today);
    } catch {}
    genAi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Actions ──────────────────────────────────────────

  function togglePin(id: string) {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("pinned_actions", JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  // v10.0.29 — useRef instead of plain object literal. Pre-v10.0.29
  // every render created a fresh `{ current: "" }`, defeating the
  // memoization and re-fetching /api/missions on every quick-add in
  // a session with rapid renders. Could even spawn a duplicate Inbox
  // mission if two getInbox() calls raced before the first cached.
  const inboxRef = useRef("");
  async function getInbox(): Promise<string> {
    if (inboxRef.current) return inboxRef.current;
    // Phase SS.1 · tRPC migration · GET migrated to utils.task.missions
    // (was Phase PP) · POST migrated to createMissionMutation. Same
    // shape coverage (envelope/raw fallback gone · typed result).
    const raw = await utils.task.missions.fetch().catch((): unknown => []);
    const ms: Project[] = Array.isArray(raw) ? (raw as Project[]) : [];
    let m: Project | undefined = ms.find((x) => x.title === "Inbox") ?? ms[0];
    if (!m) {
      const created = await createMissionMutation
        .mutateAsync({
          title: "Inbox",
          status: "ACTIVE",
        })
        .catch((): unknown => null);
      m = (created as Project | null) ?? undefined;
    }
    inboxRef.current = m?.id || "";
    return inboxRef.current;
  }

  // v10.0.226 · cancellation + structured-error path. Pre-226 the
  // empty `catch {}` swallowed every failure into a generic toast.
  // Now: AbortController so unmount/retry cancels in flight, and
  // the server's new structured failure shape (provider failures,
  // 502 parse-fail, 503 all-providers-down) gets surfaced to the
  // operator instead of a flat "AI failed".
  const aiAbortRef = useRef<AbortController | null>(null);
  async function genAi() {
    // If a previous run is still in flight, cancel it · prevents a
    // stale response from clobbering a fresh one when the user
    // double-taps the button or re-triggers via keyboard.
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setGenerating(true);
    try {
      const existingTitles = tasks
        .filter((t) => ["INBOX", "READY", "DOING"].includes(t.status))
        .map((t) => t.title);
      // Phase SS.3 · tRPC migration · typed mutation returns a
      // discriminated union (ok/providers_failed/parse_failed) so
      // the page reads result.kind instead of HTTP status sniffing.
      // AbortController · tRPC v11 mutations don't accept a signal
      // in mutateAsync options · we rely on the existing mounted-
      // ref + aborted check pattern to bail out post-resolve if the
      // user navigated away. Underlying httpBatchLink does propagate
      // cancellation when the React tree unmounts.
      const d = await aiGenerateMutation.mutateAsync({
        existingTasks: existingTitles,
      });
      if (!mountedRef.current || controller.signal.aborted) return;

      if (!d.ok) {
        if (d.kind === "providers_failed") {
          const tiers = d.failures
            .map((f) => `${f.provider}/${f.failureClass ?? "?"}`)
            .join(", ");
          toast.error(`All AI providers failed · ${tiers}`);
          log.warn("ai_tasks_all_failed", { providerFailures: d.failures });
          return;
        }
        if (d.kind === "parse_failed") {
          toast.error("AI returned malformed output · retry");
          log.warn("ai_tasks_parse_fail", { rawSnippet: d.rawSnippet });
          return;
        }
        toast.error("AI failed");
        return;
      }

      // Partial-validity reporting · server validates each task and
      // drops invalid rows · log the count if the model wobbled.
      if (d.droppedInvalid > 0) {
        log.info("ai_tasks_partial", {
          kept: d.tasks.length,
          dropped: d.droppedInvalid,
          parseVia: d.parseVia,
        });
      }

      if (d.tasks?.length > 0) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const existingNorm = new Set(existingTitles.map(norm));
        // Normalize the service's `missionId?: string | null | undefined`
        // to the page's `missionId: string | null` shape · the Zod
        // `.optional().nullable()` adds undefined which the local
        // AiTask type doesn't allow. Coerce missing → null at the
        // boundary so downstream filter/map calls stay typed.
        const taskList: AiTask[] = d.tasks.map((t) => ({
          ...t,
          missionId: t.missionId ?? null,
        }));
        const fresh = taskList.filter((t) => !existingNorm.has(norm(t.title)));
        if (fresh.length === 0) {
          toast("AI has no new suggestions");
          return;
        }
        const critical = fresh.filter((t) => t.priority === "critical").slice(0, 2);
        for (const t of critical) await adoptAi(t);
        if (!mountedRef.current) return;
        setAiTasks(fresh.filter((t) => !critical.includes(t)));
        const baseMsg =
          critical.length > 0
            ? `${critical.length} critical added, ${fresh.length - critical.length} suggestions`
            : `${fresh.length} suggestions`;
        // Mention parse-via when AI output needed repair · operator
        // signal that the model's output was wobbly today.
        const msg = d.parseVia === "repaired"
          ? `${baseMsg} (output repaired)`
          : baseMsg;
        toast.success(msg);
        load();
      } else {
        toast("AI returned 0 tasks");
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        // Cancellation is intentional — no toast.
        return;
      }
      if (mountedRef.current) toast.error("Failed to generate AI tasks");
      log.warn("ai_tasks_threw", { err: err instanceof Error ? err.message : String(err) });
      reportClientError(err, { source: "tasks.genAi" });
    } finally {
      // Only clear `generating` if this controller is still the
      // active one — else a newer run owns the spinner.
      if (mountedRef.current && aiAbortRef.current === controller) {
        setGenerating(false);
        aiAbortRef.current = null;
      }
    }
  }

  /**
   * Unified quick-add. Parses the raw input with our smart parser
   * (kind detection, "by <when>" clauses, @domain + /effort tokens)
   * and creates a single Task row with the right loopKind.
   */
  async function addTask() {
    const raw = newTask.trim();
    if (!raw) return;
    const parsed = parseQuickAdd(raw);
    if (!parsed) {
      toast.error("Couldn't parse — try a simple title");
      return;
    }
    try {
      const mId = await getInbox();
      // Phase SS.1 · tRPC migration · typed mutation returns the
      // created task envelope directly · no r.ok / r.clone() dance.
      // The createTaskFromAPI service handles inbox-default-on-missing
      // + Telegram notify · same effects as before.
      const created = (await createTaskMutation.mutateAsync({
        title: parsed.title,
        missionId: mId,
        effort: parsed.effort || "M15",
        // roiScore stays 50 — the "ungraded" sentinel scoreTaskWithAI
        // keys on. Pre-2026-05-21 a PROMISE was hardcoded to 80, which
        // the !== 50 skip-guard then read as "operator-graded", so
        // promises were permanently excluded from AI ROI grading.
        roiScore: 50,
        loopKind: parsed.loopKind,
        promiseTo: parsed.promiseTo || null,
        dueDate: parsed.dueDate ? parsed.dueDate.toISOString() : null,
      })) as { id?: string; task?: { id?: string } } | null;
      setNewTask("");
      const newId = created?.task?.id ?? created?.id ?? null;
      // `done:` / `did:` prefix · the operator finished this earlier
      // and is logging it. Complete it right away so it lands in DONE
      // (streak / mastery credit fires through checkTask). markedDone
      // tracks the real outcome so the toast never claims "done" if
      // the completion failed. No AI grading — a done task's roiScore
      // never feeds the sort.
      let markedDone = false;
      if (parsed.markDone && newId) {
        try {
          await checkMutation.mutateAsync({ id: newId, action: "complete" });
          markedDone = true;
        } catch (err) {
          reportClientError(err, { source: "tasks.addTask.markDone" });
        }
      } else if (newId) {
        // Phase SS.2 · AI grading via tRPC · fire-and-forget. Every
        // kind gets graded now (promises included) · scoreTaskWithAI
        // reads the roiScore=50 sentinel and replaces it 0-100.
        void scoreMutation.mutateAsync({ id: newId }).catch(() => {
          /* non-fatal · AI grading is best-effort */
        });
      }
      const kindLabel =
        parsed.loopKind === "DAILY"
          ? "daily"
          : parsed.loopKind === "PROMISE"
            ? `promise${parsed.promiseTo ? ` to ${parsed.promiseTo}` : ""}`
            : "task";
      const extras: string[] = [kindLabel];
      if (parsed.domain) extras.push(`@${parsed.domain}`);
      if (parsed.effort) extras.push(parsed.effort);
      toast.success(`${markedDone ? "Logged done" : "Added"} · ${extras.join(" · ")}`);
      load();
      notifyDataChanged("tasks", { source: "tasks-page", detail: "add" });
    } catch (err) {
      toast.error("Failed to add task");
      reportClientError(err, { source: "tasks.addTask" });
    }
  }

  /**
   * Complete a loop — routes to the new kind-aware /check endpoint.
   * Handles optimistic UI for speed.
   */
  async function completeLoop(id: string) {
    const t = tasks.find((x) => x.id === id);
    const isDaily = t?.loopKind === "DAILY";
    // Optimistic update
    if (isDaily) {
      setTasks((prev) =>
        prev.map((x) =>
          x.id === id
            ? {
                ...x,
                lastCompletedAt: new Date().toISOString(),
                streakCount: (x.streakCount ?? 0) + 1,
              }
            : x
        )
      );
    } else {
      setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, status: "DONE" } : x)));
    }
    try {
      // Phase RR · tRPC migration · typed result envelope means we
      // can read autoLearn directly off the response without the
      // `body?.data?.autoLearn ?? body?.autoLearn` fallback dance.
      const result = await checkMutation.mutateAsync({ id, action: "complete" });
      const autoLearn = result?.autoLearn ?? null;
      // v10.0.529.77 · Wave 22 · adaptive mastery bump + wisdom
      // citation. The /check endpoint now returns enriched cross-
      // engine wins · the operator sees their work compounding in
      // real time (toast description) AND gets a matching wisdom
      // principle when one cleared the similarity floor.
      const wins: string[] = [];
      if (autoLearn?.mastery) {
        wins.push(
          `+${autoLearn.mastery.delta} → ${autoLearn.mastery.domain} ${autoLearn.mastery.score}/100`,
        );
      }
      if (autoLearn?.knowledge) {
        wins.push("insight saved");
      }
      if (autoLearn?.learn) {
        wins.push(`tutorial · ${autoLearn.learn.slug}`);
      }
      // v23 · #5 · Ghost Nick · if this task was predicted, prepend a
      // "ghost predicted this" chip with rolling accuracy.
      if (autoLearn?.ghost?.predicted) {
        wins.push(`ghost predicted · ${autoLearn.ghost.accuracyPct}% acc`);
      } else if (autoLearn?.ghost && !autoLearn.ghost.predicted && autoLearn.ghost.surprises > 0) {
        // Surprises only worth mentioning occasionally · skip noise.
      }
      // v22 · wisdom citation lives on its OWN line below the wins
      // so it reads as a quote · italicized · persona prefix.
      // Truncate to 140ch to keep the toast tidy.
      const wisdomLine = autoLearn?.wisdom
        ? `${autoLearn.wisdom.persona ?? "wisdom"} · ${
            autoLearn.wisdom.content.length > 140
              ? autoLearn.wisdom.content.slice(0, 137) + "…"
              : autoLearn.wisdom.content
          }`
        : null;
      if (wins.length > 0 || wisdomLine) {
        const description = [wins.join(" · "), wisdomLine]
          .filter(Boolean)
          .join("\n");
        toast.success(isDaily ? "🔥" : "done", {
          description,
          duration: wisdomLine ? 6500 : 4000,
        });
      } else {
        toast.success(isDaily ? "🔥" : "done");
      }
      notifyDataChanged("tasks", { source: "tasks-page", detail: "complete", id });
      // Apr 27 · if the completed task was tagged with a goalId, the
      // S3 server hook auto-bumped that goal's currentValue. Firing
      // a goals event here makes PLAN's pace chip + "loops this week"
      // counter update without waiting for the next 60s poll.
      if (t?.goalId) {
        notifyDataChanged("goals", {
          source: "tasks-page",
          detail: "task-complete-lifted-goal",
          id: t.goalId,
        });
      }
      // Apr 27 · phase progression auto-spawn happens server-side;
      // fire a projects event so PLAN's project momentum chip
      // reflects the new "warm" state immediately.
      if (t?.missionId) {
        notifyDataChanged("projects", {
          source: "tasks-page",
          detail: "task-complete-on-project",
          id: t.missionId,
        });
      }
    } catch (err) {
      toast.error("Complete failed");
      reportClientError(err, { source: "tasks.completeLoop" });
    } finally {
      // v10.0.29 — moved into finally. Pre-v10.0.29 the load() was
      // outside the try/catch; if the catch block itself threw
      // (toast lib re-throw), the optimistic state was stuck.
      // Always reload so the optimistic update rolls back if the
      // server rejected the completion.
      load();
    }
  }

  async function startTask(id: string) {
    try {
      // Phase RR · tRPC migration · same idempotent start semantics ·
      // typed mutation result · failure throws with TRPCError shape
      // that our catch handles uniformly.
      await startMutation.mutateAsync({ id });
      toast.success("Started ⏱");
      notifyDataChanged("tasks", { source: "tasks-page", detail: "start", id });
    } catch (err) {
      toast.error("Start failed");
      reportClientError(err, { source: "tasks.startTask" });
    }
    // Always reload so the UI reflects real server state whether we
    // succeeded or the optimistic assumption was wrong.
    load();
  }

  // Broken promise handler — captures the reason via the modal and
  // POSTs to the break-promise endpoint which archives the task and
  // writes a BrokenPromiseLog row with an AI-extracted pattern tag.
  async function breakPromise(id: string, reason: string) {
    // Optimistic remove so the UI feels instant. On failure the
    // finally-block load() re-fetches and snaps it back if the
    // server rejected.
    setTasks((p) => p.filter((t) => t.id !== id));
    try {
      // Phase RR · tRPC migration · pattern detection still happens
      // server-side · typed return + TRPCError shape replaces the
      // ad-hoc r.ok / r.json() dance.
      await breakPromiseMutation.mutateAsync({ id, reason });
      toast("Noted. Nick will remember.");
      notifyDataChanged("tasks", { source: "tasks-page", detail: "break-promise", id });
    } catch (err) {
      toast.error("Break capture failed");
      reportClientError(err, { source: "tasks.breakPromise" });
    }
    load();
  }

  async function deleteTask(id: string) {
    setTasks((p) => p.filter((t) => t.id !== id));
    try {
      // Phase RR · tRPC migration · same soft-delete behavior
      // server-side · typed mutation eliminates the manual r.ok check.
      await deleteMutation.mutateAsync({ id });
      notifyDataChanged("tasks", { source: "tasks-page", detail: "delete", id });
    } catch (err) {
      toast.error("Delete failed");
      reportClientError(err, { source: "tasks.deleteTask" });
    }
    load();
  }

  async function adoptAi(t: AiTask) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const tn = norm(t.title);
    const exists = tasks.some(
      (x) => ["INBOX", "READY", "DOING"].includes(x.status) && norm(x.title) === tn
    );
    if (exists) {
      setAiTasks((p) => p.filter((x) => x.title !== t.title));
      toast("Already exists — skipped");
      return;
    }
    try {
      const mId = t.missionId || (await getInbox());
      // Phase SS.1 · adoptAi migrated to createTaskMutation alongside
      // the quick-add path. Same defaults (effort/roiScore/finishCondition)
      // ride through `createTaskFromAPI` server-side.
      const created = (await createTaskMutation.mutateAsync({
        title: t.title,
        missionId: mId,
        nextPhysicalAction: t.nextAction || t.title,
        effort: t.priority === "critical" ? "H1" : "M30",
        // roiScore stays at the 50 sentinel so scoreTaskWithAI grades
        // it — same as the quick-add path. The suggestion's `priority`
        // still drives effort above; a real 0-100 AI grade beats the
        // old blind 90/50 hardcode the !== 50 skip-guard locked out.
        roiScore: 50,
        finishCondition: t.title,
      })) as { id?: string; task?: { id?: string } } | null;
      setAiTasks((p) => p.filter((x) => x.title !== t.title));
      const newId = created?.task?.id ?? created?.id ?? null;
      if (newId) {
        void scoreMutation.mutateAsync({ id: newId }).catch(() => {
          /* non-fatal · AI grading is best-effort */
        });
      }
      toast.success("Added");
      load();
    } catch (err) {
      // v10.0.29 — surface the failure. Pre-v10.0.29 the empty catch
      // was silent: AI suggestion stayed in the list with no
      // indication the add had failed.
      log.error("adoptAi_failed", {
        taskTitle: t.title,
        error: err instanceof Error ? err.message : String(err),
      });
      reportClientError(err, { source: "tasks.adoptAi" });
      toast.error(`Failed to add: ${t.title.slice(0, 40)}`);
    }
  }

  // v10.0.529.15 · createProjectManual / createProject / executePlan /
  // deleteProject lifted into <ProjectsPanel> · audit win #2 from the
  // /tasks code-explorer pass. The panel owns its own state for the
  // clarify-questions flow + manual-form quadruplet · the only callback
  // boundary back to this page is `load` (which the panel calls after
  // any mutation to refresh tasks/missions/goals together).

  // ── Derived ──────────────────────────────────────────
  // v10.0.529.18 · 11 page-level derivations (active / waiting / done /
  // doing / doneToday / overdue / dailyCount / promiseCount / onceCount
  // / reviewSet) lifted into <useTaskDerivedState>. Pre-extraction the
  // first 10 were unmemoized filter+count chains running on EVERY
  // parent render — including filter ticks, drift state changes, and
  // edit-sheet toggles. The hook owns its own minimal useMemo deps
  // (each output ticks only when its slice changes).
  const {
    active,
    waiting,
    done,
    reviewSet,
    doing,
    doneToday,
    overdue,
    dailyCount,
    promiseCount,
    onceCount,
  } = useTaskDerivedState(tasks);

  // v10.0.118 audit fix · snapshot the current hour once per render
  // instead of calling new Date().getHours() five times inside the
  // JSX. Server-render and hydration could disagree on the boundary
  // hour producing a hydration mismatch warning.
  const currentHour = new Date().getHours();
  const isAfternoon = currentHour >= 14;
  const hour12 = currentHour % 12 || 12;
  const ampm = currentHour >= 12 ? "pm" : "am";
  // v10.0.29 — reviewOpen state removed; ReviewSheet was dead UI.
  // The wizard (ReviewWizard) now handles all review flows.
  // Apr 27 · WEEKLY-REVIEW — separate state from the legacy
  // ReviewSheet (kill/reframe/blocker on individual stale tasks).
  // The wizard is the multi-step flow: triage warnings → confirm
  // goals → confirm projects → pick top 3 for next week. Both NOW
  // headline and TRACK's CTA open this.
  const [wizardOpen, setWizardOpen] = useState(false);

  // v10.0.529.18 · `activeDomains` derivation moved into <NowPanel>.
  // It was used only by TaskFilters (rendered inside NowPanel) and
  // re-derived on every parent tick of `active`. Same memoization key,
  // just colocated with the only consumer.

  // v10.0.325 · quickAddParsed useMemo moved INSIDE QuickAddBar (it
  // only depends on newTask). The component owns the parser preview
  // and the empty-state syntax hint.
  // v10.0.529.16 · `dayPct` useMemo also dropped — was computed but
  // never read (a NowOperatorBar PR removed the consumer chip but
  // not the producer). Caught during the NowPanel extraction sweep.

  // ── Goal ↔ Project bridge (Apr 20 · v10.0.529.17 hook) ──
  // The linkage is derived by walking tasks: a Mission "serves" a Goal
  // if any of its tasks carries both goalId and missionId. Only
  // `goalLineage` is consumed here — it feeds LoopStream's urgency bump
  // on rows linked to a behind/missed goal. KommandoShell dismantle ·
  // Phase 3 (2026-05-21) · the `goalToProjects` / `projectToGoals` /
  // `goalTitles` outputs fed the removed PLAN tab (KommandoPlan goal
  // cards + ProjectsPanel) · no longer destructured here.
  const { goalLineage } = useGoalProjectBridge(tasks, projects, goalsCache);

  // v10.0.529.18 · `smartHeadline` / `doneSpark` / `doneGroups`
  // derivations all moved into <NowPanel>. They were display
  // concerns of one consumer (NOW mode) being computed on every
  // parent tick (including filter changes, drift state ticks, edit
  // sheet toggles). doneGroups in particular was the worst offender
  // — an unmemoized IIFE walking `done[]` every render. Each
  // recomputes only when its own input slice changes now.

  if (loading)
    return (
      <div className="space-y-3 max-w-3xl">
        {[1, 2, 3, 4].map((i) => (
          <ShimmerSkeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );

  // The page body — a <NowPanel> (today's LoopStream + the execution
  // surface). KommandoShell dismantle · Phase 3 (2026-05-21) · this
  // used to be one of two/three mode fragments the shell switched
  // between; it now renders directly. v10.0.529.16 · the ~250-LOC
  // inline JSX was extracted to components/actions/now-panel.tsx.
  // Parent threads: tasks + derived stats (parent computes once ·
  // panel reads), filter state (kindFilter/domainFilter/searchQuery/
  // sortKey), pinnedIds/brain/aiTasks/projects/goalsCache/goalLineage,
  // and action handlers (completeLoop/deleteTask/startTask/togglePin/
  // breakPromise/addTask/genAi/adoptAi/load). NowPanel owns showDone +
  // editingGoal/Project for + focusMode + showFilters + filter-edit
  // quadruplet + the useCustomDomains hook call.
  const nowContent = (
    <NowPanel
      tasks={tasks}
      aiTasks={aiTasks}
      projects={projects}
      goalsCache={goalsCache}
      goalLineage={goalLineage}
      pinnedIds={pinnedIds}
      isDrifting={isDrifting}
      brain={brain}
      newTask={newTask}
      setNewTask={setNewTask}
      voice={voice}
      generating={generating}
      onAddTask={addTask}
      onGenAi={genAi}
      onAdoptAi={adoptAi}
      onAdoptAllAi={async () => {
        for (const t of aiTasks) await adoptAi(t);
      }}
      kindFilter={kindFilter}
      setKindFilter={setKindFilter}
      domainFilter={domainFilter}
      setDomainFilter={setDomainFilter}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      sortKey={sortKey}
      setSortKey={setSortKey}
      reviewSet={reviewSet}
      active={active}
      doing={doing}
      doneToday={doneToday}
      overdue={overdue}
      onceCount={onceCount}
      dailyCount={dailyCount}
      promiseCount={promiseCount}
      done={done}
      waiting={waiting}
      isAfternoon={isAfternoon}
      hour12={hour12}
      ampm={ampm}
      setWizardOpen={setWizardOpen}
      projectsCount={projects.length}
      onComplete={completeLoop}
      onDelete={deleteTask}
      onStart={startTask}
      onPin={togglePin}
      onBreakPromise={breakPromise}
      onReload={load}
    />
  );

  // ── Final render: a single NOW surface. KommandoShell dismantle ·
  //    Phase 3 (2026-05-21) · `nowContent` renders directly — no tab
  //    shell. May 02 — removed DriftShield card per user request (was
  //    an always-on red banner when isDrifting fired, intrusive).
  return (
    // v10.0.529.13 · iOS safe-area · respect the home-indicator inset on
    // iPhone 14/15 so the last interactive row of the page clears the
    // notch. Pure CSS · no JS · zero layout impact on desktop because
    // env(safe-area-inset-bottom) resolves to 0 there.
    <div className="space-y-3 max-w-3xl pb-[env(safe-area-inset-bottom,0px)]">
      {/* Phase B (2026-05-18) · cross-link filter banner. Renders when
          operator arrives from /goals or /scoreboard via ?goalId or
          ?missionId · X-to-clear returns to unfiltered view. */}
      {(filterGoalId || filterMissionId) ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] px-4 py-2.5 text-sm">
          <span className="text-white/80 truncate">
            Filtered ·{" "}
            <span className="font-medium text-[var(--gold)]">
              {filterGoalId ? "goal" : "mission"} · {(filterGoalId ?? filterMissionId ?? "").slice(0, 24)}
            </span>
          </span>
          <button
            type="button"
            onClick={clearFilter}
            aria-label={`Clear ${filterGoalId ? "goal" : "mission"} filter`}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-white/15 px-3 text-xs uppercase tracking-wider text-white/60 hover:text-white/90"
          >
            clear
          </button>
        </div>
      ) : null}
      {/* The execution surface — THE hero. KommandoShell dismantle ·
          Phase 3 (2026-05-21) · `nowContent` (the <NowPanel>) renders
          directly where the 3-mode <KommandoShell> used to sit. Goal
          authoring moved to /goals · TRACK moved to /scoreboard +
          /learn.

          2026-05-21 redesign (simple on top, powerful underneath) ·
          six intel/reflection widgets — daily brief, Nick's
          suggestions, operator pulse, today's compound, compound
          chain, context band — used to STACK above this surface, one
          per wave, until the task list was buried under six cards.
          They now fold into <IntelPanel> directly below, collapsed by
          default. The operator's daily loop (next move · quick-add ·
          task list) is unobstructed; intel is one deliberate tap. */}
      {nowContent}
      {/* IntelPanel · the six intel/reflection widgets, collapsed by
          default — children mount only when expanded, so on the /tasks
          load path these self-fetching widgets do no work until the
          operator opens the drawer. Order preserved from the old
          stacked layout: brief → Nick's suggestions → pulse → today's
          compound → compound chain → context band. Each still self-
          hides when it has nothing to say.

          NickSuggestions keeps its supervised-signal capture
          (action/dismiss → /api/brain/suggestion-loop); folding it
          here loses no proactive guidance because <NowPanel> already
          carries NextMoveCard + AiSuggestionsBand on the hero surface.

          ActionsContextBand still links the /brain dashboard + the
          5-card life hub — see docs/adr/0013-merge-brain-life-ops-ia.md. */}
      <IntelPanel signalCount={overdue} signalLabel="overdue">
        <DailyBriefSection />
        <NickSuggestions />
        <OperatorPulse surface="tasks" className="px-0" />
        <TodaysCompound />
        <CompoundChain surface="tasks" className="px-0 mx-0" />
        <ActionsContextBand />
      </IntelPanel>
      {/* Apr 26 · Review sheet — bottom sheet for kill/reframe/blocker
          decisions on overdue + stale tasks. Triggered by tapping the
          smart headline when reviewSet is non-empty. */}
      {/* v10.0.29 — ReviewSheet removed. setReviewOpen(true) was
          never called anywhere → dead UI. ReviewWizard below
          handles all review flows now. */}
      {/* Apr 27 · Weekly review wizard — 4-step triage + planning
          flow opened from the NOW headline REVIEW button or TRACK's
          "Run weekly review" CTA. */}
      <ReviewWizard
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          void load();
        }}
        tasks={tasks}
        goals={goalsCache}
        projects={projects}
        onPinTask={togglePin}
        pinnedIds={pinnedIds}
      />
    </div>
  );
}
