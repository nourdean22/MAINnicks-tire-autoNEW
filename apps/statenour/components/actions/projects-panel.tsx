"use client";

/**
 * ProjectsPanel · the PLAN-mode Missions block.
 *
 * Extracted from app/(mastery)/tasks/page.tsx (v10.0.529.15) as the #2
 * audit win from the /tasks code-explorer pass shipped the same day
 * (precedent: v10.0.529.14 LoopRowItem extraction).
 *
 * Pre-extraction the projectsContent fragment + its associated state +
 * the create/plan/delete handlers were inline inside TasksPage, adding
 * ~660 LOC to a daily-driver page that already topped 1,890 LOC. The
 * AI clarifying-questions flow (`planQuestions` / `planAnswers` /
 * `planTitle`) ticked at parent scope on every keystroke, which also
 * re-evaluated unrelated NOW-mode JSX (LoopStream, NowOperatorBar,
 * etc.) until v10.0.529.14's row-level memoization absorbed the cost.
 *
 * Design notes ·
 *   · Panel owns: planningProject + planQuestions + planAnswers +
 *     planTitle + manual-form quadruplet (showManualForm + manualDomain
 *     + manualStatus + manualDeadline). These are local to the
 *     create-a-project surface and irrelevant to NOW + TRACK + LEARN +
 *     REVIEW modes.
 *   · Parent still owns: `projects` (loaded via /api/missions),
 *     `tasks` (shared with NOW mode), `goalsCache`, `goalTitles`,
 *     `projectToGoals`, `expandedProject` (the deep-link target from
 *     handleJumpToProject), and `newProjectTitle` (seeded by
 *     handlePlanGoal when a no-plan goal card calls "plan it").
 *   · `onReload` is the single callback boundary back to the parent.
 *     The parent's `load()` is the right thing to pass — it re-fetches
 *     tasks + missions + goals in one Promise.all, which keeps the
 *     panel's optimistic state in sync with everything else on the
 *     page.
 *   · No `React.memo` here — ProjectsPanel re-renders precisely when
 *     `projects` or `tasks` changes, which IS the time we want it to
 *     render. Memoizing would force shallow-equality work that always
 *     fails (Set/Map props swap on every parent reload).
 *   · Visual + behavior contract: 100% IDENTICAL to the pre-extraction
 *     inline JSX. No aesthetic shifts, no UX shifts. Only owner
 *     identity shifts.
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import { Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManualMissionForm } from "@/components/actions/manual-mission-form";
import { ProjectCard } from "@/components/actions/project-card";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { createTask } from "@/lib/services/client/tasks";
import { logger as rootLogger } from "@/lib/logger";
import type {
  Task,
  Project,
  GoalCacheEntry,
} from "@/components/actions/shared";

const log = rootLogger.withSurface("tasks/projects-panel");

// v10.0.529.15 · Project + GoalCacheEntry consolidated into
// components/actions/shared.ts so page.tsx + projects-panel + any
// future consumer reference the same definition. Pre-fix both
// surfaces hand-maintained their own copy · the comment here
// explicitly flagged the drift risk. Now structural.

/**
 * Shape returned by /api/ai/plan-project in "clarify" mode. Older
 * versions returned bare strings, newer versions return objects with
 * optional `options`, so we accept either at the type level.
 */
type PlanQuestion =
  | string
  | {
      question: string;
      options?: string[];
    };

export interface ProjectsPanelProps {
  /** Active user-owned projects (parent loads + filters via load()) */
  projects: Project[];
  /** All tasks · used to compute per-project task lists for ProjectCard */
  tasks: Task[];
  /** Goal cache for the link-goal picker inside ProjectCard */
  goalsCache: GoalCacheEntry[];
  /** Goal title lookup · key: goalId, value: title */
  goalTitles: Record<string, string>;
  /** Project → linked goal IDs · drives the orphan/linked label + ProjectCard breadcrumb */
  projectToGoals: Map<string, Set<string>>;
  /** Which project is expanded (deep-link target from handleJumpToProject) */
  expandedProject: string | null;
  /** Toggle which project card is expanded · parent owns to allow cross-mode deep-linking */
  onToggleExpand: (id: string) => void;
  /** Title for both AI-plan + manual-create inputs · parent owns so handlePlanGoal can seed it */
  newProjectTitle: string;
  setNewProjectTitle: (v: string) => void;
  /** Setter on the parent's projects state · used for optimistic create + delete + plan-data updates */
  setProjects: Dispatch<SetStateAction<Project[]>>;
  /** Refresh tasks/missions/goals · the parent's load() function */
  onReload: () => Promise<void> | void;
  /** Mark a task as complete · passed through to ProjectCard's mini task list */
  onCompleteTask: (id: string) => void | Promise<unknown>;
  /** Soft-delete a task · passed through to ProjectCard's mini task list */
  onDeleteTask: (id: string) => void | Promise<unknown>;
}

