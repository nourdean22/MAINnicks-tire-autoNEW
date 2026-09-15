/**
 * PriorityBreakdownView renders every term, largest first, the multipliers
 * and the arithmetic line (2026-09-15). Plain props, static markup.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PriorityBreakdownView } from "@/components/inspector/priority-breakdown";
import type { PriorityBreakdown } from "@/lib/scoring/task-priority";

const BREAKDOWN: PriorityBreakdown = {
  terms: [
    { key: "roi", label: "roi", input: 55, weight: 0.13, contribution: 7.15, note: "roi 55 (hand-assigned)" },
    { key: "dueUrgency", label: "deadline", input: 100, weight: 0.27, contribution: 27, note: "overdue 12d" },
    { key: "staleness", label: "staleness", input: 70, weight: 0.13, contribution: 9.1, note: "untouched 9d" },
    { key: "dollar", label: "dollars", input: 81, weight: 0.12, contribution: 9.72, note: "$1,846.5 in the title" },
    { key: "mission", label: "mission rank", input: 100, weight: 0.15, contribution: 15, note: "mission #1" },
    { key: "friction", label: "low friction", input: 70, weight: 0.09, contribution: 6.3, note: "friction 30" },
    { key: "energy", label: "energy fit", input: 100, weight: 0.05, contribution: 5, note: "high energy · morning" },
    { key: "active", label: "in progress", input: 0, weight: 0.06, contribution: 0, note: "not started" },
  ],
  weightedSum: 79.27,
  multipliers: [{ key: "blocked", factor: 0.35, note: "waiting on Eddy" }],
  score: 28,
};

describe("PriorityBreakdownView", () => {
  const html = renderToStaticMarkup(<PriorityBreakdownView breakdown={BREAKDOWN} />);

  it("renders all eight terms, largest contribution first", () => {
    const order = [...html.matchAll(/data-priority-term="([a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["dueUrgency", "mission", "dollar", "staleness", "roi", "friction", "energy", "active"]);
    expect(html).toContain("overdue 12d");
    expect(html).toContain('100×0.27 = <span class="text-fg-secondary">27</span>');
  });

  it("the deciding term gets the full bar; a zero term gets none", () => {
    expect(html).toContain("width:100%");
    expect(html).toContain("width:0%");
  });

  it("shows the multiplier and the arithmetic that lands on the score", () => {
    expect(html).toContain('data-priority-multiplier="blocked"');
    expect(html).toContain("waiting on Eddy");
    expect(html).toContain("Σ 79.27 × 0.35 → ");
    expect(html).toContain('data-priority-breakdown="28"');
  });

  it("with no multipliers the arithmetic line has no × factor (the control)", () => {
    const plain = renderToStaticMarkup(<PriorityBreakdownView breakdown={{ ...BREAKDOWN, multipliers: [], score: 79 }} />);
    expect(plain).toContain("Σ 79.27 → ");
    expect(plain).not.toContain("× ");
    expect(plain).not.toContain("data-priority-multiplier");
    expect(plain).toContain('data-priority-breakdown="79"');
  });
});
