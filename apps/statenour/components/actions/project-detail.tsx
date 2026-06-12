"use client";

/**
 * ProjectDetail — the rich project detail panel.
 *
 * Renders when a project is expanded in the Actions page. Replaces
 * the old flat task-list view with a four-tab deep-dive:
 *
 *   · PLAN   — phases grouped by milestone, with steps, proTips,
 *              decision points, risks, tools & materials, done
 *              checklist. Pulls from mission.planData.
 *   · LEARN  — Nick-generated learning path. Key concepts,
 *              prerequisites, resources, practice exercises, and a
 *              minimum-viable-understanding read. Loaded on demand.
 *   · GUIDE  — Nick-generated coach entries. Given current progress,
 *              asks Nick for "what's next". Persists to
 *              planData.coachLog so you get a history of coaching
 *              moments.
 *   · CHECK  — the done-checklist from the plan.
 *
 * Falls back gracefully if planData is missing (old projects created
 * before Apr 15) — shows the flat task list instead.
 */

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Brain,
  BookOpen,
  Compass,
  CheckSquare,
  ChevronRight,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Lightbulb,
  Wrench,
  Loader2,
  Sparkles,
  ExternalLink,
  Clock,
  Trash2,
  Pencil,
  X as XIcon,
  Check,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { notifyDataChanged } from "@/lib/events/data-change";
import { trpc } from "@/lib/trpc/client";
import { createTask } from "@/lib/services/client/tasks";
import { LinkedMissionsPanel } from "@/components/missions/linked-missions-panel";
import {
  isProjectPlanData,
  type ProjectPlanData,
  type LearningPath,
  type CoachEntry,
} from "@/lib/ai/project-plan";

interface Task {
  id: string;
  title: string;
  status: string;
  nextPhysicalAction?: string;
  effort?: string;
  // Apr 27 · MERGED — goalId on the local shape so the cross-tab
  // strip can derive the project's primary linked goal from the
  // most-common goalId across its tasks (matches how the parent
  // page already builds projectToGoals).
  goalId?: string | null;
}

interface ProjectDetailProps {
  missionId: string;
  title: string;
  // May 02 · meta fields surfaced for inline edit. Optional so callers
  // can omit them — the edit panel hides those rows when undefined.
  domain?: string | null;
  status?: string | null;
  deadline?: string | null;
  planData: unknown; // raw JSON from DB, validated via isProjectPlanData
  tasks: Task[];
  onCompleteTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onDeleteProject: () => void;
  onPlanUpdated?: (next: ProjectPlanData) => void;
}

// Apr 27 · MERGED — CHECK was a near-empty tab that just showed
// plan.doneChecklist + commonMistakes. Folded into PLAN so the
// "what does done look like" panel sits next to the actual steps,
// and items auto-check as real tasks complete (smart evolution
// instead of manual click-through).
type Tab = "plan" | "learn" | "guide";

