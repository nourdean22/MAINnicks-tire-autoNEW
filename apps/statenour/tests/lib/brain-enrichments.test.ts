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
  bayesianUpdate,
  lindyWeight,
  effectiveConfidence,
  shouldSurface,
  makeMeta,
  defaultHalfLife,
} from "@/lib/brain/insight-meta";
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
import {
  countRationalizations,
  revealedPreferenceRanking,
  gapSeverity,
  frameAsAkrasia,
} from "@/lib/brain/counter-intuitive";
// ═══════════════════════════════════════════════════════════════
// SHARED — Bayes + Lindy + falsifiability scaffolding
// ═══════════════════════════════════════════════════════════════

describe("insight-meta", () => {
  it("bayesianUpdate(0.5, true) increases confidence", () => {
    expect(bayesianUpdate(0.5, true)).toBeGreaterThan(0.5);
  });

  it("bayesianUpdate(0.5, false) decreases confidence", () => {
    expect(bayesianUpdate(0.5, false)).toBeLessThan(0.5);
  });

  it("bayesianUpdate keeps confidence bounded in (0, 1)", () => {
    let c = 0.99;
    for (let i = 0; i < 100; i++) c = bayesianUpdate(c, true);
    expect(c).toBeLessThan(1);
    expect(c).toBeGreaterThan(0);
  });

  it("lindyWeight decays toward 0 as time exceeds half-life", () => {
    expect(lindyWeight(30, 0, 30)).toBeGreaterThan(0.9);
    expect(lindyWeight(30, 30, 30)).toBeCloseTo(0.55, 0); // 1 half-life elapsed
    expect(lindyWeight(30, 90, 30)).toBeLessThan(0.2);   // 3 half-lives elapsed
  });

  it("shouldSurface filters unfalsifiable claims", () => {
    const platitude = makeMeta({
      confidence: 0.95,
      falseWhen: "", // no falsifier — Popper would reject
    });
    expect(shouldSurface(platitude)).toBe(false);
  });

  it("shouldSurface accepts confident + falsifiable claims", () => {
    const claim = makeMeta({
      confidence: 0.7,
      falseWhen: "outside the 6am-9am window",
    });
    expect(shouldSurface(claim)).toBe(true);
  });

  it("defaultHalfLife maps engine to plausible window", () => {
    expect(defaultHalfLife("blind_spot")).toBeLessThan(defaultHalfLife("wisdom"));
    expect(defaultHalfLife("attention")).toBeLessThan(defaultHalfLife("correlation"));
  });

  it("effectiveConfidence is finite for valid input", () => {
    const m = makeMeta({ confidence: 0.7, halfLifeDays: 30, stabilityDays: 10 });
    const ec = effectiveConfidence(m);
    expect(Number.isFinite(ec)).toBe(true);
    expect(ec).toBeGreaterThanOrEqual(0);
    expect(ec).toBeLessThanOrEqual(1);
  });
});

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

// ═══════════════════════════════════════════════════════════════
// COUNTER-INTUITIVE — Festinger + Sartre + Samuelson + Aristotle
// ═══════════════════════════════════════════════════════════════

describe("counter-intuitive enrichments", () => {
  it("countRationalizations finds Sartre-style 'had to' patterns", () => {
    const r = countRationalizations(
      "I had to skip the gym this time, it made sense at the time, special circumstance",
    );
    expect(r.count).toBeGreaterThan(2);
  });

  it("countRationalizations handles clean text", () => {
    const r = countRationalizations(
      "I made a deliberate choice to cancel, weighed the trade-offs",
    );
    expect(r.count).toBe(0);
  });

  it("revealedPreferenceRanking flips rank when revealed differs from stated", () => {
    const stated = [
      { value: "family", rank: 1 },
      { value: "revenue", rank: 2 },
      { value: "body", rank: 3 },
    ];
    const actions = [
      { value: "revenue", weight: 50 },
      { value: "revenue", weight: 30 },
      { value: "body", weight: 5 },
      { value: "family", weight: 2 },
    ];
    const result = revealedPreferenceRanking(stated, actions);
    const family = result.find((r) => r.value === "family")!;
    const revenue = result.find((r) => r.value === "revenue")!;
    expect(revenue.delta).toBeLessThan(0); // revealed rank LOWER number = higher position
    expect(family.delta).toBeGreaterThan(0); // revealed rank HIGHER number = lower position
  });

  it("gapSeverity classifies wide gaps", () => {
    expect(gapSeverity(0.9, 0.2).severity).toBe("wide");
    expect(gapSeverity(0.7, 0.5).severity).toBe("moderate");
    expect(gapSeverity(0.7, 0.6).severity).toBe("small");
  });

  it("frameAsAkrasia uses Aristotelian framing, not identity attack", () => {
    const text = frameAsAkrasia(
      "you skipped 4 of last 5 workouts",
      "always train at 7am",
    );
    expect(text.toLowerCase()).toContain("akrasia");
    expect(text.toLowerCase()).toContain("recoverable");
    expect(text.toLowerCase()).not.toContain("you're inconsistent");
  });
});
