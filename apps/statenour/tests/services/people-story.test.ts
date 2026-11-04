/**
 * W8b (research mechanism T1, audit C8/B10) · the person page shows her whole story: every journal entry that
 * names her (newest first, capped, "more" when cut) and the goals she relates to (owner of a task under a goal, or
 * a goal_moment memory stamped with her id). Reads throw on failure so the panel can say "couldn't load".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dumps: vi.fn(), refls: vi.fn(), tasks: vi.fn(), memories: vi.fn(), goals: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainDump: { findMany: h.dumps },
    reflection: { findMany: h.refls },
    task: { findMany: h.tasks },
    brainMemory: { findMany: h.memories },
    lifeGoal: { findMany: h.goals },
  },
}));

import { PERSON_STORY_ENTRY_CAP, personStory } from "@/lib/services/people/person-story";
import { TASK_GOAL_SELECT } from "@/lib/services/task-goal-server";

const dump = (i: number) => ({ id: `d${i}`, createdAt: new Date(2026, 10, 1, 12, i), rawThoughts: `Entry ${i} about Dania and more words` });

beforeEach(() => {
  vi.clearAllMocks();
  h.dumps.mockResolvedValue([]);
  h.refls.mockResolvedValue([]);
  h.tasks.mockResolvedValue([]);
  h.memories.mockResolvedValue([]);
  h.goals.mockResolvedValue([]);
});

describe("personStory · entries", () => {
  it("every live entry naming her, newest first, excerpt windowed on her name, each a link to the entry", async () => {
    h.dumps.mockResolvedValue([dump(2), dump(1)]);
    const s = await personStory({ personId: "p1", personName: "Dania" });
    expect(s.entries.map((e) => e.id)).toEqual(["d2", "d1"]);
    expect(s.entries[0]).toMatchObject({ kind: "journal", href: "/journal?entry=d2#bd-d2" });
    expect(s.entries[0].excerpt).toContain("Dania");
    expect(s.entriesTruncated).toBe(false);
    const q = h.dumps.mock.calls[0][0];
    expect(q.where).toEqual({ deletedAt: null, personIds: { has: "p1" } });
    expect(q.orderBy).toEqual({ createdAt: "desc" });
    expect(q.take).toBe(PERSON_STORY_ENTRY_CAP + 1);
  });

  it("reflections are entries too: merged by time with the dumps, one cap over both", async () => {
    h.dumps.mockResolvedValue([dump(1)]);
    h.refls.mockResolvedValue([{ id: "r1", createdAt: new Date(2026, 10, 1, 12, 5), insight: "**WHAT**: Dania came by" }]);
    const s = await personStory({ personId: "p1", personName: "Dania" });
    expect(s.entries.map((e) => [e.id, e.kind])).toEqual([["r1", "reflection"], ["d1", "journal"]]);
    expect(s.entries[0].href).toBe("/journal?entry=r1#bd-r1");
    expect(h.refls.mock.calls[0][0].where).toEqual({ deletedAt: null, personIds: { has: "p1" } });
  });

  it("reads one past the cap and says the list was cut", async () => {
    expect(PERSON_STORY_ENTRY_CAP).toBe(10);
    h.dumps.mockResolvedValue(Array.from({ length: PERSON_STORY_ENTRY_CAP + 1 }, (_, i) => dump(i)));
    const s = await personStory({ personId: "p1", personName: "Dania" });
    expect(s.entries).toHaveLength(PERSON_STORY_ENTRY_CAP);
    expect(s.entriesTruncated).toBe(true);
  });
});

describe("personStory · goals", () => {
  it("a task she owns under a goal (own goalId, or the mission's goal) and a goal_moment stamped with her id; one row per goal", async () => {
    h.tasks.mockResolvedValue([
      { goalId: "g1", goal: { id: "g1", title: "Grow", deletedAt: null }, mission: null },
      { goalId: null, goal: null, mission: { lifeGoalId: "g2", lifeGoal: { id: "g2", title: "Rest", deletedAt: null } } },
      { goalId: "g1", goal: { id: "g1", title: "Grow", deletedAt: null }, mission: null },
      // A deleted goal is left out.
      { goalId: "g9", goal: { id: "g9", title: "Old", deletedAt: new Date() }, mission: null },
    ]);
    h.memories.mockResolvedValue([{ metadata: { personId: "p1", goalId: "g3" } }, { metadata: { personId: "p1", goalId: "g1" } }]);
    h.goals.mockResolvedValue([{ id: "g3", title: "Learn" }]);
    const s = await personStory({ personId: "p1", personName: "Dania" });
    expect(s.goals).toEqual([
      { id: "g1", title: "Grow", via: "tasks", href: "/stats?tab=goals#goal-g1" },
      { id: "g2", title: "Rest", via: "tasks", href: "/stats?tab=goals#goal-g2" },
      { id: "g3", title: "Learn", via: "moment", href: "/stats?tab=goals#goal-g3" },
    ]);
    expect(h.tasks.mock.calls[0][0].where).toMatchObject({ personId: "p1", deletedAt: null });
    // The moment read is the W6 shape: metadata.personId, category goal_moment, live rows only.
    expect(h.memories.mock.calls[0][0].where).toMatchObject({ deletedAt: null, metadata: { path: ["personId"], equals: "p1" } });
    // Only the goal ids the tasks did not already name are looked up.
    expect(h.goals.mock.calls[0][0].where).toEqual({ id: { in: ["g3"] }, deletedAt: null });
  });

  // Manager round 1, item 7c: W8a's one rule. A deleted own goal falls through to the mission's live goal.
  it("reads tasks through taskGoalServer: own live goal, else the mission's live goal", async () => {
    h.tasks.mockResolvedValue([
      { goal: { id: "g9", title: "Old", deletedAt: new Date() }, mission: { lifeGoal: { id: "g2", title: "Rest", deletedAt: null } } },
      { goal: { id: "g8", title: "Gone", deletedAt: new Date() }, mission: { lifeGoal: { id: "g7", title: "Also gone", deletedAt: new Date() } } },
    ]);
    const s = await personStory({ personId: "p1", personName: "Dania" });
    expect(s.goals.map((g) => g.id)).toEqual(["g2"]);
    expect(h.tasks.mock.calls[0][0].select).toEqual(TASK_GOAL_SELECT);
  });

  it("no goal moments: no goal lookup at all", async () => {
    await personStory({ personId: "p1", personName: "Dania" });
    expect(h.goals).not.toHaveBeenCalled();
  });

  it("a failed read throws (the panel says couldn't load, never an empty story)", async () => {
    h.dumps.mockRejectedValue(new Error("down"));
    await expect(personStory({ personId: "p1", personName: "Dania" })).rejects.toThrow("down");
  });
});
