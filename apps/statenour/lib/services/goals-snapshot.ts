/**
 * lib/services/goals-snapshot.ts · Phase A.1 (2026-05-17)
 *
 * Single source of truth for the /goals page payload.
 * Composes the LADDER (LifeGoal grouped by horizon · Day hero) +
 * SIDEBAR (8-axis mastery scores + active missions) +
 * PRUNER candidates (Nick-flagged stale goals) in one round trip
 * so the page hydrates fast without N+1 fetches.
 *
 * Per ADR-0010 · Wave-200 Phase A.1 · merged /plan + /mastery
 * graveyard rebuild.
 *
 * Data sources (all read-only):
 *   · LifeGoal · grouped by horizon (DAY|WEEK|MONTH|QUARTER|YEAR|LIFE)
 *   · Mission · status=ACTIVE · sorted by priority+ROI desc
 *   · MasteryScore · latest row per domain · last 7-day delta
 *   · BrainMemory(category="goal_prune_candidate") · Nick's stale flags
 *   · GoalEvent · last 7d count per goal for activity heatmap
 *
 * Performance budget: <500ms typical · single Postgres roundtrip via
 * Promise.all · no AI calls · no bridge hits.
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("services/goals-snapshot");

// ── Public shapes ──────────────────────────────────────────────────

export type GoalHorizon = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "LIFE";

export interface GoalRow {
  id: string;
  title: string;
  domain: string;
  horizon: GoalHorizon | null;
  metric: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number; // 0-100
  status: string;
  deadline: string | null;
  why: string | null;
  /** Whether Nick has flagged this goal as a pruning candidate */
  pruneCandidate: boolean;
  /** Days since the most recent GoalEvent (activity proxy) */
  daysSinceActivity: number | null;
  /** Count of linked open tasks */
  openTaskCount: number;
}

export interface MissionRow {
  id: string;
  title: string;
  domain: string;
  status: string;
  priority: number;
  roiScore: number;
  neglectCost: number;
  successMetric: string | null;
  deadline: string | null;
  openTaskCount: number;
}

export interface AxisScore {
  /** The mastery domain key · maps 1:1 to scoreboard label */
  domain: string;
  score: number;
  /** Delta vs 7 days ago · positive = improving */
  delta7d: number;
  /** ISO date of the latest score row */
  asOf: string;
}

export interface GoalsSnapshot {
  ladder: {
    DAY: GoalRow[];
    WEEK: GoalRow[];
    MONTH: GoalRow[];
    QUARTER: GoalRow[];
    YEAR: GoalRow[];
    LIFE: GoalRow[];
    UNSCOPED: GoalRow[]; // goals with null horizon (back-compat)
  };
  missions: MissionRow[];
  axes: AxisScore[];
  pruneCandidates: number; // count for header badge
  fetchedAt: string;
}

// ── Composition ─────────────────────────────────────────────────────

const HORIZONS: readonly GoalHorizon[] = [
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
  "LIFE",
];

function daysSince(date: Date | null | undefined): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
}