export function ProjectsPanel({
  projects,
  tasks,
  goalsCache,
  goalTitles,
  projectToGoals,
  expandedProject,
  onToggleExpand,
  newProjectTitle,
  setNewProjectTitle,
  setProjects,
  onReload,
  onCompleteTask,
  onDeleteTask,
}: ProjectsPanelProps) {
  // ── State owned by this panel ──
  // None of these are read by NOW / TRACK / LEARN / REVIEW modes, so
  // they live here. Keystrokes in the clarify questions or the manual
  // domain picker no longer tick parent state · the parent only
  // re-renders when projects / tasks / goalsCache actually change.
  const [planningProject, setPlanningProject] = useState(false);
  const [planQuestions, setPlanQuestions] = useState<PlanQuestion[]>([]);
  const [planAnswers, setPlanAnswers] = useState<string[]>([]);
  const [planTitle, setPlanTitle] = useState("");
  // May 02 · manual project create state — bypasses AI plan generation
  // so users who already know the project shape don't have to wait for
  // Nick's clarify questions + plan synthesis.
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualDomain, setManualDomain] = useState("PERSONAL");
  const [manualStatus, setManualStatus] = useState("ACTIVE");
  const [manualDeadline, setManualDeadline] = useState("");

  // ── Actions ──
  // May 02 · Manual project create (no AI) — creates the mission row
  // immediately with the provided meta, skips the plan-project AI call.
  // Drops the new project into the visible list so the user can edit
  // it inline (title, domain, status, deadline already shipped) and
  // start adding tasks via the per-project + task input.
  async function createProjectManual(opts: {
    title: string;
    domain?: string;
    status?: string;
    deadline?: string | null;
  }) {
    if (!opts.title.trim()) {
      toast.error("Title required");
      return;
    }
    setPlanningProject(true);
    try {
      const r = await authedFetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: opts.title,
          domain: opts.domain || "PERSONAL",
          status: opts.status || "ACTIVE",
          priority: 5,
          roiScore: 50,
          neglectCost: 30,
          ...(opts.deadline ? { deadline: `${opts.deadline}T23:59:59.000Z` } : {}),
        }),
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        let msg = "Failed to create mission";
        try {
          const parsed = JSON.parse(errBody) as { error?: string };
          if (parsed.error) msg = `Mission creation failed: ${parsed.error}`;
        } catch { /* leave default */ }
        toast.error(msg);
        setPlanningProject(false);
        return;
      }
      toast.success("Mission created");
      setNewProjectTitle("");
      setShowManualForm(false);
      setManualDomain("PERSONAL");
      setManualStatus("ACTIVE");
      setManualDeadline("");
      void onReload();
    } catch {
      toast.error("Mission creation failed");
    } finally {
      setPlanningProject(false);
    }
  }

  async function createProject() {
    if (!newProjectTitle.trim()) return;
    setPlanningProject(true);
    setPlanTitle(newProjectTitle);
    try {
      const r = await authedFetch("/api/ai/plan-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newProjectTitle, mode: "clarify" }),
      });
      if (r.ok) {
        const d = (await r.json()) as { questions?: PlanQuestion[] };
        if (d.questions && d.questions.length > 0) {
          setPlanQuestions(d.questions);
          setPlanAnswers(new Array(d.questions.length).fill(""));
          setPlanningProject(false);
          return;
        }
      }
      await executePlan(newProjectTitle, "");
    } catch {
      toast.error("Mission planning failed");
      setPlanningProject(false);
    }
  }

  async function executePlan(title: string, answers: string) {
    setPlanningProject(true);
    try {
      const mr = await authedFetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          domain: "PERSONAL",
          // v7 · Apr 28 · priority is 1-10 per missionCreateSchema —
          // was 50 which fails validation. Default mid (5).
          priority: 5,
          roiScore: 50,
          neglectCost: 30,
          status: "ACTIVE",
        }),
      });
      if (!mr.ok) {
        const errBody = await mr.text().catch(() => "");
        let msg = "Failed to create mission";
        try {
          const parsed = JSON.parse(errBody) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } };
          if (parsed.error) msg = `Mission creation failed: ${parsed.error}`;
          if (parsed.details?.fieldErrors) {
            const fields = Object.entries(parsed.details.fieldErrors)
              .map(([k, v]) => `${k}: ${v.join(", ")}`)
              .join(" · ");
            if (fields) msg = `Validation failed — ${fields}`;
          }
        } catch {
          /* leave default */
        }
        toast.error(msg);
        setPlanningProject(false);
        return;
      }
      const mJson = await mr.json();
      const mId = (mJson?.data ?? mJson)?.id;
      if (!mId) {
        toast.error("Mission created but no id returned");
        setPlanningProject(false);
        return;
      }
      const pr = await authedFetch("/api/ai/plan-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, answers, missionId: mId, mode: "plan" }),
      });
      interface PlanStep {
        title: string;
        nextAction?: string;
        effort?: string;
      }
      let steps: PlanStep[] = [];
      if (pr.ok) {
        const d = (await pr.json()) as { flatSteps?: PlanStep[] };
        steps = d.flatSteps || [];
      }
      // v10.0.29 — partial-failure feedback. Pre-v10.0.29 each step
      // POST had .catch(() => {}) so 3 of 5 silent failures showed
      // "5 steps planned · plan saved" while only 2 tasks existed.
      let stepsCreated = 0;
      let stepsFailed = 0;
      for (const s of steps) {
        try {
          const sr = await createTask({
            title: s.title,
            missionId: mId,
            nextPhysicalAction: s.nextAction || s.title,
            effort: s.effort || "M30",
            finishCondition: s.title,
          });
          if (sr.ok) stepsCreated++;
          else stepsFailed++;
        } catch (err) {
          stepsFailed++;
          log.warn("plan_step_create_failed", { stepTitle: s.title, error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (stepsFailed === 0) {
        toast.success(`${stepsCreated} steps planned · plan saved`);
      } else if (stepsCreated > 0) {
        toast.warning(`${stepsCreated} of ${steps.length} steps created · ${stepsFailed} failed`);
      } else {
        toast.error(`Plan saved but no steps created (${stepsFailed} failures)`);
      }
      setNewProjectTitle("");
      setPlanQuestions([]);
      setPlanTitle("");
      void onReload();
    } catch {
      toast.error("Failed to execute mission plan");
    }
    setPlanningProject(false);
  }

  async function deleteProject(id: string) {
    // v10.0.29 — optimistic + rollback + feedback. Pre-v10.0.29 the
    // empty catch swallowed failures: project disappeared from UI
    // but persisted in DB, then reappeared on next reload.
    const prevProjects = projects;
    setProjects((p) => p.filter((x) => x.id !== id));
    try {
      const r = await authedFetch(`/api/missions/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`${r.status}`);
      toast.success("deleted");
      void onReload();
    } catch (err) {
      // Revert + surface
      setProjects(prevProjects);
      log.error("deleteProject_failed", {
        missionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      toast.error("Failed to delete mission");
    }
  }

  // ── Render ──
  // May 02 · drift-gate dropped. Was `!isDrifting && ...` which made
  // the entire Projects block disappear during drift state, including
  // the "+ project" pickers on goal chips. Nour: "the projects tool
  // is gone from the plan and goals page" — verified the cause was
  // this gate. Drift state still surfaces via the ambient aura class;
  // we don't need a second hide-content signal that breaks editability.
  return (
    <div id="projects-block" className="mt-3 space-y-2 scroll-mt-20">
      {/* Header + add */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
            Missions
          </span>
          {projects.length > 0 && (
            <span className="text-[9px] text-zinc-600 font-mono">
              {projects.length} active ·{" "}
              {(() => {
                const orphans = projects.filter(
                  (p) => (projectToGoals.get(p.id)?.size ?? 0) === 0
                ).length;
                return orphans === 0 ? (
                  <span className="text-emerald-400">all linked to goals</span>
                ) : (
                  <span className="text-amber-400">{orphans} unlinked</span>
                );
              })()}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1.5">
        <Input
          placeholder="Start a mission — Nick will plan it"
          value={newProjectTitle}
          onChange={(e) => setNewProjectTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createProject()}
          className="h-8 bg-zinc-900/60 border-zinc-800/40 text-[11px] placeholder:text-zinc-600"
          disabled={planningProject}
        />
        <Button
          size="sm"
          className="h-8 px-3 bg-blue-500/15 text-blue-300 hover:bg-blue-500 hover:text-black text-[9px] font-bold border border-blue-500/30 shrink-0"
          onClick={createProject}
          disabled={planningProject}
        >
          {planningProject ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <>
              <Brain size={11} className="mr-1" />
              Plan
            </>
          )}
        </Button>
        {/* May 02 · manual create — skip AI, drop the row in. Toggles
            an inline form for picking domain/status/deadline at
            create-time so the user doesn't have to immediately edit
            after creation. */}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2.5 text-[9px] font-bold text-zinc-500 hover:text-amber-300 border border-zinc-800/40 shrink-0"
          onClick={() => setShowManualForm((v) => !v)}
          disabled={planningProject}
          title="Manual create — skip AI plan, just make the mission"
        >
          {showManualForm ? "−" : "+"} Manual
        </Button>
      </div>
      {/* Manual-create form — extracted to ManualMissionForm component
          in v10.0.266. Same primitives + colors + behavior. The form
          stays collapsible; parent owns the toggle state. */}
      {showManualForm && (
        <ManualMissionForm
          title={newProjectTitle}
          domain={manualDomain}
          setDomain={setManualDomain}
          status={manualStatus}
          setStatus={setManualStatus}
          deadline={manualDeadline}
          setDeadline={setManualDeadline}
          busy={planningProject}
          onCreate={createProjectManual}
        />
      )}
      {planQuestions.length > 0 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5 mb-1.5 space-y-1.5">
          <p className="text-[9px] text-blue-300 font-bold flex items-center gap-1">
            <Brain size={11} /> AI needs info for &quot;{planTitle}&quot;
          </p>
          {planQuestions.map((q, i) => (
            <div key={i}>
              <p className="text-[11px] text-zinc-300 mb-0.5">
                {typeof q === "string" ? q : q.question}
              </p>
              {typeof q !== "string" && q.options && (
                <div className="flex gap-1 flex-wrap mb-0.5">
                  {q.options.map((o, j) => (
                    <button
                      key={j}
                      onClick={() => {
                        const a = [...planAnswers];
                        a[i] = o;
                        setPlanAnswers(a);
                      }}
                      className={cn(
                        "text-[8px] px-1.5 py-0.5 rounded border",
                        planAnswers[i] === o
                          ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                          : "border-zinc-800 text-zinc-600"
                      )}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
              <Input
                value={planAnswers[i] || ""}
                onChange={(e) => {
                  const a = [...planAnswers];
                  a[i] = e.target.value;
                  setPlanAnswers(a);
                }}
                placeholder="…"
                className="h-6 text-[9px] bg-zinc-900/60 border-zinc-800"
              />
            </div>
          ))}
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-6 px-2.5 bg-blue-500 text-black text-[9px] font-bold"
              onClick={() => {
                executePlan(
                  planTitle,
                  planQuestions
                    .map(
                      (q, i) =>
                        `${typeof q === "string" ? q : q.question}: ${planAnswers[i] || "?"}`
                    )
                    .join("\n")
                );
                setPlanQuestions([]);
              }}
              disabled={planningProject}
            >
              {planningProject ? <Loader2 size={11} className="animate-spin" /> : "Generate"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[9px] text-zinc-600"
              onClick={() => {
                setPlanQuestions([]);
                setPlanTitle("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {/* v10.0.273 · per-project rendered card extracted into
          <ProjectCard> · was ~365 lines of inline JSX with
          momentum / pace / goal-breadcrumb / re-plan / detail
          all bundled. ProjectCard owns the rendering · this
          panel owns the state + callbacks. */}
      {projects.length > 0 && (
        <div className="space-y-2">
          {projects.map((p) => {
            const pt = tasks.filter((t) => t.missionId === p.id);
            const linkedGoalIds = Array.from(projectToGoals.get(p.id) ?? []);
            return (
              <ProjectCard
                key={p.id}
                project={p}
                tasks={pt}
                expanded={expandedProject === p.id}
                onToggleExpand={() => onToggleExpand(p.id)}
                linkedGoalIds={linkedGoalIds}
                goalTitles={goalTitles}
                goalsCache={goalsCache}
                onCompleteTask={onCompleteTask}
                onDeleteTask={onDeleteTask}
                onDeleteProject={() => deleteProject(p.id)}
                onPlanUpdated={(next) => {
                  setProjects((prev) =>
                    prev.map((x) =>
                      x.id === p.id
                        ? { ...x, planData: next as Project["planData"] }
                        : x,
                    ),
                  );
                  void onReload();
                }}
                onRefresh={onReload}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
