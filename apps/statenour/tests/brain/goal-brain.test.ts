/**
 * lib/brain/goal-brain.ts (job 2026-11-02-nour-os-interconnect W6): a goal check-in, an achieved goal and a
 * missed goal each write ONE BrainMemory row (category goal), keyed by the GoalEvent id, through brainMemory.remember
 * (the admission gate, which embeds on create).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  goalFindFirst: vi.fn(),
  memoryFindUnique: vi.fn(),
  remember: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { lifeGoal: { findFirst: h.goalFindFirst }, brainMemory: { findUnique: h.memoryFindUnique } },
}));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: h.remember } }));
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: h.warn }) } };
});

import { afterGoalMoment, GOAL_BRAIN_KINDS, GOAL_MOMENT_SOURCE } from "@/lib/brain/goal-brain";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { CONTEXT_CATEGORIES } from "@/lib/brain/memory-recall";

const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.goalFindFirst.mockResolvedValue({ id: "goal_A", title: "Save $15k" });
  h.memoryFindUnique.mockResolvedValue(null);
  h.remember.mockResolvedValue({ id: "mem_1" });
});

describe("afterGoalMoment", () => {
  it("a check-in writes one goal row through remember(), keyed by the GoalEvent id, with goalId and kind in metadata", async () => {
    const r = await afterGoalMoment({ goalEventId: "ge_1", goalId: "goal_A", kind: "check_in", text: "two invoices paid", health: "at_risk" });
    expect(r).toEqual({ written: true, id: "mem_1" });
    expect(h.remember).toHaveBeenCalledTimes(1);
    const [category, key, content, source, metadata] = h.remember.mock.calls[0];
    expect(category).toBe(BRAIN_CATEGORIES.GOAL_MOMENT);
    expect(key).toBe("goal_event:ge_1");
    expect(source).toBe(GOAL_MOMENT_SOURCE);
    expect(metadata).toEqual({ goalId: "goal_A", kind: "check_in", goalEventId: "ge_1" });
    expect(content).toContain("two invoices paid");
    expect(content).toContain("Save $15k");
    expect(content).toContain("at_risk");
    expect(h.memoryFindUnique.mock.calls[0][0].where).toEqual({ category_key: { category: "goal_moment", key: "goal_event:ge_1" } });
  });

  it("an achieved goal writes 'Achieved <title>'", async () => {
    await afterGoalMoment({ goalEventId: "ge_2", goalId: "goal_A", kind: "achieved" });
    expect(h.remember.mock.calls[0][2]).toBe('Achieved "Save $15k"');
  });

  it("is idempotent per GoalEvent: a second call for the same event finds the row and writes nothing", async () => {
    h.memoryFindUnique.mockResolvedValueOnce({ id: "mem_1" });
    const r = await afterGoalMoment({ goalEventId: "ge_1", goalId: "goal_A", kind: "check_in", text: "again", health: "on_track" });
    expect(r).toEqual({ written: false, reason: "duplicate" });
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("a racing second call whose create hits the unique key reads as a duplicate, not a failure", async () => {
    h.remember.mockRejectedValueOnce(p2002());
    const r = await afterGoalMoment({ goalEventId: "ge_1", goalId: "goal_A", kind: "achieved" });
    expect(r).toEqual({ written: false, reason: "duplicate" });
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("matches the goal by id only: a goal id inside the note is never the key (guard canary)", async () => {
    await afterGoalMoment({ goalEventId: "ge_3", goalId: "goal_A", kind: "check_in", text: "moved goal_B, see goal_B", health: "on_track" });
    expect(h.goalFindFirst.mock.calls[0][0].where).toEqual({ id: "goal_A" });
    const [, key, , , metadata] = h.remember.mock.calls[0];
    expect(metadata.goalId).toBe("goal_A");
    expect(key).toBe("goal_event:ge_3");
  });

  it("writes nothing for a kind outside the gate (task completions are too many)", async () => {
    expect(GOAL_BRAIN_KINDS).toEqual(["check_in", "achieved", "missed"]);
    const r = await afterGoalMoment({ goalEventId: "ge_4", goalId: "goal_A", kind: "task_completed" });
    expect(r).toMatchObject({ written: false });
    expect(h.remember).not.toHaveBeenCalled();
    expect(h.goalFindFirst).not.toHaveBeenCalled();
  });

  it("a failed write is logged and returned, never thrown (the caller is fire-and-forget)", async () => {
    h.remember.mockRejectedValueOnce(new Error("db down"));
    const r = await afterGoalMoment({ goalEventId: "ge_6", goalId: "goal_A", kind: "achieved" });
    expect(r).toEqual({ written: false, reason: "db down" });
    expect(h.warn).toHaveBeenCalledWith("goal_memory_write_failed", expect.objectContaining({ goalEventId: "ge_6" }));
  });

  it("an unknown goal writes nothing, and says so in the log", async () => {
    h.goalFindFirst.mockResolvedValueOnce(null);
    const r = await afterGoalMoment({ goalEventId: "ge_7", goalId: "nope", kind: "achieved" });
    expect(r).toEqual({ written: false, reason: "goal not found" });
    expect(h.remember).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith("goal_memory_not_written", expect.objectContaining({ goalEventId: "ge_7", reason: "goal not found" }));
  });

  it("a duplicate is the only quiet no-write", async () => {
    h.memoryFindUnique.mockResolvedValueOnce({ id: "mem_1" });
    await afterGoalMoment({ goalEventId: "ge_1", goalId: "goal_A", kind: "achieved" });
    await afterGoalMoment({ goalEventId: "ge_8", goalId: "goal_A", kind: "task_completed" });
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledWith("goal_memory_not_written", expect.objectContaining({ goalEventId: "ge_8" }));
  });

  it("the goal_moment category rides chat recall", () => {
    expect(CONTEXT_CATEGORIES.has(BRAIN_CATEGORIES.GOAL_MOMENT)).toBe(true);
  });
});
