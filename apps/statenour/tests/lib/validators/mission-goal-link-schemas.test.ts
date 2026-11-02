/**
 * A mission knows its goal and what done looks like (2026-11-02).
 *
 * Prod read that day: 13 live missions, 0 with lifeGoalId, although the goal
 * "Plan it" flow had created one that afternoon. The create schema had no
 * `lifeGoalId`, so zod stripped it. The mission edit drawer sent `description`
 * ("what does done look like"), which neither schema accepts, so it was
 * dropped the same way; the column for it is `completionCriteria`.
 */
import { describe, it, expect } from "vitest";
import { missionCreateSchema, missionUpdateSchema } from "@/lib/validators/missions";

describe("mission schemas carry the goal link and the done criteria", () => {
  it("create keeps lifeGoalId and completionCriteria", () => {
    const r = missionCreateSchema.parse({
      title: "approach 3 people this week",
      lifeGoalId: "goal_1",
      completionCriteria: "3 approaches logged",
    });
    expect(r.lifeGoalId).toBe("goal_1");
    expect(r.completionCriteria).toBe("3 approaches logged");
  });

  it("create without them still parses (the thin Inbox payload)", () => {
    const r = missionCreateSchema.parse({ title: "Inbox" });
    expect(r.lifeGoalId ?? null).toBeNull();
    expect(r.completionCriteria ?? null).toBeNull();
  });

  it("update accepts both, and null clears them", () => {
    const r = missionUpdateSchema.parse({ lifeGoalId: null, completionCriteria: "" });
    expect(r.lifeGoalId).toBeNull();
    expect(r.completionCriteria).toBeNull();
    expect(missionUpdateSchema.parse({ lifeGoalId: "goal_2" }).lifeGoalId).toBe("goal_2");
  });

  it("a stray `description` is still not a field: the drawer must send completionCriteria", () => {
    const r = missionCreateSchema.parse({ title: "x", description: "done when" }) as Record<string, unknown>;
    expect("description" in r).toBe(false);
  });
});