export async function buildGoalsSnapshot(): Promise<GoalsSnapshot> {
  // Single round-trip · Promise.all over independent reads
  const [
    goals,
    missions,
    latestScoresPerDomain,
    weekAgoScoresPerDomain,
    pruneCandidateRows,
    goalEventCounts,
  ] = await Promise.all([
    prisma.lifeGoal.findMany({
      where: activeOnly({ status: { in: ["active", "in_progress", "achieved"] } }),
      orderBy: [{ horizon: "asc" }, { progress: "desc" }, { updatedAt: "desc" }],
      include: {
        _count: {
          select: {
            tasks: {
              where: { deletedAt: null, status: { in: ["INBOX", "READY", "DOING"] } },
            },
          },
        },
      },
    }),
    prisma.mission.findMany({
      where: activeOnly({ status: "ACTIVE" }),
      orderBy: [{ priority: "desc" }, { roiScore: "desc" }],
      take: 12,
      include: {
        _count: {
          select: {
            tasks: {
              where: { deletedAt: null, status: { in: ["INBOX", "READY", "DOING"] } },
            },
          },
        },
      },
    }),
    // Latest MasteryScore per domain · use Prisma groupBy for the
    // max(date) lookup, then a single findMany for the actual rows.
    // Avoids raw SQL column-name brittleness (model uses created_at
    // mapped from createdAt etc). 2026-05-18 fix.
    prisma.masteryScore
      .findMany({ orderBy: { date: "desc" }, take: 200 })
      .then((rows) => {
        // Reduce to latest-per-domain in memory
        const latest = new Map<string, typeof rows[number]>();
        for (const r of rows) {
          if (!latest.has(r.domain)) latest.set(r.domain, r);
        }
        return Array.from(latest.values()).map((r) => ({
          domain: r.domain,
          score: Number(r.score),
          date: r.date,
        }));
      }),
    // Same but 7 days ago for delta calculation. Cheap memory filter
    // over the same recent rows (already paged in above query).
    prisma.masteryScore
      .findMany({
        where: {
          date: {
            lte: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
          },
        },
        orderBy: { date: "desc" },
        take: 200,
      })
      .then((rows) => {
        const latest = new Map<string, typeof rows[number]>();
        for (const r of rows) {
          if (!latest.has(r.domain)) latest.set(r.domain, r);
        }
        return Array.from(latest.values()).map((r) => ({
          domain: r.domain,
          score: Number(r.score),
          date: r.date,
        }));
      }),
    prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.GOAL_PRUNE_CANDIDATE,
        deletedAt: null,
      },
      select: { key: true },
    }),
    // Most recent GoalEvent per goal for activity recency
    // 2026-05-18 fix · table maps to snake_case "goal_events" via
    // @@map("goal_events") · same for column names (camelCase model
    // fields map to snake_case columns). Use Prisma's safer groupBy
    // to avoid raw-SQL column-naming brittleness.
    prisma.goalEvent
      .groupBy({ by: ["goalId"], _max: { createdAt: true } })
      .then((rows) =>
        rows.map((r) => ({
          goalId: r.goalId,
          lastEvent: (r._max.createdAt ?? new Date(0)) as Date,
        })),
      ),
  ]).catch((err) => {
    log.warn("snapshot_query_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    throw err;
  });

  // Index lookups for O(1) access during composition
  const pruneSet = new Set(pruneCandidateRows.map((r) => r.key));
  const eventByGoal = new Map<string, Date>(
    goalEventCounts.map((r) => [r.goalId, r.lastEvent]),
  );
  const week7Map = new Map<string, number>(
    weekAgoScoresPerDomain.map((r) => [r.domain, Number(r.score)]),
  );

  // Group goals by horizon · null → UNSCOPED bucket
  const ladder: GoalsSnapshot["ladder"] = {
    DAY: [],
    WEEK: [],
    MONTH: [],
    QUARTER: [],
    YEAR: [],
    LIFE: [],
    UNSCOPED: [],
  };

  for (const g of goals) {
    const row: GoalRow = {
      id: g.id,
      title: g.title,
      domain: g.domain,
      horizon: HORIZONS.includes(g.horizon as GoalHorizon)
        ? (g.horizon as GoalHorizon)
        : null,
      metric: g.metric,
      targetValue: g.targetValue,
      currentValue: g.currentValue,
      unit: g.unit,
      progress: g.progress,
      status: g.status,
      deadline: g.deadline?.toISOString() ?? null,
      why: g.why,
      pruneCandidate: pruneSet.has(g.id),
      daysSinceActivity: daysSince(eventByGoal.get(g.id) ?? g.updatedAt),
      openTaskCount: g._count.tasks,
    };
    const bucket = (row.horizon ?? "UNSCOPED") as keyof typeof ladder;
    ladder[bucket].push(row);
  }

  const missionsOut: MissionRow[] = missions.map((m) => ({
    id: m.id,
    title: m.title,
    domain: m.domain as string,
    status: m.status as string,
    priority: m.priority,
    roiScore: m.roiScore,
    neglectCost: m.neglectCost,
    successMetric: m.successMetric,
    deadline: m.deadline?.toISOString() ?? null,
    openTaskCount: m._count.tasks,
  }));

  const axes: AxisScore[] = latestScoresPerDomain.map((r) => {
    const prior = week7Map.get(r.domain) ?? Number(r.score);
    return {
      domain: r.domain,
      score: Number(r.score),
      delta7d: Math.round((Number(r.score) - prior) * 100) / 100,
      asOf: r.date,
    };
  });

  return {
    ladder,
    missions: missionsOut,
    axes,
    pruneCandidates: pruneSet.size,
    fetchedAt: new Date().toISOString(),
  };
}
