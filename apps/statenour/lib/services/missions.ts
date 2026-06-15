import { Prisma, type PrismaClient } from "@prisma/client";
const { PrismaClientKnownRequestError } = Prisma;

import { getDemoState, makeDemoId, type DemoMission, type DemoTask } from "@/lib/demo-store";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/runtime";
import { rankMissions } from "@/lib/scoring/mission-ranking";
import { syncTaskPriorities } from "@/lib/services/tasks";
import { serializeForJson } from "@/lib/utils/serialize";
import { ServiceError } from "@/lib/utils/service-error";
import { missionCreateSchema, missionUpdateSchema } from "@/lib/validators/missions";
import { softDelete, softDeleteMany, activeOnly } from "@/lib/db/soft-delete";
import type { MissionDomain } from "@prisma/client";
import {
  CANONICAL_DOMAIN_KEYS,
  anchorTitleFor,
  legacyDomainFor,
  GENERAL_ANCHOR_KIND,
  type CanonicalDomain,
} from "@/lib/missions/domains";
import { logCreate, logUpdate, stripNoise } from "@/lib/db/entity-audit";
import { invalidate } from "@/lib/utils/cache";
// v10.0.174 · isInboxMission import removed when assertActiveMissionCap
// became a no-op. If a future cap is restored that needs to filter
// inboxes, re-import from "@/lib/services/mission-helpers".

// v9.1.23 · cache invalidation hook (matches tasks.ts pattern).
function invalidateMutationCaches(): void {
  invalidate("dashboard_brief");
  invalidate("ultron_command_center_state_v1");
}

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Active-project cap · history of decisions:
 *   · Original (pre-v10.0.154): hard cap of 3 ("focus discipline")
 *   · v10.0.154: Inbox missions excluded from the count
 *   · v10.0.172: cap raised from 3 → 5 after operator hit the wall
 *   · v10.0.174: cap REMOVED entirely. Operator made the call —
 *     "I don't want a limit." Function is now a no-op kept for
 *     callsite compatibility (createMission + updateMission still
 *     await it). If a future cap is needed, restore the body.
 */
async function assertActiveMissionCap(
  _db: DbClient,
  _currentMissionId?: string,
): Promise<void> {
  // Intentional no-op. The operator owns the focus-discipline call;
  // the system does not impose one.
  void _db;
  void _currentMissionId;
}

function decorateMissions(
  missions: Array<DemoMission & { tasks: Array<Pick<DemoTask, "id" | "status">> }>
) {
  const serialized = serializeForJson(missions);
  const ranking = rankMissions(serialized);
  const rankMap = new Map(ranking.rankedMissions.map((mission) => [mission.id, mission]));

  return (serialized as Array<DemoMission & { tasks: Array<Pick<DemoTask, "id" | "status">> }>).map((mission) => {
    const rank = rankMap.get(mission.id);
    return {
      ...mission,
      rank: rank?.rank || null,
      rankScore: rank?.rankScore || null,
      rankExplanation: rank?.explanation || null,
      openTaskCount: mission.tasks.filter((task: Pick<DemoTask, "id" | "status">) => !["DONE", "ARCHIVED"].includes(task.status)).length
    };
  });
}

export async function listMissions() {
  if (isDemoMode) {
    const state = getDemoState();
    const missions = [...state.missions]
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status.localeCompare(right.status);
        }

        return right.updatedAt.getTime() - left.updatedAt.getTime();
      })
      .map((mission) => ({
        ...mission,
        tasks: state.tasks
          .filter((task) => task.missionId === mission.id)
          .map((task) => ({
            id: task.id,
            status: task.status
          }))
      }));

    return decorateMissions(missions);
  }

  const missions = await prisma.mission.findMany({
    where: activeOnly(), // v7.9 — hide soft-deleted · v10.0.529.106 wave-74 · helper
    include: {
      tasks: {
        where: activeOnly(), // hide tasks of deleted missions
        select: {
          id: true,
          status: true
        }
      }
    },
    orderBy: [
      {
        status: "asc"
      },
      {
        updatedAt: "desc"
      }
    ]
  });

  return decorateMissions(missions);
}

