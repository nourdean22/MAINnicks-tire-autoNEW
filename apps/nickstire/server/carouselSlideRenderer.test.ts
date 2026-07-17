import { describe, it, expect } from "vitest";
import {
  CAROUSEL_TERRITORY_DESIGNS,
  CAROUSEL_W,
  CAROUSEL_H,
  renderCarouselSlideHtml,
  type RenderableCarouselBrief,
} from "./services/carouselSlideRenderer";
import { CREATIVE_TERRITORIES } from "../client/src/lib/igCarouselStudio";

const BRIEF: RenderableCarouselBrief = {
  id: "test-deck",
  creativeTerritory: "blueprint_xray",
  campaignKeyword: "BRAKES",
  topic: "How brake pads actually wear",
  slides: [
    { slideNumber: 1, role: "pattern_interrupt", headline: "Your brakes keep receipts", body: "" },
    { slideNumber: 2, role: "plain_truth", headline: "Pads wear in layers", body: "Every stop shaves a little friction material. That's the design." },
    { slideNumber: 3, role: "the_clue", headline: "The squeal is a feature", body: "A metal indicator sings BEFORE the pad is gone." },
    { slideNumber: 4, role: "what_to_do", headline: "Hear it? Book it", body: "A squeal today is a cheap visit. Grinding tomorrow is a rotor." },
    { slideNumber: 5, role: "saveable_recap", headline: "Save this checklist", body: "Squeal = indicator. Grind = metal. Pull = uneven wear." },
  ],
};

describe("CAROUSEL_TERRITORY_DESIGNS", () => {
  it("covers every creative territory (keys parity with CREATIVE_TERRITORIES)", () => {
    expect(Object.keys(CAROUSEL_TERRITORY_DESIGNS).sort()).toEqual(Object.keys(CREATIVE_TERRITORIES).sort());
  });
  it("designs are genuinely differentiated — blueprint is not gold-on-black", () => {
    expect(CAROUSEL_TERRITORY_DESIGNS.blueprint_xray.accent).not.toBe(CAROUSEL_TERRITORY_DESIGNS.premium_product_ad.accent);
    expect(CAROUSEL_TERRITORY_DESIGNS.mechanic_translation.ink).not.toBe(CAROUSEL_TERRITORY_DESIGNS.premium_product_ad.ink);
    // At least 8 distinct accent colors across the 13 territories.
    const accents = new Set(Object.values(CAROUSEL_TERRITORY_DESIGNS).map((d) => d.accent));
    expect(accents.size).toBeGreaterThanOrEqual(8);
  });
});

describe("renderCarouselSlideHtml", () => {
  it("renders native 4:5 with the territory design, page count, and dots", () => {
    const html = renderCarouselSlideHtml(BRIEF, BRIEF.slides[1], 1, 5);
    expect(html).toContain(`width:${CAROUSEL_W}px`);
    expect(html).toContain(`height:${CAROUSEL_H}px`);
    expect(CAROUSEL_H / CAROUSEL_W).toBeCloseTo(1350 / 1080);
    expect(html).toContain("SCHEMATIC"); // blueprint badge, not the premium one
    expect(html).toContain("2/5");
    expect((html.match(/class="dot( on)?"/g) || []).length).toBe(5);
    expect(html).toContain("PADS WEAR IN LAYERS".length ? "Pads wear in layers" : "");
  });

  it("hook slide suppresses body copy; final slide carries the keyword CTA chip", () => {
    const hook = renderCarouselSlideHtml(BRIEF, BRIEF.slides[0], 0, 5);
    expect(hook).toContain("display:none"); // body hidden on the hook
    const middle = renderCarouselSlideHtml(BRIEF, BRIEF.slides[2], 2, 5);
    expect(middle).toContain('DM &quot;BRAKES&quot;');
    expect(middle).toMatch(/\.kw\{[^}]*display:none/); // chip hidden mid-deck
    const final = renderCarouselSlideHtml(BRIEF, BRIEF.slides[4], 4, 5);
    expect(final).not.toMatch(/\.kw\{[^}]*display:none/); // chip visible on recap
  });

  it("escapes hostile copy — no raw HTML reaches the page", () => {
    const html = renderCarouselSlideHtml(
      { ...BRIEF, campaignKeyword: 'X"><script>' },
      { slideNumber: 2, role: "plain_truth", headline: '<script>alert(1)</script>', body: 'a & b < c' },
      1,
      5,
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b &lt; c");
  });

  it("unknown territory falls back to the premium design instead of crashing", () => {
    const html = renderCarouselSlideHtml(
      { ...BRIEF, creativeTerritory: "not_a_territory" as never },
      BRIEF.slides[1],
      1,
      5,
    );
    expect(html).toContain("PREMIUM");
  });
});
