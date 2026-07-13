import { Prisma, type PrismaClient, type Task } from "@prisma/client";
const { PrismaClientKnownRequestError } = Prisma;

import { getDemoState, makeDemoId, type DemoMission, type DemoTask } from "@/lib/demo-store";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/runtime";
import { rankMissions } from "@/lib/scoring/mission-ranking";
import { scoreTaskPriority } from "@/lib/scoring/task-priority";
import { daysSince } from "@/lib/utils/datetime";
import { serializeForJson } from "@/lib/utils/serialize";
import { ServiceError } from "@/lib/utils/service-error";
import { taskCreateSchema, taskUpdateSchema } from "@/lib/validators/tasks";
import { emitTaskEventAsync } from "@/lib/brain/task-events";
import { emitTaskCompleted } from "@/lib/db/brain-bus-emit";
import { runAutoLearn, type AutoLearnReport } from "@/lib/services/auto-learn";
import { emitGoalEventAsync } from "@/lib/brain/goal-events";
import { creditTaskStats } from "@/lib/mastery/goal-stats";
import type { TaskReward } from "@/lib/mastery/task-reward";
import { isDailyCheckoff } from "@/lib/loops/daily-checkoff";
import { DOMAINS } from "@/lib/mastery/config";
import { CONFIDENCE } from "@/lib/mastery/scoring-config";
import { classifyTaskLinkage } from "@/lib/ai/classify-task-linkage";
// resolveInboxMissionId is dynamic-imported inside enrichTaskLinkage to
// avoid a static tasks↔missions import cycle (missions imports
// syncTaskPriorities from here).
import { isProjectPlanData, type ProjectPlanData, type ProjectStep } from "@/lib/ai/project-plan";
import { invalidate } from "@/lib/utils/cache";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/tasks");

// v9.1.23 · cache keys that must be invalidated on any task/mission
// mutation. Without this, dashboard_brief (30s TTL) shows a stale
// view including completed tasks as still-open or deleted missions
// still appearing in primaryMission. Centralized here so the same
// keys get invalidated from missions.ts via re-import.
function invalidateMutationCaches(): void {
  invalidate("dashboard_brief");
  invalidate("ultron_command_center_state_v1");
}
import { softDelete, activeOnly } from "@/lib/db/soft-delete";
import { logCreate, logUpdate, stripNoise } from "@/lib/db/entity-audit";

type DbClient = PrismaClient | Prisma.TransactionClient;

type TaskFilter = {
  status?: string;
  sort?: string;
  missionId?: string;
  /** Phase B (2026-05-18) · filter to tasks tagged to a specific
   *  LifeGoal · drives the /goals → /tasks?goalId=X cross-link. */
  goalId?: string;
  /** v7.9 — pass "all" to include soft-deleted rows (admin/undo views). */
  deletedAt?: "all";
};

async function ensureMissionExists(db: DbClient, missionId: string) {
  const mission = await db.mission.findUnique({
    where: { id: missionId }
  });

  if (!mission) {
    throw new ServiceError("Mission not found.", 404);
  }
}

function buildTaskViewModels(
  tasks: Array<DemoTask & { mission: DemoMission }>,
  missions: DemoMission[]
) {
  const serializedTasks = serializeForJson(tasks);
  const missionRanking = rankMissions(serializeForJson(missions));
  const missionMap = new Map(missionRanking.rankedMissions.map((mission) => [mission.id, mission]));

  return (serializedTasks as Array<DemoTask & { mission: DemoMission; missionId: string; manualPriorityOverride: number | null; lastTouchedAt: string | null; updatedAt: string; status: string; id: string; events?: Array<{ source: string | null; createdAt: string | Date }> }>).map((task) => {
    const automation = scoreTaskPriority(task, missionMap);
    const effectivePriority = task.manualPriorityOverride ?? automation.score;
    const mission = missionMap.get(task.missionId);
    const staleDays = daysSince(task.lastTouchedAt || task.updatedAt);
    // v10.0.529.82 · Wave 26 · C2 · adaptive stale threshold. Was a
    // hardcoded 5d everywhere · now scales by operator state:
    //   · DAILY loops are never "stale" (resets every day by design)
    //   · everything else uses 5d as the default
    // The state-aware tightening (3d on light backlogs, 7d during
    // drift) lives in useTaskDerivedState on the client so it can
    // read nourState · the server keeps the 5d baseline for the
    // serializer · clients can override the badge if they want.
    const taskLoopKind = (task as DemoTask & { loopKind?: string }).loopKind;
    const staleThreshold = taskLoopKind === "DAILY" ? Infinity : 5;
    const stale = !["DONE", "ARCHIVED"].includes(task.status) && (staleDays || 0) >= staleThreshold;
    // Apr 26 · F5 — surface the original creation source. The first
    // event with kind=created carries it; null when no event was
    // logged (legacy tasks created before the TaskEvent substrate).
    const originSource = task.events?.[0]?.source ?? null;

    return {
      ...task,
      effectivePriority,
      effectivePriorityExplanation: automation.explanation,
      missionRank: mission?.rank || null,
      stale,
      originSource
    };
  });
}

function sortTasks(tasks: ReturnType<typeof buildTaskViewModels>, sort = "priority") {
  const clone = [...tasks];

  if (sort === "due") {
    clone.sort((left, right) => {
      const leftDate = left.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDate = right.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return leftDate - rightDate;
    });
    return clone;
  }

  if (sort === "mission") {
    clone.sort((left, right) => (left.missionRank || 99) - (right.missionRank || 99));
    return clone;
  }

  if (sort === "updated") {
    clone.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    return clone;
  }

  clone.sort((left, right) => right.effectivePriority - left.effectivePriority);
  return clone;
}

export async function syncTaskPriorities(db: DbClient = prisma) {
  if (isDemoMode) {
    const state = getDemoState();
    const missionRanking = rankMissions(serializeForJson(state.missions));
    const missionMap = new Map(missionRanking.rankedMissions.map((mission) => [mission.id, mission]));
    const now = new Date();

    state.tasks
      .filter((task) => !["DONE", "ARCHIVED"].includes(task.status))
      .forEach((task) => {
        const automation = scoreTaskPriority(task, missionMap);
        task.autoPriority = automation.score;
        task.autoPriorityExplanation = automation.explanation;
        task.updatedAt = now;
      });

    return;
  }

  // v9.1.23 · added deletedAt:null on both queries. Soft-deleted
  // missions were inflating missionRank scores via rankMissions, and
  // soft-deleted tasks were getting their autoPriority needlessly
  // updated. Both leaks bypass the v7.9 universal soft-delete.
  const [missions, tasks] = await Promise.all([
    db.mission.findMany({ where: activeOnly() }),
    db.task.findMany({
      include: {
        mission: true,
      },
      where: activeOnly({
        status: {
          notIn: ["DONE", "ARCHIVED"],
        },
      }),
    }),
  ]);

  const missionRanking = rankMissions(serializeForJson(missions));
  const missionMap = new Map(missionRanking.rankedMissions.map((mission) => [mission.id, mission]));

  await Promise.all(
    (serializeForJson(tasks) as Array<{ id: string; title: string; missionId: string; status: string; roiScore: number; frictionScore: number; energyRequired: string; dueDate: string | Date | null; manualPriorityOverride: number | null; lastTouchedAt: string | null; updatedAt: string }>).map((task) => {
      const automation = scoreTaskPriority(task, missionMap);
      return db.task.update({
        where: {
          id: task.id
        },
        data: {
          autoPriority: automation.score,
          autoPriorityExplanation: automation.explanation
        }
      });
    })
  );
}

