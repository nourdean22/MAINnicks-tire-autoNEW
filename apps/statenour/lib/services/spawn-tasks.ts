/**
 * lib/services/spawn-tasks.ts · Phase WW (2026-05-22 ·
 * legacy-modernizer REST→tRPC actions slice).
 *
 * Auto-creates NOW tasks from a project's plan phases. Extracted
 * verbatim from the inline POST /api/projects/[id]/spawn-tasks route
 * handler so the legacy REST route AND the new `task.spawnTasks`
 * tRPC procedure call the SAME function · drift structurally
 * impossible.
 *
 * Idempotent · each ProjectStep gets a `taskId` written back into
 * planData after spawn · re-running only spawns un-spawned steps.
 * Routes every create through the canonical `createTask` service
 * (taskCreateSchema validation · auto-priority · TaskEvent · audit).
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import {
  isProjectPlanData,
  type ProjectPlanData,
  type ProjectPhase,
  type ProjectStep,
} from "@/lib/ai/project-plan";
import { emitTaskEventAsync } from "@/lib/brain/task-events";
import { createTask } from "@/lib/services/tasks";

export interface SpawnTasksArgs {
  /** mission / project id whose plan to spawn from */
  missionId: string;
  /** spawn only this phase's steps · default = first un-spawned phase */
  phase?: string;
  /** alternative selector · index into planData.phases */
  phaseIndex?: number;
  /** spawn every un-spawned step across all phases */
  all?: boolean;
  /** override goalId tagged on each spawned task */
  goalId?: string | null;
}

export interface SpawnTasksResult {
  spawned: number;
  alreadyExisted: number;
  /** the phase actually targeted */
  phase: string;
  /** newly-created task ids */
  taskIds: string[];
}

const VALID_EFFORT = ["M5", "M15", "M30", "H1", "H2PLUS"] as const;
type EffortBand = (typeof VALID_EFFORT)[number];

function normalizeEffort(raw: string | undefined): EffortBand {
  if (!raw) return "M30";
  const upper = raw.toUpperCase();
  if ((VALID_EFFORT as readonly string[]).includes(upper))
    return upper as EffortBand;
  if (upper === "H2" || upper === "H4" || upper === "H8") return "H2PLUS";
  return "M30";
}

/**
 * Spawn NOW tasks from a project plan.
 *
 * @throws ServiceError(404) when the mission doesn't exist.
 * @throws ServiceError(400) when the mission has no plan, or the
 *         requested phase / phaseIndex doesn't resolve.
 */
export async function spawnProjectTasks(
  args: SpawnTasksArgs,
): Promise<SpawnTasksResult> {
  const { missionId } = args;

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
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
  if (args.all === true) {
    phasesToProcess = plan.phases.map((phase, index) => ({ phase, index }));
  } else if (typeof args.phaseIndex === "number") {
    const phase = plan.phases[args.phaseIndex];
    if (!phase) throw new ServiceError(`No phase at index ${args.phaseIndex}`, 400);
    phasesToProcess = [{ phase, index: args.phaseIndex }];
  } else if (typeof args.phase === "string") {
    const idx = plan.phases.findIndex((p) => p.name === args.phase);
    if (idx === -1) throw new ServiceError(`Phase "${args.phase}" not found`, 400);
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
        finishCondition: step.isCheckpoint
          ? "Checkpoint reached"
          : step.isDecisionPoint
            ? "Decision recorded"
            : "Step complete",
        loopKind: "ONCE",
        phaseName: phase.name,
        goalId: args.goalId ?? null,
      });
      // createTask returns a view-model that can be null when the
      // post-create hydration query misses · skip back-reference
      // tracking but keep the step in the updated plan as-is.
      if (!created) {
        updatedSteps.push(step);
        continue;
      }
      newTaskIds.push(created.id);
      // Supplemental event with project-spawn source attribution.
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
}
