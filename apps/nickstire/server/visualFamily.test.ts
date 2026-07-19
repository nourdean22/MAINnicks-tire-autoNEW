/**
 * Visual families — the two-layer rule, enforced.
 *
 * SUBJECT layer may be photography or generated imagery. BRAND layer — every
 * word, the handle, the CTA — is always drawn by us. An image model cannot
 * reliably spell "Nick's Tire & Auto", and this codebase has already held reels
 * for GENERATED_TEXT_ARTIFACT. Deterministic type is not a style choice; it is
 * how the words on a published asset can be trusted to say what we wrote.
 */
import { describe, it, expect } from "vitest";
import {
  VISUAL_FAMILIES, getVisualFamily, resolveFamilyForSubject, renderFamilyCardHtml,
  familyFromArtDirection,
  FEED_W, FEED_H, STORY_W, STORY_H, STORY_SAFE_TOP, STORY_SAFE_BOTTOM,
} from "./services/visualFamily";

const card = (over: Partial<Parameters<typeof renderFamilyCardHtml>[0]> = {}) =>
  renderFamilyCardHtml({
    family: getVisualFamily("seasonal_offer"),
    headline: "Your brakes are on a diet",
    body: "Once the pad gets this thin you are one drive from metal on metal.",
    cta: "Free brake check",
    eyebrow: "Nick's Tire & Auto",
    width: FEED_W, height: FEED_H,
    ...over,
  });

describe("families are genuinely different compositions", () => {
  it("families differ in GROUND, which is where variety belongs", () => {
    const families = Object.values(VISUAL_FAMILIES);
    expect(families.length).toBeGreaterThanOrEqual(3);
    expect(new Set(families.map((f) => f.bg)).size).toBe(families.length);
    expect(new Set(families.map((f) => f.motif)).size).toBeGreaterThan(1);
  });

  it("anchor changes ONLY where the content demands it — not for variety's sake", () => {
    // CORRECTED BY OPERATOR FEEDBACK 2026-07-19. This test previously asserted
    // that anchors must VARY, on the theory that identical composition means one
    // card recoloured. Shown three renders, the operator accepted both
    // centre-anchored solid-CTA cards and rejected the only top-anchored
    // outline-CTA one. The signal was about STRUCTURE, not subject: a hazard post
    // should read as the same brand in worse weather, not a different publisher.
    //
    // So the invariant is inverted. The ONLY family allowed to move its anchor is
    // one carrying a subject photo, which needs the type out of the image.
    for (const f of Object.values(VISUAL_FAMILIES)) {
      if (f.anchor !== "center") {
        expect(f.subject, `${f.id} moves its anchor without a subject photo to justify it`).toBe("required");
      }
    }
  });

  it("each family tells the operator WHEN to use it", () => {
    for (const f of Object.values(VISUAL_FAMILIES)) {
      expect(f.when.length).toBeGreaterThan(30);
      expect(f.label.length).toBeGreaterThan(3);
    }
  });

  it("an unknown id falls back rather than rendering nothing", () => {
    expect(getVisualFamily("does_not_exist").id).toBe("seasonal_offer");
    expect(getVisualFamily(null).id).toBe("seasonal_offer");
  });
});

