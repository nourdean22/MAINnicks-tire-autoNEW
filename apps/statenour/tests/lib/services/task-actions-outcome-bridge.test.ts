/**
 * checkTask → outcome-loop wiring (2026-08-19 · outcome-loop wave).
 *
 * The adversarial review's core finding was BUILT-TESTED-UNWIRED: the
 * consumers were unit-tested but nothing pinned the WIRING from the
 * completion moment. This file pins it at the checkTask boundary:
 *
 *   1. rating → ledger bridge: OUTSTANDING/SATISFACTORY land
 *      outcomeUseful:true, SUBSTANDARD/FAILED false, no rating → no call.
 *   2. rating + lesson ride into runAutoLearn's task shape (ONCE path).
 *   3. DAILY persists the pair on the recurring row (last-write, like
 *      completionNote) and does NOT hit the ledger bridge.
 *
 * Mocks prisma + auto-learn + outcome-ledger · no real DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  mission: { findUnique: vi.fn(), findMany: vi.fn() },
  brainMemory: { findMany: vi.fn(), upsert: vi.fn() },
  runAutoLearn: vi.fn(async () => null),
  recordOutcomeByContent: vi.fn(async () => true),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    brainMemory: mocks.brainMemory,
    $transaction: vi.fn(async (fn) =>
      fn({ task: mocks.task, mission: mocks.mission, brainMemory: mocks.brainMemory }),
    ),
  },
}));

vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  stripNoise: vi.fn((x) => x),
}));

vi.mock("@/lib/cache/dashboard-cache", () => ({
  invalidateMutationCaches: vi.fn(),
}));

vi.mock("@/lib/brain/task-events", () => ({
  emitTaskEventAsync: vi.fn(),
  emitTaskCompleted: vi.fn(),
}));

vi.mock("@/lib/db/brain-bus-emit", () => ({
  emitTaskCompleted: vi.fn(async () => undefined),
}));

vi.mock("@/lib/services/auto-learn", () => ({
  runAutoLearn: mocks.runAutoLearn,
}));

vi.mock("@/lib/services/skill-reinforce", () => ({
  reinforceSkill: vi.fn(async () => undefined),
  matchSkillKeys: vi.fn(() => []),
}));

vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));

vi.mock("@/lib/services/outcome-ledger", () => ({
  recordOutcomeByContent: mocks.recordOutcomeByContent,
}));

import { checkTask } from "@/lib/services/task-actions";
import { OutcomeRating } from "@prisma/client";

function setupTask(opts: { loopKind?: string } = {}) {
  mocks.task.findUnique.mockResolvedValueOnce({
    id: "t-1",
    title: "Call the supplier about brake pads",
    finishCondition: "done",
    missionId: "mission-1",
    loopKind: opts.loopKind ?? "ONCE",
    status: "READY",
    lastCompletedAt: null,
    streakCount: 0,
    startedAt: null,
    actualMinutes: 0,
    context: "ANYWHERE",
    effort: "M30",
    autoPriority: 50,
    roiScore: 50,
    goalId: null,
    mission: { title: "Mission 1", domain: "ops" },
    goal: null,
  });
  mocks.task.update.mockResolvedValue({
    id: "t-1",
    title: "Call the supplier about brake pads",
    status: opts.loopKind === "DAILY" ? "READY" : "DONE",
    loopKind: opts.loopKind ?? "ONCE",
    streakCount: 1,
    lastCompletedAt: new Date(),
    actualMinutes: 0,
    effort: "M30",
  });
  mocks.task.findMany.mockResolvedValue([]);
}

/** The ledger bridge is fire-and-forget (void async IIFE + dynamic
 *  import) — give the microtask/macrotask queue a couple of turns
 *  before asserting either way. */
const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.upsert.mockResolvedValue({});
  mocks.recordOutcomeByContent.mockResolvedValue(true);
});

describe("checkTask · rating → outcome-ledger bridge (ONCE)", () => {
  it.each([
    [OutcomeRating.OUTSTANDING, true],
    [OutcomeRating.SATISFACTORY, true],
    [OutcomeRating.SUBSTANDARD, false],
    [OutcomeRating.FAILED, false],
  ])("%s lands outcomeUseful:%s by title hash", async (rating, useful) => {
    setupTask();
    await checkTask({ id: "t-1", action: "complete", outcomeRating: rating });
    await flush();
    expect(mocks.recordOutcomeByContent).toHaveBeenCalledWith(
      "Call the supplier about brake pads",
      useful,
      "task:t-1",
    );
  });

  it("no rating → the ledger is never touched (unrated ≠ not useful)", async () => {
    setupTask();
    await checkTask({ id: "t-1", action: "complete" });
    await flush();
    expect(mocks.recordOutcomeByContent).not.toHaveBeenCalled();
  });
});

describe("checkTask · rating + lesson ride into auto-learn (ONCE)", () => {
  it("passes both through the task shape", async () => {
    setupTask();
    await checkTask({
      id: "t-1",
      action: "complete",
      outcomeRating: OutcomeRating.FAILED,
      outcomeLesson: "Should have confirmed stock before promising a date.",
    });
    expect(mocks.runAutoLearn).toHaveBeenCalledTimes(1);
    const args = mocks.runAutoLearn.mock.calls[0][0] as {
      task: { outcomeRating: string | null; outcomeLesson: string | null };
    };
    expect(args.task.outcomeRating).toBe("FAILED");
    expect(args.task.outcomeLesson).toBe(
      "Should have confirmed stock before promising a date.",
    );
  });
});

describe("checkTask · DAILY", () => {
  it("persists the pair on the recurring row (last-write, like completionNote)", async () => {
    setupTask({ loopKind: "DAILY" });
    await checkTask({
      id: "t-1",
      action: "complete",
      outcomeRating: OutcomeRating.SATISFACTORY,
      outcomeLesson: "Batch these in the morning.",
    });
    const data = mocks.task.update.mock.calls[0][0].data;
    expect(data.outcomeRating).toBe("SATISFACTORY");
    expect(data.outcomeLesson).toBe("Batch these in the morning.");
  });

  it("does NOT hit the ledger bridge — a recurring loop is not a one-shot suggestion outcome", async () => {
    setupTask({ loopKind: "DAILY" });
    await checkTask({
      id: "t-1",
      action: "complete",
      outcomeRating: OutcomeRating.OUTSTANDING,
    });
    await flush();
    expect(mocks.recordOutcomeByContent).not.toHaveBeenCalled();
  });
});
