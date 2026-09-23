/**
 * Deferred priority refreshes must COALESCE, not stampede.
 *
 * WHY THIS FILE EXISTS — review catch on PR #2408.
 *
 * Moving `syncTaskPriorities` out of the write transaction bought liveness (a
 * derived refresh can no longer fail a user's write) but gave up the
 * serialisation the transaction and its row locks used to provide — a trade the
 * first version made without naming.
 *
 * ★★ THE FAILURE IS A LOST-UPDATE, NOT A CRASH. `syncTaskPriorities` reads
 * every open task, then writes derived scores with NO version predicate. Two
 * mutations finishing close together launched two independent full-table
 * passes, so the pass that READ FIRST could WRITE LAST and leave `autoPriority`
 * computed from a stale due date, mission or rank — silently, until some later
 * mutation happened to correct it.
 *
 * Coalescing is sound precisely because a full-table refresh is IDEMPOTENT and
 * order-independent: one pass after N mutations is equivalent to N passes, and
 * strictly cheaper.
 *
 * ⚠ IN-PROCESS ONLY by construction. Two Railway instances can still overlap;
 * this removes the common case, not the distributed one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findMany: vi.fn(), update: vi.fn() },
  mission: { findMany: vi.fn() },
  /** Resolves the in-flight syncTaskPriorities so a test controls overlap. */
  gate: { release: null as null | (() => void), calls: 0 },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { task: mocks.task, mission: mocks.mission, $transaction: vi.fn() },
}));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), stripNoise: vi.fn((x) => x) }));
vi.mock("@/lib/utils/cache", () => ({ invalidate: vi.fn() }));
vi.mock("@/lib/cache/dashboard-cache", () => ({ invalidateMutationCaches: vi.fn() }));
vi.mock("@/lib/brain/task-events", () => ({ emitTaskEventAsync: vi.fn(), emitTaskCompleted: vi.fn() }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitTaskCompleted: vi.fn(async () => undefined) }));
vi.mock("@/lib/brain/goal-events", () => ({ emitGoalEventAsync: vi.fn() }));
vi.mock("@/lib/services/auto-learn", () => ({ runAutoLearn: vi.fn(async () => null) }));

import { scheduleGlobalPrioritySync, __awaitPrioritySyncForTest } from "@/lib/services/tasks";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.calls = 0;
  mocks.gate.release = null;
  mocks.mission.findMany.mockResolvedValue([]);
  mocks.task.update.mockResolvedValue({});
  // Each full-table pass blocks on a gate the test opens, so overlap is
  // deterministic rather than a race we hope to observe.
  mocks.task.findMany.mockImplementation(
    () =>
      new Promise((resolve) => {
        mocks.gate.calls += 1;
        mocks.gate.release = () => resolve([]);
      }),
  );
});

/** Let the microtask queue drain so the scheduler's async body advances. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("scheduleGlobalPrioritySync", () => {
  // POSITIVE CONTROL — if scheduling stopped running the sync at all, the
  // "no stampede" assertion below would pass trivially on zero passes.
  it("runs a full-table pass when nothing is in flight", async () => {
    scheduleGlobalPrioritySync("test");
    await tick();
    expect(mocks.gate.calls).toBe(1);
    mocks.gate.release?.();
    await __awaitPrioritySyncForTest();
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // THE LOST-UPDATE GUARD. Several mutations landing during one in-flight
  // pass must NOT each start their own; a second pass runs once, afterwards.
  it("CANARY — concurrent requests do not start overlapping full-table passes", async () => {
    scheduleGlobalPrioritySync("a");
    await tick();
    expect(mocks.gate.calls).toBe(1);

    // Three more mutations finish while the first pass is still running.
    scheduleGlobalPrioritySync("b");
    scheduleGlobalPrioritySync("c");
    scheduleGlobalPrioritySync("d");
    await tick();
    expect(mocks.gate.calls).toBe(1); // still ONE — no stampede

    mocks.gate.release?.();
    await tick();
    await tick();

    // Exactly one catch-up pass, not three.
    expect(mocks.gate.calls).toBe(2);
    mocks.gate.release?.();
    await tick();
    await tick();
    expect(mocks.gate.calls).toBe(2);
  });

  it("a later request after everything settled starts a fresh pass", async () => {
    scheduleGlobalPrioritySync("a");
    await tick();
    mocks.gate.release?.();
    await tick();
    await tick();
    const after = mocks.gate.calls;

    scheduleGlobalPrioritySync("later");
    await tick();
    expect(mocks.gate.calls).toBe(after + 1);
    mocks.gate.release?.();
    await tick();
  });

  // A failing refresh must not wedge the flag — the next mutation has to be
  // able to schedule one, or the whole derived lane silently stops updating.
  it("a failed pass still clears the in-flight flag", async () => {
    mocks.task.findMany.mockRejectedValueOnce(new Error("db down"));
    scheduleGlobalPrioritySync("boom");
    await tick();
    await tick();

    mocks.task.findMany.mockImplementation(
      () =>
        new Promise((resolve) => {
          mocks.gate.calls += 1;
          mocks.gate.release = () => resolve([]);
        }),
    );
    scheduleGlobalPrioritySync("next");
    await tick();
    expect(mocks.gate.calls).toBeGreaterThan(0);
    mocks.gate.release?.();
    await tick();
  });
});
