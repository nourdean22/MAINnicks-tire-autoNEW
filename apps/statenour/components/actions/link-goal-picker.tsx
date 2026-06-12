"use client";

/**
 * LinkGoalPicker — inline popover that appears when Nour taps the
 * "↑ no goal linked" chip on an orphan project card. Lists his
 * active goals as tappable options. Selecting one batch-patches
 * every task in that project (Mission) with goalId = selected, so
 * the Goal ↔ Project bridge picks up the linkage on next render.
 *
 * Semantics: links the project to the goal at the TASK level
 * (since Mission has no goalId column in the current schema — the
 * bridge derives goal↔project from Task.goalId + Task.missionId).
 * Only patches tasks that are missing a goalId — won't overwrite
 * explicit per-task goal assignments.
 *
 * Lives in projectsContent in the tasks page.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Target, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { classifyStaleness } from "@/lib/brain/goal-staleness";
import { notifyDataChanged } from "@/lib/events/data-change";
import { trpc } from "@/lib/trpc/client";

interface GoalOption {
  id: string;
  title: string;
  horizon?: string | null;
  domain?: string;
  // Apr 27 · staleness fields. Optional so callers without the data
  // still work (the helper falls back to "alive" when fields missing).
  createdAt?: string;
  updatedAt?: string;
  progress?: number;
  currentValue?: number;
  status?: string;
  linkedActiveCount?: number;
  linkedDoneCount?: number;
  loopsThisWeek?: number;
}

interface LinkGoalPickerProps {
  projectId: string;
  projectTitle: string;
  taskIdsWithoutGoal: string[];
  goals: GoalOption[];
  onLinked?: () => void;
  /** Optional trigger label — defaults to "link goal". */
  triggerLabel?: string;
  /**
   * Apr 27 · EDIT — when set, the picker is in re-link mode. The
   * named goal renders as "✓ current" inside the list and an
   * Unlink button appears at the top. Used by the task-level goal
   * chip when Nour wants to fix a wrong linkage (e.g. a business
   * task accidentally tied to his weight goal).
   */
  currentGoalId?: string | null;
  allowUnlink?: boolean;
  /** Custom render for the trigger (defaults to amber pill). */
  renderTrigger?: (open: () => void) => React.ReactNode;
  /** Auto-open on mount — used when picker is rendered conditionally
   *  in response to a parent-controlled "edit this task" intent. */
  defaultOpen?: boolean;
  /** Called when picker closes (so parent can clear edit state). */
  onClose?: () => void;
}

// ─── Apr 27 · P3 — fuzzy goal suggester ───────────────────────────
// Tokenizes project title and goal title, scores by overlap +
// substring + domain match. Returns the top 1-2 candidates for
// one-tap linking. Lives in the same file because it's only used
// here; promote to lib/ if other surfaces need it.

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "into", "your",
  "have", "more", "what", "when", "will", "make", "want", "need", "plan",
  "make", "than", "then", "out",
]);

interface SuggestionScore {
  goal: GoalOption;
  score: number;
}

