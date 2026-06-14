"use client";

/**
 * ProjectCard · v10.0.273 · per-project rendered card extracted from
 * the /tasks page projectsContent block.
 *
 * Was inline at app/(mastery)/tasks/page.tsx ~lines 1539-1905 (~365
 * lines of JSX). Extracted as part of Move 3 of the state-of-autonicks
 * audit (the highest-risk in-codebase refactor) to bring /tasks page
 * under a saner cognitive-load ceiling.
 *
 * The card renders ·
 *   · mini progress-ring with percent done
 *   · title + domain badge
 *   · open / done / total counts
 *   · momentum chip (warm / steady / stale / cold / dead)
 *   · "in flight on NOW" pulse when a task is DOING
 *   · last-action ticker
 *   · re-plan button on drift (>14d untouched)
 *   · goal breadcrumb (linked goals OR "+ link" picker)
 *   · expanded ProjectDetail when toggled
 *
 * No behavior change vs the inline version · same data shape, same
 * callbacks, same primitives. Pure relocation + typed prop boundary.
 */

import { Badge } from "@/components/ui/badge";
import { ChevronRight, Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  computeProjectMomentum,
  tickerLine as projectTickerLine,
  momentumLabel,
  momentumTone,
} from "@/lib/brain/project-momentum";
import { suggestGoalsForProject, LinkGoalPicker } from "@/components/actions/link-goal-picker";
import { ProjectDetail } from "@/components/actions/project-detail";
import { trpc } from "@/lib/trpc/client";
import {
  domainClass as dc,
  type Task,
} from "@/components/actions/shared";

// ── Local types · mirrored from /tasks page so the boundary is typed ──
// Both Project + GoalCacheEntry are owned by the parent · we only need
// the shape for rendering / picker invocation.
interface Project {
  id: string;
  title: string;
  status: string;
  domain?: string | null;
  description?: string | null;
  deadline?: string | null;
  planData?: unknown;
}

// Mirror the /tasks page's GoalCacheEntry shape exactly so the
// optional horizon + domain align without nominal-type conflict.
interface GoalCacheEntry {
  id: string;
  title: string;
  horizon?: string | null;
  domain?: string;
  createdAt?: string;
  updatedAt?: string;
  progress?: number;
  currentValue?: number;
  targetValue?: number;
  deadline?: string | null;
  unit?: string | null;
  status?: string;
  linkedActiveCount?: number;
  linkedDoneCount?: number;
  loopsThisWeek?: number;
}

export interface ProjectCardProps {
  /** The project being rendered */
  project: Project;
  /** Tasks belonging to this project (already filtered by parent) */
  tasks: Task[];
  /** Whether this card is currently expanded */
  expanded: boolean;
  /** Toggle expand/collapse · parent owns the open-card state so only one expands at a time */
  onToggleExpand: () => void;
  /** Linked goal IDs for this project (parent owns the projectToGoals map) */
  linkedGoalIds: string[];
  /** Goal title lookup · key: goalId, value: title */
  goalTitles: Record<string, string>;
  /** Full goal cache for the picker (full row shape · parent owns the cache) */
  goalsCache: GoalCacheEntry[];
  /** Mark a task as complete */
  onCompleteTask: (id: string) => void | Promise<unknown>;
  /** Soft-delete a task */
  onDeleteTask: (id: string) => void | Promise<unknown>;
  /** Soft-delete this project */
  onDeleteProject: () => void | Promise<unknown>;
  /** Update plan data when ProjectDetail re-plans */
  onPlanUpdated: (next: unknown) => void;
  /** Refresh tasks/projects/goals · called after any mutation */
  onRefresh: () => void | Promise<unknown>;
}

