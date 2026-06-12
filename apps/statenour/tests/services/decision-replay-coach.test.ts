/**
 * decision-replay-coach · service tests · v10.0.528 · Arc B · Feature 3
 *
 * Unit-level. Prisma is mocked end-to-end so the 7 covered behaviors
 * exercise the engine without any DB round-trips.
 *
 * Coverage map:
 *   1. pickDueReplays · returns decisions older than 30d
 *   2. pickDueReplays · skips decisions with reviewed=true DecisionReplay
 *   3. gatherOutcomeSignals · counts task completions/abandonments
 *      + commitment status delta + topical memory hits in the window
 *   4. matchWisdom · prefers Munger/Naval/Buffett keys when overlap exists
 *   5. matchWisdom · returns null below similarity floor (0.3)
 *   6. composeReplayPrompt · cites the wisdom when present
 *   7. composeReplayPrompt · falls back to generic frame without wisdom
 *
 * Bonus: pickDueReplays · empty pool returns []
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  masteryDecision: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  decisionReplay: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  taskEvent: {
    findMany: vi.fn(),
  },
  brainMemory: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  commitment: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    masteryDecision: mocks.masteryDecision,
    decisionReplay: mocks.decisionReplay,
    taskEvent: mocks.taskEvent,
    brainMemory: mocks.brainMemory,
    commitment: mocks.commitment,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// Imported AFTER vi.mock so the module picks up the mocked deps.
import {
  pickDueReplays,
  gatherOutcomeSignals,
  matchWisdom,
  composeReplayPrompt,
  type DueDecision,
} from "@/lib/services/decision-replay-coach";

beforeEach(() => {
  mocks.masteryDecision.findMany.mockReset();
  mocks.masteryDecision.findUnique.mockReset();
  mocks.decisionReplay.findMany.mockReset();
  mocks.decisionReplay.findFirst.mockReset();
  mocks.decisionReplay.update.mockReset();
  mocks.decisionReplay.create.mockReset();
  mocks.taskEvent.findMany.mockReset();
  mocks.brainMemory.findMany.mockReset();
  mocks.brainMemory.create.mockReset();
  mocks.commitment.findMany.mockReset();
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function makeDueDecision(overrides: Partial<DueDecision> = {}): DueDecision {
  return {
    id: 1,
    title: "Ship more features",
    domain: "BUSINESS",
    chosen: "Ship more features to unblock revenue",
    reasoning: "Pipeline is starving — features unlock leads",
    predictedOutcome: "Revenue +20% in 30 days",
    createdAt: new Date(Date.now() - 31 * DAY_MS),
    ageDays: 31,
    ...overrides,
  };
}

// ── Test 1 · pickDueReplays returns decisions older than 30d ────────

describe("pickDueReplays", () => {
  it("returns decisions older than 30d when no replay row marks them reviewed", async () => {
    mocks.masteryDecision.findMany.mockResolvedValueOnce([
      {
        id: 1,
        title: "Hire a second tech",
        domain: "BUSINESS",
        chosen: "Hire next quarter",
        reasoning: "Bandwidth",
        predictedOutcome: "Doubled throughput",
        createdAt: new Date(Date.now() - 45 * DAY_MS),
      },
      {
        id: 2,
        title: "Switch CRM",
        domain: "BUSINESS",
        chosen: "Wait two more months",
        reasoning: "Cost of switching",
        predictedOutcome: "Avoid disruption",
        createdAt: new Date(Date.now() - 31 * DAY_MS),
      },
    ]);
    mocks.decisionReplay.findMany.mockResolvedValueOnce([]); // none reviewed

    const due = await pickDueReplays(5);
    expect(due).toHaveLength(2);
    expect(due[0]!.id).toBe(1);
    expect(due[0]!.ageDays).toBeGreaterThanOrEqual(30);
    expect(due[1]!.id).toBe(2);
  });

  it("returns empty when the candidate pool is empty", async () => {
    mocks.masteryDecision.findMany.mockResolvedValueOnce([]);
    const due = await pickDueReplays(5);
    expect(due).toEqual([]);
    // Skipping the reviewed-row lookup is fine · no harm done if it
    // doesn't fire, but the code path may still call it depending on
    // implementation. We only assert the result here.
  });
});

// ── Test 2 · pickDueReplays skips already-reviewed decisions ────────

describe("pickDueReplays · already-replayed skip", () => {
  it("skips MasteryDecisions whose corresponding DecisionReplay row is reviewed=true", async () => {
    mocks.masteryDecision.findMany.mockResolvedValueOnce([
      {
        id: 10,
        title: "Already-reviewed decision",
        domain: "BUSINESS",
        chosen: "X",
        reasoning: "Y",
        predictedOutcome: "Z",
        createdAt: new Date(Date.now() - 40 * DAY_MS),
      },
      {
        id: 11,
        title: "Fresh-due decision",
        domain: "BUSINESS",
        chosen: "A",
        reasoning: "B",
        predictedOutcome: "C",
        createdAt: new Date(Date.now() - 31 * DAY_MS),
      },
    ]);
    mocks.decisionReplay.findMany.mockResolvedValueOnce([{ decisionId: 10 }]);

    const due = await pickDueReplays(5);
    expect(due).toHaveLength(1);
    expect(due[0]!.id).toBe(11);
  });
});

// ── Test 3 · gatherOutcomeSignals aggregates the window ─────────────

describe("gatherOutcomeSignals", () => {
  it("aggregates tasks + drift + commitments + topical memories in the 30d window", async () => {
    mocks.taskEvent.findMany.mockResolvedValueOnce([
      { kind: "completed" },
      { kind: "completed" },
      { kind: "completed" },
      { kind: "abandoned" },
    ]);
    mocks.brainMemory.findMany
      .mockResolvedValueOnce([
        { id: "d1", metadata: { priority: "P1" } },
        { id: "d2", metadata: { priority: "P2" } },
      ])
      .mockResolvedValueOnce([
        { id: "m1" },
        { id: "m2" },
      ]);
    mocks.commitment.findMany.mockResolvedValueOnce([
      { status: "completed", description: "ship more features by month-end" },
      { status: "broken", description: "ship more features faster" },
      { status: "active", description: "ship more features incrementally" },
      // unrelated commitment · must NOT count
      { status: "broken", description: "fix the tire balancer" },
    ]);

    const decision = makeDueDecision();
    const signals = await gatherOutcomeSignals(decision);

    expect(signals.tasksCompleted).toBe(3);
    expect(signals.tasksAbandoned).toBe(1);
    expect(signals.driftAlertCount).toBe(2);
    expect(signals.topicalMemoryCount).toBe(2);
    expect(signals.commitmentStatusDelta.completed).toBe(1);
    expect(signals.commitmentStatusDelta.broken).toBe(1);
    expect(signals.commitmentStatusDelta.stillActive).toBe(1);
    expect(signals.bullets.length).toBeGreaterThan(0);
    expect(signals.bullets.length).toBeLessThanOrEqual(3);
    // First bullet should mention tasks
    expect(signals.bullets[0]).toMatch(/task/i);
  });
});

// ── Test 4 · matchWisdom prefers Munger/Naval/Buffett ───────────────

describe("matchWisdom", () => {
  it("picks the wisdom with highest keyword overlap and applies persona boost", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      {
        id: "w1",
        key: "wisdom_munger_inversion",
        // shares many tokens with the decision ("features", "revenue",
        // "pipeline") · should win after the 1.25 persona boost.
        content:
          "Invert the problem. Instead of asking how to ship more features, ask what would kill the revenue pipeline.",
        confidence: 0.9,
      },
      {
        id: "w2",
        key: "wisdom_random_other",
        content: "Some unrelated principle about cooking eggs.",
        confidence: 0.9,
      },
      {
        id: "w3",
        key: "wisdom_naval_leverage",
        // share fewer tokens with the decision · still beats random.
        content: "Leverage comes from code, capital, and features that scale.",
        confidence: 0.85,
      },
    ]);

    const decision = makeDueDecision({
      title: "Ship more features",
      chosen: "Ship more features",
      reasoning: "Pipeline is starving — features unlock revenue",
      predictedOutcome: "Revenue +20%",
    });
    const signals = {
      tasksCompleted: 5,
      tasksAbandoned: 2,
      driftAlertCount: 1,
      topicalMemoryCount: 0,
      commitmentStatusDelta: { broken: 1, completed: 1, stillActive: 1 },
      bullets: ["5 tasks completed, 2 abandoned"],
    };

    const wisdom = await matchWisdom(decision, signals);
    expect(wisdom).not.toBeNull();
    if (!wisdom) throw new Error("wisdom should not be null");
    expect(
      wisdom.key.startsWith("wisdom_munger_") ||
        wisdom.key.startsWith("wisdom_naval_"),
    ).toBe(true);
    expect(wisdom.similarity).toBeGreaterThanOrEqual(0.3);
  });

  it("returns null when no wisdom clears the 0.3 similarity floor", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      {
        id: "w-noisy",
        key: "wisdom_random_x",
        content: "Completely unrelated to anything in the decision text.",
        confidence: 0.9,
      },
    ]);
    const decision = makeDueDecision({
      title: "ABC",
      chosen: "DEF",
      reasoning: "GHI",
      predictedOutcome: "JKL",
    });
    const signals = {
      tasksCompleted: 0,
      tasksAbandoned: 0,
      driftAlertCount: 0,
      topicalMemoryCount: 0,
      commitmentStatusDelta: { broken: 0, completed: 0, stillActive: 0 },
      bullets: [],
    };
    const wisdom = await matchWisdom(decision, signals);
    expect(wisdom).toBeNull();
  });
});

// ── Test 5 · composeReplayPrompt format ─────────────────────────────

describe("composeReplayPrompt", () => {
  it("includes the wisdom lens citation when wisdom is present", () => {
    const decision = makeDueDecision();
    const signals = {
      tasksCompleted: 4,
      tasksAbandoned: 1,
      driftAlertCount: 2,
      topicalMemoryCount: 3,
      commitmentStatusDelta: { broken: 1, completed: 1, stillActive: 2 },
      bullets: [
        "4 tasks completed, 1 abandoned",
        "2 drift alerts",
        "Commitments: 1 kept, 1 broken, 2 still active",
      ],
    };
    const wisdom = {
      id: "w1",
      key: "wisdom_munger_inversion",
      excerpt: "Invert the problem · find the failure mode first.",
      similarity: 0.42,
    };
    const prompt = composeReplayPrompt(decision, signals, wisdom);
    expect(prompt.text).toContain("Decision replay");
    expect(prompt.text).toContain("You decided:");
    expect(prompt.text).toContain("What happened:");
    expect(prompt.text).toContain("Munger lens");
    expect(prompt.text).toContain("Would you decide differently now?");
    expect(prompt.wisdomKey).toBe("wisdom_munger_inversion");
    expect(prompt.decisionId).toBe(decision.id);
  });

  it("falls back to a generic 'what did this teach you' frame when wisdom is null", () => {
    const decision = makeDueDecision();
    const signals = {
      tasksCompleted: 0,
      tasksAbandoned: 0,
      driftAlertCount: 0,
      topicalMemoryCount: 0,
      commitmentStatusDelta: { broken: 0, completed: 0, stillActive: 0 },
      bullets: [],
    };
    const prompt = composeReplayPrompt(decision, signals, null);
    expect(prompt.text).toContain("Decision replay");
    expect(prompt.text).toContain("What did this decision teach you?");
    expect(prompt.text).not.toContain("lens");
    expect(prompt.wisdomKey).toBeNull();
    // No outcome bullets → "no measurable signals" hint
    expect(prompt.text).toMatch(/no measurable signals/);
  });
});
