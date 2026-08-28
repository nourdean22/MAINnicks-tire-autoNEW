/**
 * Canaries for the promotable check.
 *
 * THE INVARIANT THAT MATTERS MOST: failing promotability must NEVER block
 * organic publishing. Promotable is the stricter spec; a pack that cannot be
 * boosted is still perfectly postable and must say why it is not boost-eligible.
 * Every "is flagged non-promotable" assertion below is therefore PAIRED with an
 * assertion that the same pack remains organically valid.
 *
 * The rules encoded here were verified against Meta's own policy pages on
 * 2026-08-28, including two that refuted a default assumption - before/after is
 * NOT banned for an auto shop, and the 20% image-text rule is gone. Those two
 * appear here as explicit NEGATIVE controls, so a future session cannot quietly
 * re-add a rule Meta does not have.
 */
import { describe, it, expect } from "vitest";
import {
  promotabilityBlockers,
  isPromotable,
  absoluteClaims,
  hasUnqualifiedPrice,
  destinationBlocker,
  SAFE_AREA_MARGIN_PCT,
  type PromotabilityFacts,
} from "@shared/reelPromotability";
import { disclosureViolation } from "@shared/reelDisclosure";

/** A clean, real-footage, disclosed, service-page-linked pack. */
const clean = (over: Partial<PromotabilityFacts> = {}): PromotabilityFacts => ({
  id: "pack-clean",
  copy: "Three signs a wheel bearing is failing. Book a brake inspection when you're ready.",
  videoProvider: null,
  aspectRatio: "9:16",
  safeAreaRespected: true,
  ctaText: "book a brake inspection",
  landingDestination: "/brakes",
  ...over,
});

describe("the baseline pack is promotable (positive control)", () => {
  it("a clean real-footage pack with a service-page destination passes", () => {
    expect(promotabilityBlockers(clean())).toEqual([]);
    expect(isPromotable(clean())).toBe(true);
  });
});

/* -- Meta rules that ARE universal ---------------------------------------- */

describe("absolute / guaranteed outcome claims (Meta, all advertisers)", () => {
  const bad = (copy: string) => clean({ id: "pack-claim", copy });

  it("flags a guarantee", () => {
    const b = promotabilityBlockers(bad("Guaranteed to fix your alignment. Book today."));
    expect(b.map((x) => x.code)).toContain("ABSOLUTE_OUTCOME_CLAIM");
    expect(b.find((x) => x.code === "ABSOLUTE_OUTCOME_CLAIM")?.source).toBe("meta");
  });

  it("flags risk-free and 100% framing", () => {
    expect(absoluteClaims("Risk-free brake check").length).toBeGreaterThan(0);
    expect(absoluteClaims("100% guaranteed results").length).toBeGreaterThan(0);
  });

  // NEGATIVE CONTROL: ordinary descriptive copy must not trip the claim rule, or
  // the gate becomes noise and gets switched off.
  it("does NOT flag ordinary service copy", () => {
    for (const c of [
      "Three signs a wheel bearing is failing.",
      "We check tread depth on every visit.",
      "Pothole season is hard on alignment.",
    ]) {
      expect(absoluteClaims(c), c).toEqual([]);
    }
  });

  // A non-promotable pack is still ORGANICALLY fine - the whole point.
  it("a claim-flagged pack is still organically publishable", () => {
    const pack = bad("Guaranteed to fix your alignment.");
    expect(isPromotable(pack)).toBe(false);
    expect(
      disclosureViolation({ id: pack.id, videoProvider: null, copy: pack.copy }),
    ).toBeNull();
  });
});

describe("unqualified price claims (first-party, not a quoted Meta clause)", () => {
  it("flags a bare dollar figure", () => {
    expect(hasUnqualifiedPrice("Is it $50 or $1,500?")).toBe(true);
    const b = promotabilityBlockers(clean({ copy: "Is it $50 or $1,500?" }));
    expect(b.map((x) => x.code)).toContain("UNQUALIFIED_PRICE_CLAIM");
    // Labelled honestly - Meta publishes no pricing clause.
    expect(b.find((x) => x.code === "UNQUALIFIED_PRICE_CLAIM")?.source).toBe("first-party");
  });

  it("PERMITS a qualified price", () => {
    for (const c of ["Tires from $25 installed.", "Most brake jobs run $200-400.", "Typically $80."]) {
      expect(hasUnqualifiedPrice(c), c).toBe(false);
    }
  });

  it("PERMITS copy with no price at all", () => {
    expect(hasUnqualifiedPrice("Book a brake inspection.")).toBe(false);
  });
});

