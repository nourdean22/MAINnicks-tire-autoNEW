/**
 * Canaries for the measured baseline and the decision rules.
 *
 * Two jobs. (1) Pin the baseline to the operator's verified export, so a future
 * edit that "rounds" a number has to argue with a test. (2) Prove each decision
 * rule fires on its own case AND stays silent on its neighbours — a rule that
 * fires on everything gives the same advice every time, which is no advice.
 */
import { describe, it, expect } from "vitest";
import {
  ACCOUNT_BASELINE,
  BASELINE_TARGETS,
  diagnose,
  MIN_SAMPLE_FOR_RANKING,
  type PostMetrics,
} from "./accountBaseline";
import { CONCEPTS, catalogSummary, rankConcepts } from "./conceptCatalog";

/** A post that trips no rule — the control every case below deviates from. */
const NEUTRAL: PostMetrics = {
  views: 1000,
  interactions: 10,
  profileVisits: 5,
  saves: 5,
  sends: 2,
  follows: 0,
  websiteTaps: 1,
  retention: 0.5,
  nonFollowerReach: 0.7,
};

describe("the baseline is the operator's measured export, denominators attached", () => {
  it("carries the raw counts from the 30-day Insights export", () => {
    expect(ACCOUNT_BASELINE.views).toBe(13871);
    expect(ACCOUNT_BASELINE.interactions).toBe(137);
    expect(ACCOUNT_BASELINE.profileVisits).toBe(74);
    expect(ACCOUNT_BASELINE.followers).toBe(3269);
    expect(ACCOUNT_BASELINE.windowDays).toBe(30);
    expect(ACCOUNT_BASELINE.capturedOn).toBe("2026-08-28");
  });

  it("every rate is DERIVED from its counts, not typed in", () => {
    const r = ACCOUNT_BASELINE.rates;
    expect(r.interactionRate.pct).toBeCloseTo((137 / 13871) * 100, 2);
    expect(r.profileVisitRate.pct).toBeCloseTo((74 / 13871) * 100, 2);
    expect(r.uniqueEngagedRate.pct).toBeCloseTo((35 / 3269) * 100, 2);
    // The published headline figures, to the precision the operator quoted them.
    expect(r.interactionRate.pct).toBeCloseTo(0.99, 2);
    expect(r.profileVisitRate.pct).toBeCloseTo(0.53, 2);
    expect(r.uniqueEngagedRate.pct).toBeCloseTo(1.07, 2);
  });

  it("no rate can exist without naming its denominator", () => {
    for (const [name, r] of Object.entries(ACCOUNT_BASELINE.rates)) {
      expect(r.of, `${name} has no denominator`).toBeGreaterThan(0);
      expect(r.denominatorLabel.length, `${name} has no denominator LABEL`).toBeGreaterThan(0);
    }
    // Interactions and unique-engaged are over DIFFERENT populations. Quoting
    // them side by side without this distinction is the whole failure mode.
    expect(ACCOUNT_BASELINE.rates.interactionRate.denominatorLabel).not.toBe(
      ACCOUNT_BASELINE.rates.uniqueEngagedRate.denominatorLabel,
    );
  });

  it("the non-follower reach floor equals today's measured value — hold, do not 'improve'", () => {
    expect(BASELINE_TARGETS.nonFollowerReachFloorPct).toBe(ACCOUNT_BASELINE.nonFollowerReachPct);
  });

  it("every target is ABOVE the measured baseline it replaces", () => {
    expect(BASELINE_TARGETS.interactionRatePct).toBeGreaterThan(ACCOUNT_BASELINE.rates.interactionRate.pct);
    expect(BASELINE_TARGETS.profileVisitRatePct).toBeGreaterThan(ACCOUNT_BASELINE.rates.profileVisitRate.pct);
    expect(BASELINE_TARGETS.uniqueEngagedRatePct).toBeGreaterThan(ACCOUNT_BASELINE.rates.uniqueEngagedRate.pct);
  });
});