export async function getMissionById(id: string) {
  if (isDemoMode) {
    const state = getDemoState();
    const mission = state.missions.find((candidate) => candidate.id === id);

    if (!mission) {
      return null;
    }

    const tasks = state.tasks
      .filter((task) => task.missionId === id)
      .sort((left, right) => {
        const leftPriority = left.autoPriority || 0;
        const rightPriority = right.autoPriority || 0;

        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }

        const leftDue = left.dueDate ? left.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
        const rightDue = right.dueDate ? right.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue;
      })
      .map((task) => ({
        ...task,
        mission
      }));

    return serializeForJson({
      ...mission,
      tasks
    });
  }

  // v9.1.23 · added deletedAt filter to BOTH the mission and its
  // tasks include. Without these, getMissionById was returning
  // soft-deleted missions + their soft-deleted tasks — defeating
  // the v7.9 universal soft-delete contract for any caller that
  // looked up a mission by id.
  const mission = await prisma.mission.findFirst({
    where: activeOnly({ id }),
    include: {
      tasks: {
        where: activeOnly(),
        include: {
          mission: true,
        },
        orderBy: [
          {
            autoPriority: "desc",
          },
          {
            dueDate: "asc",
          },
        ],
      },
    },
  });

  if (!mission) {
    return null;
  }

  return serializeForJson(mission);
}

export async function getMissionRanking() {
  if (isDemoMode) {
    return rankMissions(serializeForJson(getDemoState().missions));
  }

  const missions = await prisma.mission.findMany({
    where: activeOnly({
      status: "ACTIVE", // v7.9 — ranking only sees alive missions
    })
  });

  return rankMissions(serializeForJson(missions));
}

export async function createMission(input: unknown, tx?: Prisma.TransactionClient) {
  const payload = missionCreateSchema.parse(input);

  if (isDemoMode) {
    const state = getDemoState();

    if (payload.status === "ACTIVE") {
      const activeCount = state.missions.filter((mission) => mission.status === "ACTIVE").length;

      if (activeCount >= 3) {
        throw new ServiceError("Only 3 active missions are allowed at once.", 400);
      }
    }

    const now = new Date();
    const mission: DemoMission = {
      id: makeDemoId("mission"),
      title: payload.title,
      domain: payload.domain,
      status: payload.status,
      priority: payload.priority,
      roiScore: payload.roiScore,
      neglectCost: payload.neglectCost,
      successMetric: payload.successMetric || null,
      deadline: payload.deadline || null,
      weeklyReviewNote: payload.weeklyReviewNote || null,
      manualRankOverride: payload.manualRankOverride ?? null,
      createdAt: now,
      updatedAt: now
    };

    state.missions.push(mission);
    await syncTaskPriorities();
    return serializeForJson(mission);
  }

  // Core transactional write. Runs on the caller's `tx` when one is
  // supplied (convertCaptureItem makes the mission-create + capture
  // update atomic), otherwise in its own transaction.
  const runCore = async (client: Prisma.TransactionClient) => {
    if (payload.status === "ACTIVE") {
      await assertActiveMissionCap(client);
    }

    const mission = await client.mission.create({
      // payload.planData is `unknown` after validator (kept permissive
      // since ProjectPlanData is a deep nested type owned elsewhere);
      // Prisma's JSON column accepts InputJsonValue. Cast at the
      // boundary to keep the validator simple.
      data: payload as Prisma.MissionCreateInput
    });

    await syncTaskPriorities(client);
    return mission;
  };
  const created = tx ? await runCore(tx) : await prisma.$transaction(runCore);

  // v8.0 Phase 2A — log create.
  void logCreate("mission", created.id, created as unknown as Record<string, unknown>, {
    source: "service:createMission",
  });
  // v9.1.23 · cache invalidation
  invalidateMutationCaches();

  return serializeForJson(created);
}