/* -- the two rules Meta does NOT have (refuted 2026-08-28) ---------------- */

describe("rules Meta does NOT have - encoded as negative controls", () => {
  // Before/after is scoped to cosmetic products/procedures (18+). An auto shop
  // showing a repair before/after is NOT caught by it.
  it("before/after REPAIR imagery is promotable", () => {
    const pack = clean({ copy: "Before and after on this control arm. We replaced it same day." });
    expect(promotabilityBlockers(pack)).toEqual([]);
  });

  // The 20% image-text limit was removed; it is a performance tip now. No text
  // rule is encoded, so heavy on-screen text must not block promotion.
  it("heavy on-screen text is promotable", () => {
    const pack = clean({
      copy: "SQUEAL MEANS PADS. GRIND MEANS ROTORS. BOOK A BRAKE INSPECTION TODAY AT NICK'S ON EUCLID AVE.",
    });
    expect(promotabilityBlockers(pack)).toEqual([]);
  });
});

/* -- the funnel rule ------------------------------------------------------ */

describe("destination matching - paying into a broken funnel", () => {
  it("blocks a CTA that lands on the homepage, and says why in money terms", () => {
    const b = destinationBlocker(clean({ landingDestination: "/" }));
    expect(b?.code).toBe("DESTINATION_IS_HOMEPAGE");
    expect(b?.reason).toMatch(/0\.53%|13,871/);
  });

  it("blocks a bare origin URL too, not just a literal slash", () => {
    expect(destinationBlocker(clean({ landingDestination: "https://nickstire.org" }))?.code).toBe(
      "DESTINATION_IS_HOMEPAGE",
    );
  });

  it("blocks an undeclared destination when copy asks for an action", () => {
    expect(destinationBlocker(clean({ landingDestination: null }))?.code).toBe("DESTINATION_UNDECLARED");
  });

  // POSITIVE CONTROL: a specific service page passes.
  it("PERMITS a topic-specific destination", () => {
    expect(destinationBlocker(clean({ landingDestination: "/brakes" }))).toBeNull();
  });

  // No ask, nothing to match - an awareness pack is not punished for it.
  it("does not require a destination when the copy makes no ask", () => {
    expect(destinationBlocker(clean({ ctaText: null, landingDestination: null }))).toBeNull();
  });
});

/* -- AI disclosure: the stricter of organic and paid governs --------------- */

describe("AI disclosure carries into promotion", () => {
  it("undisclosed generated video is NOT promotable", () => {
    const pack = clean({ id: "gen", videoProvider: "higgsfield", copy: "Book a brake inspection." });
    expect(promotabilityBlockers(pack).map((x) => x.code)).toContain("DISCLOSURE_NOT_SATISFIED");
  });

  it("PERMITS disclosed generated video", () => {
    const pack = clean({ id: "gen-ok", videoProvider: "higgsfield", apiDisclosureFlag: true });
    expect(promotabilityBlockers(pack)).toEqual([]);
  });

  it("flags a safe-area violation only for generated video, as a first-party rule", () => {
    const pack = clean({ videoProvider: "higgsfield", apiDisclosureFlag: true, safeAreaRespected: false });
    const b = promotabilityBlockers(pack).find((x) => x.code === "SAFE_AREA_VIOLATED");
    expect(b?.source).toBe("first-party");
    expect(SAFE_AREA_MARGIN_PCT).toBe(14);
  });

  it("unknown safe-area state does not block - absent is not a violation", () => {
    const pack = clean({ videoProvider: "higgsfield", apiDisclosureFlag: true, safeAreaRespected: null });
    expect(promotabilityBlockers(pack)).toEqual([]);
  });
});

describe("every blocker names its source so nobody miscites Meta", () => {
  it("each blocker is labelled meta or first-party", () => {
    const pack = clean({
      copy: "Guaranteed $50 fix.",
      videoProvider: "higgsfield",
      landingDestination: "/",
      aspectRatio: "1:1",
    });
    const b = promotabilityBlockers(pack);
    expect(b.length).toBeGreaterThan(2);
    for (const x of b) expect(["meta", "first-party"]).toContain(x.source);
  });
});
