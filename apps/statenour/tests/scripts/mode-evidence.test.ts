/**
 * Canaries for the deep-routing probe's verdict logic.
 *
 * WHY THIS FILE EXISTS. The probe's first draft printed
 * "deep turns NEVER named a tool (0/348)" as though it were a finding. It was
 * not: `tool.chosen` had written exactly ONE row in its entire life, because
 * the lane shipped that same day. The LEFT JOIN faithfully reported 347 turns
 * as "never named a tool" for a reason that has nothing to do with routing.
 *
 * That is the measured-zero lie the surrounding workstream exists to stamp
 * out, produced by the instrument built to detect it. The floor below is the
 * fix; these tests are what stop it being quietly removed.
 */
import { describe, it, expect } from "vitest";
import {
  classifyModeEvidence,
  assessJoinCoverage,
  CHOSEN_COVERAGE_FLOOR,
  JOIN_COVERAGE_FLOOR,
} from "../../scripts/lib/mode-evidence.mjs";

/** The shape production actually returned on 2026-09-17. */
const PROD_SHAPE = [
  { mode: "deep", turns: 348, with_chosen_row: 1, named_a_tool: 0 },
  { mode: "standard", turns: 120, with_chosen_row: 0, named_a_tool: 0 },
];

describe("classifyModeEvidence", () => {
  it("reports the real deep share from the production shape", () => {
    const r = classifyModeEvidence({ rows: PROD_SHAPE, total: 468 });
    expect(r.deepTurns).toBe(348);
    expect(r.deepShare).toBeCloseTo(74.4, 1);
    expect(r.verdict).toBe("routing-inflated");
  });

  it("refuses to call named>=1 informative on one chosen row", () => {
    const r = classifyModeEvidence({ rows: PROD_SHAPE, total: 468 });
    expect(r.chosenRows).toBe(1);
    expect(r.chosenIsInformative).toBe(false);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // Break the guard: drop the floor to 0, which is what "simplifying away
  // the floor" would do. The SAME input must now claim the column is
  // informative — i.e. the floor is load-bearing, not decoration. Without
  // this, a future edit could delete the floor and every test stay green.
  it("CANARY — dropping the floor makes the same one-row input read as informative", () => {
    const guarded = classifyModeEvidence({ rows: PROD_SHAPE, total: 468 });
    const unguarded = classifyModeEvidence({ rows: PROD_SHAPE, total: 468, floor: 0 });

    expect(guarded.chosenIsInformative).toBe(false);
    expect(unguarded.chosenIsInformative).toBe(true);
    expect(unguarded.chosenIsInformative).not.toBe(guarded.chosenIsInformative);
  });

  it("becomes informative once coverage reaches the floor", () => {
    const rows = [
      { mode: "deep", turns: 348, with_chosen_row: CHOSEN_COVERAGE_FLOOR, named_a_tool: 0 },
      { mode: "standard", turns: 120, with_chosen_row: 0, named_a_tool: 0 },
    ];
    expect(classifyModeEvidence({ rows, total: 468 }).chosenIsInformative).toBe(true);
  });

  // The floor is asymmetric by design: it gates the ABSENCE claim only.
  it("lets a single counterexample refute even below the floor", () => {
    const rows = [
      { mode: "deep", turns: 348, with_chosen_row: 1, named_a_tool: 1 },
      { mode: "standard", turns: 120, with_chosen_row: 0, named_a_tool: 0 },
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
    const rows = [{ mode: "standard", turns: 120, with_chosen_row: 40, named_a_tool: 9 }];
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
  // shape of a measured zero dressed as a clean bill of health: no rows to
  // drop, therefore nothing was dropped, therefore trust the split.
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
