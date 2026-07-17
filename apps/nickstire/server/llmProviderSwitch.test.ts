/**
 * AI_FORCE_GEMINI escape hatch — when the OpenAI-family key is dead (live
 * 2026-07-17: shared OpenRouter account 402'd every creative leg), the flag
 * reroutes hard-pinned gpt-* call sites onto the Gemini free-tier key.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolveEffectiveModel } from "./_core/llm";

const before = { force: process.env.AI_FORCE_GEMINI, gm: process.env.GEMINI_MODEL };
afterEach(() => {
  if (before.force === undefined) delete process.env.AI_FORCE_GEMINI; else process.env.AI_FORCE_GEMINI = before.force;
  if (before.gm === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = before.gm;
});

describe("resolveEffectiveModel", () => {
  it("is a no-op when the flag is off (explicit pins pass through)", () => {
    delete process.env.AI_FORCE_GEMINI;
    expect(resolveEffectiveModel("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(resolveEffectiveModel(undefined)).toBeUndefined();
  });

  it("remaps gpt-* pins to the Gemini default when forced", () => {
    process.env.AI_FORCE_GEMINI = "true";
    delete process.env.GEMINI_MODEL;
    expect(resolveEffectiveModel("gpt-4o-mini")).toBe("gemini-2.5-flash");
    expect(resolveEffectiveModel(undefined)).toBe("gemini-2.5-flash");
  });

  it("respects GEMINI_MODEL override and leaves explicit gemini pins untouched", () => {
    process.env.AI_FORCE_GEMINI = "true";
    process.env.GEMINI_MODEL = "gemini-2.5-pro";
    expect(resolveEffectiveModel("gpt-4o")).toBe("gemini-2.5-pro");
    expect(resolveEffectiveModel("gemini-2.5-flash")).toBe("gemini-2.5-flash");
  });
});
