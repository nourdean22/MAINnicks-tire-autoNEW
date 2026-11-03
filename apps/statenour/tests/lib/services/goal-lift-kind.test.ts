/**
 * Map gap 3 (job 2026-11-02-nour-os-interconnect W2): a finished task added +1 to currentValue
 * whatever the unit, so a $15,000 goal moved $1 per task. A metric goal's value now comes only from a
 * check-in or an explicit edit; the completion is still on the goal's record as a GoalEvent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  memoryCreate: vi.fn(),
  /** The transaction client's create: DISTINCT from prisma.brainMemory.create, so a marker write is attributable. */
  txMemoryCreate: vi.fn(),
  /** Markers that survived their transaction (a throw inside the callback discards them: the rollback). */
  committedMarkers: [] as string[],
  emit: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findUnique: h.findUnique, update: h.update },
    brainMemory: { create: h.memoryCreate },
    // Round 1 P2-17: a non-metric lift writes its marker and the increment in one transaction.
    $transaction: async (fn: (tx: unknown) => unknown) => {
      const pending: string[] = [];
      const create = async (args: { data: { key: string } }) => {
        const r = await h.txMemoryCreate(args);
        pending.push(args.data.key);
        return r;
      };
      const out = await fn({ lifeGoal: { findUnique: h.findUnique, update: h.update }, brainMemory: { create } });
      h.committedMarkers.push(...pending);
      return out;
    },
  },
}));
vi.mock("@/lib/brain/goal-events", () => ({ emitGoalEventAsync: h.emit }));
vi.mock("@/lib/logger", async (orig) => {
  const actual = await orig<typeof import("@/lib/logger")>();
  return {
    ...actual,
    logger: { ...actual.logger, withSurface: (s: string) => ({ ...actual.logger.withSurface(s), warn: (...a: unknown[]) => h.warn(...a) }) },
  };
});

import { liftGoalOnTaskComplete } from "@/lib/services/tasks";

const goal = (kind: string, unit = "$") => ({ id: "g1", kind, unit, currentValue: 4000, targetValue: 15000, status: "active", achievedAt: null });

beforeEach(() => {
  for (const fn of Object.values(h)) if (typeof fn === "function") fn.mockReset();
  h.committedMarkers = [];
  h.memoryCreate.mockResolvedValue({});
  h.txMemoryCreate.mockResolvedValue({});
  h.update.mockResolvedValue({ currentValue: 4001, targetValue: 15000, status: "active" });
});

describe("liftGoalOnTaskComplete by goal kind", () => {
  it("a metric goal's value does not move; the completion is recorded as task_completed", async () => {
    h.findUnique.mockResolvedValue(goal("metric"));
    await liftGoalOnTaskComplete("g1", "t1");
    expect(h.update).not.toHaveBeenCalled();
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ goalId: "g1", kind: "task_completed", payload: expect.objectContaining({ taskId: "t1" }) }));
  });

  it("a unitless metric goal is still a metric: no +1 (its check-in carries the value)", async () => {
    h.findUnique.mockResolvedValue(goal("metric", ""));
    await liftGoalOnTaskComplete("g1", "t1");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("a milestone goal keeps the +1 per finished task", async () => {
    h.findUnique.mockResolvedValue(goal("milestone", ""));
    await liftGoalOnTaskComplete("g1", "t1");
    expect(h.update.mock.calls[0][0].data).toEqual({ currentValue: { increment: 1 } });
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: "progress_logged" }));
  });

  it("round 1 P1-11: a milestone goal reaching its target by task count is NOT auto-achieved", async () => {
    h.findUnique.mockResolvedValue({ ...goal("milestone", ""), currentValue: 0, targetValue: 1 });
    h.update.mockResolvedValue({ currentValue: 1, targetValue: 1 });
    expect(await liftGoalOnTaskComplete("g1", "t1")).toBe(true);
    expect(h.update.mock.calls.some((c) => (c[0] as { data: { status?: string } }).data.status === "achieved")).toBe(false);
    expect(h.emit).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "achieved" }));
  });

  it("round 1 P2-17: a failed increment throws, so the marker rolls back with it and a later completion can retry", async () => {
    h.findUnique.mockResolvedValue(goal("milestone", ""));
    h.update.mockRejectedValueOnce(new Error("deadlock"));
    await expect(liftGoalOnTaskComplete("g1", "t1")).rejects.toThrow("deadlock");
    expect(h.memoryCreate, "the marker is never written on the global client (it would commit alone)").not.toHaveBeenCalled();
    expect(h.txMemoryCreate).toHaveBeenCalledTimes(1);
    expect(h.committedMarkers).toEqual([]);
    expect(h.emit).not.toHaveBeenCalled();
    // The retry is open: the next completion lifts and its marker commits.
    h.update.mockResolvedValue({ currentValue: 4001, targetValue: 15000, status: "active" });
    expect(await liftGoalOnTaskComplete("g1", "t1")).toBe(true);
    expect(h.committedMarkers).toEqual(["goal-lift:g1:t1"]);
  });

  it("round 1 P1-9: the lift says whether the value moved (metric: false, milestone: true, repeat: false)", async () => {
    h.findUnique.mockResolvedValue(goal("metric"));
    expect(await liftGoalOnTaskComplete("g1", "t1")).toBe(false);
    h.findUnique.mockResolvedValue(goal("milestone", ""));
    expect(await liftGoalOnTaskComplete("g1", "t2")).toBe(true);
    h.txMemoryCreate.mockRejectedValue(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    expect(await liftGoalOnTaskComplete("g1", "t2")).toBe(false);
  });

  it("the metric record is claimed once: a second completion of the same task emits nothing", async () => {
    h.findUnique.mockResolvedValue(goal("metric"));
    h.memoryCreate.mockRejectedValue(new Error("P2002"));
    await liftGoalOnTaskComplete("g1", "t1");
    expect(h.emit).not.toHaveBeenCalled();
  });

  it("a metric marker write that fails for any other reason is logged (goal_lift_marker_failed) and thrown, never read as 'already lifted'", async () => {
    h.findUnique.mockResolvedValue(goal("metric"));
    h.memoryCreate.mockRejectedValue(new Error("connection reset"));
    await expect(liftGoalOnTaskComplete("g1", "t1")).rejects.toThrow("connection reset");
    expect(h.warn).toHaveBeenCalledWith("goal_lift_marker_failed", expect.objectContaining({ goalId: "g1", taskId: "t1" }));
    expect(h.emit).not.toHaveBeenCalled();
  });
});
