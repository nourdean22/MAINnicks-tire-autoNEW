/**
 * Canaries for the reel disclosure gate.
 *
 * The gate exists because AI-generated footage framed as a real customer
 * incident, repair, test, or before/after is a fabricated claim about the shop's
 * own work, published under the shop's name. Rule 2 additionally enforces Meta's
 * disclosure requirement for photorealistic generated video (verified against
 * Meta policy 2026-08-28).
 *
 * Every blocking assertion is PAIRED with a positive control. A gate that
 * refuses everything scores identically to a working one on refusal tests, and
 * a gate that blocks legitimate educational content would be switched off within
 * a week - at which point it guards nothing.
 */
import { describe, it, expect } from "vitest";
import {
  disclosureViolation,
  requiredPublishParams,
  isGenerated,
  hasDisclosure,
  realEvidenceClaims,
  type DisclosurePack,
} from "@shared/reelDisclosure";

const base: DisclosurePack = { id: "test-pack", copy: "", videoProvider: null };

/* -- Rule 1: generated footage may not claim real evidence ---------------- */

describe("Rule 1 - generated video framed as real evidence FAILS", () => {
  const violating = (copy: string): DisclosurePack => ({
    ...base,
    id: "violating",
    videoProvider: "higgsfield",
    copy,
  });

  it("blocks a generated pack claiming a real customer", () => {
    const r = disclosureViolation(violating("This customer came in with a sidewall bulge. AI-generated."));
    expect(r).toContain("BLOCKED_AI_PRESENTED_AS_REAL");
    expect(r).toContain("real-customer");
  });

  it("blocks a generated pack claiming we performed the repair", () => {
    expect(disclosureViolation(violating("We replaced the wheel bearing the same day. AI-generated."))).toContain(
      "BLOCKED_AI_PRESENTED_AS_REAL",
    );
  });

  it("blocks a generated pack claiming a before/after", () => {
    expect(disclosureViolation(violating("Before and after on this brake job. AI-generated."))).toContain(
      "BLOCKED_AI_PRESENTED_AS_REAL",
    );
  });

  it("blocks a generated pack claiming a test we ran", () => {
    expect(disclosureViolation(violating("We tested three tires at 20 PSI. AI-generated."))).toContain(
      "BLOCKED_AI_PRESENTED_AS_REAL",
    );
  });

  it("blocks a generated pack claiming real footage", () => {
    expect(disclosureViolation(violating("Caught on camera in our bay. AI-generated."))).toContain(
      "BLOCKED_AI_PRESENTED_AS_REAL",
    );
  });

  // The disclosure label does NOT rescue a real-evidence claim. Saying
  // "AI-generated" under a video that asserts a real customer is still a lie
  // about the shop's work - Rule 1 must outrank Rule 2.
  it("a disclosure label does NOT excuse a real-evidence claim", () => {
    const r = disclosureViolation({
      ...violating("This customer came in with a bulge."),
      disclosureLabel: "AI-generated",
      copy: "This customer came in with a bulge. AI-generated visualization.",
    });
    expect(r).toContain("BLOCKED_AI_PRESENTED_AS_REAL");
  });

  // POSITIVE CONTROL 1: identical framing, but the footage is REAL. Nothing to
  // disclose, nothing to block - a shop filming its own bay must not be gated.
  it("PERMITS the same real-evidence copy when the footage is real", () => {
    expect(
      disclosureViolation({
        ...base,
        id: "real-footage",
        videoProvider: null,
        copy: "This customer came in with a sidewall bulge. We replaced it the same day.",
      }),
    ).toBeNull();
  });

  // POSITIVE CONTROL 2: generated footage that makes NO claim about a real
  // event, and discloses itself, is exactly what the pipeline should ship.
  it("PERMITS generated footage that is educational and disclosed", () => {
    expect(
      disclosureViolation({
        ...base,
        id: "educational",
        videoProvider: "higgsfield",
        copy: "How to read a tire sidewall in 30 seconds. AI-generated illustration.",
        apiDisclosureFlag: true,
      }),
    ).toBeNull();
  });
});

