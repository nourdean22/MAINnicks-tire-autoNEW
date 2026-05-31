import { describe, it, expect } from "vitest";
import {
  HORIZON_RANK,
  ancestorChain,
  validateParentLink,
  rollUpChildren,
} from "@/lib/mastery/goal-ladder";

describe("goal-ladder · ancestorChain", () => {
  it("walks a linear parent chain to the root", () => {
    const parentOf = new Map<string, string | null>([
      ["c", "b"],
      ["b", "a"],
      ["a", null],
    ]);
    expect(ancestorChain("c", parentOf)).toEqual(["c", "b", "a"]);
  });

  it("returns [] for a null/undefined start", () => {
    expect(ancestorChain(null, new Map())).toEqual([]);
    expect(ancestorChain(undefined, new Map())).toEqual([]);
  });

  it("does not hang on a pre-existing corrupt cycle (each node once)", () => {
    const parentOf = new Map<string, string | null>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(ancestorChain("a", parentOf)).toEqual(["a", "b"]);
  });
});

describe("goal-ladder · validateParentLink", () => {
  // week -> month -> year (a valid ladder); day + noh are roots.
  const horizonOf = new Map<string, string | null>([
    ["day", "DAY"],
    ["week", "WEEK"],
    ["month", "MONTH"],
    ["year", "YEAR"],
    ["noh", null],
  ]);
  const parentOf = new Map<string, string | null>([
    ["week", "month"],
    ["month", "year"],
    ["year", null],
    ["day", null],
    ["noh", null],
  ]);

  it("allows unlink (null parent)", () => {
    expect(validateParentLink({ goalId: "week", parentGoalId: null, horizonOf, parentOf })).toEqual({
      ok: true,
    });
  });

  it("rejects self-parent", () => {
    expect(
      validateParentLink({ goalId: "week", parentGoalId: "week", horizonOf, parentOf }),
    ).toEqual({ ok: false, reason: "self" });
  });

  it("rejects a cycle (linking to a descendant)", () => {
    // week -> month -> year already, so 'week' is a descendant of 'year';
    // setting year.parent = week would loop.
    expect(
      validateParentLink({ goalId: "year", parentGoalId: "week", horizonOf, parentOf }),
    ).toEqual({ ok: false, reason: "cycle" });
  });

  it("rejects an inverted horizon (parent shorter than child)", () => {
    // child=year(4), parent=day(0) — not a cycle, but inverted.
    expect(
      validateParentLink({ goalId: "year", parentGoalId: "day", horizonOf, parentOf }),
    ).toEqual({ ok: false, reason: "horizon" });
  });

  it("allows a valid higher-horizon parent", () => {
    // child=day(0) -> parent=week(1)
    expect(
      validateParentLink({ goalId: "day", parentGoalId: "week", horizonOf, parentOf }),
    ).toEqual({ ok: true });
  });

  it("allows an equal-horizon parent (lenient grouping)", () => {
    const h = new Map<string, string | null>([
      ["a", "WEEK"],
      ["b", "WEEK"],
    ]);
    const p = new Map<string, string | null>([
      ["a", null],
      ["b", null],
    ]);
    expect(validateParentLink({ goalId: "a", parentGoalId: "b", horizonOf: h, parentOf: p })).toEqual({
      ok: true,
    });
  });

  it("skips the horizon check when either horizon is unknown", () => {
    // child='noh' has null horizon -> horizon rule cannot apply -> allowed
    expect(
      validateParentLink({ goalId: "noh", parentGoalId: "day", horizonOf, parentOf }),
    ).toEqual({ ok: true });
  });
});

describe("goal-ladder · rollUpChildren", () => {
  it("returns zeros for no children", () => {
    expect(rollUpChildren([])).toEqual({ childCount: 0, doneCount: 0, avgChildProgress: 0 });
  });

  it("counts done (achieved|completed) and averages progress (rounded)", () => {
    const r = rollUpChildren([
      { progress: 100, status: "achieved" },
      { progress: 50, status: "active" },
      { progress: 30, status: "completed" },
    ]);
    expect(r).toEqual({ childCount: 3, doneCount: 2, avgChildProgress: 60 });
  });

  it("treats non-finite progress as 0", () => {
    const r = rollUpChildren([
      { progress: Number.NaN, status: "active" },
      { progress: 80, status: "active" },
    ]);
    expect(r.avgChildProgress).toBe(40);
  });
});

describe("goal-ladder · HORIZON_RANK", () => {
  it("orders short -> long", () => {
    expect(HORIZON_RANK.DAY).toBeLessThan(HORIZON_RANK.WEEK);
    expect(HORIZON_RANK.WEEK).toBeLessThan(HORIZON_RANK.MONTH);
    expect(HORIZON_RANK.MONTH).toBeLessThan(HORIZON_RANK.QUARTER);
    expect(HORIZON_RANK.QUARTER).toBeLessThan(HORIZON_RANK.YEAR);
    expect(HORIZON_RANK.YEAR).toBeLessThan(HORIZON_RANK.LIFE);
  });
});
