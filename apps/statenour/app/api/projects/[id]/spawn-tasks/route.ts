/**
 * POST /api/projects/[id]/spawn-tasks — auto-create NOW tasks from
 * a project's plan phases.
 *
 * Apr 27 · S2. The biggest unlock in the PLAN-tab upgrade. Until now,
 * `/api/ai/plan-project` produced text plans into Mission.planData but
 * those phases never reached the NOW page — Nour had to manually
 * type each task. This endpoint reads the plan and spawns Tasks bound
 * to (missionId, goalId, phaseName) so the NOW stream populates
 * automatically.
 *
 * Idempotent: each ProjectStep gets a `taskId` written back into
 * planData after spawn. Re-running the endpoint only spawns steps
 * that don't already have a taskId.
 *
 * Body shape (all optional):
 *   {
 *     phase?: string;       // spawn only this phase's steps; default = first
 *                           // phase that has no spawned tasks yet
 *     phaseIndex?: number;  // alternative selector; index into planData.phases
 *     all?: boolean;        // spawn every un-spawned step across all phases
 *     goalId?: string;      // override goalId tagged on each task
 *   }
 *
 * Response:
 *   {
 *     spawned: number;
 *     alreadyExisted: number;
 *     phase: string;        // the phase actually targeted
 *     taskIds: string[];    // newly-created task ids
 *   }
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import {
  isProjectPlanData,
  type ProjectPlanData,
  type ProjectPhase,
  type ProjectStep,
} from "@/lib/ai/project-plan";
import { emitTaskEventAsync } from "@/lib/brain/task-events";
// v10.0.529.99 · Wave 43 · route writes through canonical service.
import { createTask } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

interface SpawnRequest {
  phase?: string;
  phaseIndex?: number;
  all?: boolean;
  goalId?: string;
}

const VALID_EFFORT = ["M5", "M15", "M30", "H1", "H2PLUS"] as const;
type EffortBand = (typeof VALID_EFFORT)[number];

function normalizeEffort(raw: string | undefined): EffortBand {
  if (!raw) return "M30";
  const upper = raw.toUpperCase();
  if ((VALID_EFFORT as readonly string[]).includes(upper)) return upper as EffortBand;
  // Loose alias map for AI-produced values
  if (upper === "H2" || upper === "H4" || upper === "H8") return "H2PLUS";
  return "M30";
}

export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as SpawnRequest;

  const mission = await prisma.mission.findUnique({ where: { id } });
  if (!mission) throw new ServiceError("Project not found", 404);

  const plan = mission.planData as unknown;
  if (!isProjectPlanData(plan) || plan.phases.length === 0) {
    throw new ServiceError(
      "Project has no plan to spawn from. Run /api/ai/plan-project first.",
      400,
    );
  }

  // ── Pick which phase(s) to spawn ──
  let phasesToProcess: Array<{ phase: ProjectPhase; index: number }>;
  if (body.all === true) {
    phasesToProcess = plan.phases.map((phase, index) => ({ phase, index }));
  } else if (typeof body.phaseIndex === "number") {
    const phase = plan.phases[body.phaseIndex];
    if (!phase) throw new ServiceError(`No phase at index ${body.phaseIndex}`, 400);
    phasesToProcess = [{ phase, index: body.phaseIndex }];
  } else if (typeof body.phase === "string") {
    const idx = plan.phases.findIndex((p) => p.name === body.phase);
    if (idx === -1) throw new ServiceError(`Phase "${body.phase}" not found`, 400);
    phasesToProcess = [{ phase: plan.phases[idx], index: idx }];
  } else {
    // Default: pick the first phase whose steps aren't all spawned yet.
    const idx = plan.phases.findIndex((p) =>
      (p.steps ?? []).some((s) => !s.taskId),
    );
    if (idx === -1) {
      // All phases already spawned — nothing to do.
      return {
        spawned: 0,
        alreadyExisted: plan.phases.reduce(
          (s, p) => s + (p.steps?.length ?? 0),
          0,
        ),
        phase: plan.phases[plan.phases.length - 1]?.name ?? "",
        taskIds: [] as string[],
      };
    }
    phasesToProcess = [{ phase: plan.phases[idx], index: idx }];
  }

  // ── Spawn missing tasks per phase ──
  // We mutate a deep copy of the plan so we can write back at the end.
  const updatedPlan: ProjectPlanData = JSON.parse(
    JSON.stringify(plan),
  ) as ProjectPlanData;

  const newTaskIds: string[] = [];
  let alreadyExisted = 0;
  let lastPhaseName = "";

  for (const { phase, index } of phasesToProcess) {
    lastPhaseName = phase.name;
    const updatedSteps: ProjectStep[] = [];
    for (const step of phase.steps ?? []) {
      if (step.taskId) {
        // Verify the referenced task still exists; if it was deleted,
        // we'll re-spawn rather than leave a dangling reference.
        const exists = await prisma.task.findUnique({
          where: { id: step.taskId },
          select: { id: true },
        });
        if (exists) {
          alreadyExisted++;
          updatedSteps.push(step);
          continue;
        }
      }
      // v10.0.529.99 · Wave 43 · route through canonical createTask
      // service (was prisma.task.create direct). Service handles:
      // taskCreateSchema validation · ensureMissionExists · goalId
      // sibling-inheritance · syncTaskPriorities (computes autoPriority)
      // · TaskEvent emit · logCreate audit · cache invalidation.
      // Pre-Wave-43 spawn-tasks bypassed ALL of these · tasks were born
      // without auto-priority + audit trail.
      const created = await createTask({
        title: step.title,
        missionId: mission.id,
        status: "READY",
        nextPhysicalAction: step.nextAction || step.title,
        effort: normalizeEffort(step.effort),
        roiScore: 60,
        frictionScore: 30,
        energyRequired: "MEDIUM",
        context: "ANYWHERE",
        finishCondition:
          step.isCheckpoint
            ? "Checkpoint reached"
            : step.isDecisionPoint
              ? "Decision recorded"
              : "Step complete",
        loopKind: "ONCE",
        phaseName: phase.name,
        goalId: body.goalId ?? null,
      });
      // createTask returns a view-model that can be null when the
      // post-create hydration query misses · skip back-reference
      // tracking but keep the step in the updated plan as-is.
      if (!created) {
        updatedSteps.push(step);
        continue;
      }
      newTaskIds.push(created.id);
      // Wave 43 · supplemental event with project-spawn source · the
      // service emits "created/service:createTask" generic event ·
      // this adds project-context source attribution for analytics.
      emitTaskEventAsync({
        taskId: created.id,
        kind: "created",
        source: "api:project-spawn",
        payload: { projectId: mission.id, phase: phase.name, phaseIndex: index },
      });
      updatedSteps.push({ ...step, taskId: created.id });
    }
    updatedPlan.phases[index] = { ...phase, steps: updatedSteps };
  }

  // Persist the taskId back-references so re-runs are idempotent.
  updatedPlan.updatedAt = new Date().toISOString();
  await prisma.mission.update({
    where: { id: mission.id },
    data: { planData: updatedPlan as unknown as object },
  });

  return {
    spawned: newTaskIds.length,
    alreadyExisted,
    phase: lastPhaseName,
    taskIds: newTaskIds,
  };
// v10.0.119 audit-pattern fix · owner-gated. Spawns tasks from a
// project plan — anonymous trigger = task spam vector.
}, { auth: "owner" });