/* -- Rule 2: generated video must disclose -------------------------------- */

describe("Rule 2 - undisclosed generated video FAILS", () => {
  it("blocks generated footage with no disclosure anywhere", () => {
    const r = disclosureViolation({
      ...base,
      id: "undisclosed",
      videoProvider: "veo",
      copy: "Three signs your brakes need attention.",
    });
    expect(r).toContain("BLOCKED_MISSING_AI_DISCLOSURE");
  });

  it("PERMITS the same pack once a disclosure label is present", () => {
    expect(
      disclosureViolation({
        ...base,
        id: "disclosed",
        videoProvider: "veo",
        copy: "Three signs your brakes need attention.",
        apiDisclosureFlag: true,
      }),
    ).toBeNull();
  });

  // POSITIVE CONTROL: real footage needs no disclosure at all.
  it("PERMITS real footage with no disclosure", () => {
    expect(
      disclosureViolation({ ...base, id: "real", videoProvider: null, copy: "Three signs your brakes need attention." }),
    ).toBeNull();
  });
});

/* -- helpers, incl. the false-positive controls that keep the gate usable -- */

describe("helpers", () => {
  it("isGenerated matches every known generative provider and nothing else", () => {
    for (const p of ["higgsfield", "veo-3.1-fast", "seedance-2.5", "kling", "wan", "sora", "hailuo"]) {
      expect(isGenerated({ ...base, videoProvider: p })).toBe(true);
    }
    // NEGATIVE CONTROLS: real capture sources are not generative.
    for (const p of ["iphone", "frigate", "dashcam", "canon", "", null]) {
      expect(isGenerated({ ...base, videoProvider: p })).toBe(false);
    }
  });

  it("hasDisclosure accepts the accepted phrasings, rejects unrelated copy", () => {
    for (const c of ["AI-generated", "made with AI", "AI visualization", "simulated", "dramatization"]) {
      expect(hasDisclosure({ ...base, copy: c })).toBe(true);
    }
    expect(hasDisclosure({ ...base, copy: "Book your appointment today." })).toBe(false);
  });

  // The gate must not fire on ordinary educational copy, or it gets disabled.
  it("realEvidenceClaims does NOT fire on generic educational copy", () => {
    for (const c of [
      "How to check your tread depth with a penny.",
      "Why tire pressure drops when it gets cold.",
      "Three signs a wheel bearing is failing.",
      "What the check engine light actually means.",
    ]) {
      expect(realEvidenceClaims(c)).toEqual([]);
    }
  });

  it("realEvidenceClaims fires on genuine real-event claims", () => {
    expect(realEvidenceClaims("This customer came in with a bulge.").length).toBeGreaterThan(0);
    expect(realEvidenceClaims("Before and after on this alignment.").length).toBeGreaterThan(0);
  });
});

/* -- the structured flag IS the mechanism (corrected 2026-08-28) ---------- */

describe("Meta's is_ai_generated is the disclosure mechanism, not caption text", () => {
  // The correction: a caption saying "AI-generated" does NOT satisfy Meta.
  it("caption text alone does NOT satisfy the disclosure requirement", () => {
    const r = disclosureViolation({
      ...base,
      id: "caption-only",
      videoProvider: "higgsfield",
      copy: "Three signs your brakes need attention. AI-generated.",
      // no apiDisclosureFlag
    });
    expect(r).toContain("BLOCKED_MISSING_AI_DISCLOSURE");
    expect(r).toContain("caption text is NOT the platform mechanism");
  });

  it("the structured flag satisfies it", () => {
    expect(
      disclosureViolation({
        ...base,
        id: "flagged",
        videoProvider: "higgsfield",
        copy: "Three signs your brakes need attention.",
        apiDisclosureFlag: true,
      }),
    ).toBeNull();
  });

  it("requiredPublishParams demands the flag for generated video and nothing for real footage", () => {
    expect(requiredPublishParams({ ...base, videoProvider: "higgsfield", copy: "" })).toEqual({ is_ai_generated: true });
    expect(requiredPublishParams({ ...base, videoProvider: null, copy: "" })).toEqual({});
  });
});
