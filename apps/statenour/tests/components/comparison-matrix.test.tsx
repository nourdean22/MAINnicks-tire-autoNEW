/**
 * v10.0.553 · tests/components/comparison-matrix.test.tsx
 *
 * Contract tests for the generic <ComparisonMatrix>. Mirrors the
 * existing component-test pattern · vitest in `environment: "node"`
 * with `react-dom/server.renderToString` (no jsdom dep).
 *
 * Coverage matrix:
 *   1. Renders the right number of <tr> / <th> for given options + criteria
 *   2. Per-column scoring tints the top-30% emerald, bottom-30% rose
 *   3. aria-sort attribute appears on the active-sort header
 *   4. Empty options array renders gracefully (no crash, empty-state copy)
 *   5. Empty criteria array renders gracefully
 *   6. Null cells get the neutral tint (not green/red)
 *   7. `higherIsBetter: false` inverts the ranking
 *   8. Display override is respected
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";

import {
  ComparisonMatrix,
  type MatrixCell,
  type MatrixCriterion,
  type MatrixOption,
} from "@/components/ui/comparison-matrix";

// ── Fixture · 5 options × 3 criteria · enough to exercise quantile tinting ──
const FIVE_OPTIONS: MatrixOption[] = [
  { id: "a", label: "Option A" },
  { id: "b", label: "Option B" },
  { id: "c", label: "Option C" },
  { id: "d", label: "Option D" },
  { id: "e", label: "Option E" },
];

const THREE_CRITERIA: MatrixCriterion[] = [
  { id: "score", label: "Score", higherIsBetter: true },
  { id: "cost", label: "Cost", higherIsBetter: false },
  { id: "rating", label: "Rating", higherIsBetter: true },
];

// Per-cell data · option A has best score (100) · option E worst (60).
// Cost is lowest-best · A cheapest (10) · E most expensive (50).
// Rating · D has null · everyone else 3..5.
const FIXTURE_VALUES: Record<string, Record<string, number | null>> = {
  a: { score: 100, cost: 10, rating: 5 },
  b: { score: 90, cost: 20, rating: 4 },
  c: { score: 80, cost: 30, rating: 3 },
  d: { score: 70, cost: 40, rating: null },
  e: { score: 60, cost: 50, rating: 4 },
};

function fixtureCells(opt: MatrixOption, crit: MatrixCriterion): MatrixCell {
  const v = FIXTURE_VALUES[opt.id]?.[crit.id];
  if (v === undefined || v === null) return { value: null };
  return { value: v, score: v };
}

// Helper · strip React's SSR `<!-- -->` comment markers before asserting.
const norm = (s: string) => s.replace(/<!--\s*-->/g, "");

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ComparisonMatrix · structure", () => {
  it("renders one <tr> in tbody per option + one in thead", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
      />,
    );
    // Five body rows + one header row = six <tr> open tags total.
    const trMatches = html.match(/<tr/g) ?? [];
    expect(trMatches.length).toBe(6);
  });

  it("renders one <th scope='col'> per criterion plus one for the option-label column", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
      />,
    );
    const colHeaders = html.match(/scope="col"/g) ?? [];
    // 3 criteria + 1 option-label column = 4 column-scoped headers.
    expect(colHeaders.length).toBe(4);
  });

  it("renders one <th scope='row'> per option", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
      />,
    );
    const rowHeaders = html.match(/scope="row"/g) ?? [];
    expect(rowHeaders.length).toBe(5);
  });
});

describe("ComparisonMatrix · color-coded cells", () => {
  it("tints the top 30% of scores green per column (higherIsBetter=true)", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
      />,
    );
    // For 5 options · ceil(0.3 * 5) = 2 → top 2 are emerald.
    // Score column · A (100) + B (90) should be emerald.
    // We assert via the data-tint attribute (deterministic · resilient
    // to className refactors).
    const emeraldCells = html.match(/data-tint="emerald"/g) ?? [];
    const roseCells = html.match(/data-tint="rose"/g) ?? [];
    // Per criterion · 2 emerald + 2 rose = 4 each across 3 criteria.
    // Rating column has only 4 scored cells (D is null) · still top-2
    // emerald + bottom-2 rose by the >3 quantile path.
    expect(emeraldCells.length).toBe(6); // 2 per criterion · 3 criteria
    expect(roseCells.length).toBe(6);
  });

  it("renders the corresponding tint classes (emerald-300, rose-300)", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
      />,
    );
    expect(html).toMatch(/bg-emerald-500\/15/);
    expect(html).toMatch(/bg-rose-500\/15/);
    expect(html).toMatch(/bg-amber-500\/15/);
  });

  it("flips ranking when higherIsBetter=false (cost lower is best)", () => {
    // Cost column · lower = better · so the cheapest options (A:10, B:20)
    // should be emerald · most expensive (D:40, E:50) rose. We verify
    // by isolating the cost column · a one-column matrix.
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={[{ id: "cost", label: "Cost", higherIsBetter: false }]}
        cells={fixtureCells}
      />,
    );
    // Pull all rows in document order · the first emerald row should be A.
    // Capture cell rendered values to confirm.
    const cellValues = [...html.matchAll(/data-tint="([^"]+)"[^>]*>([^<]+)</g)];
    expect(cellValues.length).toBe(5);
    // After default desc sort by the (only) column · cost-low-is-better
    // means desc sort surfaces the worst first · but we sort by raw key
    // not by tint · so confirm tints are assigned to the right cell value.
    const emeraldValues = cellValues
      .filter((m) => m[1] === "emerald")
      .map((m) => m[2]);
    // emerald = the 2 best · since lower-is-better the best are 10 and 20.
    expect(emeraldValues.sort()).toEqual(["10", "20"]);
  });

  it("leaves null cells with the neutral tint (no green / red)", () => {
    // Option D has rating=null · its rating cell must be neutral.
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={[{ id: "rating", label: "Rating" }]}
        cells={fixtureCells}
      />,
    );
    // Pull all 5 cells · the one with display "—" must be neutral.
    const cells = [...html.matchAll(/data-tint="([^"]+)"[^>]*>([^<]+)</g)];
    const emDash = cells.find((m) => m[2] === "—");
    expect(emDash).toBeDefined();
    expect(emDash?.[1]).toBe("neutral");
  });

  it("respects MatrixCell.display override", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={[{ id: "x", label: "X" }]}
        criteria={[{ id: "k", label: "K" }]}
        cells={() => ({ value: 0.42, display: "$0.42" })}
      />,
    );
    expect(html).toContain("$0.42");
    expect(html).not.toContain(">0.42<"); // raw float should be replaced
  });
});

describe("ComparisonMatrix · sort + a11y", () => {
  it("places aria-sort on the active-sort header (descending by default)", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
      />,
    );
    // Default sort criterion = first criterion = "score" · descending.
    expect(html).toMatch(/aria-sort="descending"/);
    // The other criteria carry aria-sort="none".
    const noneCount = (html.match(/aria-sort="none"/g) ?? []).length;
    expect(noneCount).toBe(2);
  });

  it("honors defaultSortCriterion prop", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
        defaultSortCriterion="rating"
      />,
    );
    // Find the "Rating" header and check it carries descending.
    const ratingHeader = html.match(
      /<th[^>]*aria-sort="descending"[^>]*>[\s\S]*?Rating/,
    );
    expect(ratingHeader).not.toBeNull();
  });

  it("makes sortable headers keyboard-focusable (tabIndex=0)", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
      />,
    );
    // Three sortable column headers · all must be tabIndex=0.
    const tabCount = (html.match(/tabIndex="0"/g) ?? []).length;
    // React serializes tabIndex={0} as `tabindex="0"` in SSR.
    const lowerCount = (html.match(/tabindex="0"/g) ?? []).length;
    expect(tabCount + lowerCount).toBe(3);
  });

  it("renders the title and caption when supplied", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
        title="vendor bake-off"
        caption="lowest cost wins"
      />,
    );
    expect(norm(html)).toMatch(/vendor bake-off/);
    expect(norm(html)).toMatch(/lowest cost wins/);
  });
});

describe("ComparisonMatrix · empty states", () => {
  it("renders gracefully when options is empty", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={[]}
        criteria={THREE_CRITERIA}
        cells={fixtureCells}
      />,
    );
    expect(html).toMatch(/no options to compare/i);
    // No <tbody> rows.
    const trMatches = html.match(/<tr/g) ?? [];
    expect(trMatches.length).toBe(0);
  });

  it("renders gracefully when criteria is empty", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={FIVE_OPTIONS}
        criteria={[]}
        cells={fixtureCells}
      />,
    );
    expect(html).toMatch(/no criteria defined/i);
  });

  it("renders gracefully when both dimensions are empty", () => {
    const html = renderToString(
      <ComparisonMatrix
        options={[]}
        criteria={[]}
        cells={fixtureCells}
      />,
    );
    // Either empty-state branch fires · first match wins (options empty).
    expect(html).toMatch(/no options|no criteria/i);
  });
});
