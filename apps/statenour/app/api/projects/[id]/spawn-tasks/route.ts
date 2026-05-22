/**
 * POST /api/projects/[id]/spawn-tasks — auto-create NOW tasks from
 * a project's plan phases.
 *
 * Apr 27 · S2. Reads the plan and spawns Tasks bound to (missionId,
 * goalId, phaseName) so the NOW stream populates automatically.
 *
 * Idempotent: each ProjectStep gets a `taskId` written back into
 * planData after spawn. Re-running the endpoint only spawns steps
 * that don't already have a taskId.
 *
 * Body shape (all optional):
 *   { phase?, phaseIndex?, all?, goalId? }
 *
 * Response: { spawned, alreadyExisted, phase, taskIds }
 *
 * Phase WW (2026-05-22) · heavy lifting moved to
 * `lib/services/spawn-tasks.spawnProjectTasks` so both this REST
 * endpoint AND the new `trpc.task.spawnTasks` mutation call the same
 * function · drift between consumers structurally impossible.
 */

import { apiHandler } from "@/lib/utils/http";
import { spawnProjectTasks } from "@/lib/services/spawn-tasks";

export const dynamic = "force-dynamic";

interface SpawnRequest {
  phase?: string;
  phaseIndex?: number;
  all?: boolean;
  goalId?: string;
}

// v10.0.119 audit-pattern fix · owner-gated. Spawns tasks from a
// project plan — anonymous trigger = task spam vector.
export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as SpawnRequest;
  return spawnProjectTasks({
    missionId: id,
    phase: body.phase,
    phaseIndex: body.phaseIndex,
    all: body.all,
    goalId: body.goalId,
  });
}, { auth: "owner" });
