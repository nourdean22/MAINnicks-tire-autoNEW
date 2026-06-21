/**
 * Command-center state · v9.0-alpha · Apr 30.
 *
 * Single typed read of the operator's full operating context. Composed
 * from existing primitives — no new tables. Every field is a query
 * against a model that already exists, so this lands without schema
 * change and with low blast radius.
 *
 * Consumers:
 *   · /api/command-center/state — HTTP surface (next-step UI fetch)
 *   · lib/ai/context/nick-prime-context.ts — server-side direct call,
 *     so AI assembly doesn't pay an HTTP round-trip.
 *
 * Discipline: this module ONLY reads. Never writes. If a future caller
 * needs to mutate command state, that caller writes via its own service
 * (Task service, Decision service, etc.) and the state endpoint just
 * reflects.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { MONTHLY_REVENUE_TARGET } from "@/lib/config/business";
import { DOMAINS } from "@/lib/mastery/config";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { cached } from "@/lib/utils/cache";

// ── Summaries (every shape stays small + JSON-friendly) ─────────────

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  priority: string; // critical · high · medium · low (derived from autoPriority)
  domain: string;
  effort: string | null;
  energyRequired: string | null;
  context: string | null;
  startedAt: string | null;
  lastTouchedAt: string | null;
  dueDate: string | null;
}

export interface CommitmentSummary {
  id: string;
  description: string;
  toWhom: string;
  status: string;
  deadline: string | null;
  domain: string | null;
}

export interface ScheduledActionSummary {
  id: string;
  actionType: string;
  scheduledFor: string;
  status: string;
}

/** v9.1.4 · Active Mission (project) summary for the prompt. */
export interface MissionSummary {
  id: string;
  title: string;
  domain: string;
  priority: number;
  successMetric: string | null;
}

/** v9.1.4 · Active LifeGoal summary for the prompt. */
export interface GoalSummary {
  id: string;
  title: string;
  domain: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number; // 0-100
  horizon: string | null;
  daysToDeadline: number | null;
}

/** v9.1.5 · Recent BrainDump summary — what Nour was thinking lately. */
export interface BrainDumpSummary {
  id: string;
  date: string;
  summary: string | null;
  /** First 200 chars of rawThoughts when summary is missing. */
  excerpt: string;
  moodBefore: string | null;
  moodAfter: string | null;
  actionsTaken: number;
  createdAt: string;
}

/** v9.1.5 · Reflection summary — Nick's own pattern observations. */
export interface ReflectionSummary {
  id: string;
  date: string;
  scope: string; // daily/weekly/monthly/triggered
  category: string;
  insight: string;
  confidence: number;
  actionable: boolean;
  acknowledged: boolean;
  createdAt: string;
}

/** v9.1.8 · Pinned brain memory — Nour's permanent context slots. */
export interface PinnedMemorySummary {
  key: string;
  content: string;
  source: string | null;
  seenCount: number;
  updatedAt: string;
}

/** v9.1.8 · Top hard-rule brain memory (identity/feedback/brand). */
export interface BrainRuleSummary {
  category: string;
  key: string;
  content: string;
  confidence: number;
}

/** v9.1.9 · Mastery score snapshot — one per domain. */
export interface MasteryDomainScore {
  domain: string;
  label: string;
  score: number;
  baseline: number;
}

/**
 * v9.1.9 · Domain snapshot — the live, shop-facing operational state.
 * Revenue, savings rate, mastery scores. Replaces v1's "Live domain
 * snapshot" + "Mastery" + "LIVE METRICS" inline blocks.
 */
export interface DomainSnapshot {
  business: {
    monthlyRevenueTarget: number;
    /** Most recent business revenue snapshot value (USD). */
    latestRevenue: number | null;
    /** As-of date for the financial snapshot. */
    asOf: string | null;
    savingsRatePct: number | null;
    netWorthEstimate: number | null;
    moneyScore: number | null;
  };
  mastery: MasteryDomainScore[];
}

/**
 * v9.1.10 · Temporal context — current time bucket, day of week,
 * weekend flag, and (when set) Nour's 3 weekly targets. Drives the
 * "TIME-AWARE GUIDANCE" + "WEEKLY RHYTHM" + "THIS WEEK'S TARGETS"
 * sections that v1 carried inline.
 */
