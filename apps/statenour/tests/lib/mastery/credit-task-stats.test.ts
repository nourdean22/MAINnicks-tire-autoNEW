/**
 * creditTaskStats orchestration tests · 2026-06-01.
 *
 * The DB-touching crediting path that makes a completed task move the
 * character sheet. Pins the contract the live smoke test proved, so a
 * future refactor can't silently break it:
 *   · stat-resolution priority: goal stats → statHints → domain inference
 *   · XP scales by the effort/ROI/goal/streak multiplier
 *   · idempotency: a re-credit of the same (task,stat) adds 0 NEW
 *   · keying: goal-resolved → goal-task: · else → task-stat: · DAILY → +date
 *   · no resolvable stat → credits nothing (no wrong credit)
 *
 * prisma is mocked (same pattern as auto-learn.test); the REAL creditStatXp
 * runs against the mocked brainMemory so the idempotency contract is exercised.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn() },
  brainMemory: { findUnique: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    brainMemory: mocks.brainMemory,
  },
}));

import { creditTaskStats } from "@/lib/mastery/goal-stats";

/** A goal-linked task whose goal declares the `physical` stat. */
const goalTask = (over: Record<string, unknown> = {}) => ({
  goalId: "g1",
  statHints: [],
  effort: "M30",
  roiScore: 50,
  streakCount: 0,
  loopKind: "ONCE",
  mission: { domain: "BUSINESS" },
  goal: { domain: "fitness", title: "Get fit", statLinks: [{ statKey: "physical", weight: 1 }] },
  ...over,
});

const noGoalTask = (over: Record<string, unknown> = {}) => ({
  goalId: null,
  statHints: [],
  effort: "M30",
  roiScore: 50,
  streakCount: 0,
  loopKind: "ONCE",
  mission: { domain: "BUSINESS" },
  goal: null,
  ...over,
});

const keysUpserted = () =>
  mocks.brainMemory.upsert.mock.calls.map((c) => c[0].where.category_key.key);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.findUnique.mockResolvedValue(null); // default: a NEW credit
  mocks.brainMemory.upsert.mockResolvedValue({});
});

describe("creditTaskStats · stat resolution + keying", () => {
  it("goal-linked → credits the goal's stat under the goal-task: key", async () => {
    mocks.task.findUnique.mockResolvedValue(goalTask());
    const n = await creditTaskStats("t1");
    expect(n.statsCredited).toBe(1);
    expect(mocks.brainMemory.upsert).toHaveBeenCalledTimes(1);
    const arg = mocks.brainMemory.upsert.mock.calls[0][0];
    expect(arg.where.category_key.key).toBe("goal-task:t1:physical");
    expect(arg.create.metadata.stat).toBe("physical");
    expect(arg.create.metadata.xp).toBeGreaterThan(0);
    // xpCredited is the REAL summed XP (not the stat count) — equals what was written.
    expect(n.xpCredited).toBe(arg.create.metadata.xp);
  });

  it("no goal → credits from statHints under the task-stat: key", async () => {
    mocks.task.findUnique.mockResolvedValue(noGoalTask({ statHints: ["business_ops", "sales"] }));
    const n = await creditTaskStats("t2");
    expect(n.statsCredited).toBe(2);
    expect(n.xpCredited).toBeGreaterThan(0);
    expect(keysUpserted()).toEqual(
      expect.arrayContaining(["task-stat:t2:business_ops", "task-stat:t2:sales"]),
    );
  });

  it("no goal + no statHints → infers the stat from the mission domain", async () => {
    mocks.task.findUnique.mockResolvedValue(noGoalTask({ mission: { domain: "BUSINESS" } }));
    const n = await creditTaskStats("t3");
    expect(n.statsCredited).toBe(1);
    expect(keysUpserted()[0]).toBe("task-stat:t3:business_ops");
  });

  it("unmappable domain + no goal + no hints → credits NOTHING (no wrong credit)", async () => {
    mocks.task.findUnique.mockResolvedValue(noGoalTask({ mission: { domain: "zzzz" } }));
    const n = await creditTaskStats("t4");
    expect(n.statsCredited).toBe(0);
    expect(n.xpCredited).toBe(0);
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("DAILY (perDay) appends the date to the key so each day credits once", async () => {
    mocks.task.findUnique.mockResolvedValue(
      noGoalTask({ statHints: ["business_ops"], loopKind: "DAILY" }),
    );
    await creditTaskStats("t5", { perDay: true, dayKey: "2026-06-01" });
    expect(keysUpserted()[0]).toBe("task-stat:t5:business_ops:2026-06-01");
  });

  it("missing task → no-op", async () => {
    mocks.task.findUnique.mockResolvedValue(null);
    const n = await creditTaskStats("nope");
    expect(n.statsCredited).toBe(0);
    expect(n.xpCredited).toBe(0);
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });
});

describe("creditTaskStats · exactly-once idempotency", () => {
  it("a re-credit of the same (task,stat) adds 0 NEW (event already exists)", async () => {
    mocks.task.findUnique.mockResolvedValue(goalTask());
    mocks.brainMemory.findUnique.mockResolvedValue({ id: "already-credited" });
    const n = await creditTaskStats("t1");
    // a same-key re-credit adds 0 NEW stats AND 0 NEW XP → the reward stays
    // honest (no double-credit, no inflated XP) on a repeat completion.
    expect(n.statsCredited).toBe(0);
    expect(n.xpCredited).toBe(0);
  });
});

describe("creditTaskStats · adaptive scaling", () => {
  it("a maxed task (H2PLUS · roi100 · goal) credits more XP than a trivial one (M5 · roi10)", async () => {
    mocks.task.findUnique.mockResolvedValue(goalTask({ effort: "M5", roiScore: 10 }));
    await creditTaskStats("low");
    const lowXp = mocks.brainMemory.upsert.mock.calls[0][0].create.metadata.xp;

    vi.clearAllMocks();
    mocks.brainMemory.findUnique.mockResolvedValue(null);
    mocks.brainMemory.upsert.mockResolvedValue({});
    mocks.task.findUnique.mockResolvedValue(goalTask({ effort: "H2PLUS", roiScore: 100 }));
    await creditTaskStats("high");
    const highXp = mocks.brainMemory.upsert.mock.calls[0][0].create.metadata.xp;

    expect(highXp).toBeGreaterThan(lowXp);
  });
});
