/**
 * tests/ai/brevity-waiver.test.ts (2026-08-18).
 *
 * The witnessed failure: replies that EXACTLY obeyed "reply with just
 * OK" wore red "REGEN RECOMMENDED" chips (overall 62 and 86 on prod)
 * because the spec/length axes measure the shape the operator ordered
 * away, and either axis alone fires the regen gate. Obedience outranks
 * style axes — the waiver encodes that, narrowly.
 */

import { describe, expect, it } from "vitest";
import { critiqueOutput, detectBrevityRequest } from "@/lib/ai/chat/output-guardian";

describe("detectBrevityRequest · fires on operator-constrained shapes", () => {
  it("matches the witnessed prompt forms", () => {
    expect(detectBrevityRequest("test message for edit flow — reply with just OK")).toBe(true);
    expect(detectBrevityRequest("EDITED message — reply with exactly: EDIT WORKED")).toBe(true);
    expect(detectBrevityRequest("is the shop open monday? yes or no")).toBe(true);
    expect(detectBrevityRequest("summarize that in one sentence")).toBe(true);
    expect(detectBrevityRequest("give me the number, keep it short")).toBe(true);
    expect(detectBrevityRequest("under 20 words: why did revenue dip?")).toBe(true);
  });

  it("does NOT fire on negated forms — 'don't just say OK' wants MORE", () => {
    expect(detectBrevityRequest("don't just say OK, walk me through it")).toBe(false);
    expect(detectBrevityRequest("do not reply with just a number — explain")).toBe(false);
  });

  it("does NOT fire on ordinary asks", () => {
    expect(detectBrevityRequest("what should I price the alignment special at?")).toBe(false);
    expect(detectBrevityRequest("")).toBe(false);
    expect(detectBrevityRequest(undefined)).toBe(false);
  });
});

describe("critiqueOutput · the waiver, end to end", () => {
  const TERSE_OBEDIENT = "OK";
  const BREVITY_ASK = "confirm you got that — reply with just OK";

  it("waives regen + rescales overall for an obedient terse reply", () => {
    const score = critiqueOutput(TERSE_OBEDIENT, "prose", { userPrompt: BREVITY_ASK });
    expect(score.shouldRegen).toBe(false);
    // Overall rescaled onto cliche+voice — a clean obedient reply reads
    // clean (>= 80 hides the chip entirely), not "quality warn · 62".
    expect(score.overall).toBeGreaterThanOrEqual(80);
    expect(score.reasons.join(" ")).toContain("brevity-requested");
  });

  it("the SAME terse reply without the constraint still gates (axes intact)", () => {
    const score = critiqueOutput(TERSE_OBEDIENT, "prose");
    expect(score.shouldRegen).toBe(true); // spec/length axis-gate unchanged
  });

  it("a hedge hiding behind the waiver still fires — hedge axis is never waived", () => {
    const score = critiqueOutput(
      "Sorry, I cannot provide that.",
      "prose",
      { userPrompt: BREVITY_ASK },
    );
    expect(score.shouldRegen).toBe(true);
    expect(score.reasons.join(" ")).toContain("hedge-detected");
  });
});
