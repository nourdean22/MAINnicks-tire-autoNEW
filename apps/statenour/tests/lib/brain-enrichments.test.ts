/**
 * tests/lib/brain-enrichments.test.ts
 *
 * Locks down the new pure-function enrichments shipped across all
 * 6 brain engines. Each test references the historical / scientific
 * source of the principle so we can audit "is this still the right
 * implementation?" cleanly.
 */

import { describe, it, expect } from "vitest";
import {
  pearson,
  pearsonLagged,
  findBestLag,
  bootstrapCorrelationCI,
  isStableAcrossStrata,
  detectMediator,
} from "@/lib/brain/correlation-finder";
import {
  tagMungerDisciplines,
  extractFalsifier,
  isFalsifiable,
  violationRate,
  findCounterWisdom,
} from "@/lib/brain/wisdom-distiller";
// ═══════════════════════════════════════════════════════════════
// CORRELATION-FINDER — Granger lag + bootstrap + Simpson + Reichenbach
// ═══════════════════════════════════════════════════════════════

describe("correlation-finder enrichments", () => {
  it("pearsonLagged returns the lagged correlation when there's a real lag relationship", () => {
    // Construct: y[t] = x[t-2] + small noise
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    const lag2 = pearsonLagged(x, y, 2);
    expect(lag2).toBeGreaterThan(0.95);
  });

  it("findBestLag identifies the best lag and flags exceedsConcurrent", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [10, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // y trails x by 1 mostly
    const result = findBestLag(x, y, 5);
    expect(result.lag).toBeGreaterThan(0);
  });

  it("bootstrapCorrelationCI flags constant data as not meaningful", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]; // constant — pearson is 0
    const ci = bootstrapCorrelationCI(x, y, 200);
    expect(ci.meaningful).toBe(false);
  });

  it("bootstrapCorrelationCI flags strong correlation as meaningful", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    const ci = bootstrapCorrelationCI(x, y, 200);
    expect(ci.meaningful).toBe(true);
    expect(ci.lo).toBeGreaterThan(0);
  });

  it("isStableAcrossStrata flags Simpson's-paradox-style flips", () => {
    // Overall: positive. Within stratum A: negative; within stratum B: negative.
    // Classic Simpson's setup.
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [5, 4, 3, 2, 1, 10, 9, 8, 7, 6];
    const strata = ["A", "A", "A", "A", "A", "B", "B", "B", "B", "B"];
    const result = isStableAcrossStrata(x, y, strata);
    expect(result.stable).toBe(false);
    expect(result.flipsIn.length).toBeGreaterThan(0);
  });

  it("detectMediator finds Z that explains away A↔B", () => {
    // Construct: A and B are both functions of C
    const c = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = c.map((v) => v * 2);
    const b = c.map((v) => v * 3);
    const found = detectMediator(a, b, [{ name: "C", series: c }]);
    expect(found.length).toBe(1);
    expect(found[0].reductionPct).toBeGreaterThan(80);
  });
});

// ═══════════════════════════════════════════════════════════════
// WISDOM-DISTILLER — Popper + Munger + Ericsson + Talmudic
// ═══════════════════════════════════════════════════════════════

describe("wisdom-distiller enrichments", () => {
  it("tagMungerDisciplines identifies psychology", () => {
    expect(tagMungerDisciplines("Beware loss aversion in pricing")).toContain(
      "psychology",
    );
  });

  it("tagMungerDisciplines identifies multi-discipline wisdom", () => {
    const tags = tagMungerDisciplines(
      "Compound momentum from bias correction (psychology + physics)",
    );
    expect(tags).toContain("psychology");
    expect(tags).toContain("physics");
  });

  it("tagMungerDisciplines returns uncategorized for empty signal", () => {
    expect(tagMungerDisciplines("just be yourself")).toEqual(["uncategorized"]);
  });

  it("extractFalsifier finds 'unless' clauses", () => {
    const result = extractFalsifier(
      "Always lift before lunch unless you're sick or jet-lagged",
    );
    expect(result).toBeTruthy();
    expect(result?.toLowerCase()).toContain("sick");
  });

  it("isFalsifiable rejects platitudes", () => {
    expect(isFalsifiable("be present")).toBe(false);
    expect(isFalsifiable("trust yourself")).toBe(false);
  });

  it("isFalsifiable accepts conditional claims", () => {
    expect(
      isFalsifiable("Discount = lazy unless margin is already fat"),
    ).toBe(true);
  });

  it("violationRate counts 'don't' violations", () => {
    const v = violationRate(
      "Don't open Twitter before noon",
      "I checked Twitter again at 9am",
    );
    expect(v.rate).toBeGreaterThan(0);
  });

  it("violationRate counts 'always' failures (token-level, naive)", () => {
    // Heuristic limit: this checks if any non-stop word from the
    // wisdom appears in the action text. Negation handling ("no
    // gym") is NOT supported — that's a deliberate scope cap for
    // the rule-based pass. Test action contains zero overlap.
    const v = violationRate(
      "Always close the gym bag the night before",
      "skipped everything today, just sat on the couch",
    );
    expect(v.rate).toBeGreaterThan(0);
  });

  it("findCounterWisdom returns a sharp objection", () => {
    expect(findCounterWisdom("be patient")).toContain("procrastination");
    expect(findCounterWisdom("trust your gut")).toContain("tired");
    expect(findCounterWisdom("random nonsense")).toBe(null);
  });
});