export function ProjectDetail({
  missionId,
  title,
  domain,
  status,
  deadline,
  planData,
  tasks,
  onCompleteTask,
  onDeleteTask,
  onDeleteProject,
  onPlanUpdated,
}: ProjectDetailProps) {
  const [tab, setTab] = useState<Tab>("plan");
  const [learning, setLearning] = useState<LearningPath | null>(null);
  const [coachEntry, setCoachEntry] = useState<CoachEntry | null>(null);
  const [loading, setLoading] = useState<"learn" | "guide" | null>(null);

  // task.* tRPC mutations · replace the in-domain PATCH /api/tasks,
  // PATCH /api/missions, POST /api/tasks/:id/check + spawn-tasks calls.
  // actions-surface slice · the /api/ai/plan-project calls (learn /
  // guide / plan / replan) now hit `trpc.ai.planProject`, and the
  // `{ missionId: null }` "remove from project" / "clear inbox" PATCHes
  // hit `trpc.task.leaveMission` (the legacy null-write was structurally
  // dead — Task.missionId is a non-nullable FK).
  const updateTask = trpc.task.update.useMutation();
  const checkTaskMut = trpc.task.check.useMutation();
  const missionUpdate = trpc.task.missionUpdate.useMutation();
  const spawnTasks = trpc.task.spawnTasks.useMutation();
  const planProjectMut = trpc.ai.planProject.useMutation();
  const leaveMissionMut = trpc.task.leaveMission.useMutation();

  // Inline title edit — PATCH /api/missions/[id] with new title.
  // Parent listens for `notifyDataChanged("projects", ...)` and reloads
  // the project list so the new title surfaces in the parent header.
  // May 02 · in-project quick-add. Pre-fix the only paths to add a task
  // to a project were "build phases" (AI plan) or "tag-from-NOW" — no
  // way to type a task title inline from this view. POSTs to /api/tasks
  // with sane defaults (M15 effort, MEDIUM energy, ONCE loop) so the
  // user can dump a task and refine fields later from the NOW row.
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);

  // May 02 · D — per-task inline rename. Pencil → input → enter to save,
  // esc to cancel. Single component-level state means only one task is
  // in rename mode at a time, which keeps the UX clean.
  const [renameTaskId, setRenameTaskId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  // May 02 · I — per-phase task add. Prefixes the title with [Phase
  // Name] so the existing taskByStrippedTitle matcher slots it under
  // the right phase on next render. State keyed by phase index so a
  // user can have one phase's input open without losing typed text
  // when toggling another's.
  const [phaseAddIndex, setPhaseAddIndex] = useState<number | null>(null);
  const [phaseAddTitle, setPhaseAddTitle] = useState("");
  const [phaseAdding, setPhaseAdding] = useState(false);

  const addTaskToPhase = useCallback(
    async (phaseName: string) => {
      const raw = phaseAddTitle.trim();
      if (!raw) return;
      const title = `[${phaseName}] ${raw}`;
      setPhaseAdding(true);
      try {
        const r = await createTask({ title, missionId, nextPhysicalAction: raw });
        if (r.ok) {
          toast.success(`Added to "${phaseName}"`);
          setPhaseAddTitle("");
          setPhaseAddIndex(null);
          notifyDataChanged("tasks", { source: "project-detail", detail: "phase-add", id: missionId });
          notifyDataChanged("projects", { source: "project-detail", detail: "phase-add", id: missionId });
        } else {
          toast.error("Add failed");
        }
      } catch {
        toast.error("Add failed");
      } finally {
        setPhaseAdding(false);
      }
    },
    [phaseAddTitle, missionId],
  );

  // May 02 · J — bulk ops. Three flavors: complete-all-active,
  // archive-all-done (DONE → ARCHIVED via PATCH so the task drops
  // out of NOW + project list), clear-inbox (drops missionId from
  // INBOX-status tasks bound to this project so they go back to
  // global Inbox).
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  const completeAll = useCallback(async () => {
    const active = tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED");
    if (active.length === 0) {
      toast.error("Nothing active to complete");
      return;
    }
    setBulkBusy("complete");
    try {
      const results = await Promise.allSettled(
        active.map((t) => checkTaskMut.mutateAsync({ id: t.id }) as Promise<any>),
      );
      const ok = results.filter((rr) => rr.status === "fulfilled").length;
      toast.success(`Completed ${ok}/${active.length}`);
      notifyDataChanged("tasks", { source: "project-detail", detail: "bulk-complete", id: missionId });
      notifyDataChanged("projects", { source: "project-detail", detail: "bulk-complete", id: missionId });
    } finally {
      setBulkBusy(null);
    }
  }, [tasks, missionId]);

  const archiveDone = useCallback(async () => {
    const done = tasks.filter((t) => t.status === "DONE");
    if (done.length === 0) {
      toast.error("Nothing done to archive");
      return;
    }
    setBulkBusy("archive");
    try {
      const results = await Promise.allSettled(
        done.map((t) =>
          updateTask.mutateAsync({ id: t.id, fields: { status: "ARCHIVED" } }) as Promise<any>,
        ),
      );
      const ok = results.filter((rr) => rr.status === "fulfilled").length;
      toast.success(`Archived ${ok}/${done.length}`);
      notifyDataChanged("tasks", { source: "project-detail", detail: "bulk-archive", id: missionId });
      notifyDataChanged("projects", { source: "project-detail", detail: "bulk-archive", id: missionId });
    } finally {
      setBulkBusy(null);
    }
  }, [tasks, missionId]);

  // May 02 · H — drag-to-reorder phases. Native HTML5 drag, no library.
  // On drop: build a new phases array swapping `from` → `to`, write
  // the reordered planData back via PATCH /api/missions/[id], then
  // call onPlanUpdated so the parent refreshes its view.
  const [draggedPhase, setDraggedPhase] = useState<number | null>(null);

  const reorderPhase = useCallback(
    async (from: number, to: number) => {
      // Re-resolve `plan` here rather than capturing it from outer
      // scope — `plan` is declared later in the function body so a
      // lexical reference would TDZ at runtime + fail TS-strict.
      const currentPlan = isProjectPlanData(planData) ? planData : null;
      if (!currentPlan || !currentPlan.phases || from === to) return;
      if (from < 0 || to < 0 || from >= currentPlan.phases.length || to >= currentPlan.phases.length) return;
      const next = JSON.parse(JSON.stringify(currentPlan)) as ProjectPlanData;
      const [moved] = next.phases!.splice(from, 1);
      next.phases!.splice(to, 0, moved);
      next.updatedAt = new Date().toISOString();
      try {
        await missionUpdate.mutateAsync({
          id: missionId,
          fields: { planData: next },
        });
        toast.success("Phase reordered");
        onPlanUpdated?.(next);
        notifyDataChanged("projects", { source: "project-detail", detail: "phase-reorder", id: missionId });
      } catch {
        toast.error("Reorder failed");
      }
    },
    [planData, missionId, onPlanUpdated, missionUpdate],
  );

  const clearInbox = useCallback(async () => {
    const inboxTasks = tasks.filter((t) => t.status === "INBOX");
    if (inboxTasks.length === 0) {
      toast.error("No INBOX tasks to clear");
      return;
    }
    setBulkBusy("clear");
    try {
      // actions-surface slice · "clear inbox" via trpc.task.leaveMission.
      // The legacy PATCH `{ missionId: null }` was structurally dead
      // (non-nullable FK + a required-field schema) — it failed every
      // time. `leaveMission` re-points each task at the Inbox mission,
      // which is exactly the "move INBOX-status tasks back to global
      // Inbox" the button promises.
      const results = await Promise.allSettled(
        inboxTasks.map((t) => leaveMissionMut.mutateAsync({ id: t.id }) as Promise<any>),
      );
      const ok = results.filter((rr) => rr.status === "fulfilled").length;
      toast.success(`Cleared ${ok} INBOX → global`);
      notifyDataChanged("tasks", { source: "project-detail", detail: "clear-inbox", id: missionId });
      notifyDataChanged("projects", { source: "project-detail", detail: "clear-inbox", id: missionId });
    } finally {
      setBulkBusy(null);
    }
  }, [tasks, missionId, leaveMissionMut]);

  const startRename = useCallback((id: string, currentTitle: string) => {
    setRenameTaskId(id);
    setRenameTitle(currentTitle);
  }, []);

  const cancelRename = useCallback(() => {
    setRenameTaskId(null);
    setRenameTitle("");
  }, []);

  const saveRename = useCallback(async () => {
    if (!renameTaskId) return;
    const next = renameTitle.trim();
    if (!next) {
      toast.error("Title required");
      return;
    }
    setSavingRename(true);
    try {
      await updateTask.mutateAsync({
        id: renameTaskId,
        fields: { title: next },
      });
      toast.success("Renamed");
      notifyDataChanged("tasks", { source: "project-detail", detail: "rename", id: renameTaskId });
      notifyDataChanged("projects", { source: "project-detail", detail: "rename", id: missionId });
      cancelRename();
    } catch {
      toast.error("Rename failed");
    } finally {
      setSavingRename(false);
    }
  }, [renameTaskId, renameTitle, missionId, cancelRename, updateTask]);

  // May 02 · E — per-task manual status switch. PATCH /api/tasks/[id]
  // with { status }. Lets Nour bump a task INBOX→READY→DOING without
  // tab-hopping to NOW. Toast gives confirmation since the UI may not
  // visually re-sort right away.
  const switchStatus = useCallback(
    async (id: string, nextStatus: string) => {
      try {
        await updateTask.mutateAsync({
          id,
          fields: {
            status: nextStatus as NonNullable<
              Parameters<typeof updateTask.mutateAsync>[0]["fields"]["status"]
            >,
          },
        });
        toast.success(`→ ${nextStatus.toLowerCase()}`);
        notifyDataChanged("tasks", { source: "project-detail", detail: "status", id });
        notifyDataChanged("projects", { source: "project-detail", detail: "status", id: missionId });
      } catch {
        toast.error("Status change failed");
      }
    },
    [missionId, updateTask],
  );

  const addTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    setAddingTask(true);
    try {
      const r = await createTask({ title, missionId });
      if (r.ok) {
        toast.success("Task added");
        setNewTaskTitle("");
        notifyDataChanged("tasks", { source: "project-detail", detail: "add-task", id: missionId });
        notifyDataChanged("projects", { source: "project-detail", detail: "add-task", id: missionId });
      } else {
        toast.error("Add failed");
      }
    } catch {
      toast.error("Add failed");
    } finally {
      setAddingTask(false);
    }
  }, [newTaskTitle, missionId]);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  // May 02 · domain + status + deadline edits. Initialize with current
  // values so canceling an edit restores cleanly. Domain/status enums
  // match the missionUpdateSchema validator (BUSINESS/PERSONAL/HEALTH/
  // CONTENT/FINANCE + ACTIVE/PAUSED/COMPLETE/KILLED).
  const [editDomain, setEditDomain] = useState(domain ?? "");
  const [editStatus, setEditStatus] = useState(status ?? "");
  const [editDeadline, setEditDeadline] = useState(deadline ? deadline.slice(0, 10) : "");
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = useCallback(() => {
    setEditTitle(title);
    setEditDomain(domain ?? "");
    setEditStatus(status ?? "");
    setEditDeadline(deadline ? deadline.slice(0, 10) : "");
    setEditing(true);
  }, [title, domain, status, deadline]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditTitle(title);
    setEditDomain(domain ?? "");
    setEditStatus(status ?? "");
    setEditDeadline(deadline ? deadline.slice(0, 10) : "");
  }, [title, domain, status, deadline]);

  const saveEdit = useCallback(async () => {
    const nextTitle = editTitle.trim();
    if (!nextTitle) {
      toast.error("Title required");
      return;
    }
    // Build a delta payload — only PATCH fields the user actually
    // changed. Avoids hammering the row with no-op writes that would
    // still emit audit events.
    const payload: Record<string, string | null> = {};
    if (nextTitle !== title) payload.title = nextTitle;
    if (editDomain && editDomain !== (domain ?? "")) payload.domain = editDomain;
    if (editStatus && editStatus !== (status ?? "")) payload.status = editStatus;
    const currentDeadlineDay = deadline ? deadline.slice(0, 10) : "";
    if (editDeadline !== currentDeadlineDay) {
      payload.deadline = editDeadline ? `${editDeadline}T23:59:59.000Z` : null;
    }
    if (Object.keys(payload).length === 0) {
      setEditing(false);
      return;
    }
    setSavingEdit(true);
    try {
      await missionUpdate.mutateAsync({ id: missionId, fields: payload });
      toast.success("Mission updated");
      notifyDataChanged("projects", { source: "project-detail", detail: "edit", id: missionId });
      notifyDataChanged("missions", { source: "project-detail", detail: "edit", id: missionId });
      setEditing(false);
    } catch {
      toast.error("Save failed");
    } finally {
      setSavingEdit(false);
    }
  }, [editTitle, editDomain, editStatus, title, domain, status, missionId, missionUpdate]);

  const plan: ProjectPlanData | null = isProjectPlanData(planData) ? planData : null;

  // Merge server-loaded learning/coach data with what's already stored
  // in planData so the tabs show the latest state.
  const effectiveLearning = learning || plan?.learning || null;
  const coachHistory = plan?.coachLog || [];
  const latestCoach = coachEntry || coachHistory[coachHistory.length - 1] || null;

  const checkedItems = useMemo(() => new Set<string>(), []);
  const [, forceRender] = useState(0);
  const toggleChecklist = useCallback(
    (item: string) => {
      if (checkedItems.has(item)) checkedItems.delete(item);
      else checkedItems.add(item);
      forceRender((n) => n + 1);
    },
    [checkedItems]
  );

  // actions-surface slice · POST /api/ai/plan-project mode=learn →
  // trpc.ai.planProject. The procedure returns a `mode`-keyed
  // discriminated union — narrow to "learn" before reading `learning`.
  const runLearn = useCallback(async () => {
    setLoading("learn");
    try {
      const d = await planProjectMut.mutateAsync({ missionId, mode: "learn" });
      // `d.learning` is typed `unknown` at the router boundary (the
      // TS2589 firewall · see PlanProjectWireResult) · cast back to the
      // local LearningPath, exactly as the old untyped JSON path did.
      if (d.mode === "learn" && d.learning) {
        const learning = d.learning as LearningPath;
        setLearning(learning);
        toast.success("Learning path generated");
        if (onPlanUpdated && plan) {
          onPlanUpdated({
            ...plan,
            learning,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch {
      toast.error("Learn mode failed");
    }
    setLoading(null);
  }, [missionId, onPlanUpdated, plan, planProjectMut]);

  // actions-surface slice · POST /api/ai/plan-project mode=guide →
  // trpc.ai.planProject. Narrow to the "guide" variant before reading
  // `entry`.
  const runGuide = useCallback(async () => {
    setLoading("guide");
    try {
      const d = await planProjectMut.mutateAsync({ missionId, mode: "guide" });
      // `d.entry` is typed `unknown` at the router boundary (the TS2589
      // firewall) · cast back to the local CoachEntry.
      if (d.mode === "guide" && d.entry) {
        setCoachEntry(d.entry as CoachEntry);
        toast.success("Nick has a read");
      }
    } catch {
      toast.error("Guide mode failed");
    }
    setLoading(null);
  }, [missionId, planProjectMut]);

  // Fallback: no planData. Instead of telling the user to delete
  // their project (hostile), show a smart task view + offer to
  // generate a plan for the existing project.
  if (!plan) {
    const activeTasks = tasks.filter((t) => t.status !== "DONE");
    const doneTasks = tasks.filter((t) => t.status === "DONE");
    const pct = tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0;
    return (
      <div className="border-t border-zinc-800/20 p-2.5 space-y-2">
        {/* Inline title/domain/status edit — visible whenever Edit is tapped */}
        {editing && (
          <div className="space-y-1.5 p-2 rounded border border-amber-500/30 bg-amber-500/5">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Mission title"
              autoFocus
              className="w-full bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[12px] font-bold text-zinc-100 focus:outline-none focus:border-amber-500"
            />
            <div className="flex items-center gap-2">
              <select
                value={editDomain}
                onChange={(e) => setEditDomain(e.target.value)}
                className="flex-1 bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-100 focus:outline-none focus:border-amber-500"
              >
                <option value="">— domain —</option>
                <option value="BUSINESS">business</option>
                <option value="PERSONAL">personal</option>
                <option value="HEALTH">health</option>
                <option value="CONTENT">content</option>
                <option value="FINANCE">finance</option>
              </select>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="flex-1 bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-100 focus:outline-none focus:border-amber-500"
              >
                <option value="">— status —</option>
                <option value="ACTIVE">active</option>
                <option value="PAUSED">paused</option>
                <option value="COMPLETE">complete</option>
                <option value="KILLED">killed</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveEdit}
                disabled={savingEdit || !editTitle.trim()}
                className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[9px] text-amber-300 font-bold uppercase tracking-wider hover:bg-amber-500/30 disabled:opacity-50"
              >
                {savingEdit ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
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
        )}

        {/* Stats bar */}
        <div className="flex items-center gap-2 text-[9px] text-zinc-500 font-mono">
          <span className="text-amber-400">{activeTasks.length}</span>
          <span>open</span>
          <span className="text-zinc-800">·</span>
          <span className="text-emerald-400">{doneTasks.length}</span>
          <span>done</span>
          <span className="text-zinc-800">·</span>
          <span>{pct}%</span>
        </div>

        {/* May 02 · in-project task quick-add (no-plan path too) */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newTaskTitle.trim() && !addingTask) {
                void addTask();
              }
            }}
            placeholder="+ add task to this mission"
            className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
          />
          <button
            type="button"
            onClick={() => void addTask()}
            disabled={addingTask || !newTaskTitle.trim()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 text-[10px] font-bold uppercase tracking-wider hover:bg-blue-500/20 disabled:opacity-40"
          >
            {addingTask ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
            add
          </button>
        </div>

        {/* Generate plan offer — not "delete and recreate" */}
        <button
          onClick={async () => {
            setLoading("guide");
            try {
              // actions-surface slice · plan generation via
              // trpc.ai.planProject (narrow to the "plan" variant).
              // `d.plan` is typed `unknown` at the router boundary (the
              // TS2589 firewall) · cast back to ProjectPlanData.
              const d = await planProjectMut.mutateAsync({
                missionId,
                mode: "plan",
                title,
              });
              if (d.mode === "plan" && d.plan && onPlanUpdated) {
                onPlanUpdated(d.plan as ProjectPlanData);
                toast.success("Plan generated");
              } else {
                toast.success("Plan started — tasks created");
              }
            } catch {
              toast.error("Plan generation failed");
            }
            setLoading(null);
          }}
          disabled={loading === "guide"}
          className="w-full flex items-center justify-center gap-2 p-2 rounded-lg border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 transition-colors"
        >
          {loading === "guide" ? (
            <Loader2 size={11} className="animate-spin text-blue-400" />
          ) : (
            <Brain size={11} className="text-blue-400" />
          )}
          <span className="text-[10px] font-bold text-blue-300">
            {loading === "guide" ? "Nick is planning…" : "Generate AI plan for this project"}
          </span>
        </button>

        {/* Active tasks */}
        {activeTasks.length > 0 && (
          <div className="space-y-0.5">
            {activeTasks.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-1 px-1 rounded text-[11px] hover:bg-zinc-800/20 group">
                <button
                  onClick={() => onCompleteTask(t.id)}
                  className="text-zinc-700 hover:text-emerald-400 shrink-0"
                >
                  <Circle size={13} />
                </button>
                {renameTaskId === t.id ? (
                  <input
                    type="text"
                    value={renameTitle}
                    onChange={(e) => setRenameTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveRename();
                      if (e.key === "Escape") cancelRename();
                    }}
                    onBlur={() => { if (!savingRename) cancelRename(); }}
                    autoFocus
                    className="flex-1 bg-zinc-900 border border-amber-500/40 rounded px-1.5 py-0.5 text-[11px] text-zinc-100 focus:outline-none focus:border-amber-500"
                  />
                ) : (
                  <span className="flex-1 text-zinc-300 truncate">{t.title}</span>
                )}
                <select
                  value={t.status}
                  onChange={(e) => void switchStatus(t.id, e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[8px] uppercase tracking-wider text-zinc-400 focus:outline-none focus:border-amber-500/40 shrink-0"
                  title="Change status"
                >
                  <option value="INBOX">inbox</option>
                  <option value="READY">ready</option>
                  <option value="DOING">doing</option>
                  <option value="WAITING">waiting</option>
                  <option value="DONE">done</option>
                </select>
                <button
                  onClick={() => startRename(t.id, t.title)}
                  className="text-zinc-700 hover:text-amber-400 shrink-0"
                  title="Rename"
                >
                  <Pencil size={10} />
                </button>
                <button
                  onClick={() => onDeleteTask(t.id)}
                  className="text-zinc-700 hover:text-red-400 shrink-0"
                  title="Delete task entirely"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Done tasks — collapsed */}
        {doneTasks.length > 0 && (
          <details className="group">
            <summary className="text-[9px] text-zinc-600 cursor-pointer hover:text-zinc-400 list-none flex items-center gap-1">
              <ChevronRight size={9} className="group-open:rotate-90 transition-transform" />
              {doneTasks.length} completed
            </summary>
            <div className="mt-1 space-y-0.5">
              {doneTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 py-0.5 px-1 text-[10px] text-zinc-600">
                  <CheckCircle2 size={11} className="text-emerald-700 shrink-0" />
                  <span className="line-through flex-1 truncate">{t.title}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={startEdit}
            className="text-[8px] text-zinc-700 hover:text-amber-400 flex items-center gap-1 uppercase tracking-wider"
          >
            <Pencil size={8} />
            Edit
          </button>
          <button onClick={onDeleteProject} className="text-[8px] text-zinc-700 hover:text-red-400 flex items-center gap-1">
            <Trash2 size={8} />
            Delete project
          </button>
        </div>
      </div>
    );
  }

  // Build a quick lookup of task status by title so we can match plan
  // steps back to their DB tasks (the tasks are inserted with titles
  // like "[Phase name] Step title"). This is imperfect but good
  // enough for the progress dots.
  const taskByStrippedTitle = new Map<string, Task>();
  for (const t of tasks) {
    const stripped = t.title.replace(/^\[.*?\]\s*/, "").trim();
    taskByStrippedTitle.set(stripped, t);
  }

  return (
    <div className="border-t border-zinc-800/20 p-3 space-y-3">
      {/* Inline title/domain/status edit — same panel as the no-plan fallback */}
      {editing && (
        <div className="space-y-1.5 p-2 rounded border border-amber-500/30 bg-amber-500/5">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Mission title"
            autoFocus
            className="w-full bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[12px] font-bold text-zinc-100 focus:outline-none focus:border-amber-500"
          />
          <div className="flex items-center gap-2">
            <select
              value={editDomain}
              onChange={(e) => setEditDomain(e.target.value)}
              className="flex-1 bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-100 focus:outline-none focus:border-amber-500"
            >
              <option value="">— domain —</option>
              <option value="BUSINESS">business</option>
              <option value="PERSONAL">personal</option>
              <option value="HEALTH">health</option>
              <option value="CONTENT">content</option>
              <option value="FINANCE">finance</option>
            </select>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="flex-1 bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-100 focus:outline-none focus:border-amber-500"
            >
              <option value="">— status —</option>
              <option value="ACTIVE">active</option>
              <option value="PAUSED">paused</option>
              <option value="COMPLETE">complete</option>
              <option value="KILLED">killed</option>
            </select>
          </div>
          <input
            type="date"
            value={editDeadline}
            onChange={(e) => setEditDeadline(e.target.value)}
            placeholder="deadline"
            className="w-full bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[10px] text-zinc-100 focus:outline-none focus:border-amber-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveEdit}
              disabled={savingEdit || !editTitle.trim()}
              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[9px] text-amber-300 font-bold uppercase tracking-wider hover:bg-amber-500/30 disabled:opacity-50"
            >
              {savingEdit ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
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
      )}

      {/* ── Summary + tabs ── */}
      {plan.summary && (
        <p className="text-[11px] text-zinc-400 italic leading-relaxed">{plan.summary}</p>
      )}
      {/* Apr 27 · CROSS-TAB STRIP — every tab anchors to the same
          live numbers so PLAN/LEARN/GUIDE/CHECK feel like four lenses
          on one project, not four separate dead screens.
          · % done — same number as the ring on the collapsed card
          · phase progress — current phase / total phases when phases exist
          · linked goal — derived from the most-common goalId across
            tasks. Tap → scrolls/anchors to the goal in the goals list.
          · DOING chip when something on this project is in flight
          · count badges per tab (steps / concepts / coach hits / done) */}
      {(() => {
        const doneTasksCt = tasks.filter((t) => t.status === "DONE").length;
        const doingTasksCt = tasks.filter((t) => t.status === "DOING").length;
        const projectPct =
          tasks.length > 0
            ? Math.round((doneTasksCt / tasks.length) * 100)
            : 0;
        const totalPhases = plan?.phases?.length ?? 0;
        const completedPhases =
          plan?.phases?.filter((ph) =>
            (ph.steps || []).every((s) => {
              const stripped = s.title;
              const tk = taskByStrippedTitle.get(stripped);
              return tk?.status === "DONE";
            }),
          ).length ?? 0;
        // Tally goalIds across tasks; pick the dominant one as the
        // project's "primary" goal. Multiple goals on one project is
        // unusual but we render up to the top 1 to keep the strip tight.
        const goalCount = new Map<string, number>();
        for (const t of tasks) {
          if (!t.goalId) continue;
          goalCount.set(t.goalId, (goalCount.get(t.goalId) ?? 0) + 1);
        }
        const topGoalId =
          [...goalCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        return (
          <GlassCard className="flex items-center gap-2 px-2 py-1.5 text-[9px] font-mono flex-wrap">
            <span className="text-zinc-500 uppercase tracking-wider">{projectPct}%</span>
            {totalPhases > 0 && (
              <>
                <span className="text-zinc-800">·</span>
                <span className="text-zinc-500">
                  phase <span className="text-blue-300">{completedPhases}</span>/{totalPhases}
                </span>
              </>
            )}
            <span className="text-zinc-800">·</span>
            <span className="text-zinc-500">
              <span className="text-emerald-400">{doneTasksCt}</span>/{tasks.length} steps
            </span>
            {doingTasksCt > 0 && (
              <>
                <span className="text-zinc-800">·</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-px rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 uppercase tracking-wider text-[8px]">
                  <span className="h-1 w-1 rounded-full bg-blue-400 animate-pulse" />
                  in flight {doingTasksCt}
                </span>
              </>
            )}
            {topGoalId && (
              <>
                <span className="text-zinc-800">·</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Scroll the goal card on the same page into view
                    // by id. Keeps tabs feeling connected without a
                    // route change.
                    document
                      .getElementById(`goal-${topGoalId}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  className="inline-flex items-center gap-1 text-violet-300 hover:text-violet-200 underline decoration-dotted"
                  title="Jump to linked goal"
                >
                  ↑ goal
                </button>
              </>
            )}
          </GlassCard>
        );
      })()}
      <div className="flex items-center gap-1 border-b border-zinc-800/40 -mx-3 px-3 pb-0 overflow-x-auto no-scrollbar">
        {(() => {
          const totalSteps = (plan?.phases ?? []).reduce(
            (n, ph) => n + (ph.steps?.length ?? 0),
            0,
          );
          const stepCount = totalSteps > 0 ? totalSteps : tasks.length;
          const conceptCt =
            (effectiveLearning?.keyConcepts?.length ?? 0) +
            (effectiveLearning?.resources?.length ?? 0);
          const coachCt = coachHistory.length;
          // PLAN's badge merges step count + done count (e.g. 4/11)
          // since the merged tab now owns both progress AND checklist.
          const doneCt = tasks.filter((t) => t.status === "DONE").length;
          const planBadge =
            stepCount > 0 ? `${doneCt}/${stepCount}` : "0";
          const tabs = [
            { k: "plan" as const, label: "Plan", icon: <Brain size={11} />, badge: planBadge },
            { k: "learn" as const, label: "Learn", icon: <BookOpen size={11} />, badge: conceptCt > 0 ? String(conceptCt) : "" },
            { k: "guide" as const, label: "Guide", icon: <Compass size={11} />, badge: coachCt > 0 ? String(coachCt) : "" },
          ];
          return tabs.map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider border-b-2 transition-all -mb-px",
                tab === t.k
                  ? "border-[var(--gold)] text-[var(--gold)]"
                  : "border-transparent text-zinc-600 hover:text-zinc-400"
              )}
            >
              {t.icon}
              {t.label}
              {t.badge && (
                <span
                  className={cn(
                    "ml-0.5 text-[8px] font-mono px-1 rounded",
                    tab === t.k
                      ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                      : "bg-zinc-800/60 text-zinc-500",
                  )}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ));
        })()}
      </div>

      {/* ══ PLAN TAB ══ */}
      {tab === "plan" && (
        <div className="space-y-3">
          {/* May 02 · in-project task quick-add */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTaskTitle.trim() && !addingTask) {
                  void addTask();
                }
              }}
              placeholder="+ add task to this mission"
              className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
            />
            <button
              type="button"
              onClick={() => void addTask()}
              disabled={addingTask || !newTaskTitle.trim()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 text-[10px] font-bold uppercase tracking-wider hover:bg-blue-500/20 disabled:opacity-40"
            >
              {addingTask ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              add
            </button>
          </div>
          {/* Quick-glance meta */}
          {(plan.estimatedTimeline || plan.totalEstimatedCost) && (
            <div className="flex flex-wrap gap-2 text-[10px]">
              {plan.estimatedTimeline && (
                <Badge className="bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">
                  <Clock size={9} className="mr-1" />
                  {plan.estimatedTimeline}
                </Badge>
              )}
              {plan.totalEstimatedCost && (
                <Badge className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">
                  ${plan.totalEstimatedCost.low}–${plan.totalEstimatedCost.high}
                </Badge>
              )}
            </div>
          )}

          {/* Apr 27 · STEPS-FALLBACK — when planData has no phases
              (older projects, AI flake, manual project creation), the
              PLAN tab was just blank under the tabs. Render the actual
              spawned tasks as a flat step list so Nour can complete /
              delete them inline instead of staring at empty space.
              Includes a "regenerate plan" button to ask Nick for a
              proper phase structure. */}
          {(!plan.phases || plan.phases.length === 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-zinc-500 italic">
                  No phases yet · {tasks.length} task{tasks.length === 1 ? "" : "s"} below
                </p>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    setLoading("guide");
                    try {
                      // actions-surface slice · regenerate phases via
                      // trpc.ai.planProject. The legacy `regenerate: true`
                      // body field was dead — the plan-project schema
                      // never declared it · safeParseBody dropped it.
                      // `d.plan` is `unknown` at the router boundary (the
                      // TS2589 firewall) · cast back to ProjectPlanData.
                      const d = await planProjectMut.mutateAsync({
                        missionId,
                        mode: "plan",
                        title,
                      });
                      if (d.mode === "plan" && d.plan && onPlanUpdated) {
                        onPlanUpdated(d.plan as ProjectPlanData);
                      }
                      toast.success("Phases generated");
                    } catch {
                      toast.error("Plan failed");
                    }
                    setLoading(null);
                  }}
                  disabled={loading === "guide"}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-300 hover:bg-blue-500/15 disabled:opacity-50"
                >
                  {loading === "guide" ? (
                    <Loader2 size={9} className="animate-spin" />
                  ) : (
                    <Brain size={9} />
                  )}
                  {loading === "guide" ? "thinking…" : "build phases"}
                </button>
              </div>
              {tasks.length === 0 ? (
                <p className="text-[10px] text-zinc-600 italic py-3 text-center">
                  No tasks yet — tap &ldquo;build phases&rdquo; or add tasks from NOW
                </p>
              ) : (
                <GlassCard className="space-y-0.5 p-1.5">
                  {tasks
                    .slice()
                    .sort((a, b) => {
                      // Active first (DOING > READY > INBOX), then DONE
                      const order: Record<string, number> = {
                        DOING: 0,
                        READY: 1,
                        INBOX: 2,
                        DONE: 3,
                      };
                      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                    })
                    .map((t) => {
                      const isDone = t.status === "DONE";
                      const isDoing = t.status === "DOING";
                      return (
                        <div
                          key={t.id}
                          className={cn(
                            "flex items-start gap-2 py-1 px-1.5 rounded text-[11px] group",
                            isDone && "opacity-50",
                            isDoing && "bg-blue-500/5 border-l-2 border-blue-500/30",
                          )}
                        >
                          <button
                            onClick={() => !isDone && onCompleteTask(t.id)}
                            disabled={isDone}
                            className={cn(
                              "mt-0.5 shrink-0",
                              isDone
                                ? "text-emerald-500"
                                : "text-zinc-700 hover:text-emerald-400",
                            )}
                          >
                            {isDone ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                          </button>
                          {renameTaskId === t.id ? (
                            <input
                              type="text"
                              value={renameTitle}
                              onChange={(e) => setRenameTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void saveRename();
                                if (e.key === "Escape") cancelRename();
                              }}
                              onBlur={() => { if (!savingRename) cancelRename(); }}
                              autoFocus
                              className="flex-1 bg-zinc-900 border border-amber-500/40 rounded px-1.5 py-0.5 text-[11px] text-zinc-100 focus:outline-none focus:border-amber-500"
                            />
                          ) : (
                            <span
                              className={cn(
                                "flex-1 text-zinc-300",
                                isDone && "line-through",
                              )}
                            >
                              {t.title}
                            </span>
                          )}
                          {isDoing && (
                            <Badge className="bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[7px] h-3 px-1 shrink-0">
                              DOING
                            </Badge>
                          )}
                          <select
                            value={t.status}
                            onChange={(e) => void switchStatus(t.id, e.target.value)}
                            className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[8px] uppercase tracking-wider text-zinc-400 focus:outline-none focus:border-amber-500/40 shrink-0 mt-0.5"
                            title="Change status"
                          >
                            <option value="INBOX">inbox</option>
                            <option value="READY">ready</option>
                            <option value="DOING">doing</option>
                            <option value="WAITING">waiting</option>
                            <option value="DONE">done</option>
                          </select>
                          <button
                            onClick={() => startRename(t.id, t.title)}
                            className="text-zinc-700 hover:text-amber-400 shrink-0 mt-0.5"
                            title="Rename"
                          >
                            <Pencil size={10} />
                          </button>
                          {/* Apr 27 · REMOVE-FROM-PROJECT — separate
                              from delete. Sets missionId=null so the
                              task stays alive on NOW but leaves this
                              project's list. Use case: business tasks
                              accidentally bound to a personal project. */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                // actions-surface slice · "remove from
                                // project" via trpc.task.leaveMission.
                                // The legacy PATCH `{ missionId: null }`
                                // was structurally dead (non-nullable
                                // FK) — leaveMission re-points the task
                                // at the Inbox mission so it "lives on
                                // NOW" as the title promises.
                                await leaveMissionMut.mutateAsync({ id: t.id });
                                toast.success(`Removed from project — task lives on NOW`);
                                // Apr 27 · "erase in place = erase
                                // everywhere" — notify every surface
                                // (NOW, PLAN, TRACK) so they refresh
                                // and the task disappears from the
                                // project view, not just here.
                                notifyDataChanged("tasks", {
                                  source: "project-detail",
                                  detail: "remove-from-project",
                                  id: t.id,
                                });
                                notifyDataChanged("projects", {
                                  source: "project-detail",
                                  detail: "remove-from-project",
                                  id: missionId,
                                });
                                onPlanUpdated?.(plan);
                              } catch {
                                toast.error("Remove failed");
                              }
                            }}
                            className="text-zinc-700 hover:text-amber-400 shrink-0 mt-0.5 text-[8px] font-mono uppercase tracking-wider px-1"
                            title="Remove from mission (keeps the task on NOW)"
                          >
                            ↗
                          </button>
                          <button
                            onClick={() => onDeleteTask(t.id)}
                            className="text-zinc-700 hover:text-red-400 shrink-0 mt-0.5"
                            title="Delete task entirely"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      );
                    })}
                </GlassCard>
              )}
            </div>
          )}

          {/* Phases */}
          {(plan.phases || []).map((phase, pi) => {
            // Apr 27 · S2 — count which steps in this phase already
            // have a spawned task (taskId set) and how many don't.
            // Drives the "spawn N tasks to NOW" button visibility.
            const stepsTotal = (phase.steps || []).length;
            const stepsSpawned = (phase.steps || []).filter((s) => s.taskId).length;
            const stepsToSpawn = stepsTotal - stepsSpawned;
            const isDragging = draggedPhase === pi;
            return (
            <div
              key={pi}
              draggable
              onDragStart={(e) => {
                setDraggedPhase(pi);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedPhase !== null && draggedPhase !== pi) {
                  void reorderPhase(draggedPhase, pi);
                }
                setDraggedPhase(null);
              }}
              onDragEnd={() => setDraggedPhase(null)}
              className={cn(
                "rounded-lg border border-zinc-800/40 bg-zinc-900/40 overflow-hidden transition-opacity",
                isDragging && "opacity-40"
              )}
            >
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-900/60 border-b border-zinc-800/30 gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="text-zinc-700 hover:text-zinc-400 cursor-grab active:cursor-grabbing shrink-0 select-none text-[10px]"
                    title="Drag to reorder"
                  >
                    ⋮⋮
                  </span>
                  <span className="text-[9px] font-bold text-zinc-600 font-mono shrink-0">
                    {pi + 1}
                  </span>
                  <span className="text-[11px] font-bold text-zinc-300 truncate">{phase.name}</span>
                </div>
                {/* Apr 27 · S2 — spawn-to-NOW button. Renders when this
                    phase has un-spawned steps. Tap → POST creates
                    Tasks bound to (missionId, phaseName) so they
                    appear on NOW immediately + the planData phases
                    get taskId back-references for idempotency. */}
                {stepsToSpawn > 0 && (
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const d = await spawnTasks.mutateAsync({
                          missionId,
                          phaseIndex: pi,
                        });
                        const spawned = d?.spawned ?? 0;
                        toast.success(
                          `Added ${spawned} task${spawned === 1 ? "" : "s"} to NOW`,
                        );
                        // Cross-page event so NOW refreshes immediately.
                        window.dispatchEvent(
                          new CustomEvent("nour:data-changed", {
                            detail: { domain: "tasks", source: "project-spawn" },
                          }),
                        );
                        // If the parent supplied a plan-updated cb,
                        // hand it the freshest planData so the UI
                        // reflects the new taskId back-references
                        // without a full reload.
                        if (d?.taskIds && onPlanUpdated && plan) {
                          const next = JSON.parse(JSON.stringify(plan)) as ProjectPlanData;
                          // The server has already written the
                          // back-refs; we don't have the full
                          // updated plan in the response so just
                          // bump updatedAt and rely on the parent's
                          // own refresh path. If the parent reloads
                          // data, planData comes back fresh from DB.
                          next.updatedAt = new Date().toISOString();
                          onPlanUpdated(next);
                        }
                      } catch {
                        toast.error("Spawn failed");
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[9px] font-mono text-amber-300 hover:bg-amber-500/15 shrink-0"
                    title="Create NOW tasks from this phase's steps"
                  >
                    <Sparkles size={9} />
                    spawn {stepsToSpawn} → NOW
                  </button>
                )}
                {phase.estimatedDays && (
                  <span className="text-[9px] text-zinc-600 shrink-0">{phase.estimatedDays}d</span>
                )}
                {/* May 02 · I — open per-phase task add */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPhaseAddIndex(phaseAddIndex === pi ? null : pi);
                    setPhaseAddTitle("");
                  }}
                  className="inline-flex items-center gap-0.5 rounded-md border border-blue-500/30 bg-blue-500/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-300 hover:bg-blue-500/15 shrink-0"
                  title="Add a task to this phase"
                >
                  <Plus size={9} />
                  task
                </button>
              </div>
              {phaseAddIndex === pi && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-500/5 border-b border-blue-500/20">
                  <input
                    type="text"
                    value={phaseAddTitle}
                    onChange={(e) => setPhaseAddTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && phaseAddTitle.trim() && !phaseAdding) {
                        void addTaskToPhase(phase.name);
                      }
                      if (e.key === "Escape") {
                        setPhaseAddIndex(null);
                        setPhaseAddTitle("");
                      }
                    }}
                    autoFocus
                    placeholder={`+ task in "${phase.name}"`}
                    className="flex-1 bg-zinc-900 border border-blue-500/40 rounded px-2 py-0.5 text-[11px] text-zinc-100 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => void addTaskToPhase(phase.name)}
                    disabled={phaseAdding || !phaseAddTitle.trim()}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 text-[9px] font-bold uppercase tracking-wider hover:bg-blue-500/20 disabled:opacity-40"
                  >
                    {phaseAdding ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
                    add
                  </button>
                </div>
              )}
              {phase.milestone && (
                <p className="text-[9px] text-zinc-600 italic px-2.5 py-1 bg-zinc-900/20 border-b border-zinc-800/20">
                  ✓ {phase.milestone}
                </p>
              )}
              <div className="p-1 space-y-0.5">
                {(phase.steps || []).map((step, si) => {
                  const dbTask = taskByStrippedTitle.get(step.title);
                  const isDone = dbTask?.status === "DONE";
                  const isDoing = dbTask?.status === "DOING";
                  return (
                    <div
                      key={si}
                      className={cn(
                        "flex items-start gap-2 py-1 px-1.5 rounded text-[11px] group",
                        isDone && "opacity-50",
                        isDoing && "bg-blue-500/5 border-l-2 border-blue-500/30"
                      )}
                    >
                      <button
                        onClick={() => dbTask && !isDone && onCompleteTask(dbTask.id)}
                        disabled={!dbTask}
                        className={cn(
                          "mt-0.5 shrink-0",
                          isDone ? "text-emerald-500" : "text-zinc-700 hover:text-emerald-400"
                        )}
                      >
                        {isDone ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn("text-zinc-300 flex-1", isDone && "line-through")}>
                            {step.title}
                          </span>
                          {step.isCheckpoint && (
                            <Badge className="bg-amber-500/10 text-amber-300 text-[7px] h-3 px-1">CHECK</Badge>
                          )}
                          {step.isDecisionPoint && (
                            <Badge className="bg-violet-500/10 text-violet-300 text-[7px] h-3 px-1">DECIDE</Badge>
                          )}
                          {step.effort && (
                            <span className="text-[8px] text-zinc-600 font-mono">{step.effort}</span>
                          )}
                          {typeof step.estimatedCost === "number" && step.estimatedCost > 0 && (
                            <span className="text-[8px] text-emerald-500/60 font-mono">${step.estimatedCost}</span>
                          )}
                          {step.who && step.who !== "Nour" && (
                            <span className="text-[8px] text-blue-400/70">· {step.who}</span>
                          )}
                        </div>
                        {step.nextAction && step.nextAction !== step.title && (
                          <p className="text-[9px] text-zinc-600 mt-0.5">→ {step.nextAction}</p>
                        )}
                        {step.proTip && (
                          <p className="text-[9px] text-amber-400/70 mt-0.5 flex items-start gap-1">
                            <Lightbulb size={9} className="mt-0.5 shrink-0" />
                            {step.proTip}
                          </p>
                        )}
                        {step.reasoning && (
                          <p className="text-[9px] text-zinc-600 italic mt-0.5">{step.reasoning}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}

          {/* Key risks */}
          {plan.keyRisks && plan.keyRisks.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-red-400/80">Key risks</p>
              {plan.keyRisks.map((r, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/15 text-[10px]">
                  <AlertTriangle size={11} className="text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-red-300 font-medium">{r.risk}</p>
                    <p className="text-zinc-500 mt-0.5">→ {r.mitigation}</p>
                    {r.costIfHappens && (
                      <p className="text-zinc-600 text-[9px] mt-0.5">Impact: {r.costIfHappens}</p>
                    )}
                  </div>
                  <Badge
                    className={cn(
                      "text-[7px] h-3 px-1 font-mono shrink-0",
                      r.likelihood === "high" ? "bg-red-500/20 text-red-300" :
                      r.likelihood === "medium" ? "bg-amber-500/20 text-amber-300" :
                      "bg-zinc-700/40 text-zinc-500"
                    )}
                  >
                    {r.likelihood}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {/* Decision points */}
          {plan.decisionPoints && plan.decisionPoints.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-violet-400/80">Decision points</p>
              {plan.decisionPoints.map((dp, i) => (
                <div key={i} className="p-2 rounded-lg bg-violet-500/5 border border-violet-500/15 text-[10px]">
                  <p className="text-violet-300 font-medium">{dp.decision}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {dp.options.map((o, j) => (
                      <Badge key={j} className="bg-zinc-800 text-zinc-400 text-[8px] h-3">{o}</Badge>
                    ))}
                  </div>
                  {dp.recommendation && (
                    <p className="text-zinc-500 italic mt-1">→ {dp.recommendation}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pro tips + common mistakes */}
          {plan.proTips && plan.proTips.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/80">Pro tips</p>
              {plan.proTips.map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] text-amber-200/80">
                  <Lightbulb size={10} className="shrink-0 mt-0.5 text-amber-400/70" />
                  <span>{t}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tools & materials */}
          {plan.toolsAndMaterials && plan.toolsAndMaterials.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-blue-400/80">Tools & materials</p>
              <div className="grid grid-cols-1 gap-0.5">
                {plan.toolsAndMaterials.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
                    <Wrench size={9} className="text-blue-400/60 shrink-0" />
                    <span className="text-zinc-400 flex-1">{t.item}</span>
                    <span className="text-zinc-600 text-[9px]">{t.quantity}</span>
                    {typeof t.estimatedCost === "number" && t.estimatedCost > 0 && (
                      <span className="text-emerald-500/60 text-[9px] font-mono">${t.estimatedCost}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Apr 27 · MERGED FROM CHECK TAB ──
              "What does done look like?" lives next to the steps now,
              not in a separate near-empty tab. Items auto-check when
              their text fuzzy-matches a completed task title — so the
              checklist evolves as Nour completes work, instead of
              being a manual click-through.

              · doneChecklist — the AI's "definition of done"
              · commonMistakes — the things to watch for
              · keyRisks were rendered above; not duplicated here. */}
          {((plan.doneChecklist && plan.doneChecklist.length > 0) ||
            (plan.commonMistakes && plan.commonMistakes.length > 0) ||
            tasks.filter((t) => t.status === "DONE").length > 0) && (
            <div className="space-y-2 pt-2 mt-1 border-t border-zinc-800/40">
              {/* Done-when checklist with auto-evolution */}
              {plan.doneChecklist && plan.doneChecklist.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80 flex items-center gap-1">
                      <CheckSquare size={9} /> Done when…
                    </p>
                    {/* Auto-progress chip from real task state */}
                    {(() => {
                      const doneTasksLower = new Set(
                        tasks
                          .filter((t) => t.status === "DONE")
                          .map((t) =>
                            t.title.replace(/^\[.*?\]\s*/, "").toLowerCase().trim()
                          )
                      );
                      const autoChecked = plan.doneChecklist!.filter((item) => {
                        const lower = item.toLowerCase();
                        // fuzzy: any done-task title contained in (or
                        // contains) the checklist item
                        for (const dt of doneTasksLower) {
                          if (lower.includes(dt) || dt.includes(lower.slice(0, 20))) return true;
                        }
                        return checkedItems.has(item);
                      }).length;
                      return (
                        <span className="text-[8px] font-mono text-zinc-500">
                          <span className="text-emerald-400">{autoChecked}</span>/{plan.doneChecklist!.length}
                        </span>
                      );
                    })()}
                  </div>
                  {plan.doneChecklist.map((item, i) => {
                    // Same fuzzy matcher inline so each item knows if
                    // it's "auto-checked" by completed tasks. Manual
                    // toggle still works on top.
                    const lower = item.toLowerCase();
                    const autoChecked = tasks.some((t) => {
                      if (t.status !== "DONE") return false;
                      const tl = t.title.replace(/^\[.*?\]\s*/, "").toLowerCase().trim();
                      return lower.includes(tl) || tl.includes(lower.slice(0, 20));
                    });
                    const manualChecked = checkedItems.has(item);
                    const checked = autoChecked || manualChecked;
                    return (
                      <button
                        key={i}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleChecklist(item);
                        }}
                        className="flex items-start gap-2 py-1 px-1 rounded w-full text-left hover:bg-zinc-800/30 text-[11px]"
                        title={
                          autoChecked
                            ? "Auto-checked from completed task"
                            : "Tap to toggle"
                        }
                      >
                        <span
                          className={cn(
                            "mt-0.5 shrink-0",
                            checked ? "text-emerald-500" : "text-zinc-700"
                          )}
                        >
                          {checked ? <CheckSquare size={12} /> : <Circle size={12} />}
                        </span>
                        <span
                          className={cn(
                            "flex-1 text-zinc-400",
                            checked && "line-through text-zinc-600"
                          )}
                        >
                          {item}
                        </span>
                        {autoChecked && (
                          <span className="text-[7px] font-mono uppercase tracking-wider text-emerald-500/60 shrink-0 mt-1">
                            auto
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Common mistakes — moved from CHECK tab */}
              {plan.commonMistakes && plan.commonMistakes.length > 0 && (
                <div className="space-y-1 pt-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/80 flex items-center gap-1">
                    <AlertTriangle size={9} /> Watch for
                  </p>
                  {plan.commonMistakes.map((m, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] text-zinc-400">
                      <AlertTriangle size={9} className="shrink-0 mt-0.5 text-amber-400/60" />
                      <span>{m}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Recently-completed log — visible proof of progress.
                  Kicks in even when there's no doneChecklist; gives
                  empty-checklist projects something useful in the
                  merged panel. */}
              {(() => {
                const doneTasks = tasks
                  .filter((t) => t.status === "DONE")
                  .slice(0, 5);
                if (doneTasks.length === 0) return null;
                return (
                  <details className="pt-1 group">
                    <summary className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 cursor-pointer hover:text-zinc-300 list-none flex items-center gap-1">
                      <ChevronRight
                        size={9}
                        className="transition-transform group-open:rotate-90"
                      />
                      Recently completed ({tasks.filter((t) => t.status === "DONE").length})
                    </summary>
                    <div className="mt-1 space-y-0.5 ml-3">
                      {doneTasks.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center gap-2 text-[10px] text-zinc-500"
                        >
                          <CheckCircle2
                            size={10}
                            className="text-emerald-500/60 shrink-0"
                          />
                          <span className="line-through truncate flex-1">
                            {t.title.replace(/^\[.*?\]\s*/, "")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ══ LEARN TAB ══ */}
      {tab === "learn" && (
        <div className="space-y-3">
          {!effectiveLearning && (
            <div className="text-center py-4 space-y-2">
              <p className="text-[10px] text-zinc-500 italic">
                Teach me the 20% I need to know before starting.
              </p>
              <Button size="sm" onClick={runLearn} disabled={loading === "learn"} className="h-7 px-3 bg-amber-500/15 text-amber-300 hover:bg-amber-500 hover:text-black text-[10px] font-bold border border-amber-500/30">
                {loading === "learn" ? <Loader2 size={11} className="animate-spin mr-1" /> : <BookOpen size={11} className="mr-1" />}
                Generate learning path
              </Button>
            </div>
          )}
          {effectiveLearning && (
            <>
              {effectiveLearning.mvuRead && (
                <GlassCard className="p-2.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/80 mb-1.5">Minimum viable understanding</p>
                  <p className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{effectiveLearning.mvuRead}</p>
                </GlassCard>
              )}
              {effectiveLearning.keyConcepts && effectiveLearning.keyConcepts.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-blue-400/80">Key concepts</p>
                  {effectiveLearning.keyConcepts.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="text-blue-400/60 font-mono shrink-0 mt-0.5">{i + 1}.</span>
                      <span className="text-zinc-400">{c}</span>
                    </div>
                  ))}
                </div>
              )}
              {effectiveLearning.prerequisites && effectiveLearning.prerequisites.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80">Prerequisites</p>
                  {effectiveLearning.prerequisites.map((p, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] text-zinc-400">
                      <CheckSquare size={9} className="shrink-0 mt-0.5 text-emerald-400/60" />
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              )}
              {effectiveLearning.resources && effectiveLearning.resources.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-violet-400/80">Resources</p>
                  {effectiveLearning.resources.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <ExternalLink size={9} className="shrink-0 mt-0.5 text-violet-400/60" />
                      <div className="flex-1">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:text-violet-200 underline">
                            {r.title}
                          </a>
                        ) : (
                          <span className="text-zinc-400">{r.title}</span>
                        )}
                        {r.note && <p className="text-zinc-600 text-[9px]">{r.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {effectiveLearning.practiceExercises && effectiveLearning.practiceExercises.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/80">Practice exercises</p>
                  {effectiveLearning.practiceExercises.map((p, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] text-zinc-400">
                      <Sparkles size={9} className="shrink-0 mt-0.5 text-amber-400/60" />
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              )}
              <Button size="sm" onClick={runLearn} disabled={loading === "learn"} variant="ghost" className="w-full h-6 text-[9px] text-zinc-500 hover:text-zinc-300">
                {loading === "learn" ? <Loader2 size={10} className="animate-spin mr-1" /> : null}
                Regenerate
              </Button>
            </>
          )}
        </div>
      )}

      {/* ══ GUIDE TAB ══ */}
      {tab === "guide" && (
        <div className="space-y-3">
          <Button size="sm" onClick={runGuide} disabled={loading === "guide"} className="w-full h-8 bg-gradient-to-r from-[var(--gold)]/20 to-amber-400/20 text-amber-300 hover:from-[var(--gold)]/40 hover:to-amber-400/40 text-[11px] font-bold border border-[var(--gold)]/30">
            {loading === "guide" ? <Loader2 size={12} className="animate-spin mr-1" /> : <Compass size={12} className="mr-1" />}
            What should I do next?
          </Button>
          {latestCoach && (
            <div className="space-y-2">
              <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-[9px] font-bold uppercase tracking-wider text-amber-400/80 mb-1">Nick&apos;s read</p>
                <p className="text-[12px] text-zinc-200 leading-relaxed">{latestCoach.read}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80 mb-1">Next move</p>
                <p className="text-[12px] text-zinc-200">{latestCoach.nextAction}</p>
              </div>
              {latestCoach.blocker && (
                <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-red-400/80 mb-1">Blocker</p>
                  <p className="text-[11px] text-zinc-300">{latestCoach.blocker}</p>
                </div>
              )}
              {latestCoach.risks && latestCoach.risks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-red-400/80">Watch next 48h</p>
                  {latestCoach.risks.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] text-zinc-400">
                      <AlertTriangle size={9} className="shrink-0 mt-0.5 text-red-400/60" />
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[8px] text-zinc-700 text-right">
                {new Date(latestCoach.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
          )}
          {coachHistory.length > 1 && !coachEntry && (
            <details className="text-[9px] text-zinc-600">
              <summary className="cursor-pointer hover:text-zinc-400">Coach history ({coachHistory.length - 1})</summary>
              <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                {coachHistory.slice(0, -1).reverse().map((entry, i) => (
                  <GlassCard key={i} className="p-1.5">
                    <p className="text-zinc-500 text-[9px]">
                      {new Date(entry.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </p>
                    <p className="text-zinc-400 text-[10px] mt-0.5">{entry.read}</p>
                    <p className="text-emerald-400/70 text-[10px] mt-0.5">→ {entry.nextAction}</p>
                  </GlassCard>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* CHECK tab removed — its content (doneChecklist + common
          mistakes + recently-completed log) now lives at the bottom
          of the PLAN tab so steps and "what does done look like" sit
          next to each other and evolve together. */}

      {/* May 02 · J — bulk ops row. Three batch operations on the
          project's tasks: complete all active, archive done, clear
          INBOX (drops missionId so they go to global Inbox). */}
      <div className="pt-2 border-t border-zinc-800/30 flex items-center gap-2 flex-wrap">
        <span className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">
          bulk:
        </span>
        <button
          type="button"
          onClick={completeAll}
          disabled={bulkBusy !== null}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/5 text-[9px] font-mono uppercase tracking-wider text-emerald-300/80 hover:bg-emerald-500/15 disabled:opacity-40"
          title="Mark all active tasks DONE"
        >
          {bulkBusy === "complete" ? <Loader2 size={9} className="animate-spin" /> : <CheckCircle2 size={9} />}
          complete all
        </button>
        <button
          type="button"
          onClick={archiveDone}
          disabled={bulkBusy !== null}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800/30 text-[9px] font-mono uppercase tracking-wider text-zinc-400 hover:bg-zinc-800/60 disabled:opacity-40"
          title="Archive all DONE tasks (drops them out of NOW)"
        >
          {bulkBusy === "archive" ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
          archive done
        </button>
        <button
          type="button"
          onClick={clearInbox}
          disabled={bulkBusy !== null}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/5 text-[9px] font-mono uppercase tracking-wider text-amber-300/80 hover:bg-amber-500/15 disabled:opacity-40"
          title="Move INBOX-status tasks back to global Inbox"
        >
          {bulkBusy === "clear" ? <Loader2 size={9} className="animate-spin" /> : <XIcon size={9} />}
          clear inbox
        </button>
      </div>

      {/* Footer — project edit + delete */}
      <div className="pt-2 border-t border-zinc-800/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={startEdit}
            className="text-[9px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 uppercase tracking-wider"
          >
            <Pencil size={9} />
            Edit
          </button>
          <button onClick={onDeleteProject} className="text-[9px] text-red-400/50 hover:text-red-400 flex items-center gap-1">
            <Trash2 size={9} />
            Delete project
          </button>
        </div>
        <span className="text-[8px] text-zinc-700 font-mono">
          {tasks.filter((t) => t.status === "DONE").length}/{tasks.length} steps
        </span>
      </div>

      {/* v10.0.421 · linked missions panel · operator can connect this
          mission to others (depends-on / blocks / supersedes / spawned-from
          / related). Lazy-loads the link list + missions catalog when
          mounted · scoped to this mission only. */}
      <LinkedMissionsPanel missionId={missionId} />
    </div>
  );
}

// Silence unused `ChevronRight` import — it's referenced in the
// barrel in case we add step grouping later.
void ChevronRight;