describe("decision rules — each fires on its case and spares its neighbours", () => {
  it("HOOK_OVERPROMISED: reach came, retention did not — fix the payoff, keep the hook", () => {
    const d = diagnose({ ...NEUTRAL, views: 5000, retention: 0.2 });
    expect(d.code).toBe("HOOK_OVERPROMISED");
    expect(d.doNotChange).toMatch(/hook/i);
    expect(d.evidence).toContain("20%");
  });

  it("WEAK_FRANCHISE_IDENTITY: sends without follows", () => {
    const d = diagnose({ ...NEUTRAL, views: 1000, sends: 30, follows: 0 });
    expect(d.code).toBe("WEAK_FRANCHISE_IDENTITY");
  });

  it("BIO_AND_OFFER_BROKEN: visits cleared target, taps did not — and content is off-limits", () => {
    const d = diagnose({ ...NEUTRAL, views: 1000, profileVisits: 40, websiteTaps: 0 });
    expect(d.code).toBe("BIO_AND_OFFER_BROKEN");
    expect(d.doNotChange).toMatch(/hook|script|format/i);
  });

  it("REPACKAGE_OPENING: saved but never travelled", () => {
    const d = diagnose({ ...NEUTRAL, views: 1000, saves: 40, nonFollowerReach: 0.2 });
    expect(d.code).toBe("REPACKAGE_OPENING");
    expect(d.doNotChange).toMatch(/body|re-shoot/i);
  });

  it("HOLDING: a post with no dominant failure gets no instruction", () => {
    expect(diagnose(NEUTRAL).code).toBe("HOLDING");
  });

  it("UNMEASURED: below the sample floor, nothing is claimed", () => {
    const d = diagnose({ ...NEUTRAL, views: MIN_SAMPLE_FOR_RANKING - 1 });
    expect(d.code).toBe("UNMEASURED");
    expect(d.change).toMatch(/Nothing yet/);
  });

  it("NULL retention is UNMEASURED, never read as zero", () => {
    // "Instagram did not report it" and "nobody watched" are different facts.
    const d = diagnose({ ...NEUTRAL, views: 5000, retention: null });
    expect(d.code).not.toBe("HOOK_OVERPROMISED");
  });

  it("the deepest funnel failure wins when two rules match at once", () => {
    // Both BIO_AND_OFFER_BROKEN and HOOK_OVERPROMISED apply here. Fixing the
    // opening first would just send more people to the same dead end.
    const d = diagnose({
      ...NEUTRAL,
      views: 5000,
      profileVisits: 200,
      websiteTaps: 0,
      retention: 0.2,
    });
    expect(d.code).toBe("BIO_AND_OFFER_BROKEN");
  });

  it("every diagnosis names a change AND a thing to leave alone", () => {
    const cases: PostMetrics[] = [
      NEUTRAL,
      { ...NEUTRAL, views: 5000, retention: 0.2 },
      { ...NEUTRAL, sends: 30, follows: 0 },
      { ...NEUTRAL, profileVisits: 40, websiteTaps: 0 },
      { ...NEUTRAL, saves: 40, nonFollowerReach: 0.2 },
      { ...NEUTRAL, views: 3 },
    ];
    for (const c of cases) {
      const d = diagnose(c);
      expect(d.change.length, `${d.code} has no change`).toBeGreaterThan(0);
      expect(d.doNotChange.length, `${d.code} has no doNotChange`).toBeGreaterThan(0);
      expect(d.evidence.length, `${d.code} has no evidence`).toBeGreaterThan(0);
    }
  });
});

describe("concept catalog — rows, cost-ranked, no invented rubric", () => {
  it("has a real catalog across multiple franchises", () => {
    const s = catalogSummary();
    expect(s.total).toBeGreaterThanOrEqual(60);
    expect(s.franchises).toBeGreaterThanOrEqual(6);
  });

  it("no concept carries a score field — the 100-point rubric is deliberately absent", () => {
    for (const c of CONCEPTS) {
      expect(Object.keys(c)).not.toContain("score");
      expect(Object.keys(c)).not.toContain("weightedScore");
      expect(Object.keys(c)).not.toContain("rank");
    }
  });

  it("REAL production is zero-credit by definition", () => {
    for (const c of CONCEPTS.filter((x) => x.productionType === "real")) {
      expect(c.estCredits, `${c.id} is real but costs credits`).toBe(0);
    }
    for (const c of CONCEPTS.filter((x) => x.productionType !== "real")) {
      expect(c.estCredits, `${c.id} is synthetic but free`).toBeGreaterThan(0);
    }
  });

  it("unmeasured concepts rank by cost ascending — zero-credit real footage first", () => {
    const ranked = rankConcepts();
    expect(ranked[0].estCredits).toBe(0);
    expect(ranked[0].productionType).toBe("real");
    // Monotonic non-decreasing cost across the unmeasured tail.
    const costs = ranked.filter((c) => c.actuals === null).map((c) => c.estCredits);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]);
  });

  it("MEASURED concepts outrank every estimate, however cheap", () => {
    // The point of the ranking: one real number beats the whole cost heuristic.
    const expensiveButProven = {
      ...CONCEPTS.find((c) => c.productionType === "ai")!,
      id: "proven",
      actuals: {
        publishedAt: "2026-08-20",
        views: 1000,
        interactions: 50,
        profileVisits: 30,
        saves: 10,
        sends: 5,
        follows: 3,
        websiteTaps: 2,
        retention: 0.6,
        nonFollowerReach: 0.8,
      },
    };
    const ranked = rankConcepts([...CONCEPTS, expensiveButProven]);
    expect(ranked[0].id).toBe("proven");
  });

  it("actuals are null until published — never a zero standing in for unmeasured", () => {
    for (const c of CONCEPTS) {
      if (c.status !== "published") expect(c.actuals).toBeNull();
    }
  });
});
