/**
 * W8c · a suggested goal per unlinked mission (Sunsama S1 at the mission level). 0 of 13 prod missions carry a goal;
 * the drawer offers "Suggested: <goal> · Use". The rank is the linker's own cosine over the mission's stored vector
 * and each active goal's vector (the linker embeds goals as sourceType "life_goal", same model only); when any goal
 * has no same-model vector the whole rank falls back to a word-overlap score, labelled basis "words".
 *
 * GUARD: the suggestion is keyed by the goal's id from the server's own active list; a goal title inside the
 * mission title is matched as words, never returned or used as the key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mission: vi.fn(), goals: vi.fn(), vectors: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: { findFirst: h.mission },
    lifeGoal: { findMany: h.goals },
    vectorEmbedding: { findMany: h.vectors },
  },
}));

import {
  SUGGEST_GOAL_MAX_GOALS,
  SUGGEST_GOAL_MIN_COSINE,
  SUGGEST_GOAL_MIN_WORDS,
  suggestGoalForMission,
  wordOverlapScore,
} from "@/lib/missions/suggest-goal";

const SPACE = "cohere:embed-v4.0";
const vec = (...xs: number[]) => JSON.stringify(xs);
const goal = (id: string, title: string, why: string | null = null) => ({ id, title, why });
const missionRow = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  title: "Bay two lift install",
  successMetric: null,
  completionCriteria: null,
  lifeGoalId: null,
  ...over,
});

beforeEach(() => {
  h.mission.mockReset();
  h.goals.mockReset();
  h.vectors.mockReset();
  h.mission.mockResolvedValue(missionRow());
  h.vectors.mockResolvedValue([]);
});

describe("suggestGoalForMission · embedding basis", () => {
  it("ranks active goals by cosine against the mission's stored vector and returns the best goal's id", async () => {
    h.goals.mockResolvedValue([goal("g1", "Grow the shop"), goal("g2", "Run a marathon")]);
    h.vectors.mockResolvedValue([
      { sourceType: "mission", sourceId: "m1", embedding: vec(1, 0, 0), model: SPACE },
      { sourceType: "life_goal", sourceId: "g1", embedding: vec(0.9, 0.1, 0), model: SPACE },
      { sourceType: "life_goal", sourceId: "g2", embedding: vec(0, 1, 0), model: SPACE },
    ]);
    const s = await suggestGoalForMission("m1");
    expect(s).toMatchObject({ goalId: "g1", title: "Grow the shop", basis: "embedding" });
    expect(s!.score).toBeGreaterThan(0.9);
    const where = h.goals.mock.calls[0][0];
    expect(where.where).toEqual({ status: "active", deletedAt: null });
    expect(where.take).toBe(SUGGEST_GOAL_MAX_GOALS);
  });

  it("returns null when the best cosine is under SUGGEST_GOAL_MIN_COSINE (a measured no-match, not a guess)", async () => {
    h.goals.mockResolvedValue([goal("g1", "Grow the shop")]);
    const below = SUGGEST_GOAL_MIN_COSINE - 0.05;
    h.vectors.mockResolvedValue([
      { sourceType: "mission", sourceId: "m1", embedding: vec(1, 0), model: SPACE },
      { sourceType: "life_goal", sourceId: "g1", embedding: vec(below, Math.sqrt(1 - below * below)), model: SPACE },
    ]);
    expect(await suggestGoalForMission("m1")).toBeNull();
  });

  it("CONTROL: the same pair just over the threshold IS suggested", async () => {
    h.goals.mockResolvedValue([goal("g1", "Grow the shop")]);
    const above = SUGGEST_GOAL_MIN_COSINE + 0.05;
    h.vectors.mockResolvedValue([
      { sourceType: "mission", sourceId: "m1", embedding: vec(1, 0), model: SPACE },
      { sourceType: "life_goal", sourceId: "g1", embedding: vec(above, Math.sqrt(1 - above * above)), model: SPACE },
    ]);
    expect(await suggestGoalForMission("m1")).toMatchObject({ goalId: "g1", basis: "embedding" });
  });

  it("never mixes models: a goal vector from another model sends the whole rank to the word fallback", async () => {
    h.goals.mockResolvedValue([goal("g1", "Bay two lift"), goal("g2", "Run a marathon")]);
    h.vectors.mockResolvedValue([
      { sourceType: "mission", sourceId: "m1", embedding: vec(1, 0), model: SPACE },
      { sourceType: "life_goal", sourceId: "g1", embedding: vec(1, 0), model: "venice-bge-m3" },
      { sourceType: "life_goal", sourceId: "g2", embedding: vec(0, 1), model: SPACE },
    ]);
    expect(await suggestGoalForMission("m1")).toMatchObject({ goalId: "g1", basis: "words" });
  });
});

describe("suggestGoalForMission · word fallback (no goal vectors yet)", () => {
  it("scores shared content words between the mission and each goal's title + why, labelled basis 'words'", async () => {
    h.mission.mockResolvedValue(missionRow({ title: "Install the bay two lift", successMetric: "lift passes inspection" }));
    h.goals.mockResolvedValue([goal("g1", "Run a marathon"), goal("g2", "Second lift running", "bay two doubles throughput")]);
    const s = await suggestGoalForMission("m1");
    expect(s).toMatchObject({ goalId: "g2", title: "Second lift running", basis: "words" });
    expect(s!.score).toBeGreaterThanOrEqual(SUGGEST_GOAL_MIN_WORDS);
  });

  it("returns null when no goal shares a content word (stopwords do not count)", async () => {
    h.mission.mockResolvedValue(missionRow({ title: "Call the insurance agent" }));
    h.goals.mockResolvedValue([goal("g1", "Run the marathon")]);
    expect(await suggestGoalForMission("m1")).toBeNull();
  });

  it("GUARD: a goal title inside the mission title is matched by words but keyed by the goal's id", async () => {
    h.mission.mockResolvedValue(missionRow({ title: "Hit 15K revenue this month" }));
    h.goals.mockResolvedValue([goal("cuid_goal_7", "Hit 15K revenue this month")]);
    const s = await suggestGoalForMission("m1");
    expect(s!.goalId).toBe("cuid_goal_7");
    expect(s!.goalId).not.toBe("Hit 15K revenue this month");
  });

  it("wordOverlapScore is 0 for no shared word and 1 for the same words", () => {
    expect(wordOverlapScore("bay lift", "marathon")).toBe(0);
    expect(wordOverlapScore("Bay lift", "the lift, bay!")).toBe(1);
  });
});

describe("suggestGoalForMission · what it never does", () => {
  it("suggests nothing for a mission that already has a goal, and reads no goals", async () => {
    h.mission.mockResolvedValue(missionRow({ lifeGoalId: "g1" }));
    expect(await suggestGoalForMission("m1")).toBeNull();
    expect(h.goals).not.toHaveBeenCalled();
  });

  it("no active goals is null, not an error", async () => {
    h.goals.mockResolvedValue([]);
    expect(await suggestGoalForMission("m1")).toBeNull();
  });

  it("a mission that does not exist throws (the drawer says couldn't suggest)", async () => {
    h.mission.mockResolvedValue(null);
    await expect(suggestGoalForMission("nope")).rejects.toThrow(/not found/i);
  });

  it("a failed read throws, never reads as 'no suggestion'", async () => {
    h.goals.mockRejectedValue(new Error("db down"));
    await expect(suggestGoalForMission("m1")).rejects.toThrow("db down");
  });

  it("reads the mission by id, live only", async () => {
    h.goals.mockResolvedValue([]);
    await suggestGoalForMission("m1");
    expect(h.mission.mock.calls[0][0].where).toEqual({ id: "m1", deletedAt: null });
  });
});
