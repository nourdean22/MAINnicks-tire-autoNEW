/**
 * Canaries for concepts-as-data.
 *
 * The load-bearing invariant: NO concept may sit in an unexplained state. 21
 * packs were parked at "UNKNOWN" in the markdown backlog, which is an instrument
 * that cannot report its own condition. Here, every non-publishable row carries
 * a blockReason, and that is asserted rather than hoped for.
 */
import { describe, it, expect } from "vitest";
import {
  classifyPack,
  productionTypeOf,
  franchiseOf,
  rankConcepts,
  toRow,
  PRODUCTION_COST,
  type PackFacts,
  type ConceptRow,
} from "../../shared/reelConcepts";

const pack = (over: Partial<PackFacts> = {}): PackFacts => ({ id: "2026-08-17-plug-vs-patch", ...over });

describe("THE UNKNOWN RULE - every non-publishable concept says why", () => {
  const cases: PackFacts[] = [
    pack(),                                                        // bare: no captions, no brief
    pack({ hasCaptions: true, needsGeneratedVideo: true }),        // needs credits
    pack({ hasBrief: true }),                                      // brief but no captions
    pack({ declaredBlock: "BLOCKED: NO MOTION ROUTE" }),           // hard block
    pack({ retired: true }),                                       // dead
    pack({ hasCaptions: true, hasRealFootage: true }),             // publishable
  ];

  it("no classification is ever silent", () => {
    for (const f of cases) {
      const { status, blockReason } = classifyPack(f);
      if (status === "publishable") expect(blockReason).toBeNull();
      else expect(blockReason, `status=${status} produced no reason`).toBeTruthy();
    }
  });

  it("an undetermined pack is needs-work WITH a reason, never a silent UNKNOWN", () => {
    const r = classifyPack(pack());
    expect(r.status).toBe("needs-work");
    expect(r.blockReason).toContain("production route undetermined");
  });

  // POSITIVE CONTROL: real footage plus captions publishes with NO reason. A
  // classifier that blocked everything would pass every assertion above.
  it("PERMITS real footage with captions and returns no block reason", () => {
    const r = classifyPack(pack({ hasCaptions: true, hasRealFootage: true }));
    expect(r.status).toBe("publishable");
    expect(r.blockReason).toBeNull();
  });
});

describe("production type and cost", () => {
  it("real footage is free, generated is the expensive lane", () => {
    expect(productionTypeOf(pack({ hasRealFootage: true }))).toBe("real-footage");
    expect(productionTypeOf(pack({ hasCaptions: true, needsGeneratedVideo: true }))).toBe("generated");
    expect(productionTypeOf(pack({ hasCaptions: true }))).toBe("stills");
    expect(productionTypeOf(pack())).toBe("undetermined");
    expect(PRODUCTION_COST["real-footage"]).toBeLessThan(PRODUCTION_COST.generated);
  });

  it("real footage wins over needsGeneratedVideo when both are set", () => {
    expect(productionTypeOf(pack({ hasRealFootage: true, needsGeneratedVideo: true }))).toBe("real-footage");
  });

  it("franchiseOf strips the date prefix", () => {
    expect(franchiseOf("2026-08-17-plug-vs-patch")).toBe("plug-vs-patch");
    expect(franchiseOf("no-date-here")).toBe("no-date-here");
  });
});

describe("ranking - cost ascending, measured performance first, NO weighted rubric", () => {
  const rows: ConceptRow[] = [
    toRow(pack({ id: "2026-08-01-generated-one", hasCaptions: true, needsGeneratedVideo: true })),
    toRow(pack({ id: "2026-08-02-real-one", hasCaptions: true, hasRealFootage: true })),
    toRow(pack({ id: "2026-08-03-stills-one", hasCaptions: true })),
  ];

  it("zero-credit real-footage concepts surface first", () => {
    expect(rankConcepts(rows)[0].id).toBe("2026-08-02-real-one");
    expect(rankConcepts(rows).map((r) => r.cost)).toEqual([0, 1, 2]);
  });

  it("a measured concept outranks every unmeasured one regardless of cost", () => {
    const measured = toRow(pack({ id: "2026-08-04-measured", hasCaptions: true, needsGeneratedVideo: true }), {
      igPostId: "1", views: 900, interactions: 20, profileVisits: 12, publishedAt: "2026-08-19",
    });
    expect(rankConcepts([...rows, measured])[0].id).toBe("2026-08-04-measured");
  });

  it("measured concepts order by profile visits - the step that is actually broken", () => {
    const a = toRow(pack({ id: "a", hasCaptions: true, hasRealFootage: true }), { igPostId: "1", views: 9000, interactions: 90, profileVisits: 3, publishedAt: "x" });
    const b = toRow(pack({ id: "b", hasCaptions: true, hasRealFootage: true }), { igPostId: "2", views: 100, interactions: 5, profileVisits: 40, publishedAt: "y" });
    // b has 90x fewer views but converts - it ranks first.
    expect(rankConcepts([a, b])[0].id).toBe("b");
  });

  it("actuals are null when unmeasured - never zero, which would read as measured-and-bad", () => {
    expect(toRow(pack({ hasCaptions: true, hasRealFootage: true })).actuals).toBeNull();
  });
});

/* -- the promotable flag: stricter spec, never blocks organic ------------- */

describe("promotable flag on the concept row", () => {
  const publishablePack = pack({ id: "2026-08-20-x", hasCaptions: true, hasRealFootage: true });

  it("is null when no promotability facts are supplied - unassessed is not ineligible", () => {
    const r = toRow(publishablePack);
    expect(r.promotable).toBeNull();
    expect(r.promotionBlockers).toBeNull();
  });

  it("is true for a clean pack with a service-page destination", () => {
    const r = toRow(publishablePack, null, {
      id: "x", copy: "Book a brake inspection.", aspectRatio: "9:16",
      ctaText: "book a brake inspection", landingDestination: "/brakes",
    });
    expect(r.promotable).toBe(true);
    expect(r.promotionBlockers).toEqual([]);
  });

  // THE INVARIANT: not boost-eligible, still organically publishable.
  it("a non-promotable pack REMAINS publishable and says why it cannot be boosted", () => {
    const r = toRow(publishablePack, null, {
      id: "x", copy: "Guaranteed fix.", aspectRatio: "9:16",
      ctaText: "come in", landingDestination: "/",
    });
    expect(r.promotable).toBe(false);
    expect(r.status).toBe("publishable");     // organic path untouched
    expect(r.blockReason).toBeNull();          // nothing blocks the post
    expect(r.promotionBlockers!.join(" ")).toMatch(/ABSOLUTE_OUTCOME_CLAIM|DESTINATION_IS_HOMEPAGE/);
  });
});
