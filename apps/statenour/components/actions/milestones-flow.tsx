"use client";

/**
 * MilestonesFlow — milestones-first PLAN IT.
 *
 * Apr 27 · G4. The old "PLAN IT" button on a goal card jumped
 * straight to a full project plan. Goals like "50K interactions"
 * need landmarks (1K → 5K → 15K → 50K) before tactics, otherwise
 * the plan is a wall of steps with no review checkpoints.
 *
 * Flow:
 *   1. Loading — POST /api/ai/plan-project mode=milestones with the
 *      goal's title + target metric + deadline. AI returns 3-5
 *      verifiable checkpoints.
 *   2. Editing — Nour reviews the proposed milestones inline. Each
 *      one is editable (textarea), removable, and the list can be
 *      extended with a blank entry. Order matters.
 *   3. Generating — Nour confirms. Component creates a Mission row,
 *      calls plan-project mode=plan with milestones[] so the AI's
 *      phases map 1:1 to confirmed checkpoints, then spawns the
 *      first phase via /api/projects/[id]/spawn-tasks tagged with
 *      goalId.
 *   4. Done — emits onComplete(missionId) so the parent jumps to
 *      the new project + refreshes.
 *
 * Errors at any stage are toast-surfaced; the panel stays open so
 * Nour can retry. Cancel returns the goal card to its un-planned
 * state — no half-built project leaks.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Brain, Plus, Sparkles, Loader2, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { notifyDataChanged } from "@/lib/events/data-change";
import { trpc } from "@/lib/trpc/client";

interface SuggestedMilestone {
  label: string;
  metric: string | null;
  estimatedDate: string | null;
}

export interface MilestonesGoal {
  id: string;
  title: string;
  targetValue?: number;
  unit?: string;
  metric?: string;
  deadline?: string | null;
  domain?: string;
}

interface MilestonesFlowProps {
  goal: MilestonesGoal;
  onComplete?: (missionId: string) => void;
  onCancel: () => void;
}

type Phase = "loading" | "editing" | "generating";

export function MilestonesFlow({
  goal,
  onComplete,
  onCancel,
}: MilestonesFlowProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [rationale, setRationale] = useState<string>("");
  const [milestones, setMilestones] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // task.createMission / task.spawnTasks replace POST /api/missions +
  // POST /api/projects/:id/spawn-tasks. actions-surface slice · the
  // plan-project AI calls (mode=milestones · mode=plan) now hit
  // `trpc.ai.planProject` (replacing POST /api/ai/plan-project).
  const createMission = trpc.task.createMission.useMutation();
  const spawnTasks = trpc.task.spawnTasks.useMutation();
  const planProjectMut = trpc.ai.planProject.useMutation();

  // Step 1: load milestone suggestions on mount.
  // actions-surface slice · POST /api/ai/plan-project mode=milestones →
  // trpc.ai.planProject. The procedure returns a discriminated union
  // keyed on `mode` — narrow to the "milestones" variant before reading
  // `milestones` / `rationale`.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await planProjectMut.mutateAsync({
          mode: "milestones",
          title: goal.title,
          goalTarget: goal.targetValue,
          goalUnit: goal.unit,
          goalMetric: goal.metric,
          goalDeadline: goal.deadline ?? undefined,
          domain: goal.domain,
        });
        if (cancelled) return;
        const list: SuggestedMilestone[] =
          d.mode === "milestones" ? d.milestones : [];
        const labels = list
          .map((m) => {
            const parts = [m.label];
            if (m.metric) parts.push(m.metric);
            if (m.estimatedDate) parts.push(`by ${m.estimatedDate}`);
            return parts.join(" · ");
          })
          .filter(Boolean);
        setMilestones(labels.length > 0 ? labels : ["", "", ""]);
        setRationale(d.mode === "milestones" ? d.rationale : "");
        setPhase("editing");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setMilestones(["", "", ""]);
        setPhase("editing");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal]);

  const updateMilestone = (i: number, value: string) =>
    setMilestones((prev) => prev.map((m, idx) => (idx === i ? value : m)));

  const removeMilestone = (i: number) =>
    setMilestones((prev) => prev.filter((_, idx) => idx !== i));

  const addMilestone = () => setMilestones((prev) => [...prev, ""]);

  // Step 3: generate full plan + spawn first phase
  const generatePlan = async () => {
    const trimmed = milestones.map((m) => m.trim()).filter(Boolean);
    if (trimmed.length < 2) {
      toast.error("At least 2 milestones");
      return;
    }
    setPhase("generating");
    try {
      // Create the Mission first · createMission validates the
      // payload server-side against missionCreateSchema.
      let missionId: string | undefined;
      try {
        const mission = await createMission.mutateAsync({
          title: goal.title,
          domain: (goal.domain || "PERSONAL").toUpperCase(),
          // v7 · Apr 28 · priority is 1-10 per missionCreateSchema.
          // Mid-high (7) for goal flows.
          priority: 7,
          roiScore: 60,
          neglectCost: 40,
          status: "ACTIVE",
        });
        missionId = (mission as { id?: string } | null)?.id;
      } catch (err) {
        toast.error(
          `Couldn't create project${err instanceof Error ? `: ${err.message}` : ""}`,
        );
        setPhase("editing");
        return;
      }
      if (!missionId) {
        toast.error("Project created but no id");
        setPhase("editing");
        return;
      }

      // Generate the plan with confirmed milestones constraining phases.
      // actions-surface slice · POST /api/ai/plan-project mode=plan →
      // trpc.ai.planProject. mutateAsync rejects on a server error · the
      // outer catch surfaces the "Plan failed" toast.
      try {
        await planProjectMut.mutateAsync({
          mode: "plan",
          missionId,
          title: goal.title,
          milestones: trimmed,
          domain: goal.domain,
        });
      } catch {
        toast.error("AI couldn't generate the plan");
        setPhase("editing");
        return;
      }

      // Spawn the first phase (tagged with goalId so completing
      // those tasks lifts the goal via the S3 hook). Best-effort —
      // a spawn failure doesn't abort the (already-created) project.
      let spawned = 0;
      try {
        const sd = await spawnTasks.mutateAsync({
          missionId,
          phaseIndex: 0,
          goalId: goal.id,
        });
        spawned = sd?.spawned ?? 0;
      } catch {
        /* spawn is best-effort · project + plan already landed */
      }

      toast.success(
        `Project spawned · ${trimmed.length} phases${spawned > 0 ? ` · ${spawned} starter tasks on NOW` : ""}`,
      );
      notifyDataChanged("missions", { source: "milestones-flow", detail: "plan", id: missionId });
      notifyDataChanged("projects", { source: "milestones-flow", detail: "plan", id: missionId });
      notifyDataChanged("tasks", { source: "milestones-flow", detail: "spawn", id: missionId });
      onComplete?.(missionId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Plan failed");
      setPhase("editing");
    }
  };

  return (
    <div className="rounded-surface border border-blue-500/30 bg-blue-500/[0.04] p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles size={12} className="text-blue-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-blue-400">
            Milestones for &ldquo;{goal.title.slice(0, 60)}&rdquo;
          </p>
          {rationale && (
            <p className="text-[12px] text-fg-secondary italic mt-0.5">
              {rationale}
            </p>
          )}
        </div>
        <button
          onClick={onCancel}
          className="text-fg-tertiary hover:text-fg shrink-0"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>

      {phase === "loading" && (
        <div className="flex items-center gap-2 text-[12px] text-fg-tertiary italic py-3">
          <Loader2 size={11} className="animate-spin" />
          <span>Nick is breaking this down into 3-5 checkpoints…</span>
        </div>
      )}

      {phase !== "loading" && (
        <>
          {error && (
            <p className="text-[11px] text-rose-400 italic">
              AI: {error} · using blank list, edit + confirm to plan anyway
            </p>
          )}
          <div className="space-y-1.5">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[11px] font-mono text-blue-400/70 mt-1.5 shrink-0 w-5">
                  {i + 1}
                </span>
                <textarea
                  value={m}
                  onChange={(e) => updateMilestone(i, e.target.value)}
                  rows={1}
                  placeholder="What's the checkpoint here?"
                  className="flex-1 rounded-control border border-edge-default bg-content px-2 py-1 text-[11px] text-fg placeholder:text-fg-tertiary outline-none focus:border-accent resize-none leading-snug"
                  disabled={phase === "generating"}
                />
                <button
                  onClick={() => removeMilestone(i)}
                  disabled={phase === "generating"}
                  className="text-fg-tertiary hover:text-rose-400 mt-1.5 shrink-0 disabled:opacity-50"
                  title="Remove"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {milestones.length < 7 && (
              <button
                onClick={addMilestone}
                disabled={phase === "generating"}
                className="text-[12px] text-blue-300/70 hover:text-blue-300 inline-flex items-center gap-1 ml-6 disabled:opacity-50"
              >
                <Plus size={10} />
                Add milestone
              </button>
            )}
          </div>

          <div className="flex items-center justify-between pt-1.5 border-t border-edge-subtle">
            <span className="text-[11px] text-fg-tertiary italic">
              Each milestone becomes a phase in the plan
            </span>
            <button
              onClick={() => void generatePlan()}
              disabled={phase === "generating" || milestones.filter((m) => m.trim()).length < 2}
              className={cn(
                "inline-flex items-center gap-1 rounded-control border px-3 py-1 text-[13px] font-medium transition-colors duration-[var(--motion-state)]",
                phase === "generating"
                  ? "border-edge-default text-fg-tertiary"
                  : "border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500 hover:text-black",
              )}
            >
              {phase === "generating" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Brain size={11} />
              )}
              {phase === "generating" ? "Planning…" : "Spin up project"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
