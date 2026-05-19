/**
 * Bulk project task backfill service · Phase SS.4 (2026-05-19 AM).
 *
 * Lifted from `app/api/projects/backfill-tasks/route.ts` so both the
 * legacy REST endpoint AND the new `trpc.task.backfill` mutation call
 * the same function · drift between consumers structurally impossible.
 *
 * Walks every active mission with a non-empty planData, calls the
 * canonical createTask service for each phase step that lacks a
 * taskId, and aggregates the count.
 *
 * Idempotent: re-running won't duplicate (planData.steps[].taskId
 * is the spawn flag). Safe to wire to a button or run from a script.
 *
 * Staleness gates (preserve the route's original Apr-27 filter):
 *   1. Plan age > 90 days → skip (zombie plan)
 *   2. All linked goals stale → skip (anchored to dead goals)
 *   3. Project has no goal links → still allowed (orphan but real)
 *
 * `firstPhaseOnly` default true · spawn only the first un-spawned
 * phase of each project so NOW doesn't get flooded with 50 tasks.
 */

import { prisma } from "@/lib/prisma";
import {
  isProjectPlanData,
  type ProjectPlanData,
  type ProjectStep,
} from "@/lib/ai/project-plan";
import { emitTaskEventAsync } from "@/lib/brain/task-events";
import { classifyStaleness } from "@/lib/brain/goal-staleness";
import { createTask } from "@/lib/services/tasks";

const VALID_EFFORT = ["M5", "M15", "M30", "H1", "H2PLUS"] as const;
type EffortBand = (typeof VALID_EFFORT)[number];

function normalizeEffort(raw: string | undefined): EffortBand {
  if (!raw) return "M30";
  const upper = raw.toUpperCase();
  if ((VALID_EFFORT as readonly string[]).includes(upper)) return upper as EffortBand;
  if (upper === "H2" || upper === "H4" || upper === "H8") return "H2PLUS";
  return "M30";
}

const STALE_PLAN_AGE_MS = 90 * 86400_000;

export interface BackfillResult {
  projectsScanned: number;
  projectsSpawned: number;
  totalTasksSpawned: number;
  totalTasksAlreadyExisted: number;
  details: Array<{
    projectId: string;
    title: string;
    spawned: number;
    alreadyExisted: number;
    phase: string;
  }>;
}

