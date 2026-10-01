/**
 * BrandTruth compiler + fact-drift canary.
 *
 * POSITIVE CONTROL (run on main before this change): the drift canary below
 * found 3 hits of the retired mileage warranty in
 * packages/meta-ads-architect/src (prompts.ts:12, presets/nicks-tire.ts:22,
 * generator/index.ts:320) and the stale "1,685+" review floor in
 * client/src/lib/igCarouselStudio.ts:53. It failed. That is the shape of
 * failure it exists to catch.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS } from "../shared/business";
import {
  applyBrandTruthToCampaignInput,
  compileBrandTruth,
  renderBrandTruthBlock,
  STALE_FACT_PATTERNS,
} from "./services/brandTruth";

describe("compileBrandTruth", () => {
  const bt = compileBrandTruth();

  it("carries the invoice warranty, never the retired mileage wording", () => {
    expect(bt.warranty.parts).toMatch(/1-year limited parts/);
    expect(bt.warranty.labor).toMatch(/90-day limited labor/);
    expect(bt.warranty.roadHazard).toMatch(/No road-hazard/);
    for (const v of Object.values(bt.warranty)) expect(v).not.toMatch(/12,?000/);
  });

  it("mirrors the SSOT for identity, hours, reviews and payment programs", () => {
    expect(bt.identity.languages).toEqual(BUSINESS.languages);
    expect(bt.identity.languages).not.toContain("Spanish");
    expect(bt.hours.display).toBe(BUSINESS.hours.display);
    expect(bt.reviews.countDisplay).toBe(BUSINESS.reviews.countDisplay);
    expect(bt.paymentPrograms.providers).toEqual(BUSINESS.financing.providers);
    expect(bt.paymentPrograms.providers).toHaveLength(4);
    expect(bt.paymentPrograms.adSafeSentence).not.toMatch(/financing/i);
  });

  it("renders a block with every hard claim restriction for each channel", () => {
    for (const channel of ["ads", "social", "article", "gbp"] as const) {
      const block = renderBrandTruthBlock(bt, channel);
      expect(block).toContain("CLAIM RESTRICTIONS");
      expect(block).toContain("90-day labor");
      expect(block).not.toMatch(/12,?000/);
      for (const r of bt.claimRestrictions) expect(block).toContain(r);
    }
    expect(renderBrandTruthBlock(bt, "article")).toContain(bt.warranty.usedTires);
  });
});

describe("applyBrandTruthToCampaignInput", () => {
  it("replaces whatever facts the admin form sent with compiled truth", () => {
    const stale = {
      offer: { productOrServiceName: "Brakes", serviceArea: "Mars" },
      priceStack: { guaranteeOrRefundTerms: "12-month / 12,000-mile warranty on most repairs", paymentMethods: "Cash, Snap Finance" },
      audience: { languages: ["English", "Spanish"] },
      assetsAndProof: { realReviewSources: "Google Reviews, Yelp" },
      constraints: { businessAddress: "Cleveland, OH", forbiddenWords: ["cheapest"] },
    };
    const out = applyBrandTruthToCampaignInput(stale);
    expect(out.priceStack.guaranteeOrRefundTerms).not.toMatch(/12,?000/);
    expect(out.priceStack.guaranteeOrRefundTerms).toMatch(/90-day labor/);
    expect(out.audience.languages).toEqual([...BUSINESS.languages]);
    expect(out.assetsAndProof.realReviewSources).not.toMatch(/Yelp/);
    expect(out.constraints.businessAddress).toContain("17625 Euclid Ave");
    expect(out.constraints.phoneNumber).toBe(BUSINESS.phone.display);
    expect(out.constraints.forbiddenWords).toEqual(expect.arrayContaining(["cheapest", "mile warranty", "financing"]));
    expect(out.businessFacts?.factsBlock).toContain("CLAIM RESTRICTIONS");
    // creative inputs survive untouched
    expect(out.offer.productOrServiceName).toBe("Brakes");
  });
});

describe("fact-drift canary over creative prompt sources", () => {
  const appRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(appRoot, "../..");
  const roots = [
    path.join(repoRoot, "packages/meta-ads-architect/src"),
    path.join(appRoot, "server/services/adStudio"),
    path.join(appRoot, "server/services/gbpContentGenerator.ts"),
    path.join(appRoot, "server/content-generator.ts"),
    path.join(appRoot, "client/src/lib/igCarouselStudio.ts"),
    path.join(appRoot, "client/src/lib/facelessReelStudio.ts"),
    path.join(appRoot, "server/services/igAutopost.ts"),
    path.join(appRoot, "server/services/igPostingLlm.ts"),
    path.join(appRoot, "server/services/reelBriefGen.ts"),
    path.join(appRoot, "server/services/carouselBriefGen.ts"),
  ];

  function walk(p: string): string[] {
    if (!fs.existsSync(p)) return [];
    const st = fs.statSync(p);
    if (st.isFile()) return p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
    return fs.readdirSync(p).flatMap((f) => walk(path.join(p, f)));
  }

  it("no creative prompt source carries a retired business fact", () => {
    const files = roots.flatMap(walk).filter((f) => !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    const hits: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const { pattern, why } of STALE_FACT_PATTERNS) {
        const m = text.match(pattern);
        if (m) hits.push(`${path.relative(repoRoot, file)}: "${m[0]}" — ${why}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("canary control: the patterns do match the retired wording", () => {
    const stale = 'guaranteeOrRefundTerms: "12-month / 12,000-mile warranty on most repairs"';
    expect(STALE_FACT_PATTERNS.some((p) => p.pattern.test(stale))).toBe(true);
  });
});
