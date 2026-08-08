/**
 * Contract tests for v9.0-alpha command-center state + NickPrimeContext.
 *
 * Verifies:
 *   1. The exported builder produces a value that conforms to the
 *      shape every consumer (operator UI + AI prompt) depends on.
 *   2. The context projection from state → NickPrimeContext is a pure
 *      pass-through (no surprise transformations).
 *
 * The Prisma layer is mocked so this test runs without a live DB.
 * What we're actually verifying is the SHAPE contract — the regression
 * we want to catch is "someone changed CommandCenterState and broke
 * the AI prompt builder downstream without realizing."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    brainMemory: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    agendaItem: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock the underlying state builder so we exercise the projection +
// type contract without booting Prisma.
vi.mock("@/lib/ai/context/command-center-state", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/context/command-center-state")>(
    "@/lib/ai/context/command-center-state",
  );
  return {
    ...actual,
    buildCommandCenterState: vi.fn(),
  };
});

import {
  buildCommandCenterState,
  type CommandCenterState,
} from "@/lib/ai/context/command-center-state";
import {
  buildNickPrimeContext,
  nickContextFromState,
} from "@/lib/ai/context/nick-prime-context";

const FIXTURE_STATE: CommandCenterState = {
  generatedAt: "2026-04-30T12:00:00.000Z",
  operator: {
    timeOfDay: "midday",
    todayScore: null,
  },
  commands: {
    active: {
      id: "task-1",
      title: "Close out launch announcement",
      status: "DOING",
      priority: "high",
      domain: "business",
      effort: "M30",
      energyRequired: "MEDIUM",
      context: "DESK",
      startedAt: "2026-04-30T11:00:00.000Z",
      lastTouchedAt: "2026-04-30T11:55:00.000Z",
      dueDate: null,
    },
    open: [],
    commitments: [
      {
        id: "1",
        description: "Send tire quote to John D.",
        toWhom: "John",
        status: "active",
        deadline: "2026-05-01",
        domain: "business",
      },
    ],
    scheduled: [],
  },
  missions: [
    {
      id: "m-1",
      title: "Launch v9 Command Spine",
      domain: "business",
      priority: 1,
      successMetric: "v9.0 shipped to bdnick.info",
    },
  ],
  goals: [
    {
      id: "g-1",
      title: "Hit $40k revenue this month",
      domain: "business",
      metric: "revenue",
      targetValue: 40000,
      currentValue: 12500,
      unit: "$",
      progress: 31,
      horizon: "month",
      daysToDeadline: 14,
    },
  ],
  recentThinking: {
    brainDumps: [
      {
        id: "bd-1",
        date: "2026-04-29",
        summary: "Worried about quote loss pattern",
        excerpt: "lost three quotes in a row, all on price...",
        moodBefore: "anxious",
        moodAfter: "focused",
        actionsTaken: 2,
        createdAt: "2026-04-29T08:30:00.000Z",
      },
    ],
    reflections: [
      {
        id: "r-1",
        date: "2026-04-29",
        scope: "daily",
        category: "business",
        insight: "Price-loss correlates with skipped financing pitch",
        confidence: 0.82,
        actionable: true,
        acknowledged: false,
        createdAt: "2026-04-29T20:00:00.000Z",
      },
    ],
  },
  brainAnchors: {
    pinned: [
      {
        key: "no_agents_rule",
        content: "Never spin up sub-agents",
        source: "feedback_work_style_v2",
        seenCount: 47,
        updatedAt: "2026-04-15T00:00:00.000Z",
      },
    ],
    rules: [
      {
        category: "identity",
        key: "communication_dna",
        content: "Direct, terse, action-first.",
        confidence: 0.95,
      },
    ],
  },
  domainSnapshot: {
    business: {
      monthlyRevenueTarget: 20000,
      latestRevenue: 12500,
      asOf: "2026-04-29",
      savingsRatePct: 22.5,
      netWorthEstimate: 95000,
      moneyScore: 68,
    },
    mastery: [
      { domain: "business_ops", label: "Business Operations", score: 7, baseline: 6.5 },
    ],
  },
  temporal: {
    dayName: "Mon",
    dayNameLong: "Monday",
    todayISO: "2026-04-27",
    currentHour: 9,
    bucket: "morning",
    isWeekend: false,
    weekKey: "2026-04-27",
    weeklyTargets: {
      revenue: "$20K closed",
      personal: "Read 1 book",
      health: "4 workouts",
    },
    weeklyTargetsRaw: null,
  },
  proof: {
    today: { tasksDone: 3, tasksDoneWithProof: 1, autonomousActionsOk: 2, cronRunsOk: 14, cronRunsFailed: 0 },
    last7d: { tasksDone: 21, tasksDoneWithProof: 8, autonomousActionsOk: 14, cronRunsOk: 98, cronRunsFailed: 1 },
  },
  risks: {
    driftAlerts: [],
    brainAlerts: [
      {
        category: "decision_quality_drift",
        content: "Decision quality dropped 18% week-over-week",
        createdAt: "2026-04-29T08:00:00.000Z",
      },
    ],
    staleCommands: [],
    noProofDay: {
      fired: false,
      tasksDone: 3,
      withProof: 1,
      reason: "",
    },
  },
  decisions: {
    recent: [
      {
        id: 12,
        title: "Switch tire supplier to DK Tire B2B",
        date: "2026-04-22",
        domain: "business",
        grade: "A",
        reviewDate: null,
        hasOutcome: true,
      },
    ],
    needsReview: [],
  },
  systemHealth: {
    crons: { active: 34, silent: 0, failures24h: 0 },
    ai: { recentCallCount: 47, recentErrorRate: 0 },
    memory: {
      lastBrainCycleAt: "2026-04-30T09:00:00.000Z",
      embeddingCoveragePct: 87.4,
    },
  },
  automation: { activeRules: 12, recentRuns24h: 18, failures24h: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildCommandCenterState).mockResolvedValue(FIXTURE_STATE);
});

describe("v9.0-alpha · command-center state contract", () => {
  it("buildNickPrimeContext projects every required field", async () => {
    const ctx = await buildNickPrimeContext();

    // Operator
    expect(ctx.operatorState.timeOfDay).toBe("midday");

    // Commands
    expect(ctx.activeCommand?.id).toBe("task-1");
    expect(ctx.activeCommand?.priority).toBe("high");
    expect(Array.isArray(ctx.openCommands)).toBe(true);

    // Proof
    expect(ctx.todayProof.tasksDone).toBe(3);
    expect(ctx.todayProof.autonomousActionsOk).toBe(2);

    // Risks
    expect(ctx.activeRisks.brain).toHaveLength(1);
    expect(ctx.activeRisks.brain[0]?.category).toBe("decision_quality_drift");

    // Commitments + scheduled (v9.1.7)
    expect(ctx.activeCommitments).toHaveLength(1);
    expect(ctx.activeCommitments[0]?.toWhom).toBe("John");
    expect(Array.isArray(ctx.scheduledActions)).toBe(true);

    // Missions + Goals (v9.1.4)
    expect(ctx.activeMissions).toHaveLength(1);
    expect(ctx.activeMissions[0]?.title).toBe("Launch v9 Command Spine");
    expect(ctx.activeGoals).toHaveLength(1);
    expect(ctx.activeGoals[0]?.progress).toBe(31);

    // Recent thinking (v9.1.5)
    expect(ctx.recentBrainDumps).toHaveLength(1);
    expect(ctx.recentReflections).toHaveLength(1);
    expect(ctx.recentReflections[0]?.actionable).toBe(true);

    // Brain anchors (v9.1.8)
    expect(ctx.pinnedContext).toHaveLength(1);
    expect(ctx.pinnedContext[0]?.key).toBe("no_agents_rule");
    expect(ctx.brainRules).toHaveLength(1);
    expect(ctx.brainRules[0]?.category).toBe("identity");

    // Domain snapshot (v9.1.9)
    expect(ctx.domainSnapshot.business.monthlyRevenueTarget).toBe(20000);
    expect(ctx.domainSnapshot.business.moneyScore).toBe(68);
    expect(ctx.domainSnapshot.mastery).toHaveLength(1);
    expect(ctx.domainSnapshot.mastery[0]?.score).toBe(7);

    // Temporal (v9.1.10)
    expect(ctx.temporal.dayNameLong).toBe("Monday");
    expect(ctx.temporal.weeklyTargets?.revenue).toBe("$20K closed");
    expect(ctx.temporal.weekKey).toBe("2026-04-27");

    // Decisions
    expect(ctx.recentDecisions).toHaveLength(1);
    expect(ctx.decisionsNeedingReview).toHaveLength(0);

    // System health
    expect(ctx.systemHealth.crons.active).toBe(34);
    expect(ctx.systemHealth.memory.embeddingCoveragePct).toBeCloseTo(87.4);

    // Agenda Items
    expect(Array.isArray(ctx.agendaItems)).toBe(true);
  });

  it("nickContextFromState is a pure projection (same input → same output)", () => {
    const a = nickContextFromState(FIXTURE_STATE);
    const b = nickContextFromState(FIXTURE_STATE);
    expect(a).toEqual(b);

    // Spot-check that the projection passes the underlying objects
    // through (not deep-cloned) — keeping the API cheap.
    expect(a.activeCommand).toBe(FIXTURE_STATE.commands.active);
    expect(a.recentDecisions).toBe(FIXTURE_STATE.decisions.recent);
  });

  it("retains the full state without surprise transformations", () => {
    const ctx = nickContextFromState(FIXTURE_STATE);
    // Every top-level NickPrimeContext key must trace back to a known
    // CommandCenterState location. If a future edit drops one of these
    // assertions, this test catches the regression.
    expect(ctx.operatorState).toBe(FIXTURE_STATE.operator);
    expect(ctx.activeCommand).toBe(FIXTURE_STATE.commands.active);
    expect(ctx.openCommands).toBe(FIXTURE_STATE.commands.open);
    expect(ctx.todayProof).toBe(FIXTURE_STATE.proof.today);
    expect(ctx.activeRisks.drift).toBe(FIXTURE_STATE.risks.driftAlerts);
    expect(ctx.activeRisks.brain).toBe(FIXTURE_STATE.risks.brainAlerts);
    expect(ctx.activeRisks.stale).toBe(FIXTURE_STATE.risks.staleCommands);
    expect(ctx.recentDecisions).toBe(FIXTURE_STATE.decisions.recent);
    expect(ctx.decisionsNeedingReview).toBe(FIXTURE_STATE.decisions.needsReview);
    expect(ctx.systemHealth).toBe(FIXTURE_STATE.systemHealth);
  });
});

// ── 2026-08-08 · aiGeneration success vocabulary ────────────────────
// The health error-rate predicate counts rows whose status is NOT in
// AI_GENERATION_SUCCESS_STATUSES. The live writers emit "complete"
// (lib/ai/track.ts defaults to it, lib/ai/memory.ts hardcodes it) — the
// old list held only completed/success/"", so EVERY successful row
// counted as an error and the system prompt carried a permanent
// "ai (100% err)" alarm (prod probe 2026-08-08: 164/164 rows over 7d
// were "complete"; real error rate 0%). This pin fails if anyone
// "simplifies" the writers' value back out of the list.

import { AI_GENERATION_SUCCESS_STATUSES } from "@/lib/ai/context/command-center-state";
import { isAiGenerationError } from "@/lib/ai/generation-status";

describe("aiGeneration success vocabulary", () => {
  it("contains the value the live writers actually emit", () => {
    expect(AI_GENERATION_SUCCESS_STATUSES).toContain("complete");
  });

  it("keeps the legacy spellings so old rows never re-poison the rate", () => {
    expect(AI_GENERATION_SUCCESS_STATUSES).toContain("completed");
    expect(AI_GENERATION_SUCCESS_STATUSES).toContain("success");
    expect(AI_GENERATION_SUCCESS_STATUSES).toContain("");
  });

  it("the shared error predicate matches the writers, not invented spellings", () => {
    // Writers: track.ts defaults "complete", failure paths pass "error".
    expect(isAiGenerationError("complete")).toBe(false);
    expect(isAiGenerationError("error")).toBe(true);
    // "failed" is what ai-cost USED to filter on — no writer emits it,
    // but any row that ever carried it must still count as an error.
    expect(isAiGenerationError("failed")).toBe(true);
    // Null/absent mirrors the old "status truthy" clause → success.
    expect(isAiGenerationError(null)).toBe(false);
    expect(isAiGenerationError(undefined)).toBe(false);
  });
});
