/**
 * Nick's Mechanical Universe — the brand bible and the twelve franchises must
 * survive the gates that already govern generation.
 *
 * THIS FILE'S REASON TO EXIST: a franchise registry that reads well but whose
 * visual metaphors trip `validateFacelessSubject` or `validateNoInFrameText`
 * is twelve shows that each block at preflight, discovered one paid render at a
 * time. The obvious design — a uniformed digital mechanic hosting to camera —
 * fails exactly this way, which is why NICK-01 is a scanning beam and not a
 * body. That decision is only trustworthy if it is CHECKED, so it is checked
 * here against the real validators rather than asserted in a comment.
 */
import { describe, it, expect } from "vitest";
import { validateFacelessSubject, validateNoInFrameText } from "../lib/facelessReelStudio";
import {
  BRAND_CAST,
  BRAND_BIBLE_VERSION,
  DISEMBODIED_CAST,
  NOIR_CAMERA_GRAMMAR,
  NOIR_ENVIRONMENTS,
  buildBrandBibleFragment,
  type BrandCharacterId,
} from "../../../shared/brandBible";
import {
  FRANCHISES,
  FRANCHISE_IDS,
  buildFranchiseFragment,
  franchisesRequiring,
} from "../../../shared/contentFranchises";
import { CTA_TYPES, CONTENT_DISTRIBUTION_OBJECTIVES } from "../../../shared/instagramStudio";

describe("brand bible survives the generation gates", () => {
  it("every character's embodiment is renderable — no faces, hands or speaking people", () => {
    for (const c of Object.values(BRAND_CAST)) {
      const faceless = validateFacelessSubject([c.embodiment]);
      expect(faceless.ok, `${c.name}: ${faceless.reason}`).toBe(true);
    }
  });

  it("NICK-01 specifically — the narrator that would normally be a talking head", () => {
    const nick = BRAND_CAST.nick_01;
    expect(validateFacelessSubject([nick.embodiment]).ok).toBe(true);
    expect(validateNoInFrameText([nick.embodiment]).ok).toBe(true);
    // The prohibition is the load-bearing part: this is what keeps a generated
    // narrator from being read as a real employee.
    expect(nick.prohibited.join(" ")).toMatch(/real Nick's employee/i);
    expect(nick.objectCharacter).toBeNull();
  });

  it("camera grammar and environments carry no rendered text", () => {
    for (const shot of [...NOIR_CAMERA_GRAMMAR, ...NOIR_ENVIRONMENTS]) {
      expect(validateNoInFrameText([shot]).ok, shot).toBe(true);
      expect(validateFacelessSubject([shot]).ok, shot).toBe(true);
    }
  });

  it("the bible prompt fragment states the faceless constraint and the version", () => {
    const frag = buildBrandBibleFragment();
    expect(frag).toContain(BRAND_BIBLE_VERSION);
    expect(frag).toMatch(/NEVER render a body, face, hands/i);
  });

  it("disembodied cast members bind to no object character — they are never a rendered subject", () => {
    for (const id of DISEMBODIED_CAST) {
      expect(BRAND_CAST[id as BrandCharacterId].objectCharacter).toBeNull();
    }
  });
});

describe("twelve franchises — every metaphor must render", () => {
  it("registers exactly twelve", () => {
    expect(FRANCHISE_IDS).toHaveLength(12);
  });

  it.each(FRANCHISE_IDS)("%s: visual metaphors pass faceless + in-frame-text", (id) => {
    const f = FRANCHISES[id];
    expect(f.visualMetaphors.length).toBeGreaterThan(0);
    for (const m of f.visualMetaphors) {
      const faceless = validateFacelessSubject([m]);
      expect(faceless.ok, `${f.name} — ${faceless.reason}`).toBe(true);
      const text = validateNoInFrameText([m]);
      expect(text.ok, `${f.name} — ${text.reason}`).toBe(true);
    }
  });

  it.each(FRANCHISE_IDS)("%s: declares a valid objective, CTA set and cast", (id) => {
    const f = FRANCHISES[id];
    expect(CONTENT_DISTRIBUTION_OBJECTIVES).toContain(f.objective);
    expect(f.ctaOptions.length).toBeGreaterThan(0);
    for (const cta of f.ctaOptions) expect(CTA_TYPES).toContain(cta);
    for (const c of f.cast) expect(BRAND_CAST[c]).toBeDefined();
  });

  it.each(FRANCHISE_IDS)("%s: declares evidence, blocking conditions and a length band", (id) => {
    const f = FRANCHISES[id];
    expect(f.requiredEvidence.length).toBeGreaterThan(0);
    expect(f.blockingConditions.length).toBeGreaterThan(0);
    const [lo, hi] = f.targetSeconds;
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("no franchise offers a save CTA for a discovery objective", () => {
    // Reels earn discovery through watch time and sends. A save prompt on a
    // discovery reel competes with the send that actually distributes it —
    // this is the overcorrection that shipped for one commit and was reversed.
    for (const id of FRANCHISE_IDS) {
      const f = FRANCHISES[id];
      if (f.objective === "discovery") {
        expect(f.ctaOptions, `${f.name} is discovery`).not.toContain("save");
      }
    }
  });

  it("every franchise that claims a government source names verification in its blocks", () => {
    // Recall and E-Check content is the highest-consequence category here:
    // a wrong claim about a safety recall is worse than no post.
    for (const f of franchisesRequiring("government_source")) {
      expect(f.blockingConditions.join(" ").toLowerCase()).toMatch(/vin|government|record|pass/);
    }
  });
});

describe("truth rules that must never soften", () => {
  it("no franchise permits a failure deadline", () => {
    // "This will fail next week" is unverifiable and is the single most
    // tempting line in automotive content.
    const withTimelineRisk = ["rust_files", "tire_autopsy", "choose_the_ending"] as const;
    for (const id of withTimelineRisk) {
      const blocks = FRANCHISES[id].blockingConditions.join(" ").toLowerCase();
      expect(blocks, id).toMatch(/timeframe|timeline|weeks or months/);
    }
  });

  it("Review Reconstructed forbids inventing anything the review does not state", () => {
    const blocks = FRANCHISES.review_reconstructed.blockingConditions.join(" ").toLowerCase();
    expect(blocks).toMatch(/inventing any detail/);
    expect(blocks).toMatch(/generating a person/);
    expect(FRANCHISES.review_reconstructed.disclosure).toBe("generated_reenactment");
  });

  it("Sunday Rescue cannot state hours or pricing without a business-fact record", () => {
    const f = FRANCHISES.sunday_rescue_simulator;
    expect(f.requiredEvidence).toContain("current_business_fact");
    expect(f.blockingConditions.join(" ").toLowerCase()).toMatch(/hours, services or pricing/);
  });

  it("franchise fragments carry the NEVER block into the prompt", () => {
    for (const id of FRANCHISE_IDS) {
      expect(buildFranchiseFragment(id)).toMatch(/NEVER:/);
    }
  });
});