export async function updateMission(id: string, input: unknown) {
  const payload = missionUpdateSchema.parse(input);

  if (isDemoMode) {
    const state = getDemoState();
    const mission = state.missions.find((candidate) => candidate.id === id);

    if (!mission) {
      throw new ServiceError("Mission not found.", 404);
    }

    const nextStatus = payload.status || mission.status;

    if (nextStatus === "ACTIVE") {
      const activeCount = state.missions.filter((candidate) => candidate.status === "ACTIVE" && candidate.id !== id).length;

      if (activeCount >= 3) {
        throw new ServiceError("Only 3 active missions are allowed at once.", 400);
      }
    }

    Object.assign(mission, {
      ...payload,
      successMetric: payload.successMetric ?? mission.successMetric,
      deadline: payload.deadline ?? mission.deadline,
      weeklyReviewNote: payload.weeklyReviewNote ?? mission.weeklyReviewNote,
      manualRankOverride: payload.manualRankOverride ?? mission.manualRankOverride,
      updatedAt: new Date()
    });

    await syncTaskPriorities();
    return serializeForJson(mission);
  }

  const existing = await prisma.mission.findUnique({
    where: { id }
  });

  if (!existing) {
    throw new ServiceError("Mission not found.", 404);
  }

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const nextStatus = payload.status || existing.status;

    if (nextStatus === "ACTIVE") {
      await assertActiveMissionCap(tx, id);
    }

    const mission = await tx.mission.update({
      where: { id },
      // See createMission note re: planData/JSON column boundary cast.
      data: payload as Prisma.MissionUpdateInput
    });

    await syncTaskPriorities(tx);
    return mission;
  });

  // v8.0 Phase 2A — entity-audit diff log.
  void logUpdate(
    "mission",
    id,
    stripNoise(existing as unknown as Record<string, unknown>),
    stripNoise(result as unknown as Record<string, unknown>),
    { source: "service:updateMission" },
  );
  // v9.1.23 · cache invalidation
  invalidateMutationCaches();

  return serializeForJson(result);
}