export interface TemporalContext {
  /** "Mon" / "Tue" / etc. — short day name. */
  dayName: string;
  /** "Monday" / "Tuesday" / etc. — full day name. */
  dayNameLong: string;
  /** ISO date string YYYY-MM-DD in Nour's tz (ET). */
  todayISO: string;
  /** Hour 0-23 in ET. */
  currentHour: number;
  /** v9.1.12 · Single source of truth for the bucket name; matches
   *  operatorState.timeOfDay. Renderer reads this instead of
   *  re-deriving from currentHour. */
  bucket: "late" | "morning" | "midday" | "afternoon" | "evening";
  isWeekend: boolean;
  /** ISO week-start "YYYY-MM-DD" key (Monday). */
  weekKey: string;
  /** Three target slots — null when not set this week. */
  weeklyTargets: {
    revenue: string | null;
    personal: string | null;
    health: string | null;
  } | null;
  /** Raw text fallback when weekly_target row exists but no structured metadata. */
  weeklyTargetsRaw: string | null;
}

export interface MasteryDecisionSummary {
  id: number;
  title: string;
  date: string;
  domain: string | null;
  grade: string | null;
  reviewDate: string | null;
  hasOutcome: boolean;
}

export interface DriftAlertSummary {
  id: string | number;
  ruleName: string;
  severity: string;
  message: string;
  createdAt: string;
}

export interface BrainAlertSummary {
  category: string;
  content: string;
  createdAt: string;
}

export interface ProofRollup {
  tasksDone: number;
  /** v9.0-rc · subset of tasksDone with non-empty `proof` JSON. */
  tasksDoneWithProof: number;
  autonomousActionsOk: number;
  cronRunsOk: number;
  cronRunsFailed: number;
}

/**
 * v9.0-rc · `noProofDay` is the named risk that fires when a busy day
 * (≥3 DONE tasks) closes with zero proof attachments. Soft signal —
 * surfaced to operator + AI; nothing blocks completion.
 */
export interface NoProofDayRisk {
  fired: boolean;
  tasksDone: number;
  withProof: number;
  reason: string;
}

export interface SystemHealthSummary {
  crons: { active: number; silent: number; failures24h: number };
  ai: { recentCallCount: number; recentErrorRate: number };
  memory: { lastBrainCycleAt: string | null; embeddingCoveragePct: number };
}

