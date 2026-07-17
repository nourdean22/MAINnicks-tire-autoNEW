import { describe, it, expect } from "vitest";
import { combinePromptWithNegative } from "./services/higgsfieldStudio";

/**
 * Seedance 1.5 accepts NO negative-prompt parameter (verified via
 * `higgsfield model get seedance1_5`, 2026-07-16), so the compiler's per-lens
 * negativePrompt must be compiled INTO the positive prompt as a hard
 * DO NOT INCLUDE section — before this contract, every style exclusion the
 * prompt compiler produced (film grain on blueprint, cartoon eyes, etc.) was
 * silently dropped at dispatch.
 */
describe("combinePromptWithNegative", () => {
  it("appends the negative terms as a DO NOT INCLUDE section", () => {
    const out = combinePromptWithNegative("A blueprint wheel diagram.", "film grain, photographic realism");
    expect(out).toBe("A blueprint wheel diagram.\nDO NOT INCLUDE: film grain, photographic realism.");
  });

  it("returns the prompt unchanged when there is no negative", () => {
    expect(combinePromptWithNegative("Just a tire.")).toBe("Just a tire.");
    expect(combinePromptWithNegative("Just a tire.", "   ")).toBe("Just a tire.");
  });

  it("keeps the positive prompt fully intact ahead of the exclusions", () => {
    const prompt = "Line one.\nVISUAL CONTINUITY: same wheel.\nLine three.";
    const out = combinePromptWithNegative(prompt, "humans, hands");
    expect(out.startsWith(prompt)).toBe(true);
    expect(out.endsWith("DO NOT INCLUDE: humans, hands.")).toBe(true);
  });
});
