"use client";

/**
 * ReviewWizard — 5-step weekly review flow.
 *
 * Apr 27 · Original 4-step wizard replaced the dead REVIEW button.
 * 2026-05-27 · Step 5 ("Serve & Surprise") added per operator request
 * to lift Tim Challies' "Do More Better" framework into the loop. The
 * 4-step wizard already covered Get Clear (triage) + Get Current/Set
 * (goal+project confirm) + Get Going (pick top 3). What it was missing:
 * the per-week "where am I serving + where am I delighting?" prompts
 * that distinguish the Challies framework from vanilla GTD reviews.
 * Step 5 is two text fields (faithful · surprise) saved to BrainMemory
 * via task.saveWeeklyReview so next Monday's recall can remind Nick
 * what the operator pre-committed to.
 *
 * Steps:
 *   1. Triage warnings   — stale routines, decaying goals, cold
 *                          projects, orphan tasks. keep / kill.
 *   2. Confirm goals     — every active goal: still active? pause?
 *                          + each goal's "why" surfaced for mission
 *                          alignment (Challies' "review your mission")
 *   3. Confirm projects  — every active project: still going?
 *                          archive cold ones?
 *   4. Pick top 3        — pin 3 routines for next week. Auto-pins
 *                          on NOW so they surface tomorrow.
 *   5. Serve & Surprise  — operator types 1 "faithful" move +
 *                          1 "surprise/delight" move for the week.
 *                          Persisted to BrainMemory(category=
 *                          "weekly_review", key=ISO-week).
 *
 * Mounted at the page level so the same instance can be opened from
 * NOW headline OR TRACK's "Run weekly review" button.
 *
 * Wording: routines (not loops), warnings (not drifts).
 */

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Target,
  Trophy,
  Pin,
  X,
  Check,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { notifyDataChanged } from "@/lib/events/data-change";
import { computeProjectMomentum } from "@/lib/brain/project-momentum";
import { classifyStaleness } from "@/lib/brain/goal-staleness";
import type { Task } from "@/components/actions/shared";
import { trpc } from "@/lib/trpc/client";

interface GoalRow {
  id: string;
  title: string;
  domain?: string | null;
  progress?: number;
  currentValue?: number;
  targetValue?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  linkedActiveCount?: number;
  linkedDoneCount?: number;
  loopsThisWeek?: number;
  /** 2026-05-27 · LifeGoal.why field · the "so that" clause · surfaced
   *  in Step 2 for mission alignment per the Challies framework. */
  why?: string | null;
}

interface ProjectRow {
  id: string;
  title: string;
  domain?: string | null;
  status?: string;
}

interface ReviewWizardProps {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  goals: GoalRow[];
  projects: ProjectRow[];
  /** Caller-provided pin toggle. If unset, pinning is skipped on
   *  step 4 (we only set goals/projects status). */
  onPinTask?: (taskId: string) => void | Promise<void>;
  pinnedIds?: Set<string>;
}

type Step = 1 | 2 | 3 | 4 | 5;

/** ISO week key · "YYYY-WNN" · used as the BrainMemory upsert key
 *  so re-finishing the same week's review overwrites instead of
 *  duplicating. Sunday = end of week → if review fires before
 *  Monday morning, it slots into the *upcoming* week. */
