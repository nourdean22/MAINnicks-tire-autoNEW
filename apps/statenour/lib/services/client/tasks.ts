/**
 * Client-side task creation helper · May 02 · audit-2 dedup.
 *
 * Pre-fix, 6 callsites duplicated the same /api/tasks POST body
 * (tasks/page.tsx quick-add + adoptAi + plan-spawn + onCreateTaskForGoal,
 * project-detail.tsx addTask + addTaskToPhase). Each repeated the
 * 12-field default block (effort, roiScore, frictionScore, energy,
 * context, finishCondition, loopKind, …) with minor per-callsite
 * tweaks. This helper applies sane defaults and lets each callsite
 * override only what's actually different.
 *
 * Returns the raw Response so callers keep ownership of error UX
 * (some show "Failed to add: <title>", some throw, some toast). We
 * deliberately do NOT centralize toasts here — the 6 callsites have
 * different surface contexts (NOW vs PLAN vs project) and matching
 * messaging matters more than dedup of the toast call.
 */

import { authedFetch } from "@/hooks/use-authed-fetch";

export interface CreateTaskInput {
  title: string;
  missionId: string;
  /** Override defaults below. */
  nextPhysicalAction?: string;
  effort?: string; // e.g. "M15", "M30", "H1"
  roiScore?: number;
  frictionScore?: number;
  energyRequired?: string;
  context?: string;
  finishCondition?: string;
  loopKind?: string;
  goalId?: string | null;
  promiseTo?: string | null;
  dueDate?: string | null;
}

export function createTask(input: CreateTaskInput) {
  return authedFetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Defaults — quietly applied unless the caller passes its own value
      nextPhysicalAction: input.title,
      effort: "M15",
      roiScore: 50,
      frictionScore: 30,
      energyRequired: "MEDIUM",
      context: "ANYWHERE",
      finishCondition: "Done",
      loopKind: "ONCE",
      // Spread last so caller-provided fields win
      ...input,
    }),
  });
}
