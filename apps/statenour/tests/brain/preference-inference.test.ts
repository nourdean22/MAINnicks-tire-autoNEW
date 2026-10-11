/**
 * Arc B Feature 1 · Preference Inference Engine · v10.0.526
 *
 * Pure-function corpus. No DB calls. These tests pin the addendum rendering.
 * 2026-10-11 (R3-13): the feedback math (scoreReplyFeatures,
 * deltaFromFeaturesAndScore, applyDeltaWithDecay) lost its last caller when
 * inferDeltaFromFeedback was deleted, so it was deleted with its tests.
 */

import { describe, expect, it } from "vitest";
import * as engine from "@/lib/brain/preference-inference";
import {
  DEFAULT_VECTOR,
  buildSystemPromptAddendum,
  type PreferenceVector,
} from "@/lib/brain/preference-inference";

describe("preference-inference - no caller-less feedback math", () => {
  it("the scoring, delta and decay helpers are gone", () => {
    for (const name of ["scoreReplyFeatures", "deltaFromFeaturesAndScore", "applyDeltaWithDecay", "DEFAULT_LEARNING_RATE"]) {
      expect(engine, name).not.toHaveProperty(name);
    }
  });

  it("CONTROL: the export check sees a real export", () => {
    expect(engine).toHaveProperty("buildSystemPromptAddendum");
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