describe("the two-layer rule", () => {
  it("draws every word itself — headline, body and CTA are in the HTML", () => {
    const html = card();
    expect(html).toContain("Your brakes are on a diet");
    expect(html).toContain("Free brake check");
    expect(html).toContain("@nicks_tire_euclid");
  });

  it("places the subject BEHIND a scrim so type stays legible over any photo", () => {
    const html = card({
      family: getVisualFamily("mechanic_evidence"),
      subjectImageUrl: "https://cdn.example/worn-tread.jpg",
    });
    expect(html).toContain("worn-tread.jpg");
    expect(html).toContain("class=\"scrim\"");
    // Subject sits below the scrim, which sits below the type.
    expect(html.indexOf("class=\"subject\"")).toBeLessThan(html.indexOf("class=\"scrim\""));
    expect(html.indexOf("class=\"scrim\"")).toBeLessThan(html.indexOf("class=\"main\""));
  });

  it("renders the family motif when there is no subject image", () => {
    const html = card();
    expect(html).toContain("class=\"motif\"");
    expect(html).not.toContain("class=\"subject\"");
  });

  it("escapes operator copy — a headline can never inject markup", () => {
    const html = card({ headline: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("substitution is announced, never silent", () => {
  it("SUBSTITUTES when a subject-required family has no photo, and says why", () => {
    const r = resolveFamilyForSubject("mechanic_evidence", false);
    expect(r.substituted).toBe(true);
    expect(r.family.id).toBe("seasonal_offer");
    // A silent swap is how an operator stops trusting the generator.
    expect(r.reason).toMatch(/needs a real photo/i);
    expect(r.reason).toMatch(/rendered as/i);
  });

  it("honours the request when the photo IS there", () => {
    const r = resolveFamilyForSubject("mechanic_evidence", true);
    expect(r.substituted).toBe(false);
    expect(r.family.id).toBe("mechanic_evidence");
  });

  it("never substitutes a family that only OPTIONALLY wants a subject", () => {
    const r = resolveFamilyForSubject("road_hazard", false);
    expect(r.substituted).toBe(false);
    expect(r.family.id).toBe("road_hazard");
  });
});

describe("safe zones", () => {
  it("keeps story type clear of Instagram's own chrome, top and bottom", () => {
    // Text in the top ~250px is covered by the profile row; the bottom ~320px by
    // the reply bar. Eyeballing this in a preview does not catch it — the
    // overlay only exists on a real phone.
    const html = card({ width: STORY_W, height: STORY_H });
    expect(html).toContain(`padding:${STORY_SAFE_TOP}px`);
    expect(html).toContain(`${STORY_SAFE_BOTTOM}px`);
  });

  it("uses tighter padding for a feed post, where there is no chrome", () => {
    expect(card()).toContain("padding:92px");
  });
});

describe("feed geometry", () => {
  it("defaults the feed to 4:5, not 1:1 — 1:1 gives away vertical screen", () => {
    expect(FEED_W).toBe(1080);
    expect(FEED_H).toBe(1350);
    expect(FEED_H / FEED_W).toBeCloseTo(1.25, 2);
  });

  it("sizes the stage to whatever dimensions it is handed", () => {
    const html = card({ width: 1080, height: 1350 });
    expect(html).toContain("width:1080px;height:1350px");
  });
});

describe("long copy does not break the card", () => {
  it("shrinks a very long headline instead of overflowing", () => {
    const long = card({ headline: "A".repeat(180) });
    const size = Number(long.match(/font-size:(\d+)px/)?.[1] ?? 0);
    expect(size).toBeGreaterThanOrEqual(46);
    expect(size).toBeLessThan(112);
  });

  it("wraps rather than clipping an unbroken string", () => {
    expect(card({ headline: "B".repeat(90) })).toContain("word-break:break-word");
  });
});

describe("artDirection finally reaches the renderer", () => {
  it("routes weather and road language to the hazard family", () => {
    expect(familyFromArtDirection("Snowy Cleveland street, salt spray, dim winter light")).toBe("road_hazard");
    expect(familyFromArtDirection("A deep pothole on a wet road")).toBe("road_hazard");
  });

  it("routes offer language to the seasonal family", () => {
    expect(familyFromArtDirection("Bold promo card announcing a winter tire special")).toBe("seasonal_offer");
  });

  it("uses the evidence family ONLY when a photo actually exists", () => {
    const direction = "Macro close-up of worn tread showing the wear bar";
    expect(familyFromArtDirection(direction, true)).toBe("mechanic_evidence");
    // Same words, no photo — must not pick a family that cannot be honoured.
    expect(familyFromArtDirection(direction, false)).not.toBe("mechanic_evidence");
  });

  it("falls back rather than failing on empty or unrecognised direction", () => {
    expect(familyFromArtDirection("")).toBe("seasonal_offer");
    expect(familyFromArtDirection(null)).toBe("seasonal_offer");
    expect(familyFromArtDirection("something entirely unrelated")).toBe("seasonal_offer");
  });

  it("is deterministic — no model call, so the same words always pick the same family", () => {
    const d = "Snowy road with salt";
    expect(familyFromArtDirection(d)).toBe(familyFromArtDirection(d));
  });
});
