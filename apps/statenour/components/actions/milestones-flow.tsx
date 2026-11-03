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
 *   1. Loading — trpc.ai.planProject mode=milestones with the
 *      goal's title + target metric + deadline. AI returns 3-5
 *      verifiable checkpoints.
 *   2. Editing — Nour reviews the proposed milestones inline. Each
 *      one is editable (textarea, MILESTONE_MAX chars), removable, and
 *      the list can be extended with a blank entry. Order matters.
 *   3. Generating — Nour confirms. Component creates ONE Mission row
 *      (its id is kept in a ref, so a retry reuses it and never makes a
 *      second mission), then calls mode=plan with milestones[]. The
 *      SERVER saves the plan and spawns phase 0 in the same call
 *      (lib/services/ai-plan-project.ts), so a backgrounded phone cannot
 *      skip the spawn; the toast reports the count the server returns.
 *   4. Done — emits onComplete(missionId) so the parent jumps to
 *      the new project + refreshes.
 *
 * Errors at any stage are toast-surfaced; the panel stays open so Nour
 * can retry. Cancel after step 3 started keeps the mission already made
 * (visible on /missions, linked to the goal) and a retry from the card
 * finds it through this panel's ref only while the panel is mounted;
 * nothing is deleted on cancel.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Brain, Plus, Sparkles, Loader2, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { notifyDataChanged } from "@/lib/events/data-change";
import { trpc } from "@/lib/trpc/client";

/** CONTROLS RULE: one milestone's length, the same cap the server validates (lib/trpc/routers/ai.ts planProject). */
export const MILESTONE_MAX = 200;

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

/** The toast after a plan lands, from what the server really did. */
export function planToast(r: {
  milestones: number;
  skeleton: boolean;
  spawned: number | undefined;
  spawnFailed: string | undefined;
  budget?: boolean;
  alreadyPlanned?: boolean;
}): string {
  if (r.alreadyPlanned) return "This project already has its plan and its first tasks; nothing was created twice";
  const tasks =
    r.spawnFailed
      ? ` · the first tasks could not be created (${r.spawnFailed.slice(0, 80)}); open the project to spawn them`
      : r.spawned && r.spawned > 0
        ? ` · ${r.spawned} starter task${r.spawned === 1 ? "" : "s"} on NOW`
        : " · no starter task was created";
  return r.skeleton
    ? `Project spawned from your ${r.milestones} milestones (${r.budget ? "today's AI budget is used up" : "the AI planner did not answer"}; each milestone is one checkpoint task)${tasks}`
    : `Project spawned · ${r.milestones} phases${tasks}`;
}

export function MilestonesFlow({
  goal,
  onComplete,
  onCancel,
}: MilestonesFlowProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [rationale, setRationale] = useState<string>("");
  const [milestones, setMilestones] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The mission this panel made: a retry after a failed plan call reuses it (audit A4: every later error
  // used to lose the id, and the retry created a second mission).
  const missionIdRef = useRef<string | null>(null);
  const createMission = trpc.task.createMission.useMutation();
  const planProjectMut = trpc.ai.planProject.useMutation();

  // Step 1: load milestone suggestions once per goal. Keyed by the id: the board hands a fresh goal
  // object on every render, and `[goal]` restarted this effect (and wiped Nour's edits) each time (audit A3).
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
            return parts.join(" · ").slice(0, MILESTONE_MAX);
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
  }, [goal.id]);

  const updateMilestone = (i: number, value: string) =>
    setMilestones((prev) => prev.map((m, idx) => (idx === i ? value.slice(0, MILESTONE_MAX) : m)));

  const removeMilestone = (i: number) =>
    setMilestones((prev) => prev.filter((_, idx) => idx !== i));

  const addMilestone = () => setMilestones((prev) => [...prev, ""]);

  // Step 3: create the mission (once), then let the server plan and spawn.
  const generatePlan = async () => {
    const trimmed = milestones.map((m) => m.trim()).filter(Boolean);
    if (trimmed.length < 2) {
      toast.error("At least 2 milestones");
      return;
    }
    setPhase("generating");
    try {
      let missionId = missionIdRef.current;
      if (!missionId) {
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
            // 2026-11-02 · the mission knows its goal, its finish line and its date. Before this
            // the link was stripped by the schema (prod: 0 of 13 missions linked).
            lifeGoalId: goal.id,
            completionCriteria: trimmed[trimmed.length - 1],
            deadline: goal.deadline ?? undefined,
          });
          missionId = (mission as { id?: string } | null)?.id ?? null;
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
        missionIdRef.current = missionId;
      }

      // The server writes the plan and spawns phase 0 in one call; its tasks carry the mission's goal.
      let planned: Awaited<ReturnType<typeof planProjectMut.mutateAsync>>;
      try {
        planned = await planProjectMut.mutateAsync({
          mode: "plan",
          missionId,
          title: goal.title,
          milestones: trimmed,
          domain: goal.domain,
        });
      } catch (err) {
        toast.error(
          `Couldn't save the plan${err instanceof Error && err.message ? `: ${err.message.slice(0, 120)}` : ""} · the project is kept; tap again to retry`,
        );
        setPhase("editing");
        return;
      }
      const plan = planned.mode === "plan" ? planned : null;
      toast.success(
        planToast({
          milestones: trimmed.length,
          skeleton: plan?.fallback === "skeleton",
          spawned: plan?.spawned,
          spawnFailed: plan?.spawnFailed,
          budget: plan?.fallbackReason === "budget",
          alreadyPlanned: plan?.alreadyPlanned,
        }),
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
          <p className="font-mono text-[11px] text-blue-400">
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
                  maxLength={MILESTONE_MAX}
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
              {phase === "generating"
                ? "Writing the plan from your milestones · a few minutes · a slow planner still gives you one checkpoint per milestone"
                : "Each milestone becomes a phase in the plan"}
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
