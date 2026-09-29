/**
 * tests/lib/ai/pricing.test.ts · 2026-09-08 (program U6)
 *
 * One rate table for provider.ts, track.ts and Langfuse. The Langfuse
 * patterns are Go RE2 on the server; they are also valid JS regexes, so each
 * one is pinned against the model id it exists for.
 */
import { describe, it, expect } from "vitest";
import { LANGFUSE_MODEL_PRICES, PROVIDER_RATES_PER_1M_TOKENS, estimateCostUsd, usdToCents } from "@/lib/ai/pricing";

describe("estimateCostUsd", () => {
  it("prices a known provider from the table and rounds to $0.0001", () => {
    // 1M in + 1M out at anthropic (= claude-sonnet-5) rates = 2 + 10
    expect(estimateCostUsd("anthropic", 1_000_000, 1_000_000)).toBe(12);
    expect(estimateCostUsd("gemini", 10_000, 2_000)).toBe(0.0014);
  });
  it("no usage → undefined; unknown provider → undefined; local → 0", () => {
    expect(estimateCostUsd("anthropic")).toBeUndefined();
    expect(estimateCostUsd("nope", 10, 10)).toBeUndefined();
    expect(estimateCostUsd("ollama", 10_000, 10_000)).toBe(0);
  });
});

describe("usdToCents", () => {
  it("rounds half up and never goes negative or NaN", () => {
    expect(usdToCents(0.005)).toBe(1);
    expect(usdToCents(0.004)).toBe(0);
    expect(usdToCents(1.234)).toBe(123);
    expect(usdToCents(-1)).toBe(0);
    expect(usdToCents(Number.NaN)).toBe(0);
  });
});

describe("Langfuse model definitions", () => {
  it("every pattern is a valid regex that matches its own sample id", () => {
    for (const m of LANGFUSE_MODEL_PRICES) {
      const re = new RegExp(m.matchPattern.replace(/^\(\?i\)/, ""), "i");
      expect(re.test(m.sample), `${m.modelName} should match ${m.sample}`).toBe(true);
    }
  });
  it("prices are per token and derived from the provider table", () => {
    const gem = LANGFUSE_MODEL_PRICES.find((m) => m.modelName.includes("gemini"))!;
    expect(gem.inputPrice).toBeCloseTo(PROVIDER_RATES_PER_1M_TOKENS.gemini.input / 1_000_000, 12);
    expect(gem.outputPrice).toBeCloseTo(PROVIDER_RATES_PER_1M_TOKENS.gemini.output / 1_000_000, 12);
  });
  it("an OpenRouter slug does not also match the Gemini family (first match wins in Langfuse)", () => {
    const gem = LANGFUSE_MODEL_PRICES.find((m) => m.modelName.includes("gemini"))!;
    expect(new RegExp(gem.matchPattern.replace(/^\(\?i\)/, ""), "i").test("google/gemini-2.5-flash")).toBe(false);
  });
});
