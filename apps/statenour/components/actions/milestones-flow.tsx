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
import { authedFetch } from "@/hooks/use-authed-fetch";
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
  // POST /api/projects/:id/spawn-tasks. The plan-project AI calls
  // stay on authedFetch (AI domain · migrates in a later slice).
  const createMission = trpc.task.createMission.useMutation();
  const spawnTasks = trpc.task.spawnTasks.useMutation();

  // Step 1: load milestone suggestions on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await authedFetch("/api/ai/plan-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "milestones",
            title: goal.title,
            goalTarget: goal.targetValue,
            goalUnit: goal.unit,
            goalMetric: goal.metric,
            goalDeadline: goal.deadline,
            domain: goal.domain,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (cancelled) return;
        const list = (d?.data?.milestones ?? d?.milestones ?? []) as SuggestedMilestone[];
        const labels = list
          .map((m) => {
            const parts = [m.label];
            if (m.metric) parts.push(m.metric);
            if (m.estimatedDate) parts.push(`by ${m.estimatedDate}`);
            return parts.join(" · ");
          })
          .filter(Boolean);
        setMilestones(labels.length > 0 ? labels : ["", "", ""]);
        setRationale(d?.data?.rationale ?? d?.rationale ?? "");
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

      // Generate the plan with confirmed milestones constraining phases
      const pr = await authedFetch("/api/ai/plan-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "plan",
          missionId,
          title: goal.title,
          milestones: trimmed,
          domain: goal.domain,
        }),
      });
      if (!pr.ok) {
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
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/[0.04] p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles size={12} className="text-blue-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
            Milestones for &ldquo;{goal.title.slice(0, 60)}&rdquo;
          </p>
          {rationale && (
            <p className="text-[10px] text-zinc-400 italic mt-0.5">
              {rationale}
            </p>
          )}
        </div>
        <button
          onClick={onCancel}
          className="text-zinc-600 hover:text-zinc-200 shrink-0"
          aria-label="Cancel"
        >
          <X size={14} />
        </button>
      </div>

      {phase === "loading" && (
        <div className="flex items-center gap-2 text-[10px] text-zinc-500 italic py-3">
          <Loader2 size={11} className="animate-spin" />
          <span>Nick is breaking this down into 3-5 checkpoints…</span>
        </div>
      )}

      {phase !== "loading" && (
        <>
          {error && (
            <p className="text-[9px] text-rose-400 italic">
              AI: {error} · using blank list, edit + confirm to plan anyway
            </p>
          )}
          <div className="space-y-1.5">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[9px] font-mono text-blue-400/70 mt-1.5 shrink-0 w-5">
                  {i + 1}
                </span>
                <textarea
                  value={m}
                  onChange={(e) => updateMilestone(i, e.target.value)}
                  rows={1}
                  placeholder="What's the checkpoint here?"
                  className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-blue-500/50 resize-none leading-snug"
                  disabled={phase === "generating"}
                />
                <button
                  onClick={() => removeMilestone(i)}
                  disabled={phase === "generating"}
                  className="text-zinc-700 hover:text-rose-400 mt-1.5 shrink-0 disabled:opacity-50"
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
                className="text-[10px] text-blue-300/70 hover:text-blue-300 inline-flex items-center gap-1 ml-6 disabled:opacity-50"
              >
                <Plus size={10} />
                add milestone
              </button>
            )}
          </div>

          <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/40">
            <span className="text-[9px] text-zinc-600 italic">
              Each milestone becomes a phase in the plan
            </span>
            <button
              onClick={() => void generatePlan()}
              disabled={phase === "generating" || milestones.filter((m) => m.trim()).length < 2}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors",
                phase === "generating"
                  ? "border-zinc-700 text-zinc-500"
                  : "border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500 hover:text-black",
              )}
            >
              {phase === "generating" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Brain size={11} />
              )}
              {phase === "generating" ? "planning…" : "spin up project"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
