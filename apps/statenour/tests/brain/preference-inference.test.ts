/**
 * Arc B Feature 1 · Preference Inference Engine · v10.0.526
 *
 * Pure-function corpus. No DB calls — the engine's persistence
 * surface (load/save/aggregate) is exercised in integration tests,
 * not here. These tests pin the math + addendum rendering.
 */

import { describe, expect, it } from "vitest";
import {
  AXES,
  DEFAULT_VECTOR,
  applyDeltaWithDecay,
  buildSystemPromptAddendum,
  deltaFromFeaturesAndScore,
  scoreReplyFeatures,
  type PreferenceVector,
  type StyleFeatures,
} from "@/lib/brain/preference-inference";

describe("preference-inference · delta math", () => {
  it("delta-math · positive feedback yields signed feature vector", () => {
    const features: StyleFeatures = {
      density: 0.5,
      creativity: 0.2,
      skepticism: -0.3,
      directness: 0.7,
      humor: 0,
      jargon: 0.4,
      structure: 0.6,
      urgency: 0.1,
    };
    const delta = deltaFromFeaturesAndScore(features, 1);
    expect(delta.density).toBeCloseTo(0.5);
    expect(delta.directness).toBeCloseTo(0.7);
    expect(delta.skepticism).toBeCloseTo(-0.3);
    expect(delta.humor).toBe(0);
  });

  it("delta-math · negative feedback inverts every axis", () => {
    const features: StyleFeatures = {
      density: 0.5,
      creativity: 0.2,
      skepticism: -0.3,
      directness: 0.7,
      humor: 0,
      jargon: 0.4,
      structure: 0.6,
      urgency: 0.1,
    };
    const delta = deltaFromFeaturesAndScore(features, -1);
    expect(delta.density).toBeCloseTo(-0.5);
    expect(delta.directness).toBeCloseTo(-0.7);
    expect(delta.skepticism).toBeCloseTo(0.3);
    expect(delta.structure).toBeCloseTo(-0.6);
  });
});

describe("preference-inference · decay + clamp", () => {
  it("decay-clamp · learning rate 0.1 scales delta · clamped to [-1, 1]", () => {
    const current: PreferenceVector = { ...DEFAULT_VECTOR, directness: 0.5 };
    const delta: PreferenceVector = { ...DEFAULT_VECTOR, directness: 1 };
    const next = applyDeltaWithDecay(current, delta, 0.1);
    // 0.5 + 1 * 0.1 = 0.6
    expect(next.directness).toBeCloseTo(0.6);
    // Other axes untouched
    expect(next.density).toBe(0);
  });

  it("decay-clamp · never escapes [-1, 1] even with extreme deltas", () => {
    const current: PreferenceVector = {
      ...DEFAULT_VECTOR,
      structure: 0.95,
      humor: -0.95,
    };
    const delta: PreferenceVector = {
      ...DEFAULT_VECTOR,
      structure: 99, // would push to ~10.85 without clamp
      humor: -99,
    };
    const next = applyDeltaWithDecay(current, delta, 1);
    expect(next.structure).toBeLessThanOrEqual(1);
    expect(next.structure).toBeGreaterThanOrEqual(-1);
    expect(next.humor).toBeLessThanOrEqual(1);
    expect(next.humor).toBeGreaterThanOrEqual(-1);
    expect(next.structure).toBe(1);
    expect(next.humor).toBe(-1);
  });
});

describe("preference-inference · feature scoring", () => {
  it("empty-history · empty text yields all-zero feature vector", () => {
    const features = scoreReplyFeatures("");
    for (const axis of AXES) {
      expect(features[axis]).toBe(0);
    }
  });

  it("all-positive-feedback · bulleted technical reply scores structure + jargon", () => {
    const bulletReply = [
      "Ship it · here's the plan:",
      "- Run `pnpm run verify`",
      "- Check `prisma/schema.prisma` for drift",
      "- Inspect `lib/ai/system-prompt.ts` line 1841",
      "- Fire the migration",
      "- Lock the deploy",
      "",
      "```ts",
      "function ship() { return true; }",
      "```",
    ].join("\n");
    const features = scoreReplyFeatures(bulletReply);
    expect(features.structure).toBeGreaterThan(0.3);
    expect(features.jargon).toBeGreaterThan(0.2);
    // Positive thumbs · all axes preserve sign
    const delta = deltaFromFeaturesAndScore(features, 1);
    expect(delta.structure).toBeGreaterThan(0);
    expect(delta.jargon).toBeGreaterThan(0);
  });

  it("all-negative-feedback · hedge-heavy reply scores skepticism · thumbs-down inverts", () => {
    const hedgeReply =
      "I think maybe you could possibly consider trying X? It might work. Perhaps. Not sure though, it seems like one option among many. Could you clarify your goal? What outcome are you really after?";
    const features = scoreReplyFeatures(hedgeReply);
    expect(features.skepticism).toBeGreaterThan(0);
    const delta = deltaFromFeaturesAndScore(features, -1);
    // Thumbs-down on skeptical reply pulls operator AWAY from skepticism
    expect(delta.skepticism).toBeLessThan(0);
  });
});

describe("preference-inference · weekly aggregate math", () => {
  it("weekly-aggregate · mixed feedback averages signed deltas per axis", () => {
    // Simulate the aggregate loop: two replies, one thumbs-up on a
    // bulleted reply, one thumbs-down on a prose reply.
    const bulletFeatures = scoreReplyFeatures(
      [
        "- one",
        "- two",
        "- three",
        "- four",
        "- five",
      ].join("\n"),
    );
    const proseFeatures = scoreReplyFeatures(
      "This is a long flowing paragraph without any bullets. It just keeps going and going to demonstrate prose density.",
    );

    const d1 = deltaFromFeaturesAndScore(bulletFeatures, 1);
    const d2 = deltaFromFeaturesAndScore(proseFeatures, -1);

    // Bullet reply scored thumbs-up · pulls structure +
    expect(d1.structure).toBeGreaterThan(0);
    // Prose reply (bulletLines=0 → raw structure feature negative)
    // got thumbs-down · negative × negative = positive · also pulls
    // toward bulleted. Both feedback events agree.
    expect(d2.structure).toBeGreaterThan(0);
    const avgStructure = (d1.structure + d2.structure) / 2;
    expect(avgStructure).toBeGreaterThan(0);
    expect(avgStructure).toBeLessThanOrEqual(1);
  });
});

describe("preference-inference · addendum rendering", () => {
  it("addendum is empty when every axis is in the neutral band", () => {
    const neutral: PreferenceVector = { ...DEFAULT_VECTOR };
    expect(buildSystemPromptAddendum(neutral)).toBe("");
  });

  it("addendum surfaces strong tells with operator-voice phrasing", () => {
    const vec: PreferenceVector = {
      ...DEFAULT_VECTOR,
      density: -0.8,    // strongly terse
      structure: 0.7,   // strongly bulleted
      jargon: 0.4,      // technical
      directness: 0.9,  // strongly blunt
    };
    const addendum = buildSystemPromptAddendum(vec);
    expect(addendum).toContain("Operator style preferences");
    expect(addendum).toMatch(/terse/);
    expect(addendum).toMatch(/bulleted/);
    expect(addendum).toMatch(/technical/i);
    expect(addendum).toMatch(/blunt/);
    // The "learned tells · not rigid rules" hedge appears
    expect(addendum).toContain("not rigid rules");
  });
});
