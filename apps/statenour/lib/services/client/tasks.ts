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
 * hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice. This file
 * is a NON-React module (a plain helper, not a component/hook), so it
 * uses the vanilla (non-hook) tRPC client — the same imperative path
 * `ClientErrorTelemetry` uses. `trpcVanilla.task.create` delegates to
 * the `task-actions.createTaskFromAPI` service the legacy POST
 * /api/tasks route also calls · drift impossible.
 *
 * RETURN SHAPE CHANGE · the legacy helper returned the raw `Response`
 * so callers could read `r.ok`. The vanilla tRPC `.mutate()` THROWS on
 * failure instead, so this helper now returns `{ ok: boolean }` —
 * `{ ok: true }` on success, `{ ok: false }` on a caught throw. The two
 * `project-detail.tsx` call-sites already branch on `r.ok`, so the
 * `{ ok }` shape keeps them working unchanged.
 */

import { trpcVanilla } from "@/lib/trpc/vanilla-client";

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

/**
 * Create a task via tRPC, applying the shared default block. Returns
 * `{ ok }` — `true` on success, `false` when the mutation threw. The
 * `task.create` procedure (→ `createTaskFromAPI` → `createTask`)
 * re-validates the payload against `taskCreateSchema` server-side.
 */
export async function createTask(
  input: CreateTaskInput,
): Promise<{ ok: boolean }> {
  try {
    await trpcVanilla.task.create.mutate({
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
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