export interface CommandCenterState {
  generatedAt: string;
  operator: {
    timeOfDay: "morning" | "midday" | "afternoon" | "evening" | "late";
    todayScore: number | null;
  };
  commands: {
    active: TaskSummary | null;
    open: TaskSummary[];
    commitments: CommitmentSummary[];
    scheduled: ScheduledActionSummary[];
  };
  /** v9.1.4 · Active missions (projects) + goals — the WHY behind tasks. */
  missions: MissionSummary[];
  goals: GoalSummary[];
  /** v9.1.5 · Recent brain dumps + reflections — the recent thinking. */
  recentThinking: {
    brainDumps: BrainDumpSummary[];
    reflections: ReflectionSummary[];
  };
  /** v9.1.8 · User-pinned permanent context + top hard-rule memories. */
  brainAnchors: {
    pinned: PinnedMemorySummary[];
    rules: BrainRuleSummary[];
  };
  /** v9.1.9 · Live domain snapshot — business + mastery scores. */
  domainSnapshot: DomainSnapshot;
  /** v9.1.10 · Temporal context — day, time bucket, weekly targets. */
  temporal: TemporalContext;
  proof: {
    today: ProofRollup;
    last7d: ProofRollup;
  };
  risks: {
    driftAlerts: DriftAlertSummary[];
    brainAlerts: BrainAlertSummary[];
    staleCommands: TaskSummary[];
    /** v9.0-rc · busy day with zero proof attachments. */
    noProofDay: NoProofDayRisk;
  };
  decisions: {
    recent: MasteryDecisionSummary[];
    needsReview: MasteryDecisionSummary[];
  };
  systemHealth: SystemHealthSummary;
  automation: {
    activeRules: number;
    recentRuns24h: number;
    failures24h: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

const ALERT_CATEGORIES = [
  "correlation_alert",
  "decision_quality_drift",
  "schema_drift_alert",
  "storage_quota_alert",
  "creation_spike_alert",
  "update_spike_alert",
  "brain_bus_alert",
];

function priorityFromScore(score: number | null | undefined): string {
  const s = score ?? 50;
  if (s < 20) return "critical";
  if (s < 40) return "high";
  if (s < 60) return "medium";
  return "low";
}

function timeOfDay(): CommandCenterState["operator"]["timeOfDay"] {
  // ET-anchored — Nour's local. Vercel runs UTC; Intl handles DST.
  // v9.1.12 · delegates to bucketFromHour so operatorState.timeOfDay
  // and TemporalContext.bucket are guaranteed to agree.
  const hour = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  const h = parseInt(hour, 10);
  return bucketFromHour(Number.isFinite(h) ? h : 0);
}

function startOfDayUTC(daysAgo = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

// ── Builder ──────────────────────────────────────────────────────────

/**
 * Build the full command-center state. All reads run in parallel; each
 * one is `.catch()`-guarded so a single table going down doesn't crash
 * the whole endpoint — caller still gets a valid (partially-empty)
 * shape.
 */
export async function buildCommandCenterState(): Promise<CommandCenterState> {
  return cached<CommandCenterState>("ultron_command_center_state_v1", 15, async () => {
    const now = new Date();
  const dayStart = startOfDayUTC(0);
  const sevenDaysAgo = startOfDayUTC(7);
  const oneDayAgo = new Date(Date.now() - 86_400_000);
  const sevenDaysAgoStaleCutoff = new Date(Date.now() - 7 * 86_400_000);

  // v9.1.12 · Compute the current ISO week key here (single source of
  // truth) so the weekly_target query can filter by the EXACT key
  // for this week. Without this filter, last week's stale target row
  // surfaced as "this week's targets" — silent data lie in the prompt.
  const currentWeekKey = computeIsoWeekKey(now);

  const [
    activeTask,
    openTasks,
    commitments,
    scheduled,
    activeMissions,
    activeGoals,
    recentBrainDumps,
    recentReflections,
    pinnedMemories,
    topBrainRules,
    latestFinancial,
    masteryRows,
    weeklyTargetRow,
    todayDoneCount,
    todayDoneWithProof,
    week7DoneCount,
    week7DoneWithProof,
    autoActionToday,
    autoActionWeek,
    cronRunsToday,
    cronRunsWeek,
    driftAlerts,
    brainAlerts,
    staleCommands,
    recentDecisions,
    needsReviewDecisions,
    cronStats,
    aiRecentStats,
    lastBrainCycle,
    embeddingCounts,
    automationRules,
    automationRuns24h,
    automationFailures24h,
  ] = await Promise.all([
    prisma.task
      .findFirst({
        where: { status: "DOING", deletedAt: null },
        orderBy: [{ autoPriority: "asc" }, { lastTouchedAt: "desc" }],
        select: TASK_SELECT,
      })
      .catch(() => null),
    prisma.task
      .findMany({
        where: { status: { in: ["INBOX", "READY"] }, deletedAt: null },
        orderBy: [{ autoPriority: "asc" }, { createdAt: "desc" }],
        take: 10,
        select: TASK_SELECT,
      })
      .catch(() => [] as Array<TaskRow>),
    prisma.commitment
      .findMany({
        where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
        orderBy: { deadline: "asc" },
        take: 10,
        select: {
          id: true,
          description: true,
          toWhom: true,
          status: true,
          deadline: true,
          domain: true,
        },
      })
      .catch(() => [] as Array<CommitmentRow>),
    prisma.scheduledAction
      .findMany({
        where: { status: "pending", scheduledFor: { gte: now } },
        orderBy: { scheduledFor: "asc" },
        take: 10,
        select: { id: true, actionType: true, scheduledFor: true, status: true },
      })
      .catch(() => [] as Array<ScheduledRow>),
    // v9.1.4 · active missions (projects) — the WHY behind active tasks.
    prisma.mission
      .findMany({
        where: { status: "ACTIVE", deletedAt: null },
        orderBy: { priority: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          domain: true,
          priority: true,
          successMetric: true,
        },
      })
      .catch(() => [] as Array<MissionRow>),
    // v9.1.4 · active LifeGoals — the top-of-stack desired outcomes.
    prisma.lifeGoal
      .findMany({
        where: { status: "active", deletedAt: null },
        orderBy: [{ horizon: "asc" }, { progress: "desc" }],
        take: 8,
        select: {
          id: true,
          title: true,
          domain: true,
          metric: true,
          targetValue: true,
          currentValue: true,
          unit: true,
          progress: true,
          horizon: true,
          deadline: true,
        },
      })
      .catch(() => [] as Array<GoalRow>),
    // v9.1.5 · recent brain dumps — what Nour was actively chewing on.
    prisma.brainDump
      .findMany({
        where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          id: true,
          date: true,
          rawThoughts: true,
          summary: true,
          moodBefore: true,
          moodAfter: true,
          actionsTaken: true,
          createdAt: true,
        },
      })
      .catch(() => [] as Array<BrainDumpRow>),
    // v9.1.5 · recent reflections — Nick's own pattern observations.
    prisma.reflection
      .findMany({
        where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } },
        orderBy: [{ actionable: "desc" }, { createdAt: "desc" }],
        take: 5,
        select: {
          id: true,
          date: true,
          scope: true,
          category: true,
          insight: true,
          confidence: true,
          actionable: true,
          acknowledged: true,
          createdAt: true,
        },
      })
      .catch(() => [] as Array<ReflectionRow>),
    // v9.1.8 · User-pinned permanent memory. Top 6 by recent activity.
    prisma.brainMemory
      .findMany({
        where: { category: BRAIN_CATEGORIES.PINNED_USER, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: {
          key: true,
          content: true,
          source: true,
          seenCount: true,
          updatedAt: true,
        },
      })
      .catch(() => [] as Array<PinnedMemoryRow>),
    // v9.1.8 · Top hard-rule brain memories (identity/feedback/brand).
    prisma.brainMemory
      .findMany({
        where: {
          confidence: { gte: 0.5 },
          category: { in: ["identity", "feedback", "brand_rules", "business_context"] },
          deletedAt: null,
        },
        orderBy: { confidence: "desc" },
        take: 8,
        select: {
          category: true,
          key: true,
          content: true,
          confidence: true,
        },
      })
      .catch(() => [] as Array<BrainRuleRow>),
    // v9.1.9 · most recent daily financial snapshot.
    prisma.financialSnapshot
      .findFirst({
        orderBy: { date: "desc" },
        select: {
          date: true,
          businessRevenue: true,
          savingsRatePct: true,
          netWorthEstimate: true,
        },
      })
      .catch(() => null),
    // v9.1.9 · latest score per mastery domain (one row per domain).
    prisma.masteryScore
      .findMany({
        where: { domain: { in: DOMAINS.map((d) => d.key) } },
        orderBy: { date: "desc" },
        distinct: ["domain"],
        select: { domain: true, score: true },
      })
      .catch(() => [] as Array<{ domain: string; score: number }>),
    // v9.1.10 · this week's 3 targets (revenue / personal / health).
    // v9.1.12 · MUST filter by the exact key=`week_<isoWeekKey>` for
    // the CURRENT week. Without this filter, last week's stale row
    // would surface as "this week's targets".
    prisma.brainMemory
      .findFirst({
        where: {
          category: BRAIN_CATEGORIES.WEEKLY_TARGET,
          key: `week_${currentWeekKey}`,
          deletedAt: null,
        },
        select: { content: true, metadata: true, key: true },
      })
      .catch(() => null),
    prisma.task
      .count({ where: { status: "DONE", deletedAt: null, updatedAt: { gte: dayStart } } })
      .catch(() => 0),
    // v9.0-rc · count of DONE tasks today WITH a non-null proof JSON.
    prisma.task
      .count({
        where: {
          status: "DONE",
          deletedAt: null,
          updatedAt: { gte: dayStart },
          proof: { not: Prisma.DbNull },
        },
      })
      .catch(() => 0),
    prisma.task
      .count({
        where: { status: "DONE", deletedAt: null, updatedAt: { gte: sevenDaysAgo } },
      })
      .catch(() => 0),
    prisma.task
      .count({
        where: {
          status: "DONE",
          deletedAt: null,
          updatedAt: { gte: sevenDaysAgo },
          proof: { not: Prisma.DbNull },
        },
      })
      .catch(() => 0),
    prisma.autonomousAction
      .count({ where: { result: "success", createdAt: { gte: dayStart } } })
      .catch(() => 0),
    prisma.autonomousAction
      .count({
        where: { result: "success", createdAt: { gte: sevenDaysAgo } },
      })
      .catch(() => 0),
    prisma.cronJobLog
      .groupBy({
        by: ["status"],
        where: { createdAt: { gte: dayStart } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ status: string; _count: { _all: number } }>),
    prisma.cronJobLog
      .groupBy({
        by: ["status"],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ status: string; _count: { _all: number } }>),
    prisma.brainMemory
      .findMany({
        where: {
          category: BRAIN_CATEGORIES.COACH_EVENT,
          key: { startsWith: "coach:drift-recovery:" },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          key: true,
          content: true,
          metadata: true,
          createdAt: true,
        },
      })
      .catch(() => [] as any),
    prisma.brainMemory
      .findMany({
        where: {
          category: { in: ALERT_CATEGORIES },
          createdAt: { gte: sevenDaysAgo },
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: 7,
        select: { category: true, content: true, createdAt: true },
      })
      .catch(() => [] as Array<{ category: string; content: string; createdAt: Date }>),
    prisma.task
      .findMany({
        where: {
          status: { in: ["DOING", "READY"] },
          deletedAt: null,
          lastTouchedAt: { lt: sevenDaysAgoStaleCutoff },
        },
        orderBy: { lastTouchedAt: "asc" },
        take: 5,
        select: TASK_SELECT,
      })
      .catch(() => [] as Array<TaskRow>),
    prisma.masteryDecision
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          date: true,
          domain: true,
          grade: true,
          reviewDate: true,
          actualOutcome: true,
        },
      })
      .catch(() => [] as Array<DecisionRow>),
    prisma.masteryDecision
      .findMany({
        where: {
          // v9.1.13 · added deletedAt:null — soft-deleted decisions
          // were leaking into "needs review" and getting surfaced to
          // NICK as actionable when they shouldn't.
          deletedAt: null,
          actualOutcome: null,
          reviewDate: { not: null, lte: new Date().toISOString().slice(0, 10) },
        },
        orderBy: { reviewDate: "asc" },
        take: 5,
        select: {
          id: true,
          title: true,
          date: true,
          domain: true,
          grade: true,
          reviewDate: true,
          actualOutcome: true,
        },
      })
      .catch(() => [] as Array<DecisionRow>),
    prisma.cronJobLog
      .groupBy({
        by: ["status"],
        where: { createdAt: { gte: oneDayAgo } },
        _count: { _all: true },
      })
      .catch(() => [] as Array<{ status: string; _count: { _all: number } }>),
    // v-fix 2026-06-02: was findMany(take:500, select status) + JS tally —
    // loaded up to 500 rows to produce two numbers. Now two count() queries
    // (one Promise.all slot → [total, errors] tuple). Error set mirrors the
    // prior JS predicate exactly (status truthy AND not completed/success →
    // notIn completed/success/"").
    Promise.all([
      prisma.aiGeneration.count({ where: { createdAt: { gte: oneDayAgo } } }),
      prisma.aiGeneration.count({
        where: {
          createdAt: { gte: oneDayAgo },
          status: { notIn: ["completed", "success", ""] },
        },
      }),
    ]).catch(() => [0, 0] as [number, number]),
    prisma.cronJobLog
      .findFirst({
        where: { jobName: { contains: "brain-cycle" }, status: "success" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
      .catch(() => null),
    prisma.$queryRaw<Array<{ total: bigint; withVec: bigint }>>`
      SELECT COUNT(*)::bigint AS total,
             COUNT(embedding_vec)::bigint AS "withVec"
      FROM vector_embeddings
    `.catch(() => [] as Array<{ total: bigint; withVec: bigint }>),
    prisma.automationRule
      .count({ where: { enabled: true } })
      .catch(() => 0),
    prisma.autonomousAction
      .count({ where: { createdAt: { gte: oneDayAgo } } })
      .catch(() => 0),
    prisma.autonomousAction
      .count({
        where: { createdAt: { gte: oneDayAgo }, result: { not: "success" } },
      })
      .catch(() => 0),
  ]);

  const todayProof: ProofRollup = {
    tasksDone: todayDoneCount,
    tasksDoneWithProof: todayDoneWithProof,
    autonomousActionsOk: autoActionToday,
    cronRunsOk: pickStatusCount(cronRunsToday, "success"),
    cronRunsFailed: pickStatusCount(cronRunsToday, "failed"),
  };
  const week7Proof: ProofRollup = {
    tasksDone: week7DoneCount,
    tasksDoneWithProof: week7DoneWithProof,
    autonomousActionsOk: autoActionWeek,
    cronRunsOk: pickStatusCount(cronRunsWeek, "success"),
    cronRunsFailed: pickStatusCount(cronRunsWeek, "failed"),
  };

  // v9.0-rc · noProofDay risk. Fires when ≥3 tasks closed today and
  // zero have proof attachments. Threshold intentionally generous —
  // we don't want to nag on a 1-task day. Adjustable as we learn.
  const NO_PROOF_THRESHOLD = 3;
  const noProofDay: NoProofDayRisk = {
    fired:
      todayDoneCount >= NO_PROOF_THRESHOLD && todayDoneWithProof === 0,
    tasksDone: todayDoneCount,
    withProof: todayDoneWithProof,
    reason:
      todayDoneCount >= NO_PROOF_THRESHOLD && todayDoneWithProof === 0
        ? `Closed ${todayDoneCount} tasks today, attached proof on 0. Either attach URLs/screenshots/metrics or note "no proof" on each.`
        : "",
  };

  const cronOk24h = pickStatusCount(cronStats, "success");
  const cronFail24h = pickStatusCount(cronStats, "failed");
  const cronTotal24h = cronOk24h + cronFail24h;
  const [aiTotal, aiErrors] = aiRecentStats;
  const embedRow = embeddingCounts[0];
  const embedTotal = embedRow ? Number(embedRow.total) : 0;
  const embedWithVec = embedRow ? Number(embedRow.withVec) : 0;

  return {
    generatedAt: now.toISOString(),
    operator: {
      timeOfDay: timeOfDay(),
      todayScore: null, // DailyScore retired Apr 19; field kept for compat
    },
    commands: {
      active: activeTask ? toTaskSummary(activeTask) : null,
      open: openTasks.map(toTaskSummary),
      commitments: commitments.map(toCommitmentSummary),
      scheduled: scheduled.map(toScheduledSummary),
    },
    missions: activeMissions.map(toMissionSummary),
    goals: activeGoals.map(toGoalSummary),
    recentThinking: {
      brainDumps: recentBrainDumps.map(toBrainDumpSummary),
      reflections: recentReflections.map(toReflectionSummary),
    },
    brainAnchors: {
      pinned: pinnedMemories.map(toPinnedMemorySummary),
      rules: topBrainRules.map(toBrainRuleSummary),
    },
    domainSnapshot: buildDomainSnapshot(latestFinancial, null, masteryRows),
    temporal: buildTemporalContext(weeklyTargetRow, currentWeekKey),
    proof: {
      today: todayProof,
      last7d: week7Proof,
    },
    risks: {
      driftAlerts: (driftAlerts as any[])
        .filter((d) => {
          const meta = (d.metadata ?? {}) as Record<string, unknown>;
          return !meta.ackedAt;
        })
        .map(toDriftAlertSummary),
      brainAlerts: brainAlerts.map((a) => ({
        category: a.category,
        content: a.content,
        createdAt: a.createdAt.toISOString(),
      })),
      staleCommands: staleCommands.map(toTaskSummary),
      noProofDay,
    },
    decisions: {
      recent: recentDecisions.map(toDecisionSummary),
      needsReview: needsReviewDecisions.map(toDecisionSummary),
    },
    systemHealth: {
      crons: {
        active: cronTotal24h,
        silent: 0, // computed elsewhere; left 0 here to keep this read cheap
        failures24h: cronFail24h,
      },
      ai: {
        recentCallCount: aiTotal,
        recentErrorRate: aiTotal > 0 ? Math.round((aiErrors / aiTotal) * 1000) / 10 : 0,
      },
      memory: {
        lastBrainCycleAt: lastBrainCycle?.createdAt?.toISOString() ?? null,
        embeddingCoveragePct:
          embedTotal === 0 ? 0 : Math.round((embedWithVec / embedTotal) * 1000) / 10,
      },
    },
    automation: {
      activeRules: automationRules,
      recentRuns24h: automationRuns24h,
      failures24h: automationFailures24h,
    },
  };
  });
}

// ── Internal types + selectors ───────────────────────────────────────

const TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  autoPriority: true,
  effort: true,
  energyRequired: true,
  context: true,
  startedAt: true,
  lastTouchedAt: true,
  dueDate: true,
  mission: { select: { domain: true } },
} as const;

type TaskRow = {
  id: string;
  title: string;
  status: string;
  autoPriority: number | null;
  effort: string | null;
  energyRequired: string | null;
  context: string | null;
  startedAt: Date | null;
  lastTouchedAt: Date | null;
  dueDate: Date | null;
  mission: { domain: string } | null;
};

type CommitmentRow = {
  id: number;
  description: string;
  toWhom: string;
  status: string;
  deadline: string | null;
  domain: string | null;
};

type ScheduledRow = {
  id: string;
  actionType: string;
  scheduledFor: Date;
  status: string;
};

type DriftAlertRow = {
  key: string;
  content: string;
  metadata: any;
  createdAt: Date;
};

type DecisionRow = {
  id: number;
  title: string;
  date: string;
  domain: string | null;
  grade: string | null;
  reviewDate: string | null;
  actualOutcome: string | null;
};

function toTaskSummary(t: TaskRow): TaskSummary {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: priorityFromScore(t.autoPriority),
    domain: t.mission?.domain ?? "general",
    effort: t.effort,
    energyRequired: t.energyRequired,
    context: t.context,
    startedAt: t.startedAt?.toISOString() ?? null,
    lastTouchedAt: t.lastTouchedAt?.toISOString() ?? null,
    dueDate: t.dueDate?.toISOString() ?? null,
  };
}

function toCommitmentSummary(c: CommitmentRow): CommitmentSummary {
  return {
    id: String(c.id),
    description: c.description,
    toWhom: c.toWhom,
    status: c.status,
    deadline: c.deadline,
    domain: c.domain,
  };
}

function toScheduledSummary(s: ScheduledRow): ScheduledActionSummary {
  return {
    id: s.id,
    actionType: s.actionType,
    scheduledFor: s.scheduledFor.toISOString(),
    status: s.status,
  };
}

interface MissionRow {
  id: string;
  title: string;
  domain: string;
  priority: number;
  successMetric: string | null;
}

function toMissionSummary(m: MissionRow): MissionSummary {
  return {
    id: m.id,
    title: m.title,
    domain: m.domain,
    priority: m.priority,
    successMetric: m.successMetric,
  };
}

interface GoalRow {
  id: string;
  title: string;
  domain: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
  horizon: string | null;
  deadline: Date | null;
}

function toGoalSummary(g: GoalRow): GoalSummary {
  return {
    id: g.id,
    title: g.title,
    domain: g.domain,
    metric: g.metric,
    targetValue: g.targetValue,
    currentValue: g.currentValue,
    unit: g.unit,
    progress: Math.round(g.progress),
    horizon: g.horizon,
    daysToDeadline: g.deadline
      ? Math.max(0, Math.round((g.deadline.getTime() - Date.now()) / 86_400_000))
      : null,
  };
}

interface BrainDumpRow {
  id: string;
  date: string;
  rawThoughts: string;
  summary: string | null;
  moodBefore: string | null;
  moodAfter: string | null;
  actionsTaken: number;
  createdAt: Date;
}

function toBrainDumpSummary(b: BrainDumpRow): BrainDumpSummary {
  return {
    id: b.id,
    date: b.date,
    summary: b.summary,
    excerpt: b.rawThoughts.slice(0, 200).replace(/\s+/g, " ").trim(),
    moodBefore: b.moodBefore,
    moodAfter: b.moodAfter,
    actionsTaken: b.actionsTaken,
    createdAt: b.createdAt.toISOString(),
  };
}

interface ReflectionRow {
  id: string;
  date: string;
  scope: string;
  category: string;
  insight: string;
  confidence: number;
  actionable: boolean;
  acknowledged: boolean;
  createdAt: Date;
}

function toReflectionSummary(r: ReflectionRow): ReflectionSummary {
  return {
    id: r.id,
    date: r.date,
    scope: r.scope,
    category: r.category,
    insight: r.insight,
    confidence: r.confidence,
    actionable: r.actionable,
    acknowledged: r.acknowledged,
    createdAt: r.createdAt.toISOString(),
  };
}

interface PinnedMemoryRow {
  key: string;
  content: string;
  source: string | null;
  seenCount: number;
  updatedAt: Date;
}

function toPinnedMemorySummary(p: PinnedMemoryRow): PinnedMemorySummary {
  return {
    key: p.key,
    content: p.content,
    source: p.source,
    seenCount: p.seenCount,
    updatedAt: p.updatedAt.toISOString(),
  };
}

interface BrainRuleRow {
  category: string;
  key: string;
  content: string;
  confidence: number;
}

function toBrainRuleSummary(r: BrainRuleRow): BrainRuleSummary {
  return {
    category: r.category,
    key: r.key,
    content: r.content,
    confidence: r.confidence,
  };
}

interface FinancialSnapshotRow {
  /** date is stored as String "YYYY-MM-DD" on FinancialSnapshot. */
  date: string;
  businessRevenue: number | null;
  savingsRatePct: number | null;
  netWorthEstimate: number | null;
}

interface EmpireSnapshotRow {
  snapshotDate: Date;
  moneyScore: number | null;
}

/**
 * v9.1.9 · Project the snapshot rows into the public DomainSnapshot
 * shape. Pure function — easy to test without the DB.
 */
function buildDomainSnapshot(
  financial: FinancialSnapshotRow | null,
  empire: EmpireSnapshotRow | null,
  masteryRows: Array<{ domain: string; score: number }>,
): DomainSnapshot {
  const scoreMap = new Map(masteryRows.map((r) => [r.domain, r.score] as const));
  const mastery: MasteryDomainScore[] = DOMAINS.map((d) => ({
    domain: d.key,
    label: d.label,
    score: scoreMap.get(d.key) ?? d.baseline,
    baseline: d.baseline,
  }));

  return {
    business: {
      monthlyRevenueTarget: MONTHLY_REVENUE_TARGET,
      latestRevenue: financial?.businessRevenue ?? null,
      asOf: financial?.date ?? null,
      savingsRatePct: financial?.savingsRatePct ?? null,
      netWorthEstimate: financial?.netWorthEstimate ?? null,
      moneyScore: empire?.moneyScore ?? null,
    },
    mastery,
  };
}

interface WeeklyTargetRow {
  content: string;
  metadata: Prisma.JsonValue;
  key: string;
}

interface WeeklyTargetMetadata {
  revenue?: string;
  personal?: string;
  health?: string;
}

/**
 * v9.1.12 · Compute the ISO Monday-anchored week key as
 * "YYYY-MM-DD". Used both for the weekly_target row filter (so we
 * never surface a stale row from a previous week) and for the
 * "set for week of" label in the prompt.
 *
 * Exported so v1 (lib/ai/system-prompt.ts) can use the SAME logic
 * — fixes v9.1.13 finding C2 where v1's inline calc mixed local
 * .getDay() with UTC .toISOString() and silently picked the wrong
 * week near boundaries.
 */
export function computeIsoWeekKey(now: Date): string {
  const utcDay = now.getUTCDay(); // 0=Sun, 1=Mon
  const offsetToMonday = utcDay === 0 ? -6 : 1 - utcDay;
  const monday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + offsetToMonday,
    ),
  );
  return monday.toISOString().slice(0, 10);
}

