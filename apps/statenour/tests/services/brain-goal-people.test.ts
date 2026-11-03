/**
 * lib/services/brain-goal-people.ts (job 2026-11-02-nour-os-interconnect W6): the /brain memory tab's goal and person
 * filters. Goal = goal moments (category goal_moment) plus the extractors' free-text goal facts (category goal); a
 * picked goal narrows to that goal's moments (metadata.goalId). Person = metadata.personId. A failed read throws, so
 * the panel says "couldn't load", never "nothing in the brain". A capped list says it is capped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ memFindMany: vi.fn(), goalFindMany: vi.fn(), personFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findMany: h.memFindMany },
    lifeGoal: { findMany: h.goalFindMany },
    personProfile: { findMany: h.personFindMany },
  },
}));

import { goalPeopleMemories, GOAL_PEOPLE_ROW_CAP, GOAL_OPTION_CAP, PERSON_OPTION_CAP } from "@/lib/services/brain-goal-people";

const at = new Date("2026-11-02T15:00:00Z");
const memRow = (i: number) => ({ id: `m${i}`, category: "goal_moment", content: `moment ${i}`, createdAt: at, metadata: { goalId: "g1", kind: "check_in" } });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.memFindMany.mockResolvedValue([{ id: "m1", category: "goal_moment", content: 'Achieved "Save $15k"', createdAt: at, metadata: { goalId: "g1", kind: "achieved" } }]);
  h.goalFindMany.mockResolvedValue([{ id: "g1", title: "Save $15k" }]);
  h.personFindMany.mockResolvedValue([{ id: "p1", name: "Sam" }]);
});

describe("goalPeopleMemories", () => {
  it("goal mode lists goal moments and free-text goal facts; a picked goal narrows to its moments", async () => {
    const all = await goalPeopleMemories({ by: "goal" });
    expect(h.memFindMany.mock.calls[0][0].where).toEqual({ category: { in: ["goal_moment", "goal"] }, deletedAt: null });
    expect(h.memFindMany.mock.calls[0][0].take).toBe(GOAL_PEOPLE_ROW_CAP + 1);
    expect(all.rows).toEqual([{ id: "m1", category: "goal_moment", content: 'Achieved "Save $15k"', at: at.toISOString(), kind: "achieved" }]);
    expect(all.options).toEqual([{ id: "g1", label: "Save $15k" }]);
    expect(all.rowsTruncated).toBe(false);
    expect(all.optionsTruncated).toBe(false);
    await goalPeopleMemories({ by: "goal", id: "g1" });
    // W8a (audit C4): a pinned memory tied to the goal (pinMemory goalId) is a goal memory too: any category, by metadata.goalId.
    expect(h.memFindMany.mock.calls[1][0].where).toEqual({ deletedAt: null, metadata: { path: ["goalId"], equals: "g1" } });
  });

  it("person mode reads rows by metadata.personId, any category, and asks for a pick when none is given", async () => {
    const none = await goalPeopleMemories({ by: "person" });
    expect(none.rows).toEqual([]);
    expect(none.needsPick).toBe(true);
    expect(h.memFindMany).not.toHaveBeenCalled();
    expect(none.options).toEqual([{ id: "p1", label: "Sam" }]);
    await goalPeopleMemories({ by: "person", id: "p1" });
    expect(h.memFindMany.mock.calls[0][0].where).toEqual({ deletedAt: null, metadata: { path: ["personId"], equals: "p1" } });
  });

  it("a list over its cap is cut to the cap and says it was cut", async () => {
    h.memFindMany.mockResolvedValue(Array.from({ length: GOAL_PEOPLE_ROW_CAP + 1 }, (_, i) => memRow(i)));
    h.goalFindMany.mockResolvedValue(Array.from({ length: GOAL_OPTION_CAP + 1 }, (_, i) => ({ id: `g${i}`, title: `Goal ${i}` })));
    const r = await goalPeopleMemories({ by: "goal" });
    expect(r.rows).toHaveLength(GOAL_PEOPLE_ROW_CAP);
    expect(r.rowsTruncated).toBe(true);
    expect(r.options).toHaveLength(GOAL_OPTION_CAP);
    expect(r.optionsTruncated).toBe(true);
    h.personFindMany.mockResolvedValue(Array.from({ length: PERSON_OPTION_CAP + 1 }, (_, i) => ({ id: `p${i}`, name: `P ${i}` })));
    const p = await goalPeopleMemories({ by: "person" });
    expect(p.options).toHaveLength(PERSON_OPTION_CAP);
    expect(p.optionsTruncated).toBe(true);
  });

  it("a failed read throws (the panel renders couldn't load), never an empty list", async () => {
    h.memFindMany.mockRejectedValue(new Error("db down"));
    await expect(goalPeopleMemories({ by: "goal" })).rejects.toThrow("db down");
    h.memFindMany.mockReset();
    h.goalFindMany.mockRejectedValue(new Error("options down"));
    await expect(goalPeopleMemories({ by: "goal" })).rejects.toThrow("options down");
  });
});
