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
  logWarn: vi.fn(),
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
      warn: mocks.logWarn,
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
  mocks.logWarn.mockReset();
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

// ── pickDueReplays · a tiny in-memory Prisma fake ───────────────────
//
// Routes by the `where` the service sends, so the tests assert BEHAVIOUR
// (which decisions come back), not the order of mocked calls. It knows only
// the filters pickDueReplays uses; any other filter throws, so a query shape
// the fake cannot answer fails loudly instead of returning a quiet lie.

type SeedDecision = {
  id: number;
  title: string;
  domain: string | null;
  chosen: string | null;
  reasoning: string | null;
  predictedOutcome: string | null;
  createdAt: Date;
};
type SeedReplay = { decisionId: number | null; reviewed: boolean; reviewAt: Date };
type FakeArgs = { where: Record<string, any>; orderBy?: Record<string, string>; take?: number };

const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY_MS);

function decisionRow(id: number, createdAt: Date): SeedDecision {
  return {
    id,
    title: `Decision ${id}`,
    domain: "BUSINESS",
    chosen: "X",
    reasoning: "Y",
    predictedOutcome: "p=0.6",
    createdAt,
  };
}

function seedStore(decisions: SeedDecision[], replays: SeedReplay[]) {
  const decisionKeys = new Set(["createdAt", "id", "deletedAt"]);
  mocks.masteryDecision.findMany.mockImplementation(async (args: FakeArgs) => {
    const w = args.where;
    for (const k of Object.keys(w)) if (!decisionKeys.has(k)) throw new Error(`fake: masteryDecision filter ${k}`);
    let rows = decisions.filter(
      (d) =>
        (!w.createdAt?.lte || d.createdAt.getTime() <= w.createdAt.lte.getTime()) &&
        (!w.id?.in || w.id.in.includes(d.id)),
    );
    if (args.orderBy?.createdAt === "asc") {
      rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
    return rows.slice(0, args.take ?? rows.length);
  });
  const replayKeys = new Set(["decisionId", "reviewed", "reviewAt"]);
  mocks.decisionReplay.findMany.mockImplementation(async (args: FakeArgs) => {
    const w = args.where;
    for (const k of Object.keys(w)) if (!replayKeys.has(k)) throw new Error(`fake: decisionReplay filter ${k}`);
    let rows = replays.filter(
      (r) =>
        (w.reviewed === undefined || r.reviewed === w.reviewed) &&
        (!w.reviewAt?.lte || r.reviewAt.getTime() <= w.reviewAt.lte.getTime()) &&
        (!w.decisionId?.in || (r.decisionId !== null && w.decisionId.in.includes(r.decisionId))) &&
        (w.decisionId?.not !== null || r.decisionId !== null),
    );
    if (args.orderBy?.reviewAt === "asc") {
      rows = [...rows].sort((a, b) => a.reviewAt.getTime() - b.reviewAt.getTime());
    }
    return rows.slice(0, args.take ?? rows.length);
  });
}

// ── Test 1 · pickDueReplays returns decisions older than 30d ────────

describe("pickDueReplays", () => {
  it("returns decisions older than 30d when no replay row marks them reviewed", async () => {
    seedStore([decisionRow(1, daysAgo(45)), decisionRow(2, daysAgo(31))], []);

    const due = await pickDueReplays(5);
    expect(due).toHaveLength(2);
    expect(due[0]!.id).toBe(1);
    expect(due[0]!.ageDays).toBeGreaterThanOrEqual(30);
    expect(due[1]!.id).toBe(2);
  });

  it("returns empty when the candidate pool is empty", async () => {
    seedStore([], []);
    expect(await pickDueReplays(5)).toEqual([]);
  });
});

// ── Test 2 · pickDueReplays skips already-reviewed decisions ────────

describe("pickDueReplays · already-replayed skip", () => {
  it("skips MasteryDecisions whose corresponding DecisionReplay row is reviewed=true", async () => {
    seedStore(
      [decisionRow(10, daysAgo(40)), decisionRow(11, daysAgo(31))],
      [{ decisionId: 10, reviewed: true, reviewAt: daysAgo(5) }],
    );

    const due = await pickDueReplays(5);
    expect(due).toHaveLength(1);
    expect(due[0]!.id).toBe(11);
  });
});

// ── Brain follow-up 2 · a stored review date decides when it is asked ─

describe("pickDueReplays · own review date", () => {
  it("asks a 10-day-old decision once its own reviewAt has passed", async () => {
    const reviewAt = daysAgo(3);
    seedStore([decisionRow(1, daysAgo(10))], [{ decisionId: 1, reviewed: false, reviewAt }]);

    const due = await pickDueReplays(5);
    expect(due.map((d) => d.id)).toEqual([1]);
    expect(due[0]!.ageDays).toBe(10);
    expect(due[0]!.reviewAt?.getTime()).toBe(reviewAt.getTime());
  });

  it("does NOT ask a 45-day-old decision whose reviewAt is still in the future", async () => {
    seedStore(
      [decisionRow(2, daysAgo(45))],
      [{ decisionId: 2, reviewed: false, reviewAt: daysFromNow(30) }],
    );

    expect(await pickDueReplays(5)).toEqual([]);
  });

  it("still asks a 45-day-old decision with no replay row at all (30-day rule control)", async () => {
    seedStore([decisionRow(3, daysAgo(45))], []);

    const due = await pickDueReplays(5);
    expect(due.map((d) => d.id)).toEqual([3]);
    expect(due[0]!.reviewAt).toBeUndefined();
  });

  it("never asks a reviewed decision, even with a second unreviewed row past its date", async () => {
    seedStore(
      [decisionRow(4, daysAgo(10)), decisionRow(5, daysAgo(60))],
      [
        { decisionId: 4, reviewed: true, reviewAt: daysAgo(2) },
        { decisionId: 4, reviewed: false, reviewAt: daysAgo(1) },
        { decisionId: 5, reviewed: true, reviewAt: daysAgo(30) },
      ],
    );

    expect(await pickDueReplays(5)).toEqual([]);
  });

  it("orders own-date rows first (oldest reviewAt first), then the 30-day pool oldest first", async () => {
    seedStore(
      [
        decisionRow(20, daysAgo(200)), // 30-day pool, the oldest decision of all
        decisionRow(21, daysAgo(90)), // 30-day pool
        decisionRow(22, daysAgo(15)), // own date passed 2 days ago
        decisionRow(23, daysAgo(20)), // own date passed 8 days ago
      ],
      [
        { decisionId: 22, reviewed: false, reviewAt: daysAgo(2) },
        { decisionId: 23, reviewed: false, reviewAt: daysAgo(8) },
      ],
    );

    const due = await pickDueReplays(10);
    expect(due.map((d) => d.id)).toEqual([23, 22, 20, 21]);
  });

  it("respects the limit and fills it with own-date rows before the 30-day pool", async () => {
    seedStore(
      [
        decisionRow(30, daysAgo(80)),
        decisionRow(31, daysAgo(12)),
        decisionRow(32, daysAgo(11)),
        decisionRow(33, daysAgo(10)),
      ],
      [
        { decisionId: 31, reviewed: false, reviewAt: daysAgo(4) },
        { decisionId: 32, reviewed: false, reviewAt: daysAgo(3) },
        { decisionId: 33, reviewed: false, reviewAt: daysAgo(2) },
      ],
    );

    const due = await pickDueReplays(2);
    expect(due.map((d) => d.id)).toEqual([31, 32]);
  });

  it("skips an own-date row whose MasteryDecision is gone and moves to the next", async () => {
    seedStore(
      [decisionRow(41, daysAgo(10))],
      [
        { decisionId: 40, reviewed: false, reviewAt: daysAgo(9) }, // decision 40 was deleted
        { decisionId: 41, reviewed: false, reviewAt: daysAgo(1) },
      ],
    );

    expect((await pickDueReplays(5)).map((d) => d.id)).toEqual([41]);
  });

  it("returns a decision once, not twice, when it is both own-date due and past 30 days", async () => {
    seedStore(
      [decisionRow(50, daysAgo(45))],
      [{ decisionId: 50, reviewed: false, reviewAt: daysAgo(10) }],
    );

    const due = await pickDueReplays(5);
    expect(due.map((d) => d.id)).toEqual([50]);
    expect(due[0]!.reviewAt).toBeInstanceOf(Date);
  });
});

describe("pickDueReplays · failed reads", () => {
  it("returns empty and names the pool query when the decision read fails", async () => {
    mocks.masteryDecision.findMany.mockRejectedValue(new Error("db down"));
    mocks.decisionReplay.findMany.mockResolvedValue([]);

    expect(await pickDueReplays(5)).toEqual([]);
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "pickDueReplays_query_failed",
      expect.objectContaining({ query: "pool_decisions" }),
    );
  });

  it("returns empty (never everything) and names the lookup when the replay-status read fails", async () => {
    seedStore([decisionRow(60, daysAgo(45))], []);
    mocks.decisionReplay.findMany.mockRejectedValue(new Error("db down"));

    expect(await pickDueReplays(5)).toEqual([]);
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "pickDueReplays_query_failed",
      expect.objectContaining({ query: "replay_status" }),
    );
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

  it("says 'review date reached' for an own-date decision and keeps 'Nd ago' for the 30-day pool", () => {
    const signals = {
      tasksCompleted: 0,
      tasksAbandoned: 0,
      driftAlertCount: 0,
      topicalMemoryCount: 0,
      commitmentStatusDelta: { broken: 0, completed: 0, stillActive: 0 },
      bullets: [],
    };
    const own = composeReplayPrompt(
      makeDueDecision({ ageDays: 10, reviewAt: new Date(Date.now() - DAY_MS) }),
      signals,
      null,
    );
    expect(own.text).toContain("review date reached");
    expect(own.text).not.toContain("10d ago");

    const pool = composeReplayPrompt(makeDueDecision({ ageDays: 45 }), signals, null);
    expect(pool.text).toContain("45d ago");
    expect(pool.text).not.toContain("review date reached");
  });
});