function bucketFromHour(h: number): TemporalContext["bucket"] {
  if (h < 6) return "late";
  if (h < 11) return "morning";
  if (h < 14) return "midday";
  if (h < 18) return "afternoon";
  if (h < 22) return "evening";
  return "late";
}

/**
 * v9.1.10 · Temporal context. ET-anchored day name + hour, ISO week
 * key, weekend flag, and the latest weekly_target row mapped onto
 * the typed contract.
 *
 * v9.1.12 · weekKey now arrives pre-computed from the caller so the
 * Prisma query can filter by it. Avoids the silent stale-target leak
 * that v9.1.10 shipped with.
 */
function buildTemporalContext(
  weeklyTargetRow: WeeklyTargetRow | null,
  weekKey: string,
): TemporalContext {
  // ET-anchored day name + hour. Vercel runs UTC; we use Intl.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dayNameLong = lookup("weekday");
  const dayName = dayNameLong.slice(0, 3);
  const month = lookup("month");
  const day = lookup("day");
  const year = lookup("year");
  const todayISO = `${year}-${month}-${day}`;
  const currentHour = parseInt(lookup("hour"), 10) || 0;
  const bucket = bucketFromHour(currentHour);
  const isWeekend = dayName === "Sat" || dayName === "Sun";

  if (!weeklyTargetRow) {
    return {
      dayName,
      dayNameLong,
      todayISO,
      currentHour,
      bucket,
      isWeekend,
      weekKey,
      weeklyTargets: null,
      weeklyTargetsRaw: null,
    };
  }

  const meta = (weeklyTargetRow.metadata ?? {}) as WeeklyTargetMetadata;
  const hasStructured = !!(meta.revenue || meta.personal || meta.health);

  return {
    dayName,
    dayNameLong,
    todayISO,
    currentHour,
    bucket,
    isWeekend,
    weekKey,
    weeklyTargets: hasStructured
      ? {
          revenue: meta.revenue ?? null,
          personal: meta.personal ?? null,
          health: meta.health ?? null,
        }
      : null,
    weeklyTargetsRaw: hasStructured ? null : weeklyTargetRow.content,
  };
}

function toDriftAlertSummary(d: any): DriftAlertSummary {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const severity = meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning";
  return {
    id: d.key,
    ruleName: d.content,
    severity,
    message: typeof meta.body === "string" ? meta.body : "",
    createdAt: d.createdAt.toISOString(),
  };
}

function toDecisionSummary(d: DecisionRow): MasteryDecisionSummary {
  return {
    id: d.id,
    title: d.title,
    date: d.date,
    domain: d.domain,
    grade: d.grade,
    reviewDate: d.reviewDate,
    hasOutcome: d.actualOutcome != null,
  };
}

function pickStatusCount(
  rows: Array<{ status: string; _count: { _all: number } }>,
  status: string,
): number {
  const row = rows.find((r) => r.status === status);
  return row ? row._count._all : 0;
}
