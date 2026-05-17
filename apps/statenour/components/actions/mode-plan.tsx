"use client";

/**
 * KommandoPlan — Plan mode. Rebuilt Apr 15.
 *
 * The old version used horizon TABS (DAY/WEEK/MONTH/QUARTER/YEAR/LIFE)
 * that required goals to be tagged to a specific horizon. Nour's goals
 * had horizon: null, so every tab was empty. The page was dead on load.
 *
 * New version:
 *
 *   · ALL goals shown at once in ONE view — horizon is a tag on each
 *     card, not a filter that hides everything.
 *
 *   · Smart headline — "2 goals at 0%. Break them down."
 *
 *   · "Needs attention" signals — goals with 0 linked loops get a
 *     "No plan yet" badge. Goals that haven't been coached get a
 *     "Get Nick's read" prompt. Coach panel auto-visible when present.
 *
 *   · Goal cards are richer — big progress bar, linked loop count,
 *     time invested, WHY visible, coach read inline (not hidden
 *     behind a brain icon).
 *
 *   · Quick-add is goal-first — "What do you want to achieve?"
 *
 *   · AI suggest works across all horizons at once.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { toast } from "sonner";
import {
  Target,
  Sparkles,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  Lightbulb,
  Brain,
  Clock,
  Zap,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Activity,
  Pencil,
  X as XIcon,
  Check,
} from "lucide-react";
import { computePace, paceLabel, formatRate, type PaceVerdict } from "@/lib/brain/goal-pace";
import { notifyDataChanged, onDataChanged } from "@/lib/events/data-change";
import {
  effectiveHorizon,
  bucketByHorizon,
  HORIZON_TAB_ORDER,
  HORIZON_TAB_LABEL,
  HORIZON_STRIPE,
  type HorizonFilter,
  type GoalHorizon,
} from "@/lib/brain/goal-horizon";
import { classifyStaleness } from "@/lib/brain/goal-staleness";
import { MilestonesFlow } from "./milestones-flow";

import { authedFetch } from "@/hooks/use-authed-fetch";
type Horizon = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "LIFE";

interface CoachEntry {
  at: string;
  read: string;
  nextAction: string;
  blocker: string | null;
  risks: string[];
  progressPct: number;
}

interface LifeGoal {
  id: string;
  domain: string;
  title: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
  status: string;
  horizon: string | null;
  why: string | null;
  estimatedHours: number | null;
  coachLog: CoachEntry[] | null;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  linkedTaskCount?: number;
  linkedDoneCount?: number;
  linkedActiveCount?: number;
  minutesInvested?: number;
  // Apr 27 · GB1 + GB3 — server-enriched fields from /api/goals
  nextMove?: { id: string; title: string; status: string } | null;
  loopsThisWeek?: number;
}

// Apr 27 · G4 — which goal is currently in the milestones flow.
// Null means no flow is open. Single-goal-at-a-time so the panel
// doesn't pile up below multiple cards simultaneously.

interface SuggestedGoal {
  title: string;
  domain: string;
  metric: string;
  targetValue: number;
  unit: string;
  why: string;
  firstMove: string;
  milestones: string[];
}

/**
 * Cross-reference from each goal → its linked projects (Missions).
 * Computed by the parent tasks page by walking tasks: any Mission
 * with at least one Task whose `goalId` matches this goal is "linked".
 * Goes inline below the goal's title row so Nour can trace the
 * Goal → Project → Task ancestry without tab-hopping.
 */
export interface PlanLinkedProjectChip {
  id: string;
  title: string;
  openCount: number;
  totalCount: number;
}

interface KommandoPlanProps {
  /** Map of goalId → array of linked project chips. Keyed by LifeGoal.id. */
  goalToProjects?: Map<string, PlanLinkedProjectChip[]>;
  /** Fires when Nour taps a project chip. Parent scrolls to project card. */
  onJumpToProject?: (projectId: string) => void;
  /** Fires when Nour taps "Plan it" on a goal with no linked project.
   *  Parent seeds the project-create form with the goal title + goalId. */
  onPlanGoal?: (goal: { id: string; title: string }) => void;
  /** Apr 27 · GB1 — fires when Nour taps a goal's "next move" chip.
   *  Parent switches to NOW mode and scrolls to the matching task. */
  onJumpToTask?: (taskId: string) => void;
  /** Apr 27 · GB4 — fires when Nour taps the pace chip to create a
   *  daily-increment task. Parent creates a NOW task tagged with
   *  goalId so completing it auto-lifts the goal. */
  onCreateTaskForGoal?: (args: {
    goalId: string;
    title: string;
    /** Suggested per-day rate label (e.g. "+320 social_media_interactions"). */
    suggestedAmount: string;
  }) => Promise<void> | void;
}

