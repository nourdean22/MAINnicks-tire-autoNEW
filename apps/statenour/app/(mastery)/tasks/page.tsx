"use client";

/**
 * Actions page · /tasks
 *
 * Orchestrates the 3-mode shell (today · goals · trends · enum keys
 * NOW · PLAN · TRACK kept for localStorage compat). Owns the page-
 * level data feed (tasks · projects · goalsCache · brain) + cross-
 * mode state (filters · pinnedIds · activeMode · wizard). NOW-mode
 * rendering lives in <NowPanel> · PLAN-mode project list lives in
 * <ProjectsPanel> · all goal↔project↔task linkage derives via
 * useGoalProjectBridge.
 *
 * Each task row carries a `loopKind` field (ONCE | DAILY | PROMISE)
 * that drives streak / promise / one-shot behavior in LoopStream.
 *
 * Endpoints feeding this page: /api/tasks · /api/missions ·
 * /api/goals · /api/actions-brain · /api/ai/tasks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { logger as rootLogger } from "@/lib/logger";

// v10.0.29 — structured logger for tasks-page client-side errors.
// Pre-v10.0.29 the only diagnostic call was a console.error in load()
// which didn't reach /system/errors.
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
import { ProjectsPanel } from "@/components/actions/projects-panel";
import { NowPanel } from "@/components/actions/now-panel";
import { type AiTask } from "@/components/actions/ai-suggestions-band";
import { ActionsContextBand } from "@/components/actions/actions-context-band";
import { TodaysCompound } from "@/components/actions/todays-compound";
import { KommandoShell } from "@/components/actions/kommando-modes";
import { useGoalProjectBridge } from "@/hooks/use-goal-project-bridge";
import { useTaskDerivedState } from "@/hooks/use-task-derived-state";
import { useOncePerSession } from "@/hooks/use-once-per-session";
import { scrollToElement } from "@/lib/utils/scroll";
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

import { authedFetch } from "@/hooks/use-authed-fetch";
import { createTask } from "@/lib/services/client/tasks";
// v10.0.424 · debounced reload · coalesces 5 reload triggers into 1.
import { useDebouncedReload } from "@/hooks/use-debounced-reload";
type KindFilter = "all" | LoopKind;

// v10.0.252 · API responses are inconsistently wrapped — some routes
// return the raw shape, others return `{ data: X }`. The unwrap helper
// + Envelope type accept either and strip the wrapper if present so
// downstream code never sees the envelope. Hoisted to module scope so
// they aren't recreated on every load() call.
type Envelope<T> = T | { data: T };
function unwrap<T>(x: Envelope<T>): T {
  return x && typeof x === "object" && "data" in x
    ? (x as { data: T }).data
    : (x as T);
}

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

export default function TasksPage() {
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
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  // v10.0.529.16 · editingGoalForTaskId + editingProjectForTaskId lifted
  // into <NowPanel> with the TaskEditSheet IIFEs they drive.
  // Apr 20 bridge · page-level cache of goal rows · feeds Project→Goal
  // breadcrumb chips (title lookup) + the LinkGoalPicker (full row shape
  // with horizon/domain). KommandoPlan does its own fetch for its richer
  // card data. v10.0.529.15 · GoalCacheEntry type lives in shared.ts.
  const [goalsCache, setGoalsCache] = useState<GoalCacheEntry[]>([]);
  // v10.0.529.17 · goalTitles useMemo lifted into useGoalProjectBridge
  // alongside the other two derived maps. See the bridge destructure
  // further down where `tasks` + `projects` are first in scope.

  // v10.0.423 · loadGoalsCache + standalone useEffect REMOVED · the
  // load() pass below is the single /api/goals fetch.
  // v10.0.529.16 · `lastRefresh` state dropped — set but never read.
  // v10.0.529.16 · showDone lifted into <NowPanel> (NOW-only).
  // v10.0.529.15 · ProjectsPanel-local plan state + manual-form quad
  // lifted into <ProjectsPanel>. newProjectTitle stays here because
  // handlePlanGoal seeds it when a no-plan goal card calls "plan it".
  const [newProjectTitle, setNewProjectTitle] = useState("");
  // Filter state stays here per the v529.16 extraction brief · any
  // future PLAN/TRACK surface that wants to read filter
  // context (deep-link with a domain pre-selected, etc.) reads from
  // one source of truth instead of poking at NowPanel internals.
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
  // Which Kommando mode is active — drives mode-aware polling.
  // NOW + PLAN need task/mission/goal refresh; other modes fetch
  // their own data and don't need the 60s interval burning bandwidth.
  const [activeMode, setActiveMode] = useState<string>("NOW");
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
      // v10.0.252 · Envelope/unwrap hoisted to module scope above ·
      // see the type+function declarations near the top of the file.
      type TasksRaw = Envelope<Task[]> | Task[] | unknown;
      type MissionsRaw = Envelope<Project[]> | Project[] | { missions?: Project[] } | unknown;
      type GoalsRaw = Envelope<{ goals: GoalCacheEntry[] }> | { goals: GoalCacheEntry[] } | GoalCacheEntry[] | unknown;
      const [tRaw, mRaw, gRaw] = await Promise.all([
        // Phase B · honor URL filter (goalId/missionId from /goals cross-link)
        authedFetch(taskFetchUrl).then((r): Promise<TasksRaw> | Task[] => (r.ok ? r.json() : [])).catch((): Task[] => []),
        authedFetch("/api/missions").then((r): Promise<MissionsRaw> | Project[] => (r.ok ? r.json() : [])).catch((): Project[] => []),
        authedFetch("/api/goals").then((r): Promise<GoalsRaw> | { goals: GoalCacheEntry[] } => (r.ok ? r.json() : { goals: [] })).catch((): { goals: GoalCacheEntry[] } => ({ goals: [] })),
      ]);

      // v10.0.424 · honor abort · don't overwrite state if caller bailed.
      if (signal?.aborted) return;
      const tasksRaw = unwrap<Task[] | undefined>(tRaw as Envelope<Task[] | undefined>);
      setTasks(Array.isArray(tasksRaw) ? tasksRaw : []);

      const missionsRaw = unwrap<Project[] | { missions?: Project[] } | undefined>(mRaw as Envelope<Project[] | { missions?: Project[] } | undefined>);
      const missions = Array.isArray(missionsRaw)
        ? missionsRaw
        : missionsRaw?.missions ?? [];
      // v10.0.154 · use the unified inbox helper instead of a string
      // !== "Inbox" check. Pre-fix, the bare "Inbox" was filtered but
      // auto-created per-domain inboxes ("Inbox - business", "Inbox -
      // personal") leaked through and were treated as user projects,
      // which made the count disagree with the cap (which counted them
      // too) and with Track/Stats (which didn't filter at all).
      const { isUserProject } = await import("@/lib/services/mission-helpers");
      setProjects(
        missions.filter((p) => p.status === "ACTIVE" && isUserProject(p)),
      );

      // v10.0.423 · single goalsCache populate · merges what loadGoalsCache
      // used to do separately. List shape varies (raw array, {goals:[]},
      // {data:{goals:[]}}) so unwrap to a Goal[]+ shape, then reshape into
      // the cache entry. Pace fields (targetValue, deadline) are now part
      // of the cache so goalLineage can compute paceKind from one source.
      const goalsRaw = unwrap<{ goals?: GoalCacheEntry[] } | GoalCacheEntry[] | undefined>(
        gRaw as Envelope<{ goals?: GoalCacheEntry[] } | GoalCacheEntry[] | undefined>,
      );
      const goalList = Array.isArray(goalsRaw)
        ? goalsRaw
        : (goalsRaw?.goals ?? []);
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
      // Brain focus line (non-blocking)
      authedFetch("/api/actions-brain")
        .then((r): Promise<unknown> | null => (r.ok ? r.json() : null))
        .then((d: unknown) => {
          const data = d as { data?: { insights?: Array<{ text?: string }>; dailyFocus?: string } } | null;
          if (data?.data) setBrain(data.data);
        })
        .catch((): void => {});
    } catch (err) {
      log.error("load_failed", { error: err instanceof Error ? err.message : String(err) });
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

  // Mode-aware polling: only fire the 60s refresh when NOW or PLAN
  // is active. TRACK fetches its own data on mount and
  // don't need tasks/missions/goals refreshed in the background.
  useEffect(() => {
    if (activeMode !== "NOW" && activeMode !== "PLAN") return;
    const i = setInterval(reload, 60_000);
    return () => clearInterval(i);
  }, [reload, activeMode]);

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
        const r = await authedFetch("/api/projects/backfill-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firstPhaseOnly: true }),
        });
        if (!r.ok) return;
        const d = await r.json();
        // v10.0.423 · use the hoisted unwrap() helper instead of manual fallback chains.
        const unwrapped = unwrap<{ totalTasksSpawned?: number } | undefined>(
          d as Envelope<{ totalTasksSpawned?: number } | undefined>,
        );
        const spawned = (unwrapped?.totalTasksSpawned ?? 0) as number;
        if (spawned > 0) {
          // Soft toast so Nour sees what happened, then refresh.
          toast.success(
            `Backfilled ${spawned} task${spawned === 1 ? "" : "s"} from your plans`,
          );
          notifyDataChanged("tasks", {
            source: "tasks-page",
            detail: "auto-backfill",
          });
          await load();
        }
      } catch {
        // Silent — backfill is opportunistic. If it fails, the
        // page still renders normally.
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
    const r = await authedFetch("/api/missions")
      .then((r): Promise<unknown> => r.json())
      .catch((): unknown[] => []);
    const maybeWrapped = r as { data?: unknown } | unknown;
    const raw =
      maybeWrapped && typeof maybeWrapped === "object" && "data" in (maybeWrapped as object)
        ? (maybeWrapped as { data?: unknown }).data
        : maybeWrapped;
    const ms: Project[] = Array.isArray(raw) ? (raw as Project[]) : [];
    let m: Project | undefined = ms.find((x) => x.title === "Inbox") ?? ms[0];
    if (!m) {
      const c = await authedFetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Inbox",
          description: "Quick tasks",
          status: "ACTIVE",
        }),
      }).then((r) => r.json());
      m = (c?.data ?? c) as Project | undefined;
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
      const r = await authedFetch("/api/ai/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", existingTasks: existingTitles }),
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) return;

      if (!r.ok) {
        // v10.0.226 · server now returns structured errors. Read them.
        let detail = `HTTP ${r.status}`;
        try {
          const body = await r.json();
          if (r.status === 429) {
            const wait = Math.ceil((body.retryAfterMs ?? 60_000) / 1000);
            toast.error(`AI rate limit · retry in ${wait}s`);
            return;
          }
          if (r.status === 503 && body.providerFailures?.length) {
            const tiers = body.providerFailures
              .map((f: { provider: string; failureClass?: string }) => `${f.provider}/${f.failureClass ?? "?"}`)
              .join(", ");
            toast.error(`All AI providers failed · ${tiers}`);
            log.warn("ai_tasks_all_failed", { providerFailures: body.providerFailures });
            return;
          }
          if (r.status === 502) {
            toast.error("AI returned malformed output · retry");
            log.warn("ai_tasks_parse_fail", { rawSnippet: body.rawSnippet });
            return;
          }
          if (body.error) detail = body.error;
        } catch { /* keep HTTP fallback */ }
        toast.error(`AI failed · ${detail}`);
        return;
      }

      const d = await r.json();
      if (!mountedRef.current || controller.signal.aborted) return;

      // v10.0.226 · partial-validity reporting · server validates
      // each task against a Zod shape and drops invalid rows. Surface
      // the count so the operator knows the model wobbled if it did.
      if (d.droppedInvalid > 0) {
        log.info("ai_tasks_partial", {
          kept: d.tasks?.length ?? 0,
          dropped: d.droppedInvalid,
          parseVia: d.parseVia,
        });
      }

      if (d.tasks?.length > 0) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const existingNorm = new Set(existingTitles.map(norm));
        const fresh = d.tasks.filter((t: AiTask) => !existingNorm.has(norm(t.title)));
        if (fresh.length === 0) {
          toast("AI has no new suggestions");
          return;
        }
        const critical = fresh.filter((t: AiTask) => t.priority === "critical").slice(0, 2);
        for (const t of critical) await adoptAi(t);
        if (!mountedRef.current) return;
        setAiTasks(fresh.filter((t: AiTask) => !critical.includes(t)));
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
      const r = await createTask({
        title: parsed.title,
        missionId: mId,
        effort: parsed.effort || "M15",
        roiScore: parsed.loopKind === "PROMISE" ? 80 : 50,
        loopKind: parsed.loopKind,
        promiseTo: parsed.promiseTo || null,
        dueDate: parsed.dueDate ? parsed.dueDate.toISOString() : null,
      });
      if (!r.ok) {
        toast.error("Failed to add");
        return;
      }
      setNewTask("");
      // v10.0.529.82 · Wave 26 · C3 · fire-and-forget AI-fill of
      // roiScore. Quick-add hardcodes 50 (default) · this asks Nick
      // to read the task + grade urgency 0-100 in the background.
      // Auto-priority sort + the "next move" surface get meaningful
      // signal from the moment the task lands. Skipped when the
      // task was explicitly set to 80 (PROMISE default · already
      // graded as high-leverage).
      if (parsed.loopKind !== "PROMISE") {
        void (async () => {
          try {
            const body = await r.clone().json().catch(() => null);
            const newId = body?.data?.id ?? body?.id ?? null;
            if (newId) {
              await authedFetch(`/api/tasks/${newId}/score`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
            }
          } catch {
            /* non-fatal · AI grading is best-effort */
          }
        })();
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
      toast.success(`Added · ${extras.join(" · ")}`);
      load();
      notifyDataChanged("tasks", { source: "tasks-page", detail: "add" });
    } catch {
      toast.error("Failed to add task");
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
      const r = await authedFetch(`/api/tasks/${id}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!r.ok) throw new Error("check failed");
      const body = await r.json().catch(() => ({}));
      const autoLearn = body?.data?.autoLearn ?? body?.autoLearn ?? null;
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
    } catch {
      toast.error("Complete failed");
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
      // New start endpoint sets status=DOING AND startedAt=now so
      // actualMinutes can be diffed on completion. Replaces the
      // old PATCH {status: DOING} which didn't track time.
      const r = await authedFetch(`/api/tasks/${id}/start`, { method: "POST" });
      if (!r.ok) {
        toast.error("Start failed");
        return;
      }
      toast.success("Started ⏱");
      notifyDataChanged("tasks", { source: "tasks-page", detail: "start", id });
    } catch {
      toast.error("Start failed");
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
      const r = await authedFetch(`/api/tasks/${id}/break-promise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!r.ok) throw new Error("break failed");
      toast("Noted. Nick will remember.");
      notifyDataChanged("tasks", { source: "tasks-page", detail: "break-promise", id });
    } catch {
      toast.error("Break capture failed");
    }
    load();
  }

  async function deleteTask(id: string) {
    setTasks((p) => p.filter((t) => t.id !== id));
    try {
      const r = await authedFetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
      notifyDataChanged("tasks", { source: "tasks-page", detail: "delete", id });
    } catch {
      toast.error("Delete failed");
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
      const r = await createTask({
        title: t.title,
        missionId: mId,
        nextPhysicalAction: t.nextAction || t.title,
        effort: t.priority === "critical" ? "H1" : "M30",
        roiScore: t.priority === "critical" ? 90 : 50,
        finishCondition: t.title,
      });
      if (!r.ok) throw new Error(`${r.status}`);
      setAiTasks((p) => p.filter((x) => x.title !== t.title));
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
  // The three layers (LifeGoal / Mission / Task) live in separate
  // sections but never cross-reference. The linkage is derived by
  // walking tasks: a Mission "serves" a Goal if any of its tasks
  // carries both goalId and missionId. Feeds:
  //   • KommandoPlan → goal cards show linked project chips (via
  //     `goalToProjects`)
  //   • Projects list → each card shows the goal(s) it serves
  //     (via `projectToGoals` + `goalTitles`)
  //   • LoopStream → urgency bump on rows linked to a behind/missed
  //     goal (via `goalLineage`)
  // The 3 useMemos that produced these 4 outputs (~60 LOC) lifted
  // into <useGoalProjectBridge> at v10.0.529.17. Memoization keys
  // preserved · each derived shape still re-computes on its own
  // minimal dependency slice.
  const { goalLineage, goalToProjects, projectToGoals, goalTitles } =
    useGoalProjectBridge(tasks, projects, goalsCache);

  // Jump-to-project — expand the project card on the page when Nour
  // taps a goal's linked project chip. v10.0.529.18 · scroll-by-id
  // sequence delegated to <scrollToElement> util.
  const handleJumpToProject = useCallback((projectId: string) => {
    setExpandedProject(projectId);
    scrollToElement(`project-card-${projectId}`, "center");
  }, []);

  // "Plan it" from a no-plan goal card — seed the project-create input
  // with the goal title + auto-trigger the Nick-plans-it flow.
  const handlePlanGoal = useCallback(
    (goal: { id: string; title: string }) => {
      setNewProjectTitle(goal.title);
      scrollToElement("projects-block", "start");
    },
    [],
  );

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

  // ── Projects content (moved from NOW mode to PLAN mode Apr 15) ──
  // Projects belong with planning, not today's execution. Nour
  // pointed out the duplication — why show them under today's
  // loops when there's a Plan tab? They render below KommandoPlan's
  // goals section now, inside PLAN mode.
  //
  // v10.0.529.15 · extracted from inline ~660-LOC fragment into
  // <ProjectsPanel> · audit win #2 from the /tasks code-explorer pass.
  // The panel owns the create/plan/delete flows + their state · this
  // page only threads the data it already has (projects, tasks,
  // goalsCache, etc.) plus the deep-link target (expandedProject) and
  // the seeded title (newProjectTitle).
  const projectsContent = (
    <ProjectsPanel
      projects={projects}
      tasks={tasks}
      goalsCache={goalsCache}
      goalTitles={goalTitles}
      projectToGoals={projectToGoals}
      expandedProject={expandedProject}
      onToggleExpand={(id) =>
        setExpandedProject(expandedProject === id ? null : id)
      }
      newProjectTitle={newProjectTitle}
      setNewProjectTitle={setNewProjectTitle}
      setProjects={setProjects}
      onReload={load}
      onCompleteTask={completeLoop}
      onDeleteTask={deleteTask}
    />
  );

  // Build the NOW-mode content as a <NowPanel> that KommandoShell
  // renders when mode === "NOW". v10.0.529.16 · the ~250-LOC inline
  // JSX fragment was extracted to components/actions/now-panel.tsx
  // (audit win #3 from the /tasks code-explorer pass · symmetric to
  // ProjectsPanel at v529.15). Parent threads: tasks + derived stats
  // (parent computes once · panel reads), parent-owned filter state
  // (kindFilter/domainFilter/searchQuery/sortKey), parent-owned cross-
  // mode state (pinnedIds/brain/aiTasks/projects/goalsCache/
  // goalLineage), and parent-owned action handlers
  // (completeLoop/deleteTask/startTask/togglePin/breakPromise/addTask/
  // genAi/adoptAi/load). NowPanel owns showDone + editingGoal/Project
  // for + focusMode + showFilters + filter-edit quadruplet + the
  // useCustomDomains hook call.
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

  // ── Final render: KommandoShell handles the 3 modes. NOW mode
  //    gets the full nowContent fragment built above. May 02 — removed
  //    DriftShield card per user request (was an always-on red banner
  //    when isDrifting fired, which Nour found intrusive).
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
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[#FDB913]/30 bg-[#FDB913]/[0.04] px-4 py-2.5 text-sm">
          <span className="text-white/80 truncate">
            Filtered ·{" "}
            <span className="font-medium text-[#FDB913]">
              {filterGoalId ? "goal" : "mission"} · {(filterGoalId ?? filterMissionId ?? "").slice(0, 24)}
            </span>
          </span>
          <button
            type="button"
            onClick={clearFilter}
            className="shrink-0 text-xs uppercase tracking-wider text-white/60 hover:text-white/90 border border-white/15 rounded-full px-3 py-1"
          >
            clear
          </button>
        </div>
      ) : null}
      {/* v10.0.529.79 · Wave 23 · #1 · TodaysCompound strip · shows
          today's compounded auto-learn signal (mastery delta · insight
          count · wisdom matched · goals lifted · focused minutes) so
          the operator SEES the brain filling up in real time. Sits
          ABOVE ActionsContextBand because it's higher-signal · the
          context band is static while this strip moves with every
          check-off. Hides when nothing happened yet today. */}
      <TodaysCompound />
      {/* v10.0.529.72 · Wave 18 IA merge · brain + life context band lives
          here on /tasks (the execution surface) so the operator's daily
          flow has context inline · no second nav hop. Brain row links to
          the /brain dashboard · Life row inlines the 5-card hub
          (/mastery · /body · /financial · /knowledge · /learn). The
          QUICK NAV's BRAIN + LIFE + OPS rows in floating-home.tsx were
          deleted in the same wave. See docs/adr/0013-merge-brain-life-
          ops-ia.md. */}
      <ActionsContextBand />
      <KommandoShell
        nowContent={nowContent}
        planExtra={projectsContent}
        goalToProjects={goalToProjects}
        onJumpToProject={handleJumpToProject}
        onPlanGoal={handlePlanGoal}
        onOpenReview={() => setWizardOpen(true)}
        // Apr 27 · GB4 — pace chip → create NOW task tagged with
        // goalId. Completing this task auto-lifts the goal via the
        // S3 hook, so the metric tracks itself once Nour starts
        // checking off daily-increment tasks.
        onCreateTaskForGoal={async ({ goalId, title }) => {
          try {
            const mId = await getInbox();
            const r = await createTask({
              title,
              missionId: mId,
              goalId,
              roiScore: 70,
              finishCondition: "Increment logged",
            });
            if (r.ok) {
              toast.success("Added to NOW · tagged with this goal");
              await load();
            } else {
              toast.error("Failed to add task");
            }
          } catch {
            toast.error("Failed to add task");
          }
        }}
        // Apr 27 · GB1 — when a goal card's next-move chip is tapped,
        // switch to NOW mode + scroll-flash the matching task. The
        // ID-driven scroll uses the row id pattern LoopStream renders;
        // a tiny highlight ring fades after 2s for orientation.
        onJumpToTask={(taskId) => {
          try {
            localStorage.setItem("nour:kommando:mode", "NOW");
          } catch {}
          // Best-effort mode switch via storage event + a soft reload
          // of the active mode state in KommandoShell. We just use a
          // CustomEvent the shell listens for.
          window.dispatchEvent(
            new CustomEvent("nour:kommando:set-mode", { detail: "NOW" }),
          );
          setTimeout(() => {
            const el = document.getElementById(`task-row-${taskId}`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("ring-2", "ring-amber-400/60");
              setTimeout(() => el.classList.remove("ring-2", "ring-amber-400/60"), 2000);
            }
          }, 100);
        }}
        onModeChange={setActiveMode}
      />
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