export function ProjectCard({
  project: p,
  tasks: pt,
  expanded: exp,
  onToggleExpand,
  linkedGoalIds,
  goalTitles,
  goalsCache,
  onCompleteTask,
  onDeleteTask,
  onDeleteProject,
  onPlanUpdated,
  onRefresh,
}: ProjectCardProps) {
  // task.update replaces PATCH /api/tasks/:id for the goal link /
  // unlink chips. actions-surface slice · the re-plan button now hits
  // `trpc.ai.planProject` (replacing POST /api/ai/plan-project).
  const updateTask = trpc.task.update.useMutation();
  const planProjectMut = trpc.ai.planProject.useMutation();
  const activePt = pt.filter((t) => ["INBOX", "READY", "DOING"].includes(t.status));
  const pd = pt.filter((t) => t.status === "DONE").length;
  const pct = pt.length > 0 ? Math.round((pd / pt.length) * 100) : 0;
  // Apr 26 · P1 + P2 — project momentum bridge from PLAN to NOW.
  const momentum = computeProjectMomentum(p.id, pt);
  const mTone = momentumTone(momentum.momentum);
  const ticker = projectTickerLine(momentum);
  const isOrphan = linkedGoalIds.length === 0;

  return (
    <div
      key={p.id}
      id={`project-card-${p.id}`}
      className={cn(
        "rounded-xl border bg-zinc-900/30 overflow-hidden scroll-mt-20 transition-all",
        isOrphan ? "border-amber-500/20" : "border-zinc-800/30",
      )}
    >
      {/* Apr 27 · LINK-FIX — was a <button>, but LinkGoalPicker
          renders its own <button> inside the goal-breadcrumb
          row. Nested <button> is invalid HTML and iOS Safari
          eats the inner click, which is why "LINK GOAL" did
          nothing on the Health & Discipline card. Converted
          to a div+role=button so the picker click reaches
          its handler without DOM nesting. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className="w-full flex items-start gap-2.5 p-3 hover:bg-zinc-900/50 text-left transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-blue-500/40"
      >
        {/* Mini progress ring */}
        <div className="relative w-9 h-9 shrink-0">
          <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgb(39 39 42 / 0.4)" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke={pct >= 80 ? "rgb(52 211 153)" : pct >= 40 ? "rgb(96 165 250)" : "rgb(161 161 170)"}
              strokeWidth="3"
              strokeDasharray={`${pct * 0.942} 100`}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold font-mono text-zinc-400">
            {pct}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-bold text-zinc-100 truncate">
              {p.title}
            </span>
            <Badge className={cn("text-[7px] h-3 border-0 shrink-0", dc(p.domain ?? undefined))}>
              {(p.domain || "").toLowerCase()}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[9px] text-zinc-600 font-mono flex-wrap">
            <span><span className="text-amber-400">{activePt.length}</span> open</span>
            <span className="text-zinc-800">·</span>
            <span><span className="text-emerald-400">{pd}</span> done</span>
            <span className="text-zinc-800">·</span>
            <span>{pt.length} total</span>
            {/* Apr 26 · P1 — momentum chip. Hides on dead-empty
                projects where the "no tasks yet" ticker
                already conveys the state. */}
            {momentum.totalCount > 0 && (
              <>
                <span className="text-zinc-800">·</span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded border uppercase tracking-wider text-[8px]",
                    mTone.border,
                    mTone.bg,
                    mTone.text,
                    mTone.pulse && "animate-pulse",
                  )}
                  title={`Last touched ${Math.round(momentum.freshestTouchHrs)}h ago`}
                >
                  {momentumLabel(momentum.momentum)}
                </span>
              </>
            )}
            {/* Apr 26 · NOW bridge — when a task on this project
                is DOING, surface a tiny "in flight" chip so
                PLAN tab sees what NOW is executing. */}
            {momentum.doingTask && (
              <span
                className="px-1.5 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 text-blue-300 uppercase tracking-wider text-[8px] inline-flex items-center gap-1"
                title={`In flight on NOW: ${momentum.doingTask.title}`}
              >
                <span className="h-1 w-1 rounded-full bg-blue-400 animate-pulse" />
                in flight
              </span>
            )}
          </div>
          {/* Apr 26 · P2 — last-action ticker. Reflects what
              NOW just did (or didn't do) on this project so
              PLAN tab is alive, not a static list. */}
          {ticker && (
            <p
              className={cn(
                "text-[9px] mt-0.5 truncate font-mono",
                momentum.drifting ? "text-rose-400/70 italic" : "text-zinc-600",
              )}
            >
              ↳ {ticker}
            </p>
          )}
          {/* Apr 27 · P5 — re-plan trigger on drift. */}
          {momentum.drifting && (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  toast.loading(
                    `Asking Nick to re-plan "${p.title}"…`,
                    { id: `replan-${p.id}` },
                  );
                  // actions-surface slice · re-plan via trpc.ai.planProject.
                  // The legacy `regenerate: true` body field was dead — the
                  // plan-project schema never declared it, so the route's
                  // safeParseBody silently dropped it. Omitted here.
                  await planProjectMut.mutateAsync({
                    missionId: p.id,
                    mode: "plan",
                    title: p.title,
                  });
                  toast.success("Plan refreshed — phases updated", {
                    id: `replan-${p.id}`,
                  });
                  await onRefresh();
                } catch {
                  toast.error("Re-plan failed", { id: `replan-${p.id}` });
                }
              }}
              className="mt-1 inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/5 px-1.5 py-0.5 text-[9px] text-rose-300 hover:bg-rose-500/15"
              title="Mission hasn't moved in 14d — ask Nick to re-plan from current state"
            >
              <Brain size={9} />
              re-plan?
            </button>
          )}
          {/* Goal breadcrumb — Apr 20 bridge */}
          <div
            className="flex items-center flex-wrap gap-1 mt-1"
            onClick={(e) => {
              // Anchor container clicks shouldn't toggle expand.
              e.stopPropagation();
            }}
          >
            {isOrphan ? (
              <>
                <span className="text-[8px] font-mono uppercase tracking-wider text-amber-400/70">
                  ↑ no goal linked
                </span>
                {/* May 02 · projects with zero linkable tasks
                    produce dead chips. Hide both the fuzzy
                    suggestions and the picker trigger; show a
                    friendlier hint pointing at the next step
                    (add a task first). */}
                {pt.filter((t) => !t.goalId).length === 0 ? (
                  <span
                    className="text-[8px] font-mono uppercase tracking-wider text-zinc-600 italic"
                    title="Add a task to this mission first — goal links live on tasks."
                  >
                    add a task first
                  </span>
                ) : (
                  <>
                    {/* Apr 27 · P3 — fuzzy goal suggestions. */}
                    {(() => {
                      const suggestions = suggestGoalsForProject(
                        p.title,
                        p.domain ?? null,
                        goalsCache,
                        2,
                      );
                      return suggestions.length > 0 ? (
                        <>
                          {suggestions.map((s) => (
                            <button
                              key={s.goal.id}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const taskIds = pt
                                  .filter((t) => !t.goalId)
                                  .map((t) => t.id);
                                if (taskIds.length === 0) {
                                  toast.error("mission has no tasks to link");
                                  return;
                                }
                                try {
                                  await Promise.all(
                                    taskIds.map((tid) =>
                                      (updateTask.mutateAsync as any)({
                                        id: tid,
                                        fields: { goalId: s.goal.id },
                                      }),
                                    ),
                                  );
                                  toast.success(`Linked → ${s.goal.title.slice(0, 40)}`);
                                  void onRefresh();
                                } catch {
                                  toast.error("Link failed");
                                }
                              }}
                              className="text-[8px] font-mono px-1.5 py-px rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:border-rose-500/70 hover:bg-rose-500/25 transition-all"
                              title={`Suggested · score ${s.score} · tap to link`}
                            >
                              ↪ {s.goal.title.slice(0, 30)}
                            </button>
                          ))}
                        </>
                      ) : null;
                    })()}
                    <LinkGoalPicker
                      projectId={p.id}
                      projectTitle={p.title}
                      taskIdsWithoutGoal={pt
                        .filter((t) => !t.goalId)
                        .map((t) => t.id)}
                      goals={goalsCache}
                      onLinked={() => {
                        void onRefresh();
                      }}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <span className="text-[8px] font-mono uppercase tracking-wider text-zinc-600 shrink-0">
                  ↑ goal:
                </span>
                {linkedGoalIds.slice(0, 2).map((gid) => {
                  const title = goalTitles[gid] || gid.slice(0, 8);
                  return (
                    <span
                      key={gid}
                      className="inline-flex items-center gap-1 text-[8px] px-1.5 py-px rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 font-mono"
                      title={title}
                    >
                      <span className="truncate max-w-[160px]">{title}</span>
                      {/* Unlink X · same handler shape as LinkGoalPicker.handleUnlink */}
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const taskIds = pt
                            .filter((t) => t.goalId === gid)
                            .map((t) => t.id);
                          if (taskIds.length === 0) {
                            toast.error("nothing to unlink");
                            return;
                          }
                          try {
                            const results = await Promise.allSettled(
                              taskIds.map((tid) =>
                                (updateTask.mutateAsync as any)({
                                  id: tid,
                                  fields: { goalId: null },
                                }),
                              ),
                            );
                            const ok = results.filter(
                              (r) => r.status === "fulfilled",
                            ).length;
                            if (ok > 0) {
                              toast.success(
                                `Unlinked ${ok} task${ok === 1 ? "" : "s"} from "${title.slice(0, 30)}"`,
                              );
                              void onRefresh();
                            } else {
                              toast.error("Unlink failed");
                            }
                          } catch {
                            toast.error("Unlink failed");
                          }
                        }}
                        title={`Unlink "${title}" from this project`}
                        className="text-rose-400/70 hover:text-rose-300 hover:bg-rose-500/10 rounded-sm leading-none w-3 h-3 inline-flex items-center justify-center transition-colors"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                {linkedGoalIds.length > 2 && (
                  <span className="text-[8px] font-mono text-zinc-600">
                    +{linkedGoalIds.length - 2}
                  </span>
                )}
                {/* + link another */}
                <LinkGoalPicker
                  projectId={p.id}
                  projectTitle={p.title}
                  taskIdsWithoutGoal={pt
                    .filter((t) => !t.goalId)
                    .map((t) => t.id)}
                  goals={goalsCache}
                  onLinked={() => {
                    void onRefresh();
                  }}
                  triggerLabel="+ goal"
                />
              </>
            )}
          </div>
        </div>
        <ChevronRight
          size={12}
          className={cn("text-zinc-600 transition-transform mt-1 shrink-0", exp && "rotate-90")}
        />
      </div>
      {exp && (
        <ProjectDetail
          missionId={p.id}
          title={p.title}
          domain={p.domain}
          status={p.status}
          deadline={p.deadline}
          planData={p.planData}
          tasks={pt}
          onCompleteTask={onCompleteTask}
          onDeleteTask={onDeleteTask}
          onDeleteProject={onDeleteProject}
          onPlanUpdated={onPlanUpdated}
        />
      )}
    </div>
  );
}
