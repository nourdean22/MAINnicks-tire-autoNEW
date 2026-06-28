import { describe, it, expect } from "vitest";
import { calculateReelQualityScore } from "../client/src/lib/facelessReelStudio";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";

/**
 * The server `content.validateReelBrief` mutation and the enhanced
 * `content.generateReelBrief` both run `calculateReelQualityScore` so the reel
 * quality gate is enforced server-side, not just advisory in the Studio UI.
 * These tests lock that gate's contract against the curated sample briefs (no
 * LLM, no network).
 */
describe("reel quality gate (server-side enforcement)", () => {
  it("passes every curated SAMPLE_REEL_BRIEF", () => {
    expect(SAMPLE_REEL_BRIEFS.length).toBeGreaterThan(0);
    for (const brief of SAMPLE_REEL_BRIEFS) {
      const r = calculateReelQualityScore(brief);
      expect(r.passing, `${brief.id}: scored ${r.score}/${r.max}`).toBe(true);
    }
  });

  it("flips the claim-safety dimension when a forbidden claim is injected", () => {
    const baseline = calculateReelQualityScore(SAMPLE_REEL_BRIEFS[0]);
    const bad = structuredClone(SAMPLE_REEL_BRIEFS[0]);
    bad.voiceoverScript = "We guarantee this fix will last forever.";
    bad.selectedCaption = bad.voiceoverScript;
    const r = calculateReelQualityScore(bad);
    const claimPart = r.parts.find((p) => p.label.startsWith("Claim safety"));
    expect(claimPart?.ok).toBe(false);
    expect(r.score).toBeLessThan(baseline.score);
  });

  it("fails a brief stripped of its storyboard beats", () => {
    const empty = structuredClone(SAMPLE_REEL_BRIEFS[0]);
    empty.storyboardBeats = [];
    expect(calculateReelQualityScore(empty).passing).toBe(false);
  });
});
