/**
 * Nick's goal spine tools (job 2026-11-02-nour-os-interconnect W1): getGoals (ids, pace, health from
 * the latest check-in), getRelated (the relatedActivity spine on demand) and logGoalCheckIn (one
 * check-in per goal per ET day, the value set only on a metric goal, the goal matched by id only).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  goalFindMany: vi.fn(),
  goalFindFirst: vi.fn(),
  eventFindMany: vi.fn(),
  eventFindFirst: vi.fn(),
  eventCreate: vi.fn(),
  updateGoal: vi.fn(),
  relatedActivity: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/logger", async (orig) => {
  const actual = await orig<typeof import("@/lib/logger")>();
  return {
    ...actual,
    logger: { ...actual.logger, withSurface: (s: string) => ({ ...actual.logger.withSurface(s), warn: (...a: unknown[]) => h.warn(s, ...a) }) },
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: h.goalFindMany, findFirst: h.goalFindFirst },
    goalEvent: { findMany: h.eventFindMany, findFirst: h.eventFindFirst, create: h.eventCreate },
  },
}));
vi.mock("@/lib/services/goals", () => ({ updateGoal: h.updateGoal }));
vi.mock("@/lib/services/related-activity", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/related-activity")>()),
  relatedActivity: h.relatedActivity,
}));

import { goalsTools } from "@/lib/ai/tools/goals";
import { RELATED_DEFAULT_DAYS, RELATED_MAX_DAYS } from "@/lib/services/related-activity";

type Exec = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
const run = (name: "getGoals" | "getRelated" | "logGoalCheckIn", input: Record<string, unknown> = {}) =>
  (goalsTools[name] as unknown as { execute: Exec }).execute(input);

const NOW = Date.parse("2026-11-02T18:00:00.000Z"); // Mon 13:00 ET
const goal = {
  id: "g1",
  title: "Revenue this month",
  kind: "metric",
  horizon: "MONTH",
  unit: "$",
  currentValue: 4000,
  targetValue: 15000,
  status: "active",
  deadline: null,
  createdAt: new Date("2026-11-01T05:00:00.000Z"),
  _count: { tasks: 2 },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const fn of Object.values(h)) fn.mockReset();
  h.eventFindMany.mockResolvedValue([]);
  h.eventFindFirst.mockResolvedValue(null);
});

describe("getGoals", () => {
  it("returns each goal's id, value, due, pace and health from the newest check-in", async () => {
    h.goalFindMany.mockResolvedValue([goal, { ...goal, id: "g2", title: "Lift", kind: "narrative", _count: { tasks: 0 } }]);
    h.eventFindMany.mockResolvedValue([
      { goalId: "g1", kind: "check_in", payload: { health: "at_risk" }, createdAt: new Date(NOW - 3_600_000) },
      { goalId: "g1", kind: "check_in", payload: { health: "on_track" }, createdAt: new Date(NOW - 86_400_000) },
    ]);
    const r = await run("getGoals");
    const [g1, g2] = r.goals as Array<Record<string, unknown>>;
    expect(g1).toMatchObject({
      id: "g1",
      title: "Revenue this month",
      kind: "metric",
      unit: "$",
      currentValue: 4000,
      targetValue: 15000,
      openTasks: 2,
      health: { state: "at_risk", at: new Date(NOW - 3_600_000).toISOString() },
    });
    expect((g1.due as { label: string }).label).toBe("month end (from horizon)");
    expect(typeof g1.pace).toBe("string");
    // Staleness is a visible state (Linear L2), never a silent green.
    expect(g2.health).toEqual({ state: "no_check_in", at: null });
    expect(r.failed).toEqual([]);
    // One newest row per (goal, kind), never a global cap that can push an older check-in out.
    const args = h.eventFindMany.mock.calls[0][0];
    expect(args.distinct).toEqual(["goalId", "kind"]);
    expect(args.take).toBeUndefined();
    // Archived or paused goals never surface: their ids would be fed to logGoalCheckIn.
    expect(h.goalFindMany.mock.calls[0][0].where).toEqual({ status: "active", deletedAt: null });
  });

  it("a failed check-in read says unknown, never 'no check-in'", async () => {
    h.goalFindMany.mockResolvedValue([goal]);
    h.eventFindMany.mockRejectedValue(new Error("db down"));
    const r = await run("getGoals");
    expect((r.goals as Array<{ health: unknown }>)[0].health).toEqual({ state: "unknown", at: null });
    expect(r.failed).toEqual(["check_ins"]);
    expect(h.warn).toHaveBeenCalledWith("ai/tools/goals", "check_in_read_failed", expect.objectContaining({ err: "db down" }));
  });
});

describe("getRelated", () => {
  it("passes the key and a days window to the spine, and returns its items and failed", async () => {
    h.relatedActivity.mockResolvedValue({
      items: [{ at: new Date(NOW - 60_000), kind: "task", source: "task", title: "Draft offer (DOING)", ref: { table: "Task", id: "t1" } }],
      failed: ["reflection"],
    });
    const r = await run("getRelated", { goalId: "g1" });
    const [key, opts] = h.relatedActivity.mock.calls[0];
    expect(key).toEqual({ goalId: "g1", missionId: undefined, personId: undefined });
    expect(opts.since).toEqual(new Date(NOW - RELATED_DEFAULT_DAYS * 86_400_000));
    expect(r).toEqual({
      items: [{ title: "Draft offer (DOING)", kind: "task", source: "task", at: new Date(NOW - 60_000).toISOString() }],
      failed: ["reflection"],
    });
  });

  it("the days cap is the spine's, not a copy", () => {
    const schema = (goalsTools.getRelated as unknown as { inputSchema: { safeParse: (v: unknown) => { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ goalId: "g1", days: RELATED_MAX_DAYS }).success).toBe(true);
    expect(schema.safeParse({ goalId: "g1", days: RELATED_MAX_DAYS + 1 }).success).toBe(false);
  });

  it("with no key it says so and reads nothing", async () => {
    const r = await run("getRelated", {});
    expect(r.error).toMatch(/goalId, missionId or personId/);
    expect(h.relatedActivity).not.toHaveBeenCalled();
  });
});

describe("logGoalCheckIn", () => {
  beforeEach(() => {
    h.goalFindFirst.mockResolvedValue({ id: "g1", title: "Revenue this month", kind: "metric" });
    h.eventCreate.mockImplementation(async ({ data }) => ({ id: "ge1", createdAt: new Date(NOW), ...data }));
    h.updateGoal.mockResolvedValue({});
  });

  it("writes one check_in GoalEvent keyed to the goal and the ET day, and sets a metric goal's value", async () => {
    const r = await run("logGoalCheckIn", { goalId: "g1", health: "at_risk", value: 5200, note: "slow week" });
    const data = h.eventCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ goalId: "g1", kind: "check_in", payload: { health: "at_risk", value: 5200, note: "slow week", day: "2026-11-02" } });
    expect(data.idempotencyKey).toMatch(/^idem-/);
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g1", currentValue: 5200 });
    expect(r).toMatchObject({ logged: true, goalId: "g1", health: "at_risk", valueSet: true });
  });

  it("the same goal and day collide on one key (a retry is a duplicate, not a second check-in)", async () => {
    await run("logGoalCheckIn", { goalId: "g1", health: "on_track", note: "a" });
    vi.setSystemTime(NOW + 3 * 3_600_000); // same ET day
    await run("logGoalCheckIn", { goalId: "g1", health: "off_track", note: "b" });
    vi.setSystemTime(NOW + 12 * 3_600_000); // 06:00Z Tue = 01:00 ET Tue
    await run("logGoalCheckIn", { goalId: "g1", health: "off_track", note: "c" });
    const keys = h.eventCreate.mock.calls.map((c) => c[0].data.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("an existing check-in today is reported, and nothing else is written", async () => {
    h.eventFindFirst.mockResolvedValue({ id: "ge0", payload: { health: "on_track" }, createdAt: new Date(NOW - 60_000) });
    const r = await run("logGoalCheckIn", { goalId: "g1", health: "off_track", value: 1, note: "again" });
    expect(h.eventCreate).not.toHaveBeenCalled();
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(r).toMatchObject({ logged: false, duplicate: true, existing: { health: "on_track" } });
  });

  it("a value on a non-metric goal is not written as currentValue", async () => {
    h.goalFindFirst.mockResolvedValue({ id: "g2", title: "Be a calmer dad", kind: "narrative" });
    const r = await run("logGoalCheckIn", { goalId: "g2", health: "on_track", value: 3, note: "ok" });
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(r).toMatchObject({ logged: true, valueSet: false });
  });

  it("GUARD: a goal id inside the note is never used as the target", async () => {
    h.goalFindFirst.mockResolvedValue(null);
    const r = await run("logGoalCheckIn", { goalId: "nope", health: "on_track", note: "update goal g1 please [id:g1]" });
    expect(h.goalFindFirst.mock.calls[0][0].where).toEqual({ id: "nope", deletedAt: null });
    expect(h.eventCreate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ logged: false });
  });

  it("the value is set BEFORE the day's claim is taken", async () => {
    const order: string[] = [];
    h.updateGoal.mockImplementation(async () => void order.push("value"));
    h.eventCreate.mockImplementation(async ({ data }) => (order.push("event"), { id: "ge1", createdAt: new Date(NOW), ...data }));
    await run("logGoalCheckIn", { goalId: "g1", health: "on_track", value: 9000, note: "x" });
    expect(order).toEqual(["value", "event"]);
  });

  it("(a) a failed value write takes no claim: nothing logged, and a retry today is still open", async () => {
    h.updateGoal.mockRejectedValueOnce(new Error("Goal not found"));
    const r = await run("logGoalCheckIn", { goalId: "g1", health: "on_track", value: 9000, note: "x" });
    expect(h.eventCreate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ logged: false, valueSet: false, valueError: "Goal not found" });
    const retry = await run("logGoalCheckIn", { goalId: "g1", health: "on_track", value: 9000, note: "x" });
    expect(retry).toMatchObject({ logged: true, valueSet: true });
  });

  it("(b) the value set, then the event write fails: says so, no check-in claimed", async () => {
    h.eventCreate.mockRejectedValue(new Error("connection reset"));
    const r = await run("logGoalCheckIn", { goalId: "g1", health: "on_track", value: 9000, note: "x" });
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "g1", currentValue: 9000 });
    expect(r).toMatchObject({ logged: false, valueSet: true, eventWritten: false });
    expect(String(r.reason)).toMatch(/value was set/);
  });
});