export const recomputeTaskPriorities = syncTaskPriorities;

export async function listTasks(filter: TaskFilter = {}) {
  if (isDemoMode) {
    const state = getDemoState();
    const missionMap = new Map(state.missions.map((mission) => [mission.id, mission]));
    const tasks = state.tasks
      .filter((task) => (filter.status && filter.status !== "ALL" ? task.status === filter.status : true))
      .filter((task) => (filter.missionId ? task.missionId === filter.missionId : true))
      .map((task) => ({
        ...task,
        mission: missionMap.get(task.missionId)!
      }));

    return sortTasks(buildTaskViewModels(tasks, state.missions), filter.sort);
  }

  const where = {
    ...(filter.status && filter.status !== "ALL"
      ? {
          status: filter.status as never
        }
      : {}),
    ...(filter.missionId
      ? {
          missionId: filter.missionId
        }
      : {}),
    // Phase B (2026-05-18) · goalId filter for /goals cross-link
    ...(filter.goalId ? { goalId: filter.goalId } : {}),
    // v7.9: hide soft-deleted tasks unless caller opted in via {deletedAt: 'all'}
    ...(filter.deletedAt === "all" ? {} : { deletedAt: null }),
  };

  const missions = await prisma.mission.findMany({ where: activeOnly() });

  // Apr 27 · fault-tolerant events join. When the task_events
  // migration hasn't deployed yet (cold prod boot, migration lag),
  // including the relation throws "Table does not exist" and
  // tanks /api/tasks. Try the join first; fall back to a plain
  // findMany if the table is missing. Same pattern as /api/goals.
  // Typed via the loose any-array shape buildTaskViewModels accepts
  // so both branches compose cleanly.
  // v10.0.29 — bounded fetch. Pre-v10.0.29 listTasks pulled every
  // row with no `take` clause. As DONE tasks accumulate (soft-delete
  // means they hang around), a long-time user could see the page
  // load grow into many MB of payload. 1500-cap covers normal usage
  // (active + recent done) without missing anything; older DONE
  // tasks are hidden behind the "Older" drawer's already-existing
  // 10-item slice.
  const TASK_FETCH_CAP = 1500;
  let tasks: Parameters<typeof buildTaskViewModels>[0];
  try {
    tasks = (await prisma.task.findMany({
      where,
      include: {
        mission: true,
        // Apr 26 · F5 — pull the first `created` event per task so
        // the row can render a "from chat" / "from journal"
        // attribution chip without a second round-trip.
        events: {
          where: { kind: "created" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { source: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: TASK_FETCH_CAP,
    })) as Parameters<typeof buildTaskViewModels>[0];
  } catch (err) {
    log.warn("events_join_fallback", {
      reason: "migration may not be deployed",
      error: err instanceof Error ? err.message : String(err),
    });
    tasks = (await prisma.task.findMany({
      where,
      include: { mission: true },
      orderBy: { updatedAt: "desc" },
      take: TASK_FETCH_CAP,
    })) as Parameters<typeof buildTaskViewModels>[0];
  }

  return sortTasks(buildTaskViewModels(tasks, missions), filter.sort);
}

export async function getTaskById(id: string) {
  if (isDemoMode) {
    const state = getDemoState();
    const task = state.tasks.find((candidate) => candidate.id === id);

    if (!task) {
      return null;
    }

    const mission = state.missions.find((candidate) => candidate.id === task.missionId);

    if (!mission) {
      return null;
    }

    return buildTaskViewModels(
      [
        {
          ...task,
          mission
        }
      ],
      state.missions
    )[0];
  }

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      mission: true
    }
  });

  if (!task) {
    return null;
  }

  // v9.1.15 · added deletedAt:null. Was a bare findMany() that
  // returned soft-deleted missions, polluting view-model ranking.
  // v10.0.529.106 wave-74 · migrated to activeOnly() helper.
  const missions = await prisma.mission.findMany({
    where: activeOnly(),
  });
  return buildTaskViewModels([task], missions)[0];
}

export async function createTask(input: unknown, tx?: Prisma.TransactionClient) {
  const payload = taskCreateSchema.parse(input);

  // A bare quick-add task carries no explicit "next physical action";
  // fall back to the title so the NOT-NULL column is never an empty
  // string. title is requiredString → guaranteed non-empty.
  if (!payload.nextPhysicalAction) payload.nextPhysicalAction = payload.title;

  if (isDemoMode) {
    const state = getDemoState();
    const mission = state.missions.find((candidate) => candidate.id === payload.missionId);

    if (!mission) {
      throw new ServiceError("Mission not found.", 404);
    }

    const now = new Date();
    const task: DemoTask = {
      id: makeDemoId("task"),
      title: payload.title,
      missionId: payload.missionId,
      status: payload.status,
      nextPhysicalAction: payload.nextPhysicalAction,
      effort: payload.effort,
      roiScore: payload.roiScore,
      frictionScore: payload.frictionScore,
      energyRequired: payload.energyRequired,
      context: payload.context,
      delegatable: payload.delegatable,
      waitingOn: payload.waitingOn || null,
      dueDate: payload.dueDate || null,
      lastTouchedAt: payload.lastTouchedAt || now,
      driftRisk: payload.driftRisk,
      autoPriority: null,
      manualPriorityOverride: payload.manualPriorityOverride ?? null,
      autoPriorityExplanation: payload.autoPriorityExplanation || null,
      finishCondition: payload.finishCondition,
      createdAt: now,
      updatedAt: now
    };

    state.tasks.push(task);
    await syncTaskPriorities();
    return getTaskById(task.id);
  }

  await ensureMissionExists(prisma, payload.missionId);

  // May 02 · auto-inherit goalId from sibling tasks. The Goal↔Project
  // bridge lives at the task level (Mission has no goalId column).
  // Pre-fix, when a project was linked to a goal via "+ project" /
  // "+ goal", only the EXISTING tasks at link-time got the goalId
  // PATCH'd in. New tasks added later didn't auto-inherit, so the
  // goal would show "100% (1/1 done)" while the project still had
  // open tasks — a real UX confusion (v10.0.139 explanation).
  //
  // The fix: when creating a task with no explicit goalId, look at
  // sibling tasks under the same missionId. If they all share exactly
  // one goalId, inherit it. If they span multiple goals, abstain
  // (leave null) — the user has intentionally split this project's
  // tasks across goals; we don't override that.
  let inheritedGoalId: string | null = null;
  if (!payload.goalId) {
    // 2026-05-23 · task #22 · subtask precedence · if payload carries
    // a parentTaskId, the PARENT's goalId wins over sibling-based
    // inheritance (the operator explicitly chose this parent · its
    // goal context is the strongest signal). When no parent is set,
    // fall back to the existing sibling-scan heuristic.
    if (payload.parentTaskId) {
      const parent = await prisma.task.findUnique({
        where: { id: payload.parentTaskId },
        select: { goalId: true },
      }).catch(() => null);
      if (parent?.goalId) {
        inheritedGoalId = parent.goalId;
      }
    }
    // Fall back to the sibling-scan ONLY when the parent didn't
    // already resolve an inheritance (so subtasks under a goal-less
    // parent still get the sibling-scan benefit).
    if (!inheritedGoalId) {
      const siblings = await prisma.task.findMany({
        where: activeOnly({
          missionId: payload.missionId,
          goalId: { not: null },
        }),
        select: { goalId: true },
      }).catch(() => [] as Array<{ goalId: string | null }>);
      const distinctGoalIds = new Set(
        siblings.map((s) => s.goalId).filter((g): g is string => !!g),
      );
      if (distinctGoalIds.size === 1) {
        inheritedGoalId = [...distinctGoalIds][0]!;
      }
      // distinctGoalIds.size === 0 → no siblings linked; leave null
      // distinctGoalIds.size  >  1 → ambiguous; abstain
    }
  }

  // Core transactional write. Runs on the caller's `tx` when one is
  // supplied — so convertCaptureItem can make the task-create and the
  // capture-item update one atomic unit — otherwise in its own
  // transaction. The body is identical either way.
  const runCore = async (client: Prisma.TransactionClient) => {
    const task = await client.task.create({
      data: {
        ...payload,
        // Apply inheritance ONLY when payload didn't explicitly set goalId.
        // The spread above already wrote payload.goalId (which may be null
        // or undefined); override with inherited value when present.
        ...(inheritedGoalId ? { goalId: inheritedGoalId } : {}),
        lastTouchedAt: payload.lastTouchedAt || new Date()
      }
    });

    await syncTaskPriorities(client);

    const hydrated = await client.task.findUnique({
      where: { id: task.id },
      include: {
        mission: true
      }
    });
    // v9.1.15 · same fix as getTaskById — soft-delete filter.
    // v10.0.529.106 wave-74 · migrated to activeOnly() helper.
    const missions = await client.mission.findMany({
      where: activeOnly(),
    });

    return { task, vm: buildTaskViewModels(hydrated ? [hydrated] : [], missions)[0] };
  };
  const result = tx ? await runCore(tx) : await prisma.$transaction(runCore);

  // Apr 26 · TaskEvent emit — fire-and-forget after the transaction
  // commits so analytics never blocks the user-facing write path.
  emitTaskEventAsync({ taskId: result.task.id, kind: "created", source: "service:createTask" });
  // v8.0 Phase 2A — entity-audit create.
  void logCreate("task", result.task.id, result.task as unknown as Record<string, unknown>, {
    source: "service:createTask",
  });
  // v9.1.23 · cache invalidation — dashboard_brief etc.
  invalidateMutationCaches();

  // 2026-06-01 · classification spine · fire-and-forget enrichment AFTER the
  // task exists (snappy create, no AI on the write path). Fills mission/goal/
  // statHints when they're unset — so EVERY creation path (this service, the
  // AI tool, follow-ups, auto-spawn) lands a task that correlates to a
  // mission + goal + stats, not a generic Inbox orphan.
  void enrichTaskLinkage(result.task.id);

  return result.vm;
}

/**
 * Gap-fill a task's mission/goal/stat linkage via the AI classifier, then
 * compare-and-set only the fields still unset. Idempotent + race-safe:
 *   · skips the AI call entirely when already fully linked (review #1);
 *   · each write is a conditional `updateMany` that only touches a row whose
 *     field is STILL unset, so it never clobbers a deliberate choice or a
 *     user edit made in the create→enrich window.
 * Fire-and-forget — never throws.
 */
export async function enrichTaskLinkage(taskId: string): Promise<void> {
  if (isDemoMode) return; // demo has no classifier
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        nextPhysicalAction: true,
        missionId: true,
        goalId: true,
        statHints: true,
      },
    });
    if (!task) return;

    const { resolveInboxMissionId, resolveGeneralAnchorId } = await import("@/lib/services/missions");
    const { isGeneralAnchor } = await import("@/lib/services/mission-helpers");
    const [inboxId, missions, goals, recentCorrections] = await Promise.all([
      resolveInboxMissionId(),
      prisma.mission.findMany({
        where: activeOnly(),
        // successMetric = the mission's "what done looks like" (its description);
        // systemKind lets us drop GENERAL anchors from the candidate list.
        select: { id: true, title: true, domain: true, successMetric: true, systemKind: true },
      }),
      prisma.lifeGoal.findMany({
        where: { status: "active", deletedAt: null },
        select: { id: true, title: true, domain: true },
      }),
      // Few-shot learning signal · last 15 operator re-files. Empty pre-migration
      // (table added in 0010) — the .catch keeps classification working regardless.
      prisma.taskClassificationCorrection
        .findMany({
          orderBy: { createdAt: "desc" },
          take: 15,
          select: { taskTitle: true, chosenMissionId: true, domain: true },
        })
        .catch(() => [] as Array<{ taskTitle: string; chosenMissionId: string | null; domain: string | null }>),
    ]);

    // 2026-06-01 · treat ALL inbox-variant missions as "unclassified", not
    // just the canonical m-inbox. The operator runs "Inbox", "Inbox - health",
    // "Inbox - business"… — a task in any of them should still be offered a
    // real mission (data-profile finding).
    // "Unclassified" buckets = legacy Inbox variants AND the GENERAL anchors.
    // A task in any of them is still eligible for a SPECIFIC mission, and none
    // of them should be offered as a specific-match target.
    const inboxIds = new Set<string>([inboxId]);
    for (const m of missions) {
      if (/^inbox\b/i.test(m.title ?? "") || isGeneralAnchor(m)) inboxIds.add(m.id);
    }
    const missionUnset = !task.missionId || inboxIds.has(task.missionId);
    const goalUnset = !task.goalId;
    const statsUnset = !task.statHints || task.statHints.length === 0;
    // Already fully linked → skip the AI call (gap-fill only).
    if (!missionUnset && !goalUnset && !statsUnset) return;

    const result = await classifyTaskLinkage({
      taskTitle: task.title,
      nextPhysicalAction: task.nextPhysicalAction,
      // Don't offer inbox variants OR GENERAL anchors — they're the fallback,
      // not a "pick me" project. Pass each mission's successMetric as its
      // description (richer signal for specific-vs-general).
      missions: missions
        .filter((m) => !inboxIds.has(m.id))
        .map((m) => ({ id: m.id, title: m.title, domain: m.domain, description: m.successMetric })),
      goals,
      stats: DOMAINS.map((d) => ({ key: d.key, label: d.label })),
      // Few-shot from the operator's recent re-files (empty until 0010 + corrections capture).
      recentExamples: recentCorrections.map((c) => ({
        taskTitle: c.taskTitle,
        missionTitle: missions.find((m) => m.id === c.chosenMissionId)?.title ?? "a mission",
        domain: c.domain,
      })),
    });

    // Compare-and-set, one conditional write per field the classifier filled.
    if (missionUnset && result.missionId && result.confidence >= CONFIDENCE.silentAttach) {
      await prisma.task
        .updateMany({
          // Only reassign while the task is STILL in an inbox variant (race-safe).
          where: { id: taskId, missionId: { in: [...inboxIds] } },
          data: { missionId: result.missionId },
        })
        .catch(() => {});
    }
    if (goalUnset && result.goalId) {
      await prisma.task
        .updateMany({
          where: { id: taskId, goalId: null },
          data: { goalId: result.goalId },
        })
        .catch(() => {});
    }
    if (statsUnset && result.statHints.length > 0) {
      await prisma.task
        .updateMany({
          where: { id: taskId, statHints: { isEmpty: true } },
          data: { statHints: result.statHints },
        })
        .catch(() => {});
    }
    // Suggest-then-approve · a mission match BELOW the silent-attach bar is
    // PARKED (not silently attached, not dropped) for the operator to accept
    // or dismiss via the /missions chip. Only while still unclassified.
    if (
      missionUnset &&
      result.missionId &&
      result.confidence >= CONFIDENCE.chipFloor &&
      result.confidence < CONFIDENCE.silentAttach
    ) {
      await prisma.task
        .updateMany({
          where: { id: taskId, missionId: { in: [...inboxIds] } },
          data: {
            pendingClassification: {
              missionId: result.missionId,
              goalId: result.goalId ?? null,
              statHints: result.statHints,
              confidence: result.confidence,
              rationale: result.rationale,
            },
          },
        })
        .catch(() => {});
    }

    // 2026-06-09 · DOMAIN ANCHOR FALLBACK. When no specific mission is even a
    // chip-worthy suggestion, route the task out of the generic Inbox into its
    // canonical domain's GENERAL anchor (a real, visible per-domain bucket)
    // instead of leaving it unsorted — the "wrong/no bucket" fix. No-op
    // pre-seed (resolveGeneralAnchorId returns null) → task stays in Inbox.
    const hasSpecificSuggestion =
      !!result.missionId && result.confidence >= CONFIDENCE.chipFloor;
    if (missionUnset && !hasSpecificSuggestion) {
      const anchorId = await resolveGeneralAnchorId(result.domain);
      if (anchorId) {
        await prisma.task
          .updateMany({
            where: { id: taskId, missionId: { in: [...inboxIds] } },
            data: { missionId: anchorId },
          })
          .catch(() => {});
      }
    }
  } catch (err) {
    log.warn("enrich_task_linkage_failed", {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 2026-06-01 · the standard low-level "create a task and classify it" seam.
 * Behavior-identical to a raw `prisma.task.create` + `void enrichTaskLinkage`,
 * but DRY + one obvious place — so the AI tools, nick-agent, and follow-up
 * spawners can't create a task that silently skips classification. Does NOT
 * run the heavier `createTask` service path (priority resync / events); it's
 * a thin wrapper for callers that build their own task `data`.
 */
export async function createTaskAndEnrich(
  data: Prisma.TaskUncheckedCreateInput,
) {
  // 2026-07-12 · error-proof the mission FK. Every caller of this helper is
  // model/agent-facing and supplies a missionId the LLM chose — frequently
  // hallucinated or empty (the model has no reliable way to know a valid
  // mission id mid-conversation). Task.missionId is a hard FK (onDelete:
  // Restrict), so a bad id threw P2003, which the AI SDK surfaced in chat as
  // a red "TOOL FAILED" card. Resolve to the Inbox anchor when the chosen
  // mission is missing or doesn't exist — enrichTaskLinkage (fired below)
  // then re-files the task into the right mission by title classification,
  // so nothing is lost to a bad id and the create can never FK-throw.
  const chosenMissionId = data.missionId;
  const missionOk = chosenMissionId
    ? await prisma.mission
        .findUnique({ where: { id: chosenMissionId }, select: { id: true } })
        .then((m) => Boolean(m))
        .catch(() => false)
    : false;

  // goalId carries the same hazard: it's an optional FK (Task_goalId_fkey),
  // but the constraint is enforced on INSERT regardless of its onDelete:
  // SetNull. A hallucinated goalId threw P2003 too (proven in prod). Drop an
  // invalid goalId to null — SetNull is exactly the intended semantics — and
  // enrichTaskLinkage re-links it by classification below.
  const chosenGoalId = data.goalId;
  const goalOk = chosenGoalId
    ? await prisma.lifeGoal
        .findUnique({ where: { id: chosenGoalId }, select: { id: true } })
        .then((g) => Boolean(g))
        .catch(() => false)
    : true; // no goalId supplied → nothing to validate

  let safeData = data;
  if (!missionOk) {
    // Dynamic import · avoids the static tasks↔missions cycle (same pattern
    // enrichTaskLinkage uses below).
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    safeData = { ...safeData, missionId: await resolveInboxMissionId() };
  }
  if (!goalOk) {
    safeData = { ...safeData, goalId: null };
  }

  // 2026-07-12 · IDEMPOTENCY GUARD. Model-facing batch creates ("add these 8
  // tasks") duplicated 3-4× in prod: a mid-stream error dropped the tool-call
  // parts (so the verifier flagged the turn "unverified") even though the DB
  // write landed, the operator retried, and every retry re-created the whole
  // batch. Collapse a rapid exact re-create: same normalized title + same due
  // day, not deleted, not DONE, created in the last 10 minutes → return the
  // existing task instead of a duplicate. Only collapses retries; an
  // intentional re-add later (different day / after 10 min) still creates.
  const dupe = await findRecentDuplicateTask(safeData).catch(() => null);
  if (dupe) {
    log.info("task_create_deduped", { existingId: dupe.id, title: dupe.title.slice(0, 60) });
    return dupe;
  }

  const task = await prisma.task.create({ data: safeData });
  void enrichTaskLinkage(task.id);
  return task;
}

/**
 * Find an existing task that a fresh create would duplicate (retry collapse).
 * Match = same case-insensitive trimmed title, same due calendar day (or both
 * undated), still live (not deleted / not DONE), created within 10 minutes.
 * Returns the FULL task row so createTaskAndEnrich's return type is unchanged.
 */
async function findRecentDuplicateTask(
  data: Prisma.TaskUncheckedCreateInput,
): Promise<Task | null> {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (title.length < 2) return null;
  const since = new Date(Date.now() - 10 * 60_000);

  // Same-title live candidates created recently; compare the due day in JS
  // (avoids DB-specific date-truncation SQL).
  const candidates = await prisma.task.findMany({
    where: {
      title: { equals: title, mode: "insensitive" },
      deletedAt: null,
      status: { not: "DONE" },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (candidates.length === 0) return null;

  const newDueDay = data.dueDate ? dayKey(data.dueDate) : null;
  return candidates.find((c) => (c.dueDate ? dayKey(c.dueDate) : null) === newDueDay) ?? null;
}

function dayKey(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * 2026-06-09 · classifier learning signal. When the operator RE-FILES a task
 * into a different mission, log (taskTitle → mission/domain) so the classifier
 * few-shots the operator's own filing patterns (classify-task-linkage
 * .recentExamples). Re-filing INTO the legacy generic Inbox is "un-filing", not
 * a signal → skipped; moves to a specific mission OR a GENERAL anchor teach it.
 * Fire-and-forget · best-effort (table is added in migration 0010).
 */
async function recordTaskClassificationCorrection(args: {
  taskTitle: string;
  newMissionId: string;
}): Promise<void> {
  try {
    const m = await prisma.mission.findUnique({
      where: { id: args.newMissionId },
      select: { title: true, canonicalDomain: true, domain: true },
    });
    if (!m) return;
    const { isInboxMission } = await import("@/lib/services/mission-helpers");
    if (isInboxMission(m.title)) return; // un-filing into the generic Inbox · not a signal
    const { canonicalFromLegacy } = await import("@/lib/missions/domains");
    await prisma.taskClassificationCorrection.create({
      data: {
        taskTitle: args.taskTitle.slice(0, 500),
        chosenMissionId: args.newMissionId,
        domain: m.canonicalDomain ?? canonicalFromLegacy(m.domain),
        createdBy: "user",
      },
    });
  } catch {
    /* best-effort · table may not exist pre-0010 */
  }
}

export async function updateTask(id: string, input: unknown) {
  const payload = taskUpdateSchema.parse(input);

  if (isDemoMode) {
    const state = getDemoState();
    const task = state.tasks.find((candidate) => candidate.id === id);

    if (!task) {
      throw new ServiceError("Task not found.", 404);
    }

    if (payload.missionId && !state.missions.some((mission) => mission.id === payload.missionId)) {
      throw new ServiceError("Mission not found.", 404);
    }

    Object.assign(task, {
      ...payload,
      waitingOn: payload.waitingOn ?? task.waitingOn,
      dueDate: payload.dueDate ?? task.dueDate,
      lastTouchedAt: payload.lastTouchedAt || new Date(),
      manualPriorityOverride: payload.manualPriorityOverride ?? task.manualPriorityOverride,
      autoPriorityExplanation: payload.autoPriorityExplanation ?? task.autoPriorityExplanation,
      updatedAt: new Date()
    });

    await syncTaskPriorities();
    return getTaskById(id);
  }

  const existing = await prisma.task.findUnique({
    where: { id }
  });

  if (!existing) {
    throw new ServiceError("Task not found.", 404);
  }

  if (
    existing.loopKind === "DAILY" &&
    payload.status === "WAITING" &&
    existing.status !== "WAITING" &&
    !payload.lastCompletedAt
  ) {
    payload.lastCompletedAt = new Date();
  }

  if (payload.status === "DONE" || (payload.status === "ARCHIVED" && existing.loopKind === "PROMISE")) {
    const { checkTask } = await import("@/lib/services/task-actions");
    const checkRes = await checkTask({
      id,
      action: payload.status === "ARCHIVED" ? "break" : "complete",
      completionNote: payload.completionNote ?? null,
      outcomeScore: payload.outcomeScore ?? null,
    });
    const updated = await prisma.task.findUnique({
      where: { id },
      include: { mission: true }
    });
    const missions = await prisma.mission.findMany({
      where: activeOnly(),
    });
    return {
      task: updated!,
      vm: buildTaskViewModels(updated ? [updated] : [], missions)[0],
      autoLearn: checkRes.autoLearn,
      reward: checkRes.reward,
    };
  }

  if (payload.missionId) {
    await ensureMissionExists(prisma, payload.missionId);
  }

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const task = await tx.task.update({
      where: { id },
      data: {
        ...payload,
        lastTouchedAt: payload.lastTouchedAt || new Date()
      }
    });

    await syncTaskPriorities(tx);

    const hydrated = await tx.task.findUnique({
      where: { id: task.id },
      include: {
        mission: true
      }
    });
    // v9.1.15 · same fix as getTaskById — soft-delete filter.
    // v10.0.529.106 wave-74 · migrated to activeOnly() helper.
    const missions = await tx.mission.findMany({
      where: activeOnly(),
    });

    return { task, vm: buildTaskViewModels(hydrated ? [hydrated] : [], missions)[0] };
  });

  // v8.0 Phase 2A — log the field-level diff to entity_audits so the
  // brain layer + admin UI can ask "what did Nick change about this
  // task?" Fire-and-forget; logUpdate skips emitting if the diff is
  // empty (idempotent updates don't pollute the log).
  void logUpdate(
    "task",
    id,
    stripNoise(existing as unknown as Record<string, unknown>),
    stripNoise(result.task as unknown as Record<string, unknown>),
    { source: "service:updateTask" },
  );

  if (existing.status === "WAITING" && payload.status && payload.status !== "WAITING") {
    import("@/lib/system/patience-xp").then(m => m.awardPatienceXP(id, existing.updatedAt)).catch(console.error);
  }

  // 2026-06-09 · classifier learning · record a re-file (mission changed to a
  // different one) as a few-shot example for future classification.
  if (payload.missionId && payload.missionId !== existing.missionId) {
    void recordTaskClassificationCorrection({
      taskTitle: result.task.title,
      newMissionId: payload.missionId,
    });
  }

  // Apr 26 · Emit semantic events for state transitions. Determined
  // post-hoc from the diff so we don't need to thread the previous
  // state into every call site.
  const before = existing.status;
  const after = result.task.status;
  // v10.0.529.76 · Wave 21 · auto-learn report attached to the
  // response so /tasks UI can toast the cross-engine wins (Mastery
  // lift · Knowledge insight · Learn tutorial complete). Null when
  // nothing learned · falsy-checked client-side.
  let autoLearnReport: AutoLearnReport | null = null;
  // Wire #2 · set only on a real DONE transition (with the credited XP). Stays
  // undefined for non-completion updates → no reward surfaced.
  let completionReward: TaskReward | undefined;
  if (before !== after) {
    if (after === "DOING") {
      emitTaskEventAsync({ taskId: id, kind: "started", source: "service:updateTask" });
    } else if (after === "WAITING" && existing.loopKind !== "DAILY" && existing.loopKind !== "WEEKLY") {
      emitTaskEventAsync({ taskId: id, kind: "waiting", source: "service:updateTask" });
      const credit = await creditTaskStats(result.task.id).catch((err) => {
        log.warn("task_stat_credit_failed", {
          taskId: result.task.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return { statsCredited: 0, xpCredited: 0 };
      });
      completionReward = {
        xpCredited: credit.xpCredited,
        statsCredited: credit.statsCredited,
        goalLifted: false,
        streak: payload.streakCount ?? null,
      };
    } else if (after === "DONE") {
      emitTaskEventAsync({ taskId: id, kind: "completed", source: "service:updateTask" });
      // v10.0.529.106 · Wave 52 · CRITICAL · pre-Wave-52 this path never
      // emitted task.completed to the brain-bus, only TaskEvent. The
      // /api/tasks/[id]/check route DID emit it. Result: tasks completed
      // via the standard PATCH (the most common path) never landed in
      // BrainMemory task_completion · so the chat query "what did I get
      // done today" missed them. The /check route's identical emit is
      // dedupe-keyed by (taskId, YYYY-MM-DD) so calling from both paths
      // when a task is double-completed is safe. Hydrate the missing
      // fields (mission, loopKind) from the result.task; both are
      // already in the transaction's findUnique scope.
      const hydratedForBus = await prisma.task.findUnique({
        where: { id: result.task.id },
        select: {
          title: true,
          missionId: true,
          loopKind: true,
          mission: { select: { domain: true } },
        },
      });
      if (hydratedForBus) {
        void emitTaskCompleted({
          taskId: id,
          title: hydratedForBus.title ?? "(untitled)",
          missionId: hydratedForBus.missionId ?? null,
          domain: hydratedForBus.mission?.domain ?? null,
          loopKind: hydratedForBus.loopKind ?? "ONCE",
          completedAt: new Date().toISOString(),
        }).catch((err) =>
          log.warn("brain_bus_emit_completed_failed", {
            taskId: id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      // Apr 27 · S3 — Task→Goal lift. When a task with goalId
      // completes, bump the linked goal's currentValue + emit
      // progress_logged. Default delta = 1 (one task = one unit
      // toward the goal). Goals with explicit metric units can
      // override via payload in a future iteration; this default
      // is what makes "0/50000 social_media_interactions" actually
      // tick up as Nour finishes related tasks.
      // 2026-06-01 · credit character-sheet stat XP for EVERY completion
      // (goal-tagged → goal stats · else statHints · else domain inference),
      // scaled by effort/ROI. This is the path that actually moves /stats.
      // Await the credit so the REAL credited XP can ride back on the response
      // for the /missions reward toast. Idempotent per sourceKey (credit still
      // happens exactly once); .catch ⇒ 0 keeps it non-fatal + never fakes XP.
      const credit = await creditTaskStats(result.task.id).catch((err) => {
        log.warn("task_stat_credit_failed", {
          taskId: result.task.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return { statsCredited: 0, xpCredited: 0 };
      });
      completionReward = {
        xpCredited: credit.xpCredited,
        statsCredited: credit.statsCredited,
        goalLifted: !!existing.goalId,
        streak: null,
      };
      // currentValue lift stays goal-only (stat crediting handled above).
      if (existing.goalId) {
        void liftGoalOnTaskComplete(existing.goalId, result.task.id).catch(
          (err) =>
            log.warn("goal_lift_failed", {
              goalId: existing.goalId,
              error: err instanceof Error ? err.message : String(err),
            }),
        );
      }
      // v10.0.529.76 · Wave 21 · auto-learn cross-engine propagation.
      // Mastery (domain-bump) + Knowledge (BrainMemory:task_insight if
      // task reads like a learning) + Learn (BrainMemory:learn_complete
      // if title has a tutorial prefix). Awaited so the autoLearn
      // report can ride back on the PATCH response and the /tasks UI
      // can toast the win. See lib/services/auto-learn.ts.
      try {
        // Hydrate the mission + goal domains for the report. The
        // mission is already on `result.vm`, but goal is not — fetch
        // both with a single roundtrip.
        const enriched = await prisma.task.findUnique({
          where: { id: result.task.id },
          select: {
            title: true,
            finishCondition: true,
            roiScore: true,
            effort: true,
            loopKind: true,
            streakCount: true,
            goalId: true,
            outcomeScore: true,
            completionNote: true,
            mission: { select: { title: true, domain: true } },
            goal: { select: { domain: true } },
          },
        });
        if (enriched) {
          autoLearnReport = await runAutoLearn({
            taskId: result.task.id,
            task: {
              title: enriched.title,
              finishCondition: enriched.finishCondition,
              mission: enriched.mission
                ? { title: enriched.mission.title, domain: enriched.mission.domain }
                : null,
              goal: enriched.goal ? { domain: enriched.goal.domain } : null,
              roiScore: enriched.roiScore,
              effort: enriched.effort,
              loopKind: enriched.loopKind,
              streakCount: enriched.streakCount,
              hasGoalId: !!enriched.goalId,
              outcomeScore: enriched.outcomeScore,
              completionNote: enriched.completionNote,
            },
          });
        }
      } catch (err) {
        log.warn("auto_learn_failed", {
          taskId: result.task.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Apr 27 · P4 — phase progression auto-spawn. When the LAST
      // task of a phase completes, spawn the NEXT phase's tasks so
      // NOW always has the in-flight work surfaced. Skipped when:
      //   · task isn't tied to a phase (phaseName null)
      //   · its mission has no planData
      //   · it's not actually the last task of its phase
      //   · the next phase is already spawned
      if (existing.phaseName && existing.missionId) {
        void maybeSpawnNextPhase(existing.missionId, existing.phaseName).catch(
          (err) =>
            log.warn("phase_progression_failed", {
              missionId: existing.missionId,
              phaseName: existing.phaseName,
              error: err instanceof Error ? err.message : String(err),
            }),
        );
      }
    } else if (after === "ARCHIVED" && before !== "DONE") {
      emitTaskEventAsync({ taskId: id, kind: "abandoned", source: "service:updateTask" });
    } else if ((before === "ARCHIVED" || before === "DONE") && (after === "READY" || after === "INBOX")) {
      emitTaskEventAsync({ taskId: id, kind: "revived", source: "service:updateTask" });
    }
  }
  if (
    payload.title !== undefined ||
    payload.nextPhysicalAction !== undefined ||
    payload.finishCondition !== undefined
  ) {
    emitTaskEventAsync({ taskId: id, kind: "reframed", source: "service:updateTask" });
  }
  if (
    payload.manualPriorityOverride !== undefined &&
    payload.manualPriorityOverride !== existing.manualPriorityOverride
  ) {
    emitTaskEventAsync({
      taskId: id,
      kind: "priority_changed",
      source: "service:updateTask",
      payload: {
        from: existing.manualPriorityOverride,
        to: payload.manualPriorityOverride,
      },
    });
  }
  if (payload.dueDate !== undefined && existing.dueDate?.getTime() !== new Date(payload.dueDate ?? 0).getTime()) {
    const beforeMs = existing.dueDate?.getTime() ?? 0;
    const afterMs = payload.dueDate ? new Date(payload.dueDate).getTime() : 0;
    if (afterMs > beforeMs) {
      emitTaskEventAsync({ taskId: id, kind: "snoozed", source: "service:updateTask" });
    }
  }
  // v9.1.23 · cache invalidation
  invalidateMutationCaches();

  // v10.0.529.76 · Wave 21 · attach the cross-engine auto-learn
  // report onto the vm so the /tasks UI can toast the wins. The vm
  // is structurally-typed already · adding the extra field is safe
  // for JSON serialization and ignored by view-model consumers that
  // don't know about autoLearn yet.
  // Wire 4 · DAILY check-off (status → WAITING, not DONE) skips the DONE-credit
  // block above, so credit its per-day stat XP here (idempotent per-day via the
  // sourceKey) and set the reward — the honest fix for "DAILY shows a streak but
  // earns no XP". goalLifted stays false (DAILY never lifts goal currentValue).
  if (
    completionReward === undefined &&
    isDailyCheckoff(existing.loopKind, payload, existing.lastCompletedAt)
  ) {
    const credit = await creditTaskStats(id, { perDay: true }).catch(() => ({ statsCredited: 0, xpCredited: 0 }));
    completionReward = {
      xpCredited: credit.xpCredited,
      statsCredited: credit.statsCredited,
      goalLifted: false,
      streak: payload.streakCount ?? null,
    };
  }

  if (autoLearnReport) {
    (result.vm as unknown as Record<string, unknown>).autoLearn = autoLearnReport;
  }
  // Wire #2 · attach the reward at runtime (same cast pattern as autoLearn) so
  // the vm type is unchanged — backward-compatible, view-model consumers ignore it.
  if (completionReward) {
    (result.vm as unknown as Record<string, unknown>).reward = completionReward;
  }
  return result.vm;
}

export async function deleteTask(id: string) {
  if (isDemoMode) {
    const state = getDemoState();
    const taskIndex = state.tasks.findIndex((task) => task.id === id);

    if (taskIndex === -1) {
      throw new ServiceError("Task not found.", 404);
    }

    state.tasks.splice(taskIndex, 1);

    return {
      success: true
    };
  }

  try {
    // v7.9: soft-delete preserves the row so brain layer can mine
    // dropped/abandoned task patterns + supports undo.
    const result = await softDelete("task", { id });
    if (!result.ok) {
      throw new ServiceError("Task not found.", 404);
    }
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") {
      throw new ServiceError("Task not found.", 404);
    }
    throw error;
  }
  // v9.1.23 · cache invalidation
  invalidateMutationCaches();

  return {
    success: true
  };
}

/**
 * Apr 27 · S3 — Task→Goal lift hook. When a task with goalId completes,
 * bump the linked goal's currentValue and emit a progress_logged
 * event so PLAN-tab pace + sparkline reflect real velocity.
 *
 * Default delta semantics:
 *   · +1 unit per task completed (the simplest, dumbest baseline)
 *   · respects target ceiling — won't push currentValue past
 *     targetValue unless explicit goal updates override
 *   · auto-flips status to "achieved" when crossing the target
 *
 * Future: read task.payload for explicit `goalDelta` so a single
 * task can contribute N units (e.g. "wrote 1500 words" → +1500
 * toward a 50K word goal). Out of scope for this iteration.
 *
 * Fire-and-forget — never throws. Failures only log.
 */
export async function liftGoalOnTaskComplete(goalId: string, taskId: string): Promise<void> {
  const goal = await prisma.lifeGoal.findUnique({
    where: { id: goalId },
    select: { id: true, currentValue: true, targetValue: true, status: true, achievedAt: true },
  });
  if (!goal) return;

  // 2026-06-01 · stat crediting is now centralized in `creditTaskStats`
  // (called from every completion path: updateTask, checkTask ONCE/PROMISE,
  // checkTask DAILY, and the persist-user-turn fallback). This function is
  // currentValue-only now, so a goal-tagged task credits its stats exactly
  // once regardless of which completion path fired. Never throws.

  // Already done? Skip the lift but still log the event so the
  // brain layer sees the linked-task activity.
  if (goal.status === "achieved") {
    emitGoalEventAsync({
      goalId,
      kind: "progress_logged",
      source: "service:updateTask.goalLift",
      payload: { delta: 0, taskId, note: "goal already achieved" },
    });
    return;
  }
  const delta = 1;
  // 2026-06-01 · idempotency guard. liftGoal is now called from BOTH
  // checkTask (the /check route) and updateTask (the PATCH path); a task
  // re-completed across paths (or a double check-off) would otherwise
  // increment currentValue twice. Claim a one-time marker via the
  // BrainMemory (category,key) unique constraint — create THROWS on a
  // duplicate, so exactly one completion ever lifts this (goal,task).
  // (Stat XP is already idempotent via creditTaskStats' sourceKey.)
  const liftMarked = await prisma.brainMemory
    .create({
      data: {
        category: "goal_lift",
        key: `goal-lift:${goalId}:${taskId}`,
        content: taskId.slice(0, 80),
        source: "goal-lift",
        createdBy: "system",
      },
    })
    .then(() => true)
    .catch(() => false);
  if (!liftMarked) return; // a prior completion already lifted this task

  // Atomic increment — the prior read-then-write (currentValue =
  // goal.currentValue + delta) lost updates when two linked tasks
  // completed concurrently. `{ increment }` is atomic at the DB;
  // progress/status are derived from the value the UPDATE returns.
  // (The old targetValue ceiling-clamp is dropped — currentValue may
  // briefly sit a hair past targetValue under concurrency; progress
  // still caps at 100 and status flips to achieved either way.)
  const lifted = await prisma.lifeGoal.update({
    where: { id: goalId },
    data: { currentValue: { increment: delta } },
    select: { currentValue: true, targetValue: true, status: true },
  });
  const after = lifted.currentValue;
  const reachedTarget = lifted.targetValue > 0 && after >= lifted.targetValue;
  if (lifted.targetValue > 0) {
    const post: Record<string, unknown> = {
      progress: Math.min(100, Math.round((after / lifted.targetValue) * 100)),
    };
    if (reachedTarget && lifted.status !== "achieved") {
      post.status = "achieved";
      post.achievedAt = new Date();
    }
    await prisma.lifeGoal.update({ where: { id: goalId }, data: post });
  }
  emitGoalEventAsync({
    goalId,
    kind: "progress_logged",
    source: "service:updateTask.goalLift",
    payload: {
      delta,
      before: goal.currentValue,
      after,
      target: lifted.targetValue,
      taskId,
    },
  });
  if (reachedTarget && lifted.status !== "achieved") {
    emitGoalEventAsync({ goalId, kind: "achieved", source: "service:updateTask.goalLift" });
  }
}

/**
 * Apr 27 · P4 — phase progression auto-spawn.
 *
 * When the last open task of a phase completes, spawn the NEXT
 * phase's tasks so NOW always shows the next step in the journey.
 * Idempotent (uses the same taskId back-references the spawn
 * endpoint writes), fault-tolerant (failures only log).
 *
 * Triggers from the task-completion hook above. Reads mission.planData
 * directly to keep the call site cheap — one query for tasks, one
 * for the mission, one upsert for the new tasks.
 *
 * Skipped when:
 *   · the task isn't bound to a phase (phaseName is null)
 *   · the mission has no planData
 *   · the phase has other open tasks (not last to complete)
 *   · the next phase already has spawned tasks
 *   · this is the final phase (no next phase)
 */
export async function maybeSpawnNextPhase(missionId: string, phaseName: string): Promise<void> {
  // 1. Are there any other open tasks in this phase? If yes, the
  //    current task isn't the "last" — bail.
  const openInPhase = await prisma.task.count({
    where: {
      missionId,
      phaseName,
      status: { in: ["INBOX", "READY", "DOING", "WAITING"] },
    },
  });
  if (openInPhase > 0) return;

  // 2. Load the mission's plan
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: { planData: true },
  });
  if (!mission) return;
  const plan = mission.planData as unknown;
  if (!isProjectPlanData(plan)) return;

  // 3. Find the index of this phase + the next un-spawned phase
  const phaseIdx = plan.phases.findIndex((p) => p.name === phaseName);
  if (phaseIdx === -1 || phaseIdx >= plan.phases.length - 1) return;
  const nextPhase = plan.phases[phaseIdx + 1];
  if (!nextPhase || !nextPhase.steps || nextPhase.steps.length === 0) return;

  // If the next phase already has any spawned tasks, skip — we
  // don't want to double-spawn after a phase rollback or partial.
  const alreadySpawned = nextPhase.steps.filter((s) => s.taskId).length;
  if (alreadySpawned > 0) return;

  // Verify those taskIds actually exist (handle deleted-task edge)
  // — empty result list, so we're clear to spawn.

  // 4. Spawn the next phase's steps + write back taskIds.
  const updatedPlan: ProjectPlanData = JSON.parse(JSON.stringify(plan)) as ProjectPlanData;
  const updatedSteps: ProjectStep[] = [];
  // v9.1.24 · transactional spawn. Without this, a crash between the
  // last task.create and the mission.update would leave the spawned
  // tasks orphaned (no taskId in planData → next call sees
  // alreadySpawned=0 and re-spawns, producing duplicates). Wrap the
  // whole loop + final mission update in a transaction so EITHER
  // every task gets created AND planData reflects it, OR nothing
  // changes.
  const taskEventsToEmit: Array<{ taskId: string; phaseIndex: number }> = [];
  await prisma.$transaction(async (tx) => {
    for (const step of nextPhase.steps) {
      if (step.taskId) {
        updatedSteps.push(step);
        continue;
      }
      const created = await tx.task.create({
        data: {
          title: step.title,
          missionId,
          status: "READY",
          nextPhysicalAction: step.nextAction || step.title,
          effort: normalizeEffortValue(step.effort) as never,
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
          phaseName: nextPhase.name,
          lastTouchedAt: new Date(),
        },
        select: { id: true },
      });
      // Defer event emission until after the transaction commits —
      // emitTaskEventAsync is fire-and-forget but still touches DB,
      // and emitting from inside a transaction can reference rows
      // that aren't yet visible to other connections.
      taskEventsToEmit.push({ taskId: created.id, phaseIndex: phaseIdx + 1 });
      updatedSteps.push({ ...step, taskId: created.id });
    }
    updatedPlan.phases[phaseIdx + 1] = { ...nextPhase, steps: updatedSteps };
    updatedPlan.updatedAt = new Date().toISOString();
    await tx.mission.update({
      where: { id: missionId },
      data: { planData: updatedPlan as unknown as object },
    });
  });
  // Post-commit: emit events + gap-fill linkage (classification spine ·
  // spawned tasks inherit the parent mission but no goal/stats — enrich
  // fills goalId/statHints; compare-and-set leaves the inherited mission).
  for (const evt of taskEventsToEmit) {
    emitTaskEventAsync({
      taskId: evt.taskId,
      kind: "created",
      source: "service:phase-progression",
      payload: {
        projectId: missionId,
        phase: nextPhase.name,
        phaseIndex: evt.phaseIndex,
        triggeredBy: "previous-phase-complete",
      },
    });
    void enrichTaskLinkage(evt.taskId);
  }
  log.info("phase_progression", {
    missionId,
    finishedPhase: phaseName,
    spawnedPhase: nextPhase.name,
    spawnedSteps: updatedSteps.filter((s) => s.taskId).length,
  });
}

const VALID_EFFORT_BANDS = ["M5", "M15", "M30", "H1", "H2PLUS"] as const;
function normalizeEffortValue(raw: string | undefined): string {
  if (!raw) return "M30";
  const upper = raw.toUpperCase();
  if ((VALID_EFFORT_BANDS as readonly string[]).includes(upper)) return upper;
  if (upper === "H2" || upper === "H4" || upper === "H8") return "H2PLUS";
  return "M30";
}
