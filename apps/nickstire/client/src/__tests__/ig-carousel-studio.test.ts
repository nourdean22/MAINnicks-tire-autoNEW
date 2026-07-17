/*
 * IG Carousel Intelligence Studio — pure-helper tests.
 * No DOM, no network, no side effects: validates the safety + scoring spine.
 */
import { describe, expect, it } from "vitest";

import {
  calculateBoostScore,
  canPublish,
  detectFearmongering,
  detectForbiddenClaims,
  detectGenericMarketingLanguage,
  detectOverdiagnosis,
  detectUnsupportedPriceOrFree,
  APPROVED_USED_TIRE_PRICE_LINE,
  PUBLISH_ENABLED,
  runSafetyChecks,
  scoreConcept,
  STUDIO_DEFAULTS,
  validateCampaignKeyword,
  validateExactlyFiveSlides,
  validateNoExternalSideEffects,
  validateSourceGrounding,
  buildPublishChecklist,
  CREATIVE_TERRITORIES,
} from "../lib/igCarouselStudio";
import {
  buildCarouselStudioSystemPrompt,
  buildHiggsfieldPromptPack,
  compileCarouselSlidePrompt,
  MASTER_PROMPT_SECTIONS,
} from "../lib/igCarouselStudioPrompt";
import { SAMPLE_BRIEFS } from "../lib/igCarouselStudioSamples";

describe("forbidden-claim detection", () => {
  const cases: [string, string][] = [
    ["free brake service this week", "no-free-claims"],
    ["our work is guaranteed", "no-guarantees"],
    ["the best in Cleveland", "no-best-claims"],
    ["everyone uses us for tires", "no-everyone-uses-us"],
    ["limited time offer", "no-fake-urgency"],
    ["book now before it's too late", "no-fake-urgency"],
    ["all sizes in stock", "no-stock-claims"],
    ["you need new rotors", "no-you-need"],
    ["it is dangerous to drive like this", "no-unsafe-scare"],
    ["guaranteed same-day install", "no-sameday-guarantee"],
    ["done in 30 minutes", "no-exact-wait-times"],
  ];
  for (const [text, rule] of cases) {
    it(`flags "${text}" as ${rule}`, () => {
      expect(detectForbiddenClaims(text).map((f) => f.rule)).toContain(rule);
    });
  }

  it("allows 'free check' (the one approved free phrase)", () => {
    expect(detectForbiddenClaims("stop by for a free check")).toHaveLength(0);
  });
});

describe("overdiagnosis detection", () => {
  it("flags hard verdicts", () => {
    expect(detectOverdiagnosis("this means your alternator is bad").length).toBeGreaterThan(0);
    expect(detectOverdiagnosis("you definitely need new pads").length).toBeGreaterThan(0);
    expect(detectOverdiagnosis("your wheel bearing is broken").length).toBeGreaterThan(0);
  });
  it("allows soft diagnostic language", () => {
    for (const ok of ["this can point to a slow leak", "it may indicate wear", "worth checking soon", "do not guess"]) {
      expect(detectOverdiagnosis(ok)).toHaveLength(0);
      expect(detectForbiddenClaims(ok)).toHaveLength(0);
    }
  });
});

describe("fearmongering + generic-marketing detection", () => {
  it("flags doom framing", () => {
    expect(detectFearmongering("your car is a ticking time bomb").length).toBeGreaterThan(0);
  });
  it("warns on clichés", () => {
    const f = detectGenericMarketingLanguage("hassle-free top-notch service");
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.severity === "warn")).toBe(true);
  });
});

describe("price wording", () => {
  it("blocks any $ wording that is not the approved line", () => {
    expect(detectUnsupportedPriceOrFree("brakes from $99").length).toBe(1);
  });
  it("allows the single approved used-tire line", () => {
    expect(detectUnsupportedPriceOrFree(APPROVED_USED_TIRE_PRICE_LINE)).toHaveLength(0);
  });
});

describe("structure validators", () => {
  it("requires exactly five slides with the right roles in order", () => {
    const good = SAMPLE_BRIEFS[0].slides;
    expect(validateExactlyFiveSlides(good).ok).toBe(true);
    expect(validateExactlyFiveSlides(good.slice(0, 4)).ok).toBe(false);
    const swapped = [...good];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(validateExactlyFiveSlides(swapped).ok).toBe(false);
  });

  it("validates campaign keywords", () => {
    expect(validateCampaignKeyword("POTHOLE").ok).toBe(true);
    expect(validateCampaignKeyword("pothole").ok).toBe(false);
    expect(validateCampaignKeyword("FROGS").ok).toBe(false);
  });

  it("requires a proof source", () => {
    expect(validateSourceGrounding(SAMPLE_BRIEFS[0]).ok).toBe(true);
    expect(validateSourceGrounding({ mechanicTruth: "x", sourceNotes: [{ label: "reddit", kind: "pain_point", supports: "y" }] }).ok).toBe(false);
  });
});

describe("scoring", () => {
  it("concept score sums six 0-10 dims to /60 with the configured gate", () => {
    const winner = SAMPLE_BRIEFS[0].concepts[0];
    const s = scoreConcept(winner);
    expect(s.max).toBe(60);
    expect(s.total).toBe(59);
    expect(s.min).toBe(STUDIO_DEFAULTS.conceptMinScore);
    expect(s.passing).toBe(true);
  });

  it("boost score is /75 and all three samples pass the default gate", () => {
    for (const b of SAMPLE_BRIEFS) {
      const r = calculateBoostScore(b);
      expect(r.max).toBe(75);
      expect(r.parts.reduce((a, p) => a + p.max, 0)).toBe(75);
      expect(r.passing, `${b.id} scored ${r.score}: ${r.parts.filter((p) => !p.ok).map((p) => p.label).join(", ")}`).toBe(true);
    }
  });

  it("a blocked claim zeroes the claim-safety component", () => {
    const b = structuredClone(SAMPLE_BRIEFS[0]);
    b.slides[1].body = "guaranteed best in Cleveland";
    const r = calculateBoostScore(b);
    expect(r.parts.find((p) => p.label.startsWith("Claim safety"))?.points).toBe(0);
    expect(r.passing).toBe(false);
  });
});

