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
  CHOSEN_COVERAGE_FLOOR,
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
