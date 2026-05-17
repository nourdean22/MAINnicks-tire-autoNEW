/**
 * POST /api/projects/backfill-tasks — bulk-spawn NOW tasks from every
 * project plan that has un-spawned phases.
 *
 * Apr 27 · Nour's NOW list was empty (0/0/0) while PLAN had projects
 * with planData phases sitting unused. The S2 spawn-tasks endpoint
 * exists per-project; this is the "fill it ALL right now" wrapper.
 *
 * Walks every active mission with a non-empty planData, calls the
 * same per-project spawn logic for each phase that still has steps
 * without a taskId, and aggregates the count.
 *
 * Idempotent: re-running won't duplicate (planData.steps[].taskId
 * is the spawn flag). Safe to wire to a button or run from a script.
 *
 * Body (optional):
 *   { firstPhaseOnly?: boolean }
 *     true (default)  — only spawn the first phase of each project.
 *                       This is what Nour wants for the "backfill"
 *                       UX so NOW doesn't get flooded with 50 tasks.
 *     false           — spawn every un-spawned step in every phase.
 *
 * Response:
 *   {
 *     projectsScanned: number;
 *     projectsSpawned: number;     // had at least one new task
 *     totalTasksSpawned: number;
 *     totalTasksAlreadyExisted: number;
 *     details: Array<{ projectId, title, spawned, alreadyExisted, phase }>;
 *   }
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import {
  isProjectPlanData,
  type ProjectPlanData,
  type ProjectStep,
} from "@/lib/ai/project-plan";
import { emitTaskEventAsync } from "@/lib/brain/task-events";
import { classifyStaleness } from "@/lib/brain/goal-staleness";
// v10.0.529.99 · Wave 43 · route writes through canonical service.
import { createTask } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

interface BackfillBody {
  firstPhaseOnly?: boolean;
}

const VALID_EFFORT = ["M5", "M15", "M30", "H1", "H2PLUS"] as const;
type EffortBand = (typeof VALID_EFFORT)[number];

function normalizeEffort(raw: string | undefined): EffortBand {
  if (!raw) return "M30";
  const upper = raw.toUpperCase();
  if ((VALID_EFFORT as readonly string[]).includes(upper)) return upper as EffortBand;
  if (upper === "H2" || upper === "H4" || upper === "H8") return "H2PLUS";
  return "M30";
}

export const POST = apiHandler(async (req) => {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as BackfillBody;
  const firstPhaseOnly = body.firstPhaseOnly !== false;

  // Apr 27 · staleness filter — when Nour says "backfill" he means
  // ONLY relevant projects. We hard-skip:
  //   1. Projects whose plan was last updated > 90 days ago
  //      (zombie plan, probably out of date)
  //   2. Projects whose ALL linked goals are stale (zero-progress
  //      zombies — we don't backfill chains anchored to dead goals)
  //
  // Projects with no goal links are still valid backfill candidates
  // since they may be orphan but real work-in-progress.
  const STALE_PLAN_AGE_MS = 90 * 86400_000;
  const now = Date.now();

  // v8.27 · soft-delete retrofit · projects-backfill must skip
  // tombstoned missions/goals/tasks or it spawns zombie tasks.
  const missions = await prisma.mission.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, title: true, planData: true },
  });

  // Pull all goals once so we can classify staleness per linked goal.
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
  const details: Array<{
    projectId: string;
    title: string;
    spawned: number;
    alreadyExisted: number;
    phase: string;
  }> = [];

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

    // Apr 27 · staleness gate 1 — plan-age. Plans > 90d old are
    // skipped; either re-plan from scratch or archive the project.
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

    // Apr 27 · staleness gate 2 — goal anchors. If this project's
    // tasks all link to goals that are zombies (0% + no movement +
    // 30d+), skip. Projects with no goal links are still allowed
    // since they may be real but unbound work.
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

    // Pick which phase(s) to process for this project.
    const phaseIndexes = firstPhaseOnly
      ? [
          // First phase that has un-spawned steps (skip already-done phases)
          plan.phases.findIndex((p) => (p.steps ?? []).some((s) => !s.taskId)),
        ].filter((i) => i !== -1)
      : plan.phases.map((_, i) => i);

    if (phaseIndexes.length === 0) {
      // Project's first un-spawned phase couldn't be found → all done
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

    // Mutate a deep copy of the plan so we can write back at the end.
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
          // Verify the linked task still exists.
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
        // v10.0.529.99 · Wave 43 · canonical service. Was prisma.task.
        // create direct · bypassed taskCreateSchema · syncTaskPriorities
        // · goalId inherit · audit · cache invalidate.
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
        // Null-guard · createTask view-model can be null when post-create
        // hydration misses. Skip back-ref without counting as success.
        if (!created) {
          updatedSteps.push(step);
          continue;
        }
        // Wave 43 · supplemental source-attribution event · service
        // already emitted the generic "created" TaskEvent.
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
// v10.0.119 audit-pattern fix · owner-gated. This endpoint scans
// every project plan and creates tasks; anonymous trigger = mass
// task spam.
}, { auth: "owner" });