const HORIZON_LABELS: Record<string, { label: string; accent: string }> = {
  DAY: { label: "Today", accent: "text-amber-400 border-amber-500/30 bg-amber-500/5" },
  WEEK: { label: "Week", accent: "text-blue-400 border-blue-500/30 bg-blue-500/5" },
  MONTH: { label: "Month", accent: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" },
  QUARTER: { label: "Quarter", accent: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5" },
  YEAR: { label: "Year", accent: "text-violet-400 border-violet-500/30 bg-violet-500/5" },
  LIFE: { label: "Life", accent: "text-pink-400 border-pink-500/30 bg-pink-500/5" },
};

export function KommandoPlan({
  goalToProjects,
  onJumpToProject,
  onPlanGoal,
  onJumpToTask,
  onCreateTaskForGoal,
}: KommandoPlanProps = {}) {
  const [goals, setGoals] = useState<LifeGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<SuggestedGoal[]>([]);
  const [overview, setOverview] = useState<string>("");
  const [warning, setWarning] = useState<string>("");
  const [newTitle, setNewTitle] = useState("");
  const [newWhy, setNewWhy] = useState("");
  const [newHorizon, setNewHorizon] = useState<Horizon | "">("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [coachingId, setCoachingId] = useState<string | null>(null);
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);

  // Apr 27 · GH1 — horizon tab filter. Defaults to "ALL" so the page
  // is never empty. Goals with explicit horizon use it; goals with
  // null horizon get auto-classified by their deadline (effectiveHorizon).
  const [horizonFilter, setHorizonFilter] = useState<HorizonFilter>("ALL");

  const horizonBuckets = useMemo(() => bucketByHorizon(goals), [goals]);
  const filteredGoals = horizonBuckets[horizonFilter] ?? goals;

  // Apr 27 · G4 — milestones-first PLAN IT flow. When non-null, the
  // panel renders inline below that goal card; null collapses it.
  const [milestonesGoalId, setMilestonesGoalId] = useState<string | null>(null);

  // Apr 27 · G2 — inline progress-logging UX state. When the metric
  // chip is tapped, the row id flips into edit mode revealing a
  // small +N input that PATCHes /api/goals with progressDelta. The
  // server emits a progress_logged GoalEvent + auto-recomputes the
  // goal's progress %.
  const [logId, setLogId] = useState<string | null>(null);
  const [logValue, setLogValue] = useState<string>("");
  const [logBusy, setLogBusy] = useState(false);

  // May 02 · goal-side project link management. X on each project chip
  // unlinks (PATCHes that project's tasks pointing at this goal back
  // to goalId=null). "+ project" opens a picker over all active projects
  // (Missions); selecting one PATCHes that project's tasks to this goalId.
  // Mirrors the project-side LinkGoalPicker pattern but inverted.
  const [unlinkingChip, setUnlinkingChip] = useState<string | null>(null); // `${goalId}:${projectId}`
  const [addProjectGoalId, setAddProjectGoalId] = useState<string | null>(null);
  const [availableProjects, setAvailableProjects] = useState<Array<{ id: string; title: string; domain?: string | null }>>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [linkingProjectId, setLinkingProjectId] = useState<string | null>(null);

  // Load ALL goals (no horizon filter) so the page is never empty
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authedFetch("/api/goals");
      if (r.ok) {
        const d = await r.json();
        const list = (d.data?.goals ?? d.goals ?? []) as LifeGoal[];
        setGoals(list.filter((g) => g.status === "active"));
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Apr 27 · cross-tab reactive refresh. When NOW completes a task
  // tagged with a goalId, the S3 hook bumps the goal currentValue
  // and emits a server-side event; the client-side mutation also
  // fires `notifyDataChanged("tasks")`. Listening on tasks + goals +
  // missions here means PLAN's pace chips, "loops this week"
  // counters, project momentum etc all update instantly.
  useEffect(() => {
    const off = onDataChanged(["tasks", "goals", "missions", "projects"], (e) => {
      // Skip self-fired events to avoid double-loads
      if (e.source === "kommando-plan") return;
      void load();
    });
    return off;
  }, [load]);

  // Apr 27 · archive a stale goal — flips status to "paused" so the
  // PLAN list (filter active) hides it + the LinkGoalPicker drops
  // it. Reusable from any "this is dead" UI affordance on the card.
  const archiveGoal = useCallback(
    async (goalId: string) => {
      try {
        const r = await authedFetch("/api/goals", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: goalId, status: "paused" }),
        });
        if (!r.ok) {
          toast.error("Couldn't archive");
          return;
        }
        toast.success("Archived. Find it later in paused goals.");
        notifyDataChanged("goals", { source: "kommando-plan", detail: "archive", id: goalId });
        await load();
      } catch {
        toast.error("Couldn't archive");
      }
    },
    [load],
  );

  // Apr 27 · G2 — inline progress-logging submitter. Declared after
  // `load` so the dependency reference works.
  const submitProgressLog = useCallback(
    async (goalId: string) => {
      const num = parseFloat(logValue);
      if (!Number.isFinite(num) || num === 0) {
        toast.error("Enter a non-zero number");
        return;
      }
      setLogBusy(true);
      try {
        const r = await authedFetch("/api/goals", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: goalId, progressDelta: num }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast.success(`Logged ${num > 0 ? "+" : ""}${num}`);
        setLogId(null);
        setLogValue("");
        notifyDataChanged("goals", {
          source: "kommando-plan",
          detail: "progress-log",
          id: goalId,
        });
        await load();
      } catch {
        toast.error("Couldn't log progress");
      } finally {
        setLogBusy(false);
      }
    },
    [logValue, load],
  );

  // May 02 · unlink a project from a goal: PATCH every task in that
  // project (Mission) where goalId === this goalId back to goalId=null.
  // Bridge derives Goal↔Project from Task.goalId+Task.missionId, so
  // touching tasks is the source of truth.
  const unlinkProjectFromGoal = useCallback(
    async (goalId: string, projectId: string, projectTitle: string) => {
      const chipKey = `${goalId}:${projectId}`;
      setUnlinkingChip(chipKey);
      try {
        const r = await authedFetch(`/api/tasks?missionId=${encodeURIComponent(projectId)}`);
        if (!r.ok) {
          toast.error("Couldn't load mission tasks");
          return;
        }
        // /api/tasks returns { ok, data: [...tasks...], meta } via apiHandler.
        // Older callsites also handle plain arrays + {tasks: [...]}, so be
        // tolerant of all three shapes.
        const d = await r.json();
        const list = (Array.isArray(d) ? d
          : Array.isArray(d?.data) ? d.data
          : Array.isArray(d?.data?.tasks) ? d.data.tasks
          : Array.isArray(d?.tasks) ? d.tasks
          : []) as Array<{ id: string; goalId?: string | null; missionId?: string | null }>;
        // Match by missionId too — when a Mission has been deleted but its
        // tasks linger as orphans, the chip still surfaces but listTasks
        // may have filtered the missionId column. Defensive double-check.
        const taskIds = list
          .filter((t) => t.goalId === goalId && (!t.missionId || t.missionId === projectId))
          .map((t) => t.id);
        if (taskIds.length === 0) {
          // Fallback: fetch ALL tasks (no missionId filter) and look for
          // orphans whose missionId points at the deleted project. Covers
          // the "(unknown project)" chip case where the join filtered them.
          const rAll = await authedFetch(`/api/tasks`);
          if (rAll.ok) {
            const dAll = await rAll.json();
            const allList = (Array.isArray(dAll) ? dAll
              : Array.isArray(dAll?.data) ? dAll.data
              : []) as Array<{ id: string; goalId?: string | null; missionId?: string | null }>;
            const orphanIds = allList
              .filter((t) => t.goalId === goalId && t.missionId === projectId)
              .map((t) => t.id);
            if (orphanIds.length === 0) {
              toast.error("Nothing to unlink");
              return;
            }
            taskIds.push(...orphanIds);
          } else {
            toast.error("Nothing to unlink");
            return;
          }
        }
        const results = await Promise.allSettled(
          taskIds.map((tid) =>
            authedFetch(`/api/tasks/${tid}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ goalId: null }),
            }),
          ),
        );
        const ok = results.filter((rr) => rr.status === "fulfilled" && rr.value.ok).length;
        if (ok > 0) {
          toast.success(
            `Unlinked ${ok} task${ok === 1 ? "" : "s"} from "${projectTitle.slice(0, 30)}"`,
          );
          notifyDataChanged("tasks", { source: "kommando-plan", detail: "project-unlink" });
          notifyDataChanged("goals", { source: "kommando-plan", detail: "project-unlink", id: goalId });
          notifyDataChanged("projects", { source: "kommando-plan", detail: "project-unlink", id: projectId });
          await load();
        } else {
          toast.error("Unlink failed");
        }
      } catch {
        toast.error("Unlink failed");
      } finally {
        setUnlinkingChip(null);
      }
    },
    [load],
  );

  // May 02 · open the "+ project" picker for a given goal. Lazy-loads
  // /api/missions on first open so we don't pay the cost upfront.
  const openAddProjectPicker = useCallback(async (goalId: string) => {
    setAddProjectGoalId(goalId);
    if (availableProjects.length === 0) {
      setLoadingProjects(true);
      try {
        const r = await authedFetch("/api/missions");
        if (r.ok) {
          const d = await r.json();
          // /api/missions response shape is { ok, data: { missions: [...] } | [...] }.
          // Tolerate raw arrays and bare {missions: [...]} too for safety.
          const inner = d?.data ?? d;
          const raw = (Array.isArray(inner) ? inner
            : Array.isArray(inner?.missions) ? inner.missions
            : []) as Array<{
              id: string;
              title: string;
              domain?: string | null;
              status?: string | null;
            }>;
          // Active only — paused/archived projects shouldn't be linked to.
          // Accept both "active" and "ACTIVE" since the Mission status enum
          // is uppercase in the DB but some legacy paths return lower-case.
          const active = raw.filter((m) => {
            if (!m.status) return true;
            const s = m.status.toLowerCase();
            return s === "active";
          });
          setAvailableProjects(active.map((m) => ({ id: m.id, title: m.title, domain: m.domain })));
        }
      } catch {
        toast.error("Couldn't load missions");
      } finally {
        setLoadingProjects(false);
      }
    }
  }, [availableProjects.length]);

  // May 02 · link a project to a goal: PATCH every task in that
  // project to goalId=this. Same task-level write pattern as unlink.
  const linkProjectToGoal = useCallback(
    async (goalId: string, projectId: string, projectTitle: string) => {
      setLinkingProjectId(projectId);
      try {
        const r = await authedFetch(`/api/tasks?missionId=${encodeURIComponent(projectId)}`);
        if (!r.ok) {
          toast.error("Couldn't load mission tasks");
          return;
        }
        const d = await r.json();
        const list = (Array.isArray(d) ? d
          : Array.isArray(d?.data) ? d.data
          : Array.isArray(d?.data?.tasks) ? d.data.tasks
          : Array.isArray(d?.tasks) ? d.tasks
          : []) as Array<{ id: string; goalId?: string | null }>;
        // Skip tasks already pointing at this goal (idempotent).
        const taskIds = list.filter((t) => t.goalId !== goalId).map((t) => t.id);
        if (taskIds.length === 0) {
          toast.error("Mission has no tasks to link");
          return;
        }
        const results = await Promise.allSettled(
          taskIds.map((tid) =>
            authedFetch(`/api/tasks/${tid}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ goalId }),
            }),
          ),
        );
        const ok = results.filter((rr) => rr.status === "fulfilled" && rr.value.ok).length;
        if (ok > 0) {
          toast.success(
            `Linked ${ok} task${ok === 1 ? "" : "s"} from "${projectTitle.slice(0, 30)}"`,
          );
          notifyDataChanged("tasks", { source: "kommando-plan", detail: "project-link" });
          notifyDataChanged("goals", { source: "kommando-plan", detail: "project-link", id: goalId });
          notifyDataChanged("projects", { source: "kommando-plan", detail: "project-link", id: projectId });
          setAddProjectGoalId(null);
          await load();
        } else {
          toast.error("Link failed");
        }
      } catch {
        toast.error("Link failed");
      } finally {
        setLinkingProjectId(null);
      }
    },
    [load],
  );

  const suggestGoals = useCallback(async () => {
    setSuggesting(true);
    setSuggested([]);
    setOverview("");
    setWarning("");
    try {
      const r = await authedFetch("/api/ai/suggest-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon: "LIFE" }),
      });
      if (!r.ok) {
        toast.error("Suggest failed");
        setSuggesting(false);
        return;
      }
      const d = await r.json();
      setSuggested(Array.isArray(d.goals) ? d.goals : []);
      setOverview(d.overview || "");
      setWarning(d.warning || "");
    } catch {
      toast.error("AI request failed");
    }
    setSuggesting(false);
  }, []);

  const adoptSuggestion = useCallback(
    async (s: SuggestedGoal) => {
      try {
        const r = await authedFetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: s.domain,
            title: s.title,
            metric: s.metric,
            targetValue: s.targetValue,
            unit: s.unit,
            horizon: "LIFE",
            why: s.why,
          }),
        });
        if (r.ok) {
          toast.success("Goal adopted");
          setSuggested((p) => p.filter((x) => x.title !== s.title));
          notifyDataChanged("goals", { source: "kommando-plan", detail: "adopt-suggestion" });
          load();
        }
      } catch {
        toast.error("Adopt failed");
      }
    },
    [load]
  );

  const addManual = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const r = await authedFetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: "personal",
          title,
          horizon: newHorizon || null,
          why: newWhy.trim() || undefined,
        }),
      });
      if (r.ok) {
        toast.success("Goal added");
        setNewTitle("");
        setNewWhy("");
        setNewHorizon("");
        setShowAddForm(false);
        notifyDataChanged("goals", { source: "kommando-plan", detail: "manual-add" });
        load();
      }
    } catch {
      toast.error("Failed");
    }
  }, [newTitle, newWhy, newHorizon, load]);

  const deleteGoal = useCallback(
    async (id: string) => {
      try {
        await authedFetch(`/api/goals?id=${id}`, { method: "DELETE" });
        setGoals((p) => p.filter((g) => g.id !== id));
        notifyDataChanged("goals", { source: "kommando-plan", detail: "delete", id });
      } catch {}
    },
    []
  );

  // Inline edit state — one row at a time. PATCH /api/goals supports
  // title / why / horizon out of the box (see updateGoalSchema).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editWhy, setEditWhy] = useState("");
  const [editHorizon, setEditHorizon] = useState<string>("");
  // May 02 · A/B/C — full goal-meta editability. Adds target/metric/
  // unit/deadline (so progress math stays accurate when scope changes)
  // + domain (route the goal to the right life area) + status (pause /
  // complete / abandon a goal without a hard delete).
  const [editTargetValue, setEditTargetValue] = useState<string>("");
  const [editMetric, setEditMetric] = useState<string>("");
  const [editUnit, setEditUnit] = useState<string>("");
  const [editDeadline, setEditDeadline] = useState<string>(""); // YYYY-MM-DD
  const [editDomain, setEditDomain] = useState<string>("");
  const [editStatus, setEditStatus] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = useCallback(
    (g: {
      id: string;
      title: string;
      why?: string | null;
      horizon?: string | null;
      targetValue?: number | null;
      metric?: string | null;
      unit?: string | null;
      deadline?: string | null;
      domain?: string | null;
      status?: string | null;
    }) => {
      setEditingId(g.id);
      setEditTitle(g.title);
      setEditWhy(g.why || "");
      setEditHorizon(g.horizon || "");
      setEditTargetValue(
        typeof g.targetValue === "number" ? String(g.targetValue) : "",
      );
      setEditMetric(g.metric || "");
      setEditUnit(g.unit || "");
      setEditDeadline(g.deadline ? g.deadline.slice(0, 10) : "");
      setEditDomain(g.domain || "");
      setEditStatus(g.status || "");
    },
    [],
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditTitle("");
    setEditWhy("");
    setEditHorizon("");
    setEditTargetValue("");
    setEditMetric("");
    setEditUnit("");
    setEditDeadline("");
    setEditDomain("");
    setEditStatus("");
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    const title = editTitle.trim();
    if (!title) {
      toast.error("Title required");
      return;
    }
    // Build delta payload — skip fields the user didn't touch so we
    // don't overwrite server-side values with empty strings.
    const payload: Record<string, unknown> = { id: editingId, title };
    payload.why = editWhy.trim() || null;
    if (editHorizon) payload.horizon = editHorizon;
    if (editTargetValue !== "") {
      const tv = parseFloat(editTargetValue);
      if (Number.isFinite(tv)) payload.targetValue = tv;
    }
    if (editMetric) payload.metric = editMetric;
    if (editUnit) payload.unit = editUnit;
    if (editDeadline) {
      // datetime() validator wants ISO 8601 — promote YYYY-MM-DD to
      // end-of-day UTC so deadline filters don't fire a day early.
      payload.deadline = `${editDeadline}T23:59:59.000Z`;
    } else {
      payload.deadline = null;
    }
    if (editDomain) payload.domain = editDomain;
    if (editStatus) payload.status = editStatus;
    setSavingEdit(true);
    try {
      const r = await authedFetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        toast.success("Goal updated");
        notifyDataChanged("goals", { source: "kommando-plan", detail: "edit", id: editingId });
        cancelEdit();
        await load();
      } else {
        toast.error("Save failed");
      }
    } catch {
      toast.error("Save failed");
    } finally {
      setSavingEdit(false);
    }
  }, [editingId, editTitle, editWhy, editHorizon, editTargetValue, editMetric, editUnit, editDeadline, editDomain, editStatus, cancelEdit, load]);

  const coachGoal = useCallback(
    async (goalId: string) => {
      setCoachingId(goalId);
      try {
        const r = await authedFetch("/api/ai/coach-goal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goalId }),
        });
        if (!r.ok) throw new Error("coach failed");
        setExpandedGoal(goalId);
        toast.success("Nick has a read");
        await load();
      } catch {
        toast.error("Coach failed");
      }
      setCoachingId(null);
    },
    [load]
  );

  // Smart headline — includes project linkage so Nour sees the full
  // Goal → Project → Task chain health in one line
  const headline = useMemo(() => {
    if (goals.length === 0) return "no goals";
    const avgProgress = Math.round(
      goals.reduce((s, g) => s + g.progress, 0) / goals.length
    );
    const noLoops = goals.filter((g) => (g.linkedTaskCount ?? 0) === 0).length;
    const goalsWithProject = goalToProjects
      ? goals.filter((g) => (goalToProjects.get(g.id)?.length ?? 0) > 0).length
      : null;
    const projectGap =
      goalsWithProject !== null ? goals.length - goalsWithProject : null;

    if (noLoops === goals.length)
      return `${goals.length} goals, none broken into loops. Plan one now — Nick will spin up a project.`;
    if (projectGap !== null && projectGap > 0 && projectGap === goals.length)
      return `${goals.length} goals, ${projectGap} without a linked project. Break them down.`;
    if (projectGap !== null && projectGap > 0)
      return `${goals.length - projectGap}/${goals.length} goals have projects · ${avgProgress}% avg progress.`;
    if (noLoops > 0)
      return `${noLoops} of ${goals.length} goals have no plan. Tap to decompose.`;
    if (avgProgress >= 80) return "Goals are converging. Push to close.";
    if (avgProgress >= 40) return `${avgProgress}% average progress. Keep compounding.`;
    return `${goals.length} goals in play. ${avgProgress}% average.`;
  }, [goals, goalToProjects]);

  // Apr 20 — NEEDS ATTENTION callout retired. Nour called out the
  // redundancy: the callout and the goal cards below it rendered the
  // exact same list twice with the same "no plan" badge, eating the
  // most valuable pixels of the Plan surface. Goal cards already show
  // the no-plan state inline + now carry a "Plan it" button that
  // drops the goal title straight into the project-create flow. The
  // callout added zero new information.

  return (
    <div className="space-y-3">
      {/* ── Headline + add + suggest ── */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-bold text-zinc-200 leading-snug flex-1">
            {headline}
          </p>
          <Button
            size="sm"
            onClick={suggestGoals}
            disabled={suggesting}
            className="h-7 px-2.5 bg-violet-500/15 text-violet-300 hover:bg-violet-500/30 text-[9px] font-bold border border-violet-500/30 shrink-0"
          >
            {suggesting ? (
              <Loader2 size={11} className="animate-spin mr-1" />
            ) : (
              <Sparkles size={11} className="mr-1" />
            )}
            AI suggest
          </Button>
        </div>

        {/* Quick-add */}
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <Input
              placeholder="What do you want to achieve?"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (showAddForm) addManual();
                  else if (newTitle.trim()) setShowAddForm(true);
                }
              }}
              className="h-9 bg-zinc-900/60 border-zinc-800/40 text-[13px] placeholder:text-zinc-600 focus:border-blue-500/30 transition-all"
            />
            <Button
              size="sm"
              className="h-9 w-9 p-0 bg-zinc-800/80 hover:bg-blue-500/20 hover:text-blue-400 border border-zinc-700/50 shrink-0"
              onClick={() => {
                if (!showAddForm && newTitle.trim()) setShowAddForm(true);
                else addManual();
              }}
            >
              <Plus size={14} />
            </Button>
          </div>

          {showAddForm && newTitle.trim() && (
            <div className="rounded-lg bg-zinc-900/40 border border-zinc-800/30 p-2.5 space-y-1.5">
              <Input
                placeholder="Why does this matter?"
                value={newWhy}
                onChange={(e) => setNewWhy(e.target.value)}
                className="h-7 bg-zinc-900/60 border-zinc-800/40 text-[11px] placeholder:text-zinc-700"
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[8px] text-zinc-600 uppercase tracking-wider">
                  Horizon:
                </span>
                {(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "LIFE"] as Horizon[]).map(
                  (h) => (
                    <button
                      key={h}
                      onClick={() => setNewHorizon(newHorizon === h ? "" : h)}
                      className={cn(
                        "text-[8px] px-2 py-0.5 rounded border uppercase tracking-wider transition-all",
                        newHorizon === h
                          ? HORIZON_LABELS[h].accent
                          : "text-zinc-600 border-zinc-800/40"
                      )}
                    >
                      {HORIZON_LABELS[h].label}
                    </button>
                  )
                )}
              </div>
              <div className="flex items-center gap-1.5 justify-end">
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewWhy("");
                    setNewHorizon("");
                  }}
                  className="text-[9px] text-zinc-600 hover:text-zinc-300 px-2"
                >
                  cancel
                </button>
                <Button
                  size="sm"
                  className="h-6 px-3 text-[9px] bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500 hover:text-black font-bold border border-emerald-500/30"
                  onClick={addManual}
                >
                  Add goal
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── AI overview + warning ── */}
      {(overview || warning) && (
        <div className="space-y-1.5">
          {overview && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-violet-500/5 border border-violet-500/20">
              <Lightbulb size={11} className="text-violet-400/70 mt-0.5 shrink-0" />
              <p className="text-[10px] text-zinc-300 italic leading-relaxed">{overview}</p>
            </div>
          )}
          {warning && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <AlertTriangle size={11} className="text-amber-400/70 mt-0.5 shrink-0" />
              <p className="text-[10px] text-amber-200/90 leading-relaxed">{warning}</p>
            </div>
          )}
        </div>
      )}

      {/* ── AI suggestions ── */}
      {suggested.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-violet-400/80 px-0.5">
            Nick suggests ({suggested.length})
          </p>
          {suggested.map((s, i) => (
            <div
              key={i}
              className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-2.5 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-zinc-200">{s.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <Badge className="bg-zinc-800 text-zinc-400 text-[8px] h-3">
                      {s.domain}
                    </Badge>
                    {s.targetValue > 0 && (
                      <span className="text-[9px] text-zinc-500 font-mono">
                        {s.targetValue} {s.unit}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => adoptSuggestion(s)}
                  className="h-6 px-2 text-[9px] bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500 hover:text-black font-bold border border-emerald-500/30 shrink-0"
                >
                  Adopt
                </Button>
              </div>
              {s.why && <p className="text-[10px] text-zinc-400 italic">{s.why}</p>}
              {s.firstMove && (
                <p className="text-[10px] text-emerald-300/80">
                  <Zap size={9} className="inline mr-1" />
                  First move: {s.firstMove}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Goal cards ── */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <ShimmerSkeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <div className="text-center py-8 rounded-xl border border-zinc-800/40 bg-zinc-900/20 space-y-2">
          <Target size={20} className="mx-auto text-zinc-700" />
          <p className="text-[11px] text-zinc-500">
            Type a goal above or tap AI suggest.
          </p>
          <p className="text-[9px] text-zinc-700 italic max-w-[240px] mx-auto">
            Think big. &ldquo;Lose 44 lbs.&rdquo; &ldquo;$10K/month take-home.&rdquo;
            &ldquo;Learn Spanish fluently.&rdquo; Nick will help you plan it.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Apr 27 · GH1 — horizon tab bar. Filters the goal list by
              effective horizon (auto-classified from deadline when the
              explicit field is null). Counts shown so empty buckets
              are visible at a glance. */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {HORIZON_TAB_ORDER.map((h) => {
              const count = horizonBuckets[h]?.length ?? 0;
              const active = horizonFilter === h;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHorizonFilter(h)}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors",
                    active
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                      : "border-zinc-800 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                  )}
                >
                  <span>{HORIZON_TAB_LABEL[h]}</span>
                  <span className={cn("text-[8px]", active ? "text-amber-400/70" : "text-zinc-600")}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {filteredGoals.length === 0 ? (
            <p className="text-[11px] text-zinc-600 italic px-2 py-3">
              No goals in this horizon. Switch tabs or add one above.
            </p>
          ) : null}

          {filteredGoals.map((g) => {
            const latestCoach: CoachEntry | null =
              Array.isArray(g.coachLog) && g.coachLog.length > 0
                ? g.coachLog[g.coachLog.length - 1]
                : null;
            const isExpanded = expandedGoal === g.id;
            // Apr 27 · GH2 — auto-classify from deadline when horizon
            // is null. The card stripe + badge use this so visual
            // grouping works even on legacy goals.
            const eHorizon: GoalHorizon = effectiveHorizon(g);
            const horizonMeta = HORIZON_LABELS[eHorizon] ?? null;
            const noLoops = (g.linkedTaskCount ?? 0) === 0;

            return (
              <div
                key={g.id}
                className="rounded-xl border border-zinc-800/40 bg-zinc-900/40 overflow-hidden group flex"
              >
                {/* Apr 27 · GH4 — colored vertical stripe per horizon.
                    Glance-readable visual grouping; works alongside
                    the existing horizon badge inside the row. */}
                <div className={cn("w-1 shrink-0", HORIZON_STRIPE[eHorizon])} aria-hidden />
                <div className="flex-1 min-w-0">
                {/* Main row — tappable to expand.
                    Apr 27 · LINK-FIX — was a <button>, but the row
                    contains nested <button>s for archive, progress
                    log, pace chip, plan-it. Nested <button> is
                    invalid HTML and crashes hydration in Next 16.
                    Converted to div+role=button. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedGoal(isExpanded ? null : g.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedGoal(isExpanded ? null : g.id);
                    }
                  }}
                  className="w-full p-3 text-left hover:bg-zinc-900/60 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-blue-500/40"
                >
                  <div className="flex items-start gap-2.5">
                    {/* Progress ring */}
                    <div className="relative w-10 h-10 shrink-0">
                      <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                        <circle
                          cx="18"
                          cy="18"
                          r="15"
                          fill="none"
                          stroke="rgb(39 39 42 / 0.5)"
                          strokeWidth="3"
                        />
                        <circle
                          cx="18"
                          cy="18"
                          r="15"
                          fill="none"
                          stroke={
                            g.progress >= 80
                              ? "rgb(52 211 153)"
                              : g.progress >= 40
                                ? "rgb(96 165 250)"
                                : "rgb(161 161 170)"
                          }
                          strokeWidth="3"
                          strokeDasharray={`${g.progress * 0.942} 100`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold font-mono text-zinc-400">
                        {g.progress}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      {editingId === g.id ? (
                        // Inline edit mode — full goal-meta panel
                        <div
                          className="space-y-1.5 mb-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Goal title"
                            className="w-full bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[13px] font-bold text-zinc-100 focus:outline-none focus:border-amber-500"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={editWhy}
                            onChange={(e) => setEditWhy(e.target.value)}
                            placeholder="Why does this matter? (optional)"
                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-300 italic focus:outline-none focus:border-amber-500/40"
                          />
                          {/* May 02 · target/metric/unit row — feeds the
                              pace math + progress chip on the goal card. */}
                          <div className="grid grid-cols-3 gap-1.5">
                            <input
                              type="number"
                              step="any"
                              value={editTargetValue}
                              onChange={(e) => setEditTargetValue(e.target.value)}
                              placeholder="target"
                              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-zinc-300 focus:outline-none focus:border-amber-500/40"
                            />
                            <input
                              type="text"
                              value={editMetric}
                              onChange={(e) => setEditMetric(e.target.value)}
                              placeholder="metric"
                              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-zinc-300 focus:outline-none focus:border-amber-500/40"
                            />
                            <input
                              type="text"
                              value={editUnit}
                              onChange={(e) => setEditUnit(e.target.value)}
                              placeholder="unit"
                              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-zinc-300 focus:outline-none focus:border-amber-500/40"
                            />
                          </div>
                          {/* May 02 · deadline + domain + status row */}
                          <div className="grid grid-cols-3 gap-1.5">
                            <input
                              type="date"
                              value={editDeadline}
                              onChange={(e) => setEditDeadline(e.target.value)}
                              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-zinc-300 focus:outline-none focus:border-amber-500/40"
                            />
                            <select
                              value={editDomain}
                              onChange={(e) => setEditDomain(e.target.value)}
                              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[9px] text-zinc-300 focus:outline-none focus:border-amber-500/40"
                            >
                              <option value="">— domain —</option>
                              <option value="business">business</option>
                              <option value="personal">personal</option>
                              <option value="health">health</option>
                              <option value="content">content</option>
                              <option value="finance">finance</option>
                            </select>
                            <select
                              value={editStatus}
                              onChange={(e) => setEditStatus(e.target.value)}
                              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[9px] text-zinc-300 focus:outline-none focus:border-amber-500/40"
                            >
                              <option value="">— status —</option>
                              <option value="active">active</option>
                              <option value="paused">paused</option>
                              <option value="achieved">achieved</option>
                              <option value="completed">completed</option>
                              <option value="abandoned">abandoned</option>
                              <option value="missed">missed</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={editHorizon}
                              onChange={(e) => setEditHorizon(e.target.value)}
                              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[9px] text-zinc-300 focus:outline-none focus:border-amber-500/40"
                            >
                              <option value="">No horizon</option>
                              <option value="DAY">Day</option>
                              <option value="WEEK">Week</option>
                              <option value="MONTH">Month</option>
                              <option value="QUARTER">Quarter</option>
                              <option value="YEAR">Year</option>
                              <option value="LIFE">Life</option>
                            </select>
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={savingEdit || !editTitle.trim()}
                              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[9px] text-amber-300 font-bold uppercase tracking-wider hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {savingEdit ? (
                                <Loader2 size={9} className="animate-spin" />
                              ) : (
                                <Check size={9} />
                              )}
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-700 text-[9px] text-zinc-400 uppercase tracking-wider hover:border-zinc-600 hover:text-zinc-300"
                            >
                              <XIcon size={9} />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className={cn("flex items-center gap-1.5 flex-wrap", editingId === g.id && "hidden")}>
                        <span className="text-[13px] font-bold text-zinc-100">
                          {g.title}
                        </span>
                        {horizonMeta && (
                          <Badge
                            className={cn(
                              "text-[7px] h-3 border shrink-0",
                              horizonMeta.accent
                            )}
                          >
                            {horizonMeta.label}
                          </Badge>
                        )}
                        {noLoops && (
                          <Badge className="bg-amber-500/10 text-amber-400 text-[7px] h-3 border border-amber-500/20 shrink-0">
                            no plan
                          </Badge>
                        )}
                        {/* Apr 27 · staleness chip + archive action.
                            Renders only when the goal classifies as
                            stale (0% + no tasks + 30d+) or decaying.
                            One-tap "archive" sets status=paused so the
                            zombie disappears from active views. */}
                        {(() => {
                          const v = classifyStaleness({
                            createdAt: g.createdAt,
                            updatedAt: g.updatedAt,
                            progress: g.progress,
                            currentValue: g.currentValue,
                            status: g.status,
                            linkedActiveCount: g.linkedActiveCount,
                            linkedDoneCount: g.linkedDoneCount,
                            loopsThisWeek: g.loopsThisWeek,
                          });
                          if (v.kind === "alive") return null;
                          const isStale = v.kind === "stale";
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  confirm(
                                    `Archive "${g.title}"?\n${v.reason}\n\nIt'll move to paused — you can revive it later from /goals.`,
                                  )
                                ) {
                                  void archiveGoal(g.id);
                                }
                              }}
                              title={`${v.reason} · tap to archive`}
                              className={cn(
                                "text-[7px] h-3 px-1.5 rounded border shrink-0 inline-flex items-center gap-1 hover:bg-rose-500/20 transition-colors",
                                isStale
                                  ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                                  : "border-amber-500/30 bg-amber-500/5 text-amber-400",
                              )}
                            >
                              {isStale ? "stale · archive" : "decaying"}
                            </button>
                          );
                        })()}
                      </div>
                      {g.why && editingId !== g.id && (
                        <p className="text-[10px] text-zinc-500 italic mt-0.5 line-clamp-1">
                          {g.why}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-[9px] text-zinc-600 font-mono flex-wrap">
                        <Badge className="bg-zinc-800/50 text-zinc-500 text-[8px] h-3 border-0">
                          {g.domain}
                        </Badge>
                        {(g.linkedTaskCount ?? 0) > 0 && (
                          <span>
                            {g.linkedDoneCount}/{g.linkedTaskCount} loops
                          </span>
                        )}
                        {/* Apr 27 · GB3 — loops moved this week. The
                            "is this goal alive?" pulse. Pulled from
                            TaskEvent log; rendered emerald when > 0,
                            zinc when 0 with a "0 this week" callout. */}
                        {(g.linkedTaskCount ?? 0) > 0 && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 px-1 rounded border",
                              (g.loopsThisWeek ?? 0) > 0
                                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                                : "border-zinc-800 text-zinc-500"
                            )}
                            title="Tasks completed on this goal in the last 7 days"
                          >
                            {g.loopsThisWeek ?? 0} this week
                          </span>
                        )}
                        {(g.minutesInvested ?? 0) > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Clock size={8} />
                            {Math.round((g.minutesInvested ?? 0) / 60)}h
                          </span>
                        )}
                        {/* Apr 27 · G2 — inline progress logging.
                            Tap the metric chip → reveals a small +N
                            input. Enter saves via PATCH /api/goals
                            { progressDelta }; cancels on Escape or
                            clicking outside via the X button. */}
                        {g.targetValue > 0 && logId !== g.id && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLogId(g.id);
                              setLogValue("");
                            }}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-zinc-700 hover:border-amber-500/40 hover:bg-amber-500/5 transition-colors"
                            title="Log progress"
                          >
                            <span>
                              {g.currentValue}/{g.targetValue} {g.unit}
                            </span>
                            <Plus size={9} className="opacity-60" />
                          </button>
                        )}
                        {g.targetValue > 0 && logId === g.id && (
                          <div
                            className="inline-flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Input
                              autoFocus
                              type="number"
                              step="any"
                              value={logValue}
                              onChange={(e) => setLogValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void submitProgressLog(g.id);
                                } else if (e.key === "Escape") {
                                  setLogId(null);
                                  setLogValue("");
                                }
                              }}
                              placeholder="+N"
                              className="h-5 w-14 px-1.5 text-[10px] bg-zinc-900 border-amber-500/40"
                            />
                            <button
                              type="button"
                              onClick={() => void submitProgressLog(g.id)}
                              disabled={logBusy || !logValue}
                              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 disabled:opacity-50"
                            >
                              {logBusy ? <Loader2 size={9} className="animate-spin" /> : "log"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setLogId(null);
                                setLogValue("");
                              }}
                              className="text-[9px] text-zinc-600 hover:text-zinc-400"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                        {g.targetValue === 0 && (
                          <span>{g.currentValue} {g.unit}</span>
                        )}
                      </div>

                      {/* Apr 26 · G1 — pace projection chip. Computes
                          required-vs-actual rate from currentValue,
                          targetValue, deadline + createdAt. Hidden
                          when goal has no deadline OR no targetValue. */}
                      {(() => {
                        const v: PaceVerdict = computePace({
                          currentValue: g.currentValue,
                          targetValue: g.targetValue,
                          deadline: g.deadline,
                          createdAt: g.createdAt,
                        });
                        if (v.kind === "unscored") return null;
                        const label = paceLabel(v, g.unit);
                        const tone =
                          v.kind === "ahead"
                            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                            : v.kind === "on-track"
                              ? "border-sky-500/30 bg-sky-500/5 text-sky-300"
                              : v.kind === "behind"
                                ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
                                : v.kind === "missed"
                                  ? "border-rose-500/30 bg-rose-500/5 text-rose-300"
                                  : "border-zinc-700 bg-zinc-800/40 text-zinc-400";
                        const Icon =
                          v.kind === "ahead"
                            ? TrendingUp
                            : v.kind === "behind" || v.kind === "missed"
                              ? TrendingDown
                              : Activity;
                        // Apr 27 · GB4 — when pace says "needs N/day"
                        // or "behind · need N/day," the chip becomes a
                        // tap-to-create-task button. New task tagged
                        // with goalId so completing it auto-lifts the
                        // goal via the S3 hook.
                        const actionable =
                          (v.kind === "needs" || v.kind === "behind") &&
                          !!onCreateTaskForGoal;
                        const suggestedAmount =
                          v.kind === "needs"
                            ? `+${formatRate(v.perDay)} ${g.unit || g.metric || "unit"}`
                            : v.kind === "behind"
                              ? `+${formatRate(v.needPerDay)} ${g.unit || g.metric || "unit"}`
                              : "";
                        const chipBody = (
                          <>
                            <Icon size={9} />
                            <span>{label}</span>
                            {actionable && (
                              <>
                                <span className="opacity-40">·</span>
                                <Plus size={9} className="opacity-70" />
                              </>
                            )}
                          </>
                        );
                        return actionable ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!onCreateTaskForGoal) return;
                              const taskTitle = `Move "${g.title}" · ${suggestedAmount}`;
                              void onCreateTaskForGoal({
                                goalId: g.id,
                                title: taskTitle,
                                suggestedAmount,
                              });
                            }}
                            title={`Tap to add a daily-increment task to NOW (${suggestedAmount}/day)`}
                            className={cn(
                              "mt-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-mono hover:scale-[1.02] transition-transform",
                              tone
                            )}
                          >
                            {chipBody}
                          </button>
                        ) : (
                          <div
                            className={cn(
                              "mt-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-mono",
                              tone
                            )}
                          >
                            {chipBody}
                          </div>
                        );
                      })()}

                      {/* Apr 27 · GB1 — Next-move chip. Surfaces the
                          single highest-priority active task linked to
                          this goal. Tap → switches to NOW + scrolls to
                          that task. The "what's the next physical
                          action" answer at a glance, on every goal. */}
                      {g.nextMove && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onJumpToTask?.(g.nextMove!.id);
                          }}
                          className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[9px] hover:bg-emerald-500/10 transition-colors w-full text-left"
                          title="Jump to this task on NOW"
                        >
                          <Zap size={9} className="text-emerald-400 shrink-0" />
                          <span className="font-mono uppercase tracking-wider text-emerald-400/70 shrink-0">
                            {g.nextMove.status === "DOING" ? "in flight:" : "next:"}
                          </span>
                          <span className="text-zinc-300 truncate">
                            {g.nextMove.title}
                          </span>
                          <ArrowRight size={9} className="text-emerald-400/60 shrink-0 ml-auto" />
                        </button>
                      )}

                      {/* Apr 20 — Goal ↔ Project bridge. Shows which
                          projects (Missions) this goal is actually
                          producing work through. Tap a chip to jump
                          to that project card. If nothing's linked,
                          a "Plan it" chip seeds the project-create
                          flow with this goal's title. */}
                      {(() => {
                        const linked = goalToProjects?.get(g.id) || [];
                        const linkedIds = new Set(linked.map((lp) => lp.id));
                        // Filter the on-demand project list to projects
                        // not already linked to this goal — avoids dup
                        // chips when re-PATCHing tasks already tagged.
                        const linkable = availableProjects.filter((p) => !linkedIds.has(p.id));
                        return (
                          <div className="flex items-center flex-wrap gap-1 mt-1.5">
                            <span
                              className={cn(
                                "text-[8px] font-mono uppercase tracking-wider shrink-0",
                                linked.length > 0 ? "text-zinc-600" : "text-amber-400/60",
                              )}
                            >
                              {linked.length > 0 ? "↳ missions:" : "↳ no mission yet"}
                            </span>
                            {linked.map((lp) => {
                              const chipKey = `${g.id}:${lp.id}`;
                              const isUnlinking = unlinkingChip === chipKey;
                              return (
                                <span
                                  key={lp.id}
                                  className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/5 text-blue-300"
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onJumpToProject?.(lp.id);
                                    }}
                                    className="hover:text-blue-200 transition-colors font-medium"
                                    title={`${lp.openCount} open · ${lp.totalCount} total — tap to jump`}
                                  >
                                    {lp.title.slice(0, 28)} ·{" "}
                                    <span className="text-zinc-500">{lp.openCount}/{lp.totalCount}</span>
                                  </button>
                                  {/* May 02 · X to unlink. PATCHes every
                                      task in this project pointing at
                                      this goalId back to goalId=null. */}
                                  <button
                                    type="button"
                                    disabled={isUnlinking}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void unlinkProjectFromGoal(g.id, lp.id, lp.title);
                                    }}
                                    className="text-blue-400/70 hover:text-rose-400 hover:bg-rose-500/10 rounded-sm leading-none w-3 h-3 inline-flex items-center justify-center transition-colors disabled:opacity-40"
                                    title={`Unlink "${lp.title}" from this goal`}
                                  >
                                    {isUnlinking ? (
                                      <Loader2 size={8} className="animate-spin" />
                                    ) : (
                                      "×"
                                    )}
                                  </button>
                                </span>
                              );
                            })}
                            {linked.length === 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMilestonesGoalId(g.id);
                                }}
                                className="text-[9px] px-1.5 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 hover:border-blue-500/70 hover:bg-blue-500/25 transition-all font-bold uppercase tracking-wider flex items-center gap-0.5"
                                title="Break this goal into 3-5 milestones with Nick — then spawn the mission"
                              >
                                <Brain size={8} />
                                plan it
                              </button>
                            )}
                            {/* May 02 · "+ project" — link an existing
                                project to this goal by PATCHing all of
                                that project's tasks with goalId=this. */}
                            <div className="relative inline-flex">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (addProjectGoalId === g.id) {
                                    setAddProjectGoalId(null);
                                  } else {
                                    void openAddProjectPicker(g.id);
                                  }
                                }}
                                className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-px rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:border-amber-500/70 hover:bg-amber-500/25 transition-all"
                                title="Link an existing mission to this goal"
                              >
                                + project
                              </button>
                              {addProjectGoalId === g.id && (
                                <div
                                  className="absolute left-0 top-full mt-1 z-30 min-w-[220px] max-w-[300px] rounded-lg border border-zinc-700/60 bg-zinc-950 shadow-[0_8px_24px_rgba(0,0,0,0.6)] overflow-hidden"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-zinc-800/50">
                                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400 flex items-center gap-1">
                                      <Target size={9} />
                                      pick a project
                                    </span>
                                    <button
                                      onClick={() => setAddProjectGoalId(null)}
                                      className="text-zinc-600 hover:text-zinc-300"
                                      aria-label="close"
                                    >
                                      <XIcon size={10} />
                                    </button>
                                  </div>
                                  <div className="max-h-[240px] overflow-y-auto py-1">
                                    {loadingProjects && (
                                      <p className="px-2.5 py-3 text-[10px] text-zinc-600 italic flex items-center gap-1.5">
                                        <Loader2 size={10} className="animate-spin" />
                                        loading projects…
                                      </p>
                                    )}
                                    {!loadingProjects && linkable.length === 0 && (
                                      <p className="px-2.5 py-3 text-[10px] text-zinc-600 italic">
                                        {availableProjects.length === 0
                                          ? "no missions"
                                          : "All missions already linked."}
                                      </p>
                                    )}
                                    {linkable.map((p) => (
                                      <button
                                        key={p.id}
                                        onClick={() => void linkProjectToGoal(g.id, p.id, p.title)}
                                        disabled={linkingProjectId !== null}
                                        className={cn(
                                          "w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-900 transition-colors",
                                          linkingProjectId === p.id && "opacity-60",
                                        )}
                                      >
                                        {linkingProjectId === p.id ? (
                                          <Loader2 size={10} className="animate-spin text-blue-400 shrink-0" />
                                        ) : (
                                          <Target size={10} className="text-blue-400 shrink-0" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <p className="text-[11px] truncate text-zinc-200">{p.title}</p>
                                          {p.domain && (
                                            <p className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">
                                              {p.domain}
                                            </p>
                                          )}
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="shrink-0 mt-1">
                      {isExpanded ? (
                        <ChevronUp size={12} className="text-zinc-600" />
                      ) : (
                        <ChevronDown size={12} className="text-zinc-600" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Apr 27 · G4 — milestones flow panel. Renders below
                    the goal card when "plan it" is tapped. Owns the
                    full lifecycle: AI proposes 3-5 milestones, Nour
                    edits/confirms, project spawns with phases mapped
                    to milestones, first phase auto-spawns to NOW
                    tagged with this goalId. */}
                {milestonesGoalId === g.id && (
                  <div className="px-3 pb-3 border-t border-blue-500/20">
                    <div className="mt-2">
                      <MilestonesFlow
                        goal={{
                          id: g.id,
                          title: g.title,
                          targetValue: g.targetValue,
                          unit: g.unit,
                          metric: g.metric,
                          deadline: g.deadline,
                          domain: g.domain,
                        }}
                        onComplete={() => {
                          setMilestonesGoalId(null);
                          notifyDataChanged("goals", {
                            source: "kommando-plan",
                            detail: "milestones-flow-complete",
                            id: g.id,
                          });
                          void load();
                        }}
                        onCancel={() => setMilestonesGoalId(null)}
                      />
                    </div>
                  </div>
                )}

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2 border-t border-zinc-800/30">
                    {/* Coach section — visible when coached, or prompt to coach */}
                    {latestCoach ? (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/70">
                            Nick&apos;s read
                          </p>
                          <button
                            onClick={() => coachGoal(g.id)}
                            disabled={coachingId === g.id}
                            className="text-[8px] text-amber-400/50 hover:text-amber-400 uppercase"
                          >
                            {coachingId === g.id ? "thinking…" : "refresh"}
                          </button>
                        </div>
                        <p className="text-[11px] text-zinc-300 leading-relaxed">
                          {latestCoach.read}
                        </p>
                        <div className="flex items-start gap-2 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                          <Zap size={10} className="text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/70">
                              Next move
                            </p>
                            <p className="text-[11px] text-zinc-200">
                              {latestCoach.nextAction}
                            </p>
                          </div>
                        </div>
                        {latestCoach.blocker && (
                          <div className="flex items-start gap-2 text-[10px]">
                            <AlertTriangle
                              size={9}
                              className="text-red-400/60 shrink-0 mt-0.5"
                            />
                            <span className="text-zinc-400">
                              Blocker: {latestCoach.blocker}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => coachGoal(g.id)}
                        disabled={coachingId === g.id}
                        className="mt-2 w-full flex items-center justify-center gap-2 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
                      >
                        {coachingId === g.id ? (
                          <Loader2 size={12} className="animate-spin text-amber-400" />
                        ) : (
                          <Brain size={12} className="text-amber-400" />
                        )}
                        <span className="text-[10px] font-bold text-amber-300">
                          {coachingId === g.id
                            ? "Nick is analyzing…"
                            : "Ask Nick to analyze this goal"}
                        </span>
                      </button>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(g);
                        }}
                        className="text-[8px] text-zinc-600 hover:text-amber-400 uppercase tracking-wider flex items-center gap-1"
                      >
                        <Pencil size={9} />
                        Edit
                      </button>
                      {/* v10.0.529.84 · Wave 28 · A6 · was deleteGoal(g.id) ·
                          archiveGoal preserves the CoachLog + GoalEvent
                          history (recoverable from soft-delete) instead
                          of nuking a goal you might want to reflect on
                          later. The audit caught this as a real data-
                          loss risk · the archive function was already
                          there at line 257, just not wired here. */}
                      <button
                        onClick={() => archiveGoal(g.id)}
                        className="text-[8px] text-zinc-700 hover:text-amber-400 uppercase tracking-wider flex items-center gap-1"
                        title="pauses the goal · history preserved · recoverable"
                      >
                        <Trash2 size={9} />
                        archive
                      </button>
                    </div>
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