function isoWeekKey(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function ReviewWizard({
  open,
  onClose,
  tasks,
  goals,
  projects,
  onPinTask,
  pinnedIds,
}: ReviewWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  // Triage mutations · replace the legacy PATCH /api/{tasks,goals,
  // missions} calls. mutateAsync resolves on success / rejects on a
  // server error, matching the old `r.ok` true/false branches.
  const updateTask = trpc.task.update.useMutation();
  const goalsUpdate = trpc.task.goalsUpdate.useMutation();
  const missionUpdate = trpc.task.missionUpdate.useMutation();
  // 2026-05-27 · weekly-review persistence · writes the Step 5 inputs +
  // accumulator state to BrainMemory(category=weekly_review, key=ISO-week)
  // on Finish. Idempotent · re-finishing the same week overwrites.
  const saveReview = trpc.task.saveWeeklyReview.useMutation();
  // Step 1 — local set of warnings the user has already actioned so
  // the row hides without a refetch.
  const [actioned, setActioned] = useState<Set<string>>(new Set());
  // Step 4 — picks for next week (taskIds).
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  // Step 5 — Challies' "Serve & Surprise" lane. Two free-text fields ·
  // operator types ONE "faithful" thing (the duty they owe somewhere)
  // and ONE "surprise" thing (the act of delight they'll choose to do)
  // for the upcoming week. Saved verbatim to BrainMemory so the
  // operator + Nick can pull it back Monday morning.
  const [serveText, setServeText] = useState("");
  const [surpriseText, setSurpriseText] = useState("");

  // Reset when re-opened so each session is fresh.
  useEffect(() => {
    if (open) {
      setStep(1);
      setActioned(new Set());
      setPickedIds(new Set());
      setServeText("");
      setSurpriseText("");
    }
  }, [open]);

  const warnings = useMemo(() => {
    const now = Date.now();
    interface W {
      id: string;
      kind: "stale-task" | "decaying-goal" | "cold-project" | "orphan-task";
      label: string;
      sub: string;
      taskId?: string;
      goalId?: string;
      projectId?: string;
    }
    const list: W[] = [];
    const active = tasks.filter((t) =>
      ["INBOX", "READY", "DOING"].includes(t.status),
    );
    for (const t of active) {
      const w = t.lastTouchedAt || t.createdAt;
      if (!w) continue;
      const ageDays = Math.floor((now - new Date(w).getTime()) / 86_400_000);
      if (ageDays >= 7) {
        list.push({
          id: `task-${t.id}`,
          kind: "stale-task",
          label: t.title,
          sub: `${ageDays}d untouched`,
          taskId: t.id,
        });
      }
      if (!t.goalId && !t.missionId && t.createdAt) {
        const ageDays2 = Math.floor((now - new Date(t.createdAt).getTime()) / 86_400_000);
        if (ageDays2 >= 3) {
          list.push({
            id: `orphan-${t.id}`,
            kind: "orphan-task",
            label: t.title,
            sub: `orphan · ${ageDays2}d`,
            taskId: t.id,
          });
        }
      }
    }
    for (const g of goals) {
      if (!g.createdAt || !g.updatedAt) continue;
      const stale = classifyStaleness({
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        progress: g.progress ?? 0,
        currentValue: g.currentValue ?? 0,
        status: g.status ?? "active",
        linkedActiveCount: g.linkedActiveCount,
        linkedDoneCount: g.linkedDoneCount,
        loopsThisWeek: g.loopsThisWeek,
      });
      if (stale.kind !== "alive") {
        list.push({
          id: `goal-${g.id}`,
          kind: "decaying-goal",
          label: g.title,
          sub: stale.reason,
          goalId: g.id,
        });
      }
    }
    for (const p of projects) {
      if ((p.status ?? "ACTIVE") !== "ACTIVE") continue;
      const m = computeProjectMomentum(p.id, tasks);
      if (m.momentum === "cold" || m.momentum === "dead") {
        list.push({
          id: `proj-${p.id}`,
          kind: "cold-project",
          label: p.title,
          sub: `${m.momentum} · ${Math.round(m.freshestTouchHrs)}h ago`,
          projectId: p.id,
        });
      }
    }
    return list.filter((w) => !actioned.has(w.id));
  }, [tasks, goals, projects, actioned]);

  const activeGoals = useMemo(
    () =>
      goals.filter(
        (g) => (g.status ?? "active") !== "completed" && (g.status ?? "active") !== "achieved",
      ),
    [goals],
  );

  const activeProjects = useMemo(
    () => projects.filter((p) => (p.status ?? "ACTIVE") === "ACTIVE"),
    [projects],
  );

  const candidateTasks = useMemo(
    () =>
      tasks
        .filter((t) => ["INBOX", "READY"].includes(t.status))
        .sort((a, b) => {
          // Canonical polarity: higher = more urgent; unscored rows sink.
          const ap =
            (a as Task & { manualPriorityOverride?: number | null }).manualPriorityOverride ??
            (a as Task & { autoPriority?: number | null }).autoPriority ?? -1;
          const bp =
            (b as Task & { manualPriorityOverride?: number | null }).manualPriorityOverride ??
            (b as Task & { autoPriority?: number | null }).autoPriority ?? -1;
          return bp - ap;
        })
        .slice(0, 20),
    [tasks],
  );

  if (!open) return null;

  const killTask = async (taskId: string, warningId: string) => {
    try {
      await updateTask.mutateAsync({ id: taskId, fields: { status: "ARCHIVED" } });
      toast.success("Killed");
      setActioned((prev) => new Set(prev).add(warningId));
      notifyDataChanged("tasks", { source: "review-wizard", detail: "kill", id: taskId });
    } catch {
      toast.error("Couldn't kill");
    }
  };

  const pauseGoal = async (goalId: string, warningId: string) => {
    try {
      await goalsUpdate.mutateAsync({ id: goalId, status: "paused" });
      toast.success("Goal paused");
      setActioned((prev) => new Set(prev).add(warningId));
      notifyDataChanged("goals", { source: "review-wizard", detail: "pause", id: goalId });
    } catch {
      toast.error("Couldn't pause");
    }
  };

  const archiveProject = async (projectId: string, warningId: string) => {
    try {
      await missionUpdate.mutateAsync({
        id: projectId,
        fields: { status: "PAUSED" },
      });
      toast.success("Project paused");
      setActioned((prev) => new Set(prev).add(warningId));
      notifyDataChanged("projects", { source: "review-wizard", detail: "pause", id: projectId });
    } catch {
      toast.error("Couldn't pause project");
    }
  };

  const togglePick = (id: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  };

  const finishWizard = async () => {
    setBusy(true);
    try {
      // Pin selected tasks for next week
      if (onPinTask) {
        for (const id of pickedIds) {
          if (!pinnedIds?.has(id)) {
            await onPinTask(id);
          }
        }
      }
      // 2026-05-27 · persist the full review to BrainMemory via
      // task.saveWeeklyReview so Nick can recall the operator's
      // Serve+Surprise commitments + pinned-for-week picks during
      // Monday morning chats. Best-effort · localStorage fallback
      // below preserves delta-panel behavior if the server save fails.
      const weekKey = isoWeekKey();
      try {
        await saveReview.mutateAsync({
          weekKey,
          warningsActioned: actioned.size,
          pickedTaskIds: [...pickedIds],
          serveText: serveText.trim(),
          surpriseText: surpriseText.trim(),
        });
      } catch (err) {
        // Server save failed · still close the wizard. The localStorage
        // snapshot below ensures the delta panel still works.
        console.warn("[ReviewWizard] saveWeeklyReview failed:", err);
      }
      // Save snapshot to localStorage so next week's delta panel
      // can compare. Single key, last-snapshot-wins.
      try {
        const snapshot = {
          at: new Date().toISOString(),
          warningCount: warnings.length + actioned.size,
          actionedCount: actioned.size,
          pickedIds: [...pickedIds],
          weekKey,
          serveText: serveText.trim(),
          surpriseText: surpriseText.trim(),
        };
        localStorage.setItem("nour:lastReview", JSON.stringify(snapshot));
      } catch {
        // ignore
      }
      toast.success("Weekly review saved · top 3 pinned · serve & surprise locked");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        className="rounded-xl border border-zinc-700/60 bg-zinc-950 shadow-[0_8px_32px_rgba(0,0,0,0.8)] w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]/80">
              Weekly review
            </span>
            <span className="text-[9px] text-zinc-600 font-mono">
              step {step}/5
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-200"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-zinc-800/40">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className={cn(
                "flex-1 h-0.5 transition-all",
                n <= step ? "bg-[var(--gold)]" : "bg-zinc-800",
              )}
            />
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {step === 1 && (
            <>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[12px]">⚠️</span>
                <h3 className="text-[12px] font-bold text-zinc-100">
                  Triage warnings
                </h3>
              </div>
              <p className="text-[10px] text-zinc-500 italic">
                {warnings.length === 0
                  ? "Clean slate — nothing rotting."
                  : `${warnings.length} item${warnings.length === 1 ? "" : "s"} to decide on.`}
              </p>
              <div className="space-y-1.5 mt-2">
                {warnings.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-start gap-2 p-2 rounded-md border border-zinc-800/40 bg-zinc-900/30 text-[10px]"
                  >
                    <AlertTriangle
                      size={11}
                      className={cn(
                        "shrink-0 mt-0.5",
                        w.kind === "decaying-goal"
                          ? "text-violet-400"
                          : w.kind === "cold-project"
                            ? "text-rose-400"
                            : "text-amber-400",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-zinc-200 truncate font-medium">{w.label}</p>
                      <p className="text-[8px] text-zinc-500 italic">{w.sub}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setActioned((p) => new Set(p).add(w.id))}
                        className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                      >
                        keep
                      </button>
                      {w.taskId && (
                        <button
                          onClick={() => void killTask(w.taskId!, w.id)}
                          className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                        >
                          kill
                        </button>
                      )}
                      {w.goalId && (
                        <button
                          onClick={() => void pauseGoal(w.goalId!, w.id)}
                          className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                        >
                          pause
                        </button>
                      )}
                      {w.projectId && (
                        <button
                          onClick={() => void archiveProject(w.projectId!, w.id)}
                          className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                        >
                          pause
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center gap-1.5 mb-1">
                <Target size={11} className="text-violet-400" />
                <h3 className="text-[12px] font-bold text-zinc-100">
                  Goals — still active?
                </h3>
              </div>
              <p className="text-[10px] text-zinc-500 italic">
                {activeGoals.length} active. Pause anything you don&apos;t want to think about right now.
              </p>
              <div className="space-y-1.5 mt-2">
                {activeGoals.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-start gap-2 p-2 rounded-md border border-zinc-800/40 bg-zinc-900/30 text-[10px]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-zinc-200 font-medium">{g.title}</p>
                      <p className="text-[8px] text-zinc-500 font-mono mt-0.5">
                        {g.progress}% · {g.currentValue}/{g.targetValue}
                      </p>
                      {/* 2026-05-27 · render the "so that" clause when present ·
                       *  Challies framework: review your mission statements as
                       *  you confirm goals so the alignment is fresh in your head. */}
                      {g.why && g.why.trim().length > 0 && (
                        <p className="text-[9px] italic text-zinc-400 mt-1 leading-snug">
                          → {g.why}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => void pauseGoal(g.id, `keep-${g.id}`)}
                      className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 shrink-0 mt-0.5"
                    >
                      pause
                    </button>
                  </div>
                ))}
                {activeGoals.length === 0 && (
                  <p className="text-[10px] text-zinc-600 italic text-center py-3">
                    No active goals.
                  </p>
                )}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-center gap-1.5 mb-1">
                <Trophy size={11} className="text-blue-400" />
                <h3 className="text-[12px] font-bold text-zinc-100">
                  Projects — still going?
                </h3>
              </div>
              <p className="text-[10px] text-zinc-500 italic">
                {activeProjects.length} active. Pause cold ones to clear the deck.
              </p>
              <div className="space-y-1.5 mt-2">
                {activeProjects.map((p) => {
                  const m = computeProjectMomentum(p.id, tasks);
                  const isCold = m.momentum === "cold" || m.momentum === "dead";
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-md border text-[10px]",
                        isCold
                          ? "border-rose-500/30 bg-rose-500/5"
                          : "border-zinc-800/40 bg-zinc-900/30",
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-zinc-200 truncate font-medium">{p.title}</p>
                        <p className="text-[8px] text-zinc-500 font-mono">
                          {m.momentum} · {Math.round(m.freshestTouchHrs)}h ago
                        </p>
                      </div>
                      <button
                        onClick={() => void archiveProject(p.id, `keep-${p.id}`)}
                        className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                      >
                        pause
                      </button>
                    </div>
                  );
                })}
                {activeProjects.length === 0 && (
                  <p className="text-[10px] text-zinc-600 italic text-center py-3">
                    No active projects.
                  </p>
                )}
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div className="flex items-center gap-1.5 mb-1">
                <Pin size={11} className="text-[var(--gold)]" />
                <h3 className="text-[12px] font-bold text-zinc-100">
                  Pick top 3 for next week
                </h3>
              </div>
              <p className="text-[10px] text-zinc-500 italic">
                These get pinned to NOW so they surface tomorrow morning.
              </p>
              <div className="space-y-1 mt-2">
                {candidateTasks.map((t) => {
                  const picked = pickedIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => togglePick(t.id)}
                      disabled={!picked && pickedIds.size >= 3}
                      className={cn(
                        "w-full flex items-start gap-2 p-2 rounded-md border text-[10px] text-left transition-all",
                        picked
                          ? "border-[var(--gold)]/50 bg-[var(--gold)]/10"
                          : "border-zinc-800/40 bg-zinc-900/30 hover:border-zinc-700",
                        !picked && pickedIds.size >= 3 && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0 mt-0.5",
                          picked ? "text-[var(--gold)]" : "text-zinc-700",
                        )}
                      >
                        {picked ? <Check size={11} /> : <Pin size={10} />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-zinc-200 truncate">{t.title}</p>
                        {t.mission?.domain && (
                          <p className="text-[8px] text-zinc-600 font-mono uppercase tracking-wider">
                            {t.mission.domain.toLowerCase()}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
                {candidateTasks.length === 0 && (
                  <p className="text-[10px] text-zinc-600 italic text-center py-3">
                    No active routines to pick from.
                  </p>
                )}
              </div>
              <p className="text-[8px] text-zinc-600 font-mono uppercase tracking-wider mt-2 text-center">
                {pickedIds.size}/3 picked
              </p>
            </>
          )}

          {step === 5 && (
            <>
              {/* 2026-05-27 · Challies' "Serve & Surprise" lane · the
               *  unique-to-this-framework step that asks operator to
               *  pre-commit not just to what they MUST do (faithful) but
               *  also to one act of delight (surprise). Free-text both ·
               *  saved verbatim to BrainMemory · Nick can pull these back
               *  Monday morning to remind operator what they committed to. */}
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[12px]">🎁</span>
                <h3 className="text-[12px] font-bold text-zinc-100">
                  Serve &amp; surprise
                </h3>
              </div>
              <p className="text-[10px] text-zinc-500 italic">
                Two things for the week ahead — one faithful, one to delight someone.
              </p>
              <div className="space-y-3 mt-3">
                <div className="space-y-1">
                  <label className="block text-[9px] uppercase tracking-wider text-emerald-400/80 font-mono">
                    Faithful · the duty I owe somewhere
                  </label>
                  <textarea
                    value={serveText}
                    onChange={(e) => setServeText(e.target.value.slice(0, 500))}
                    placeholder="What basic act of service do you owe somewhere this week?"
                    rows={2}
                    className="w-full rounded-md border border-zinc-700/50 bg-zinc-900/50 px-2 py-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/40 focus:outline-none resize-none transition-colors"
                  />
                  <p className="text-[8px] text-zinc-600 font-mono text-right tabular-nums">
                    {serveText.length}/500
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="block text-[9px] uppercase tracking-wider text-amber-400/80 font-mono">
                    Surprise · the act of delight I&apos;ll choose
                  </label>
                  <textarea
                    value={surpriseText}
                    onChange={(e) => setSurpriseText(e.target.value.slice(0, 500))}
                    placeholder="Who will you surprise · and how? (Card · gift · call · time · prayer · etc.)"
                    rows={2}
                    className="w-full rounded-md border border-zinc-700/50 bg-zinc-900/50 px-2 py-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none resize-none transition-colors"
                  />
                  <p className="text-[8px] text-zinc-600 font-mono text-right tabular-nums">
                    {surpriseText.length}/500
                  </p>
                </div>
                <p className="text-[8px] text-zinc-600 italic leading-snug">
                  Saved to your brain · Nick will surface these Monday morning so
                  you don&apos;t forget what you committed to.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-zinc-800/60 flex items-center justify-between gap-2">
          <button
            onClick={() => {
              if (step === 1) onClose();
              else setStep((s) => (s - 1) as Step);
            }}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-wider"
          >
            {step === 1 ? "cancel" : "← back"}
          </button>
          {step < 5 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as Step)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--gold)] hover:bg-[var(--gold)]/25"
            >
              next
              <ChevronRight size={11} />
            </button>
          ) : (
            <button
              onClick={() => void finishWizard()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--gold)]/50 bg-[var(--gold)] text-black px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