export async function backfillProjectTasks(args: {
  firstPhaseOnly?: boolean;
}): Promise<BackfillResult> {
  const firstPhaseOnly = args.firstPhaseOnly !== false;
  const now = Date.now();

  // v8.27 · soft-delete retrofit · skip tombstoned missions/goals/tasks
  const missions = await prisma.mission.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, title: true, planData: true },
  });

  const allGoals = await prisma.lifeGoal.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      progress: true,
      currentValue: true,
      status: true,
    },
  });
  const goalById = new Map(allGoals.map((g) => [g.id, g]));

  // Project → linked goal IDs map (derived from tasks with goalId
  // bound to that mission). Same pattern the page-level bridge uses.
  const linkRows = await prisma.task.findMany({
    where: {
      missionId: { in: missions.map((m) => m.id) },
      goalId: { not: null },
      deletedAt: null,
    },
    select: { missionId: true, goalId: true },
  });
  const projectGoals = new Map<string, Set<string>>();
  for (const r of linkRows) {
    if (!r.goalId) continue;
    const set = projectGoals.get(r.missionId) ?? new Set<string>();
    set.add(r.goalId);
    projectGoals.set(r.missionId, set);
  }

  let totalSpawned = 0;
  let totalAlreadyExisted = 0;
  let projectsSpawned = 0;
  const details: BackfillResult["details"] = [];

  for (const mission of missions) {
    const plan = mission.planData as unknown;
    if (!isProjectPlanData(plan)) {
      details.push({
        projectId: mission.id,
        title: mission.title,
        spawned: 0,
        alreadyExisted: 0,
        phase: "(no plan)",
      });
      continue;
    }
    if (plan.phases.length === 0) {
      details.push({
        projectId: mission.id,
        title: mission.title,
        spawned: 0,
        alreadyExisted: 0,
        phase: "(empty phases)",
      });
      continue;
    }

    // Staleness gate 1 — plan-age
    const planUpdatedAt = plan.updatedAt
      ? new Date(plan.updatedAt).getTime()
      : new Date(plan.createdAt ?? 0).getTime();
    if (planUpdatedAt > 0 && now - planUpdatedAt > STALE_PLAN_AGE_MS) {
      details.push({
        projectId: mission.id,
        title: mission.title,
        spawned: 0,
        alreadyExisted: 0,
        phase: "(plan stale 90d+)",
      });
      continue;
    }

    // Staleness gate 2 — goal anchors
    const linkedGoalIds = projectGoals.get(mission.id);
    if (linkedGoalIds && linkedGoalIds.size > 0) {
      const allLinkedStale = Array.from(linkedGoalIds).every((gid) => {
        const g = goalById.get(gid);
        if (!g) return false;
        const v = classifyStaleness({
          createdAt: g.createdAt.toISOString(),
          updatedAt: g.updatedAt.toISOString(),
          progress: g.progress,
          currentValue: g.currentValue,
          status: g.status,
        });
        return v.kind === "stale";
      });
      if (allLinkedStale) {
        details.push({
          projectId: mission.id,
          title: mission.title,
          spawned: 0,
          alreadyExisted: 0,
          phase: "(all goals stale)",
        });
        continue;
      }
    }

    const phaseIndexes = firstPhaseOnly
      ? [
          plan.phases.findIndex((p) => (p.steps ?? []).some((s) => !s.taskId)),
        ].filter((i) => i !== -1)
      : plan.phases.map((_, i) => i);

    if (phaseIndexes.length === 0) {
      details.push({
        projectId: mission.id,
        title: mission.title,
        spawned: 0,
        alreadyExisted: plan.phases.reduce(
          (s, p) => s + (p.steps?.length ?? 0),
          0,
        ),
        phase: "(all spawned)",
      });
      continue;
    }

    const updatedPlan: ProjectPlanData = JSON.parse(
      JSON.stringify(plan),
    ) as ProjectPlanData;

    let projectSpawned = 0;
    let projectExisted = 0;
    let lastPhaseName = "";

    for (const idx of phaseIndexes) {
      const phase = plan.phases[idx];
      lastPhaseName = phase.name;
      const updatedSteps: ProjectStep[] = [];

      for (const step of phase.steps ?? []) {
        if (step.taskId) {
          const exists = await prisma.task.findUnique({
            where: { id: step.taskId },
            select: { id: true },
          });
          if (exists) {
            projectExisted++;
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
        });
        if (!created) {
          updatedSteps.push(step);
          continue;
        }
        emitTaskEventAsync({
          taskId: created.id,
          kind: "created",
          source: "api:backfill-tasks",
          payload: {
            projectId: mission.id,
            phase: phase.name,
            phaseIndex: idx,
          },
        });
        updatedSteps.push({ ...step, taskId: created.id });
        projectSpawned++;
      }
      updatedPlan.phases[idx] = { ...phase, steps: updatedSteps };
    }

    if (projectSpawned > 0) {
      updatedPlan.updatedAt = new Date().toISOString();
      await prisma.mission.update({
        where: { id: mission.id },
        data: { planData: updatedPlan as unknown as object },
      });
      projectsSpawned++;
    }

    totalSpawned += projectSpawned;
    totalAlreadyExisted += projectExisted;
    details.push({
      projectId: mission.id,
      title: mission.title,
      spawned: projectSpawned,
      alreadyExisted: projectExisted,
      phase: lastPhaseName || "(empty)",
    });
  }

  return {
    projectsScanned: missions.length,
    projectsSpawned,
    totalTasksSpawned: totalSpawned,
    totalTasksAlreadyExisted: totalAlreadyExisted,
    details,
  };
}
