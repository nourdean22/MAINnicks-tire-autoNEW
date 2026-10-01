/**
 * RENDER PARITY — the visual-language mapping must not move a single byte.
 *
 * README §J maps the 3 static families and the 13 carousel territories into
 * shared/visualLanguage.ts. That mapping is provenance only for now; the HTML
 * each renderer produces must be byte-identical to what it produced BEFORE
 * the mapping existed. These hashes were computed on commit f3da960e (the
 * pre-mapping code) with exactly the fixtures below, on 2026-10-01, and then
 * the renderers were edited. A changed hash means a render changed, which is
 * a design decision that has to be made on purpose — if you meant it, re-run
 * the fixture and replace the hash in the same commit, with the reason.
 *
 * Why hashes of HTML and not pHash of JPEGs: puppeteer is seconds per render
 * and 19 renders would dominate the suite; the HTML string is the entire
 * input to the browser, so equal HTML is equal pixels.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { VISUAL_FAMILIES, renderFamilyCardHtml, FEED_W, FEED_H, STORY_W, STORY_H } from "./services/visualFamily";
import { CAROUSEL_TERRITORY_DESIGNS, renderCarouselSlideHtml } from "./services/carouselSlideRenderer";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const BEFORE: Record<string, string> = {
  "family:mechanic_evidence:1080x1350": "1807f0f03643a2fdf202c7dddd6cb22bfc977941424d1a18db38d68354675ffe",
  "family:mechanic_evidence:1080x1920": "b5c110a9a1737ce35a65ad0f501c11002e695cabf1f8b3f4d87efb3c5c50807a",
  "family:seasonal_offer:1080x1350": "e579f58d63d30775dba23ce70707d2d90ca5774162b85beaef384faf36356ffc",
  "family:seasonal_offer:1080x1920": "b709204780d38032f3bd782e3a0e18b80b6bdf90db9644f3624ba40daacb9416",
  "family:road_hazard:1080x1350": "ffda6665833bcdb33eaa9543b0a99feca249afbbf8937f8a23e11b47791776c5",
  "family:road_hazard:1080x1920": "ce9b4b6e35214ea956f62d6018af3478d4c757615ddcfb02c1f6121c3f59203d",
  "territory:cleveland_survival_guide": "5938fd2be214f9cce798ea39effcb40ac252318d7ce76795610028eeabe725d6",
  "territory:mechanic_translation": "9c58ac2c4a6df28240682523cead9beee9ca6308851b5315ee883d9b7e734c32",
  "territory:csi_evidence_board": "07030a4a52f95e1679110ac63bc2a65994f0cf773339ae12b2a5e450fa6ec88a",
  "territory:myth_courtroom": "67af3215705e951d2b2f90ce4083b2767a7e0b423a8b28bb0a378c423ef86109",
  "territory:tiny_world": "61cd269e87a5f11e98a9731114b13106cd6c2d20a8e756f59d683f7aafead9af",
  "territory:warning_system": "62991473716289e09585b70ee9940f65fd26283a6803188350171d97151cc585",
  "territory:luxury_part_hero": "edb7c0f4d9ab2a120a1329daaa8a3bf5ccfe67288e0b84fd04bef9bb73ef9bd0",
  "territory:road_villain": "2a6b6a8644927ee6923b4eccd32f86ab36179c0536fad58ad5327e88744c71c5",
  "territory:car_body_language": "1d1aa03ea889002dd14821777e7fbcabc39bdb17bdfecd69cf981aa100eb08af",
  "territory:before_the_bill": "b3a686b3d63e838add00bff196e7a8becf5afad440b11b1943fc3cc664518d1c",
  "territory:blueprint_xray": "e0716f4f28d995939918fbc0193a0d7f77e9daba1f66f1bd0325cf9e1ff2e5fe",
  "territory:premium_product_ad": "af122551a96d5a00564f765c41415ce2ce082f519b9f3d2ae85632ec5a722219",
  "territory:weather_local_alert": "1508a1b99964cb570959cc42bc2b1fbd64dd7c5da9fc63e4d8555579be3382a9",
};

const SLIDES = [
  { slideNumber: 1 as const, role: "pattern_interrupt" as const, headline: "Your brakes keep receipts", body: "" },
  { slideNumber: 2 as const, role: "plain_english_truth" as const, headline: "Pads wear in layers", body: "Every stop shaves a little friction material." },
  { slideNumber: 3 as const, role: "saveable_recap" as const, headline: "Save this checklist", body: "Squeal = indicator." },
];

describe("visual-language mapping leaves every render byte-identical", () => {
  it("the 3 families × feed + story", () => {
    for (const f of Object.values(VISUAL_FAMILIES)) {
      for (const [w, h] of [[FEED_W, FEED_H], [STORY_W, STORY_H]] as const) {
        const html = renderFamilyCardHtml({
          family: f,
          headline: "Your brakes are on a diet",
          body: "Once the pad gets this thin you are one drive from metal on metal.",
          cta: "Free brake check",
          eyebrow: "Nick's Tire & Auto",
          width: w,
          height: h,
          subjectImageUrl: f.subject === "required" ? "https://example.com/x.jpg" : null,
          index: 1,
          total: 3,
        });
        expect(sha256(html), `${f.id} ${w}x${h}`).toBe(BEFORE[`family:${f.id}:${w}x${h}`]);
      }
    }
  });

  it("the 13 territories × 3 slide roles", () => {
    for (const t of Object.keys(CAROUSEL_TERRITORY_DESIGNS) as Array<keyof typeof CAROUSEL_TERRITORY_DESIGNS>) {
      const brief = { id: "d", creativeTerritory: t, campaignKeyword: "BRAKES" as const, topic: "t", slides: SLIDES };
      const html = SLIDES.map((s, i) => renderCarouselSlideHtml(brief, s, i, SLIDES.length)).join("\n");
      expect(sha256(html), t).toBe(BEFORE[`territory:${t}`]);
    }
  });

  it("the fixture covers every family and territory (no silent gap)", () => {
    const expected = [
      ...Object.keys(VISUAL_FAMILIES).flatMap((id) => [`family:${id}:1080x1350`, `family:${id}:1080x1920`]),
      ...Object.keys(CAROUSEL_TERRITORY_DESIGNS).map((t) => `territory:${t}`),
    ].sort();
    expect(Object.keys(BEFORE).sort()).toEqual(expected);
  });
});