export function suggestGoalsForProject(
  projectTitle: string,
  projectDomain: string | null | undefined,
  goals: GoalOption[],
  topN: number = 2,
): SuggestionScore[] {
  const projectTokens = tokenize(projectTitle).filter((t) => !STOP_WORDS.has(t));
  if (projectTokens.length === 0) return [];

  const scored: SuggestionScore[] = [];
  for (const g of goals) {
    let score = 0;
    const goalTokens = tokenize(g.title).filter((t) => !STOP_WORDS.has(t));

    // Token overlap
    const overlap = projectTokens.filter((t) => goalTokens.includes(t)).length;
    score += overlap * 10;

    // Substring containment (project title appears in goal or vice versa)
    const projectLower = projectTitle.toLowerCase();
    const goalLower = g.title.toLowerCase();
    if (projectLower.length >= 4 && goalLower.includes(projectLower)) score += 15;
    if (goalLower.length >= 4 && projectLower.includes(goalLower)) score += 15;

    // Domain match
    if (
      projectDomain &&
      g.domain &&
      projectDomain.toLowerCase() === g.domain.toLowerCase()
    ) {
      score += 5;
    }

    if (score > 0) scored.push({ goal: g, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

export function LinkGoalPicker({
  projectId: _projectId,
  projectTitle,
  taskIdsWithoutGoal,
  goals,
  onLinked,
  triggerLabel = "link goal",
  currentGoalId = null,
  allowUnlink = false,
  renderTrigger,
  defaultOpen = false,
  onClose,
}: LinkGoalPickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showStale, setShowStale] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // task.update replaces PATCH /api/tasks/:id. The link/unlink flows
  // fire one mutation per task via Promise.allSettled · a fulfilled
  // promise = a successful update (the legacy code's `r.value.ok`),
  // a rejected one = a failure.
  const updateTask = trpc.task.update.useMutation();

  // Apr 27 · split goals into alive vs stale buckets so the picker
  // doesn't shove zombie goals (0% progress, no linked tasks, 30d+
  // old) in Nour's face when he's trying to link a fresh project.
  // Stale goals are collapsed behind a "show N stale" expander.
  const { aliveGoals, staleGoals } = (() => {
    const alive: GoalOption[] = [];
    const stale: GoalOption[] = [];
    for (const g of goals) {
      // Caller may not have provided the staleness fields. When
      // missing, the helper returns "alive" by default — we err on
      // the side of showing the goal rather than hiding it.
      if (
        typeof g.createdAt !== "string" ||
        typeof g.updatedAt !== "string" ||
        typeof g.progress !== "number" ||
        typeof g.currentValue !== "number" ||
        typeof g.status !== "string"
      ) {
        alive.push(g);
        continue;
      }
      const verdict = classifyStaleness({
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        progress: g.progress,
        currentValue: g.currentValue,
        status: g.status,
        linkedActiveCount: g.linkedActiveCount,
        linkedDoneCount: g.linkedDoneCount,
        loopsThisWeek: g.loopsThisWeek,
      });
      if (verdict.kind === "stale") stale.push(g);
      else alive.push(g);
    }
    return { aliveGoals: alive, staleGoals: stale };
  })();

  // Close on outside click. Notify parent (so it can clear the
  // "currently editing this task" state).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, onClose]);

  // Apr 27 · UNLINK — when re-linking and Nour wants to clear the
  // bad goal entirely (e.g. business task wrongly tied to weight
  // goal), PATCH each task with goalId=null. Same parallel pattern
  // as handleLink for symmetry + speed.
  const handleUnlink = async () => {
    if (taskIdsWithoutGoal.length === 0) {
      toast.error("nothing to unlink");
      return;
    }
    setBusyId("__unlink__");
    try {
      const results = await Promise.allSettled(
        taskIdsWithoutGoal.map((taskId) =>
          (updateTask.mutateAsync as any)({ id: taskId, fields: { goalId: null } }),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (ok > 0) {
        toast.success(
          `Unlinked ${ok} task${ok === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}`,
        );
        // Apr 27 · cross-surface: tasks lost their goalId, so NOW
        // breadcrumbs + PLAN goal-projects bridge + TRACK rollups all
        // need a refresh. Single notify per domain — listeners decide.
        notifyDataChanged("tasks", {
          source: "link-goal-picker",
          detail: "unlink",
        });
        notifyDataChanged("goals", {
          source: "link-goal-picker",
          detail: "unlink",
        });
        notifyDataChanged("projects", {
          source: "link-goal-picker",
          detail: "unlink",
        });
        onLinked?.();
      } else {
        toast.error("Unlink failed — no tasks updated");
      }
    } catch (e) {
      toast.error(`Unlink failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusyId(null);
      setOpen(false);
      onClose?.();
    }
  };

  const handleLink = async (goal: GoalOption) => {
    if (taskIdsWithoutGoal.length === 0) {
      toast.error("project has no tasks to link");
      return;
    }
    setBusyId(goal.id);
    try {
      // Parallel update — task.update accepts goalId via the shared
      // taskUpdateSchema. We don't create a Mission.goalId column
      // because the bridge derives linkage from tasks. Fine for
      // projects with 50 or fewer tasks; above that we'd want a
      // bulk endpoint but Nour's workload is well under.
      const results = await Promise.allSettled(
        taskIdsWithoutGoal.map((taskId) =>
          (updateTask.mutateAsync as any)({ id: taskId, fields: { goalId: goal.id } }),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (ok > 0) {
        toast.success(
          `Linked ${ok} task${ok === 1 ? "" : "s"} to "${goal.title.slice(0, 40)}"${failed > 0 ? ` (${failed} failed)` : ""}`
        );
        // Apr 27 · cross-surface notify so NOW chip, PLAN goal-bridge,
        // and TRACK rollups all reflect the new linkage instantly.
        notifyDataChanged("tasks", {
          source: "link-goal-picker",
          detail: "link",
          id: goal.id,
        });
        notifyDataChanged("goals", {
          source: "link-goal-picker",
          detail: "link",
          id: goal.id,
        });
        notifyDataChanged("projects", {
          source: "link-goal-picker",
          detail: "link",
        });
        onLinked?.();
      } else {
        toast.error("Link failed — no tasks updated");
      }
    } catch (e) {
      toast.error(`Link failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusyId(null);
      setOpen(false);
    }
  };

  if (!goals || goals.length === 0) {
    return (
      <span
        className="text-[8px] font-mono uppercase tracking-wider text-zinc-600"
        title="Create a goal first in PLAN mode"
      >
        no goals to link
      </span>
    );
  }

  // Apr 27 · EDIT — when re-linking, current goal is shown as "✓
  // current" inside the list and clicking it is a no-op. Caller can
  // also pass renderTrigger to suppress the default button (used by
  // the centered modal sheet on tasks page).
  const currentGoal = currentGoalId
    ? goals.find((g) => g.id === currentGoalId) ?? null
    : null;

  return (
    <div ref={ref} className="relative inline-flex">
      {renderTrigger ? (
        renderTrigger(() => setOpen(true))
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-px rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:border-amber-500/70 hover:bg-amber-500/25 transition-all"
          title={`Link "${projectTitle}" to one of Nour's goals`}
        >
          {triggerLabel}
        </button>
      )}

      {open && (
        <div
          className={cn(
            // When the picker is rendered as a sheet (renderTrigger
            // suppressed + defaultOpen true), the parent modal already
            // positions the dropdown — render it as a static block
            // instead of an absolute popover so it doesn't fly off
            // the modal.
            renderTrigger
              ? "z-30 w-full rounded-lg border border-zinc-700/60 bg-zinc-950 overflow-hidden"
              : "absolute left-0 top-full mt-1 z-30 min-w-[220px] max-w-[300px] rounded-lg border border-zinc-700/60 bg-zinc-950 shadow-[0_8px_24px_rgba(0,0,0,0.6)] overflow-hidden",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-zinc-800/50">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400 flex items-center gap-1">
              <Target size={9} />
              {currentGoalId ? "switch goal" : "pick a goal"}
            </span>
            {!renderTrigger && (
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-600 hover:text-zinc-300"
                aria-label="close"
              >
                <X size={10} />
              </button>
            )}
          </div>
          {/* Apr 27 · UNLINK — top-of-list affordance when re-linking
              and Nour wants to clear the bad linkage entirely. */}
          {allowUnlink && currentGoalId && (
            <button
              onClick={() => void handleUnlink()}
              disabled={busyId !== null}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-rose-300 hover:bg-rose-500/10 transition-colors border-b border-zinc-800/40 disabled:opacity-50"
              title={`Unlink from "${currentGoal?.title ?? "current goal"}"`}
            >
              {busyId === "__unlink__" ? (
                <Loader2 size={10} className="animate-spin text-rose-400 shrink-0" />
              ) : (
                <X size={10} className="text-rose-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider truncate">
                  unlink
                </p>
                {currentGoal && (
                  <p className="text-[9px] text-zinc-500 truncate">
                    from &ldquo;{currentGoal.title}&rdquo;
                  </p>
                )}
              </div>
            </button>
          )}
          <div className="max-h-[240px] overflow-y-auto py-1">
            {aliveGoals.length === 0 && staleGoals.length === 0 && (
              <p className="px-2.5 py-3 text-[10px] text-zinc-600 italic">
                No goals to link yet.
              </p>
            )}
            {aliveGoals.map((g) => {
              const isCurrent = g.id === currentGoalId;
              return (
              <button
                key={g.id}
                onClick={() => !isCurrent && handleLink(g)}
                disabled={busyId !== null || isCurrent}
                className={cn(
                  "w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-900 transition-colors",
                  busyId === g.id && "opacity-60",
                  isCurrent && "bg-violet-500/5 cursor-default",
                )}
              >
                {busyId === g.id ? (
                  <Loader2 size={10} className="animate-spin text-amber-400 shrink-0" />
                ) : (
                  <Target size={10} className={cn(isCurrent ? "text-violet-300" : "text-violet-400", "shrink-0")} />
                )}
                <div className="flex-1 min-w-0">
                  <p className={cn("text-[11px] truncate", isCurrent ? "text-violet-200 font-bold" : "text-zinc-200")}>
                    {g.title}
                  </p>
                  {(g.horizon || g.domain) && (
                    <p className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">
                      {[g.horizon, g.domain].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                {isCurrent && (
                  <span className="text-[7px] font-mono uppercase tracking-wider text-violet-400/80 shrink-0">
                    current
                  </span>
                )}
              </button>
              );
            })}
            {/* Apr 27 · stale goals — zombies (0% + no linked tasks +
                30d+ old) get collapsed behind a "show N stale" footer
                so the picker stays clean. Tap to reveal them. */}
            {staleGoals.length > 0 && (
              <>
                <button
                  onClick={() => setShowStale((v) => !v)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[9px] font-mono uppercase tracking-wider text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900/50 border-t border-zinc-800/40"
                >
                  <AlertCircle size={9} className="text-amber-500/60" />
                  <span>
                    {showStale ? "hide" : "show"} {staleGoals.length} stale
                  </span>
                </button>
                {showStale &&
                  staleGoals.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => handleLink(g)}
                      disabled={busyId !== null}
                      className={cn(
                        "w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-900 transition-colors opacity-50",
                        busyId === g.id && "opacity-30"
                      )}
                      title="0% · no linked tasks · 30d+ old"
                    >
                      {busyId === g.id ? (
                        <Loader2 size={10} className="animate-spin text-amber-400 shrink-0" />
                      ) : (
                        <Target size={10} className="text-zinc-600 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-zinc-500 truncate line-through">
                          {g.title}
                        </p>
                        {(g.horizon || g.domain) && (
                          <p className="text-[8px] font-mono uppercase tracking-wider text-zinc-700">
                            {[g.horizon, g.domain].filter(Boolean).join(" · ")} · stale
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
              </>
            )}
          </div>
          <div className="px-2.5 py-1 border-t border-zinc-800/50 text-[8px] text-zinc-600">
            links {taskIdsWithoutGoal.length} task{taskIdsWithoutGoal.length === 1 ? "" : "s"}
            {staleGoals.length > 0 && (
              <span className="ml-1 text-zinc-700">· {staleGoals.length} hidden as stale</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
