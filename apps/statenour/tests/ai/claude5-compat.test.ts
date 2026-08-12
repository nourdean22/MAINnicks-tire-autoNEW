/**
 * Claude 5 frontier-lane compat tests (lib/ai/claude5-compat.ts).
 *
 * The 5-family (fable/mythos/opus-5) rejects sampling params with HTTP
 * 400 and counts always-on thinking against maxOutputTokens. These pin
 * the two mechanisms that make an ANTHROPIC_MODEL flip safe:
 *   1. the model-id gate (sonnet-5 must NOT be touched — it is
 *      prod-verified WITH temperature),
 *   2. the param sanitizer (strip sampling, floor the output budget,
 *      pass providerOptions — including effort — through untouched).
 */

import { describe, it, expect } from "vitest";
import {
  isClaude5ThinkingModel,
  sanitizeClaude5Params,
  claude5CompatMiddleware,
  CLAUDE5_MIN_OUTPUT_TOKENS,
} from "@/lib/ai/claude5-compat";

describe("isClaude5ThinkingModel", () => {
  it("matches the three frontier ids", () => {
    expect(isClaude5ThinkingModel("claude-fable-5")).toBe(true);
    expect(isClaude5ThinkingModel("claude-mythos-5")).toBe(true);
    expect(isClaude5ThinkingModel("claude-opus-5")).toBe(true);
  });

  it("matches dated snapshots and is case/whitespace tolerant", () => {
    expect(isClaude5ThinkingModel("claude-opus-5-20260724")).toBe(true);
    expect(isClaude5ThinkingModel("  CLAUDE-FABLE-5  ")).toBe(true);
  });

  it("does NOT match claude-sonnet-5 (current default — prod-verified with temperature)", () => {
    expect(isClaude5ThinkingModel("claude-sonnet-5")).toBe(false);
  });

  it("does not match older Claude generations or other providers", () => {
    expect(isClaude5ThinkingModel("claude-3-5-sonnet-latest")).toBe(false);
    expect(isClaude5ThinkingModel("x-ai/grok-4.3")).toBe(false);
    expect(isClaude5ThinkingModel("deepseek-v4-pro")).toBe(false);
    expect(isClaude5ThinkingModel("gpt-4o")).toBe(false);
  });

  it("is false for null / undefined / empty", () => {
    expect(isClaude5ThinkingModel(null)).toBe(false);
    expect(isClaude5ThinkingModel(undefined)).toBe(false);
    expect(isClaude5ThinkingModel("")).toBe(false);
  });
});

describe("sanitizeClaude5Params", () => {
  it("strips temperature, topP and topK (the HTTP-400 trio)", () => {
    const out = sanitizeClaude5Params({
      temperature: 0.4,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 20_000,
    });
    expect("temperature" in out).toBe(false);
    expect("topP" in out).toBe(false);
    expect("topK" in out).toBe(false);
  });

  it("floors a brevity cap to the thinking-headroom minimum", () => {
    // The turn classifier budgets 80-1600 visible tokens; on a thinking
    // model that budget covers thinking + text TOGETHER and strangles it.
    const out = sanitizeClaude5Params({ maxOutputTokens: 80 });
    expect(out.maxOutputTokens).toBe(CLAUDE5_MIN_OUTPUT_TOKENS);
  });

  it("sets the floor when maxOutputTokens is absent (Anthropic requires max_tokens)", () => {
    const out = sanitizeClaude5Params({});
    expect(out.maxOutputTokens).toBe(CLAUDE5_MIN_OUTPUT_TOKENS);
  });

  it("leaves a budget above the floor unchanged", () => {
    const out = sanitizeClaude5Params({ maxOutputTokens: 64_000 });
    expect(out.maxOutputTokens).toBe(64_000);
  });

  it("passes providerOptions through untouched (effort belongs to the router)", () => {
    const providerOptions = { anthropic: { effort: "high" } };
    const out = sanitizeClaude5Params({ providerOptions, temperature: 0.2 });
    expect(out.providerOptions).toBe(providerOptions);
  });

  it("does not mutate the input params object", () => {
    const params = { temperature: 0.5, maxOutputTokens: 100 };
    sanitizeClaude5Params(params);
    expect(params.temperature).toBe(0.5);
    expect(params.maxOutputTokens).toBe(100);
  });
});

describe("claude5CompatMiddleware", () => {
  it("exposes transformParams that applies the sanitizer", async () => {
    const transform = claude5CompatMiddleware.transformParams;
    expect(typeof transform).toBe("function");
    const out = (await transform!({
      type: "generate",
      params: { temperature: 0.7, maxOutputTokens: 150 },
      model: {},
    } as never)) as Record<string, unknown>;
    expect("temperature" in out).toBe(false);
    expect(out.maxOutputTokens).toBe(CLAUDE5_MIN_OUTPUT_TOKENS);
  });
});