export async function deleteMission(id: string) {
  if (isDemoMode) {
    const state = getDemoState();
    const missionIndex = state.missions.findIndex((mission) => mission.id === id);

    if (missionIndex === -1) {
      throw new ServiceError("Mission not found.", 404);
    }

    state.missions.splice(missionIndex, 1);
    state.tasks = state.tasks.filter((task) => task.missionId !== id);

    return {
      success: true
    };
  }

  try {
    // v7.9: soft-delete preserves the row + cascades hidden via the
    // task service's active-only default filter.
    const result = await softDelete("mission", { id });
    if (!result.ok) {
      throw new ServiceError("Mission not found.", 404);
    }
    // Cascade: also soft-delete all tasks pointing at this mission so
    // they disappear from list views without orphaning their FK.
    await softDeleteMany("task", { missionId: id });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") {
      throw new ServiceError("Mission not found.", 404);
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
 * v10.0.529.99 · Wave 43 · canonical inbox-resolver. Pre-Wave-43 four
 * sites hardcoded `missionId: "m-inbox"` as a string literal (Telegram
 * /task · nour-os bridge open_loop · journal-ingest · etc.). If the
 * "m-inbox" row is ever deleted, all four silently fail (FK violation).
 *
 * This helper:
 *   1. Looks for mission id="m-inbox" (the canonical seeded id)
 *   2. Falls back to any active mission titled "Inbox"
 *   3. As a last resort, creates one with id="m-inbox" + title="Inbox"
 *
 * Cached in module scope · single round-trip per cold-start.
 */
let _cachedInboxId: string | null = null;

export async function resolveInboxMissionId(): Promise<string> {
  if (_cachedInboxId) return _cachedInboxId;

  // 1. Canonical seeded id
  const seeded = await prisma.mission
    .findUnique({ where: { id: "m-inbox" }, select: { id: true, deletedAt: true } })
    .catch(() => null);
  if (seeded && !seeded.deletedAt) {
    _cachedInboxId = seeded.id;
    return _cachedInboxId;
  }

  // 2. Fallback by title
  const byTitle = await prisma.mission
    .findFirst({
      where: activeOnly({ title: "Inbox", status: "ACTIVE" }),
      select: { id: true },
    })
    .catch(() => null);
  if (byTitle) {
    _cachedInboxId = byTitle.id;
    return _cachedInboxId;
  }

  // 3. Create fresh · use the canonical "m-inbox" id so future lookups
  // hit the fast path. Catch the rare race where two requests both
  // create simultaneously (P2002 unique violation) by retrying the
  // read-by-id afterwards. Schema requires title + domain + priority +
  // roiScore + neglectCost · seed conservative values.
  try {
    const created = await prisma.mission.create({
      data: {
        id: "m-inbox",
        title: "Inbox",
        successMetric: "Catch-all for quick captures · sorted into projects later.",
        domain: "PERSONAL",
        status: "ACTIVE",
        priority: 50,
        roiScore: 50,
        neglectCost: 50,
      },
      select: { id: true },
    });
    _cachedInboxId = created.id;
    return _cachedInboxId;
  } catch {
    // Race · another request created it · re-read
    const retry = await prisma.mission
      .findUnique({ where: { id: "m-inbox" }, select: { id: true } })
      .catch(() => null);
    if (retry) {
      _cachedInboxId = retry.id;
      return _cachedInboxId;
    }
    throw new ServiceError("Failed to resolve Inbox mission", 500);
  }
}

// ── GENERAL anchor missions · 2026-06-09 ───────────────────────────────────
// The 6 system-managed per-domain catch-alls (the classifier's fallback when
// no specific mission fits). Identified by systemKind="GENERAL" (NOT by name —
// the legacy Inbox name-regex was fragile). find-or-create with canonical id
// `m-general-<domain>` so future lookups are fast. Defensive: if migration
// 0010 (system_kind/canonical_domain columns) isn't applied yet, the create
// throws → caught → returns null so enrichTaskLinkage falls back to the Inbox.
const _generalAnchorCache = new Map<string, string>();

export async function resolveGeneralAnchorId(
  domain: CanonicalDomain,
): Promise<string | null> {
  const cached = _generalAnchorCache.get(domain);
  if (cached) return cached;
  const id = `m-general-${domain}`;
  try {
    const found = await prisma.mission.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (found && !found.deletedAt) {
      _generalAnchorCache.set(domain, found.id);
      return found.id;
    }
    const created = await prisma.mission.create({
      data: {
        id,
        title: anchorTitleFor(domain),
        successMetric: `Catch-all for ${domain} tasks with no specific project.`,
        domain: legacyDomainFor(domain) as MissionDomain, // legacy enum placeholder
        canonicalDomain: domain,
        systemKind: GENERAL_ANCHOR_KIND,
        status: "ACTIVE",
        priority: 50,
        roiScore: 50,
        neglectCost: 50,
      },
      select: { id: true },
    });
    _generalAnchorCache.set(domain, created.id);
    return created.id;
  } catch {
    // Race (another request created it) OR columns not migrated yet.
    const retry = await prisma.mission
      .findUnique({ where: { id }, select: { id: true } })
      .catch(() => null);
    if (retry) {
      _generalAnchorCache.set(domain, retry.id);
      return retry.id;
    }
    return null; // caller falls back to the Inbox
  }
}

/** Idempotently ensure all 6 GENERAL anchors exist. Returns their ids. */
export async function seedGeneralAnchors(): Promise<Array<string | null>> {
  return Promise.all(CANONICAL_DOMAIN_KEYS.map((d) => resolveGeneralAnchorId(d)));
}

/** Test/admin helper · clears the in-memory cache. */
export function _resetInboxCache(): void {
  _generalAnchorCache.clear();
  _cachedInboxId = null;
}
