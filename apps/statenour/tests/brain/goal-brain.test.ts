/**
 * lib/brain/goal-brain.ts (job 2026-11-02-nour-os-interconnect W6): a goal check-in, an achieved goal and a
 * missed goal each write ONE BrainMemory row (category goal), keyed by the GoalEvent id, embedded like other rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  goalFindFirst: vi.fn(),
  memoryCreate: vi.fn(),
  embed: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { lifeGoal: { findFirst: h.goalFindFirst }, brainMemory: { create: h.memoryCreate } },
}));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: h.embed }));
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: h.warn }) } };
});

import { afterGoalMoment, GOAL_BRAIN_KINDS } from "@/lib/brain/goal-brain";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { CONTEXT_CATEGORIES } from "@/lib/brain/memory-recall";

const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.goalFindFirst.mockResolvedValue({ id: "goal_A", title: "Save $15k" });
  h.memoryCreate.mockImplementation(async ({ data }) => ({ id: "mem_1", ...data }));
  h.embed.mockResolvedValue(undefined);
});

describe("afterGoalMoment", () => {
  it("a check-in writes one goal row keyed by the GoalEvent id, with goalId and kind in metadata, then embeds it", async () => {
    const r = await afterGoalMoment({ goalEventId: "ge_1", goalId: "goal_A", kind: "check_in", text: "two invoices paid", health: "at_risk" });
    expect(r).toEqual({ written: true, id: "mem_1" });
    expect(h.memoryCreate).toHaveBeenCalledTimes(1);
    const data = h.memoryCreate.mock.calls[0][0].data;
    expect(data.category).toBe(BRAIN_CATEGORIES.GOAL);
    expect(data.key).toBe("goal_event:ge_1");
    expect(data.metadata).toEqual({ goalId: "goal_A", kind: "check_in", goalEventId: "ge_1" });
    expect(data.content).toContain("two invoices paid");
    expect(data.content).toContain("Save $15k");
    expect(data.content).toContain("at_risk");
    expect(h.embed).toHaveBeenCalledWith("mem_1", expect.stringContaining("two invoices paid"));
  });

  it("an achieved goal writes 'Achieved <title>'", async () => {
    await afterGoalMoment({ goalEventId: "ge_2", goalId: "goal_A", kind: "achieved" });
    expect(h.memoryCreate.mock.calls[0][0].data.content).toBe('Achieved "Save $15k"');
  });

  it("is idempotent per GoalEvent: a second call for the same event hits the unique key and writes nothing more", async () => {
    h.memoryCreate.mockRejectedValueOnce(p2002());
    const r = await afterGoalMoment({ goalEventId: "ge_1", goalId: "goal_A", kind: "check_in", text: "again", health: "on_track" });
    expect(r).toEqual({ written: false, reason: "duplicate" });
    expect(h.embed).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("matches the goal by id only: a goal id inside the note is never the key (guard canary)", async () => {
    await afterGoalMoment({ goalEventId: "ge_3", goalId: "goal_A", kind: "check_in", text: "moved goal_B, see goal_B", health: "on_track" });
    expect(h.goalFindFirst.mock.calls[0][0].where).toEqual({ id: "goal_A" });
    const data = h.memoryCreate.mock.calls[0][0].data;
    expect(data.metadata.goalId).toBe("goal_A");
    expect(data.key).toBe("goal_event:ge_3");
  });

  it("writes nothing for a kind outside the gate (task completions are too many)", async () => {
    expect(GOAL_BRAIN_KINDS).toEqual(["check_in", "achieved", "missed"]);
    const r = await afterGoalMoment({ goalEventId: "ge_4", goalId: "goal_A", kind: "task_completed" });
    expect(r).toMatchObject({ written: false });
    expect(h.memoryCreate).not.toHaveBeenCalled();
    expect(h.goalFindFirst).not.toHaveBeenCalled();
  });

  it("a failed embed keeps the row (embed-backfill retries it) and is logged, never thrown", async () => {
    h.embed.mockRejectedValueOnce(new Error("provider down"));
    const r = await afterGoalMoment({ goalEventId: "ge_5", goalId: "goal_A", kind: "achieved" });
    expect(r).toEqual({ written: true, id: "mem_1" });
    expect(h.warn).toHaveBeenCalledWith("goal_memory_embed_failed", expect.objectContaining({ goalEventId: "ge_5" }));
  });

  it("a failed write is logged and returned, never thrown (the caller is fire-and-forget)", async () => {
    h.memoryCreate.mockRejectedValueOnce(new Error("db down"));
    const r = await afterGoalMoment({ goalEventId: "ge_6", goalId: "goal_A", kind: "achieved" });
    expect(r).toEqual({ written: false, reason: "db down" });
    expect(h.warn).toHaveBeenCalledWith("goal_memory_write_failed", expect.objectContaining({ goalEventId: "ge_6" }));
  });

  it("an unknown goal writes nothing", async () => {
    h.goalFindFirst.mockResolvedValueOnce(null);
    const r = await afterGoalMoment({ goalEventId: "ge_7", goalId: "nope", kind: "achieved" });
    expect(r).toEqual({ written: false, reason: "goal not found" });
    expect(h.memoryCreate).not.toHaveBeenCalled();
  });

  it("the goal category rides chat recall", () => {
    expect(CONTEXT_CATEGORIES.has(BRAIN_CATEGORIES.GOAL)).toBe(true);
  });
});
