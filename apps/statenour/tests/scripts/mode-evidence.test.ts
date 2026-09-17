/**
 * Canaries for the mode probes' verdict logic.
 *
 * WHY THIS FILE EXISTS — two separate lies, both caught by review, both mine.
 *
 * 1. The probe's first draft printed "deep turns NEVER named a tool (0/348)" as
 *    a finding while `tool.chosen` had written exactly ONE row in its life. The
 *    LEFT JOIN reported 347 turns as "never named a tool" for a reason that had
 *    nothing to do with routing — the lane was one day old.
 *
 * 2. Worse: the whole ROUTING conclusion was wrong. Grouping by `mode` and
 *    calling the deep share "turns that cannot call tools" assumed the tag named
 *    the lane. It does not — `alternate-paths.ts` gates that branch on
 *    complexity/intent and never reads `mode`. That conclusion reached a PR body,
 *    agent memory and a spawned task before it was refuted.
 *
 * The coverage floor and the explicit refusal are the fixes. These tests are
 * what stop either being quietly removed.
 */
import { describe, it, expect } from "vitest";
import {
  classifyModeEvidence,
  assessJoinCoverage,
  CHOSEN_COVERAGE_FLOOR,
  JOIN_COVERAGE_FLOOR,
  LANE_ATTRIBUTION_AVAILABLE,
} from "../../scripts/lib/mode-evidence.mjs";

/** The shape production actually returned on 2026-09-17. */
const PROD_SHAPE = [
  { mode: "deep", turns: 348, with_chosen_row: 1, observed: 0, named_a_tool: 0 },
  { mode: "standard", turns: 120, with_chosen_row: 0, observed: 0, named_a_tool: 0 },
];

describe("classifyModeEvidence", () => {
  it("reports the deep share as a descriptive statistic", () => {
    const r = classifyModeEvidence({ rows: PROD_SHAPE, total: 468 });
    expect(r.deepTurns).toBe(348);
    expect(r.deepShare).toBeCloseTo(74.4, 1);
  });

  // The refusal is load-bearing: "routing-inflated" was the wrong answer.
  it("never claims a routing verdict — mode cannot attribute a lane", () => {
    const r = classifyModeEvidence({ rows: PROD_SHAPE, total: 468 });
    expect(r.verdict).toBe("cannot-attribute-lane");
    expect(r.canAttributeLane).toBe(false);
    expect(LANE_ATTRIBUTION_AVAILABLE).toBe(false);
  });

  it("refuses to call named>=1 informative with no observed deep rows", () => {
    const r = classifyModeEvidence({ rows: PROD_SHAPE, total: 468 });
    expect(r.observedForDeep).toBe(0);
    expect(r.chosenIsInformative).toBe(false);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // Break the guard: drop the floor to 0, which is what "simplifying away the
  // floor" would do. The SAME input must now read as informative — i.e. the
  // floor is load-bearing, not decoration.
  it("CANARY — dropping the floor makes the same input read as informative", () => {
    const guarded = classifyModeEvidence({ rows: PROD_SHAPE, total: 468 });
    const unguarded = classifyModeEvidence({ rows: PROD_SHAPE, total: 468, floor: 0 });
    expect(guarded.chosenIsInformative).toBe(false);
    expect(unguarded.chosenIsInformative).toBe(true);
  });

  // ── CANARY for the exact defect review found ────────────────────────
  // Coverage once summed `with_chosen_row` across ALL modes. A blind row is
  // explicitly "no measurement", so 30 blind deep rows must NOT unlock the
  // column. Under the old summing logic this input passed the floor.
  it("CANARY — 30 BLIND deep rows do not make the column informative", () => {
    const rows = [
      { mode: "deep", turns: 348, with_chosen_row: 30, observed: 0, named_a_tool: 0 },
      { mode: "standard", turns: 120, with_chosen_row: 0, observed: 0, named_a_tool: 0 },
    ];
    const r = classifyModeEvidence({ rows, total: 468 });
    expect(r.observedForDeep).toBe(0);
    expect(r.chosenIsInformative).toBe(false);
  });

  // Same defect, other direction: standard-mode rows are a different
  // population and say nothing about deep.
  it("CANARY — 40 observed STANDARD rows do not vouch for deep", () => {
    const rows = [
      { mode: "deep", turns: 348, with_chosen_row: 0, observed: 0, named_a_tool: 0 },
      { mode: "standard", turns: 120, with_chosen_row: 40, observed: 40, named_a_tool: 7 },
    ];
    const r = classifyModeEvidence({ rows, total: 468 });
    expect(r.chosenIsInformative).toBe(false);
  });

  it("becomes informative once OBSERVED deep coverage reaches the floor", () => {
    const rows = [
      {
        mode: "deep",
        turns: 348,
        with_chosen_row: CHOSEN_COVERAGE_FLOOR,
        observed: CHOSEN_COVERAGE_FLOOR,
        named_a_tool: 0,
      },
    ];
    expect(classifyModeEvidence({ rows, total: 468 }).chosenIsInformative).toBe(true);
  });

  // The floor is asymmetric by design: it gates the ABSENCE claim only.
  it("lets a single counterexample refute even below the floor", () => {
    const rows = [
      { mode: "deep", turns: 348, with_chosen_row: 1, observed: 1, named_a_tool: 1 },
    ];
    const r = classifyModeEvidence({ rows, total: 468 });
    expect(r.chosenIsInformative).toBe(false);
    expect(r.verdict).toBe("partly-refuted");
  });

  it("returns a null share rather than 0% when there is nothing to divide by", () => {
    const r = classifyModeEvidence({ rows: [], total: 0 });
    expect(r.deepShare).toBeNull();
    expect(r.verdict).toBe("no-deep");
  });

  it("says no-deep when deep never appears, instead of inventing a share", () => {
    const rows = [{ mode: "standard", turns: 120, with_chosen_row: 40, observed: 40, named_a_tool: 9 }];
    const r = classifyModeEvidence({ rows, total: 120 });
    expect(r.deepTurns).toBe(0);
    expect(r.verdict).toBe("no-deep");
  });
});

/**
 * An INNER JOIN drops non-matching rows SILENTLY. A per-group split computed
 * over 40% of the population looks identical to one computed over all of it,
 * because the dropped rows are absent from the output by construction.
 */
describe("assessJoinCoverage", () => {
  it("reports full coverage when nothing is dropped", () => {
    const c = assessJoinCoverage({ total: 1891, joined: 1891 });
    expect(c.dropped).toBe(0);
    expect(c.pct).toBe(100);
    expect(c.usable).toBe(true);
  });

  it("counts the silently dropped rows", () => {
    const c = assessJoinCoverage({ total: 1000, joined: 400 });
    expect(c.dropped).toBe(600);
    expect(c.pct).toBeCloseTo(40, 5);
    expect(c.usable).toBe(false);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // An EMPTY population must not report "100% usable". 0/0 is the classic
  // shape of a measured zero dressed as a clean bill of health.
  it("CANARY — an empty population is NOT 100% usable", () => {
    const c = assessJoinCoverage({ total: 0, joined: 0 });
    expect(c.pct).toBe(0);
    expect(c.usable).toBe(false);
  });

  it("holds the floor exactly at the boundary", () => {
    const atFloor = assessJoinCoverage({ total: 100, joined: JOIN_COVERAGE_FLOOR * 100 });
    const below = assessJoinCoverage({ total: 100, joined: JOIN_COVERAGE_FLOOR * 100 - 1 });
    expect(atFloor.usable).toBe(true);
    expect(below.usable).toBe(false);
  });
});
