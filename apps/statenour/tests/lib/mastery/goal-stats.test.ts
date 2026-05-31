/**
 * Goal → stat resolution tests · Ambition Engine P1 · 2026-05-31.
 *
 * The pure half of the goal↔stat spine — domain inference, the
 * "declared overrides inferred" rule, the weight→XP math, and the
 * idempotency key. The DB crediting (creditGoalStatsForTask) is glue
 * over these + the already-tested creditStatXp, so it's integration-
 * covered, not unit-mocked here.
 */
import { describe, it, expect } from "vitest";
import {
  inferGoalStats,
  effectiveGoalStats,
  goalStatXp,
  goalTaskSourceKey,
  goalsByStat,
} from "@/lib/mastery/goal-stats";

describe("inferGoalStats · goal.domain → stat", () => {
  it("maps the goal domains the authoring UI emits to real stat keys", () => {
    expect(inferGoalStats("business")).toEqual([{ statKey: "business_ops", weight: 1 }]);
    expect(inferGoalStats("finance")).toEqual([{ statKey: "financial", weight: 1 }]);
    expect(inferGoalStats("health")).toEqual([{ statKey: "physical", weight: 1 }]);
    expect(inferGoalStats("fitness")).toEqual([{ statKey: "physical", weight: 1 }]);
    expect(inferGoalStats("content")).toEqual([{ statKey: "marketing", weight: 1 }]);
    expect(inferGoalStats("personal")).toEqual([{ statKey: "discipline", weight: 1 }]);
    expect(inferGoalStats("career")).toEqual([{ statKey: "business_ops", weight: 1 }]);
  });
  it("passes a domain through when it is already a valid stat key", () => {
    expect(inferGoalStats("technical")).toEqual([{ statKey: "technical", weight: 1 }]);
    expect(inferGoalStats("sales")).toEqual([{ statKey: "sales", weight: 1 }]);
  });
  it("is case- and whitespace-insensitive", () => {
    expect(inferGoalStats("  Business  ")).toEqual([{ statKey: "business_ops", weight: 1 }]);
  });
  it("returns [] for an unmappable or empty domain (no wrong credit)", () => {
    expect(inferGoalStats("misc")).toEqual([]);
    expect(inferGoalStats("")).toEqual([]);
  });
});

describe("effectiveGoalStats · declared overrides inferred", () => {
  it("uses declared GoalStat rows when present, dropping invalid keys", () => {
    const declared = [
      { statKey: "discipline", weight: 0.7 },
      { statKey: "not_a_real_stat", weight: 1 },
    ];
    expect(effectiveGoalStats(declared, "health")).toEqual([
      { statKey: "discipline", weight: 0.7 },
    ]);
  });
  it("falls back to domain inference when there are no declared rows", () => {
    expect(effectiveGoalStats([], "health")).toEqual([{ statKey: "physical", weight: 1 }]);
  });
  it("normalizes a non-positive declared weight to 1", () => {
    expect(effectiveGoalStats([{ statKey: "sales", weight: 0 }], "business")).toEqual([
      { statKey: "sales", weight: 1 },
    ]);
  });
  it("returns [] when declared are all invalid and the domain is unmappable", () => {
    expect(effectiveGoalStats([{ statKey: "nope", weight: 1 }], "misc")).toEqual([]);
  });
});

describe("goalStatXp · weight → XP (task signal base)", () => {
  it("scales SIGNAL_XP.task (1.0) by weight, to one decimal", () => {
    expect(goalStatXp(1)).toBe(1);
    expect(goalStatXp(2)).toBe(2);
    expect(goalStatXp(0.5)).toBe(0.5);
  });
  it("clamps a non-positive weight to 0 XP", () => {
    expect(goalStatXp(0)).toBe(0);
    expect(goalStatXp(-3)).toBe(0);
  });
});

describe("goalTaskSourceKey · idempotency key", () => {
  it("is stable per (task, stat) so re-crediting never double-counts", () => {
    expect(goalTaskSourceKey("t1", "physical")).toBe("goal-task:t1:physical");
  });
});

describe("goalsByStat · invert goals → stat → contributing goals", () => {
  it("groups goals under the stats they level (declared + inferred)", () => {
    const m = goalsByStat([
      { id: "g1", title: "Lose 44 lbs", domain: "health", statLinks: [] },
      { id: "g2", title: "$15K month", domain: "finance", statLinks: [] },
      {
        id: "g3",
        title: "Ship statenour",
        domain: "x",
        statLinks: [{ statKey: "physical", weight: 1 }],
      },
    ]);
    expect(m.get("physical")).toEqual([
      { id: "g1", title: "Lose 44 lbs" },
      { id: "g3", title: "Ship statenour" },
    ]);
    expect(m.get("financial")).toEqual([{ id: "g2", title: "$15K month" }]);
    expect(m.get("marketing")).toBeUndefined();
  });
  it("omits a goal with an unmappable domain and no declared stats", () => {
    expect(
      goalsByStat([{ id: "g", title: "x", domain: "misc", statLinks: [] }]).size,
    ).toBe(0);
  });
});