describe("samples are clean and clearly samples", () => {
  it("every sample passes safety with zero blocking findings", () => {
    for (const b of SAMPLE_BRIEFS) {
      const rep = runSafetyChecks(b, () => "test");
      expect(rep.blocked, `${b.id}: ${rep.findings.map((f) => `${f.rule}@${f.where}:${f.match}`).join("; ")}`).toBe(false);
    }
  });
  it("samples are labelled as samples and never claim to be published", () => {
    for (const b of SAMPLE_BRIEFS) {
      expect(b.isSample).toBe(true);
      expect(b.instagramUrl).toBeNull();
      expect(b.status).toBe("draft");
    }
  });
});

describe("prompt engine", () => {
  const prompt = buildCarouselStudioSystemPrompt({ mode: "draft", avoidTopics: ["tread depth"], avoidKeywords: ["TREAD"] });
  it("contains every required section", () => {
    for (const section of MASTER_PROMPT_SECTIONS) expect(prompt).toContain(section);
  });
  it("threads overrides and avoid-lists", () => {
    const p = buildCarouselStudioSystemPrompt({ mode: "asset_prep", topicOverride: "winter wipers", keywordOverride: "wipers" });
    expect(p).toContain("winter wipers");
    expect(p).toContain("WIPERS");
    expect(prompt).toContain("tread depth");
    expect(prompt).toContain("TREAD");
  });
  it("threads proprietary evidence when provided", () => {
    const p = buildCarouselStudioSystemPrompt({
      mode: "draft",
      proprietaryEvidence: {
        recentCaseStudy: {
          vehicle: "2019 Tesla Model 3",
          symptom: "noise",
          failedComponent: "control arm",
          condition: "red",
          techNotes: "torn bushing",
          recommendedAction: "replace link",
        },
        localStats: {
          brakeRustRatioPercent: 88,
          potholeDamageCount: 99,
          commonVehicles: ["Tesla Model 3"],
          averageMileage: 50000,
        },
        clevelandAngle: "Cleveland winters are brutal.",
      },
    });
    expect(p).toContain("2019 Tesla Model 3");
    expect(p).toContain("88%");
    expect(p).toContain("99 incidents");
    expect(p).toContain("Cleveland winters are brutal.");
  });
  it("builds a 5-prompt Higgsfield pack with the no-baked-text rule", () => {
    const pack = buildHiggsfieldPromptPack(SAMPLE_BRIEFS[1]);
    for (let i = 1; i <= 5; i++) expect(pack).toContain(`## Slide ${i}`);
    expect(pack).toContain("NO baked-in text");
    expect(pack).toContain("1080×1350");
  });
  it("slide prompts use TERRITORY grammar, not one universal 85mm suffix", () => {
    // SAMPLE_BRIEFS[1] is tiny_world: miniature diorama grammar, no film-grain
    // product-ad language, and a hard DO NOT INCLUDE tail with its avoid list.
    const brief = SAMPLE_BRIEFS[1];
    const own = CREATIVE_TERRITORIES[brief.creativeTerritory];
    const pack = buildHiggsfieldPromptPack(brief);
    expect(pack).toContain(own.grammar);
    expect(pack).toContain(`DO NOT INCLUDE: ${own.avoid}`);
    // The old universal suffix is gone unless the territory itself wants it.
    if (!own.grammar.includes("85mm")) expect(pack).not.toContain("85mm");
    if (!own.grammar.includes("film grain")) expect(pack).not.toContain("film grain texture");
    // The premium territory KEEPS the 85mm product language - that is its style.
    const premium = compileCarouselSlidePrompt({ creativeTerritory: "premium_product_ad" }, { visualPrompt: "A brake rotor on a dark pedestal" });
    expect(premium).toContain("85mm product photography");
    // Blueprint forbids the photographic treatment outright.
    const bp = compileCarouselSlidePrompt({ creativeTerritory: "blueprint_xray" }, { visualPrompt: "Suspension cutaway" });
    expect(bp).toContain("Orthographic technical illustration");
    expect(bp).toContain("DO NOT INCLUDE: shallow depth of field, film grain, photographic background");
    // Every compiled prompt bans baked-in lettering and carries 4:5 composition.
    expect(bp).toContain("baked-in text");
    expect(bp).toContain("Portrait 4:5 composition");
  });
});

describe("publish is enabled", () => {
  it("PUBLISH_ENABLED is true and canPublish() returns ok", () => {
    expect(PUBLISH_ENABLED).toBe(true);
    const gate = canPublish();
    expect(gate.ok).toBe(true);
  });
  it("publish checklist keeps manual gates pending (never auto-passes)", () => {
    const items = buildPublishChecklist(SAMPLE_BRIEFS[0]);
    const manual = items.filter((i) => i.ok === null);
    expect(manual.length).toBeGreaterThanOrEqual(4); // warped-text, account, FB cross-post, human review
  });
  it("pure module attests it makes no external calls itself (publish safety is server-side)", () => {
    expect(validateNoExternalSideEffects().ok).toBe(true);
  });
});
