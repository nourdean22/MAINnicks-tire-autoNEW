/**
 * Claude 5 frontier-lane compat tests (lib/ai/claude5-compat.ts).
 *
 * The 5-family (fable/mythos/opus-5) rejects sampling params with HTTP
 * 400 and counts always-on thinking against maxOutputTokens. These pin
 * the two mechanisms that make an ANTHROPIC_MODEL flip safe:
 *   1. the model-id gates. 2026-09-29 (#2768): sonnet-5 / 5-5 and opus-4-7 /
 *      4-8 are covered too; Anthropic's model-deprecations page (read
 *      2026-09-29) says non-default sampling "Returns a 400 error ... on
 *      Claude 4.7 and later models", and the old "prod-verified WITH
 *      temperature" exemption never had a receipt,
 *   2. the param sanitizer (strip sampling, floor the output budget,
 *      pass providerOptions — including effort — through untouched).
 */

import { describe, it, expect } from "vitest";
import {
  isClaude5ThinkingModel,
  sanitizeClaude5Params,
  claude5CompatMiddleware,
  claudeCompatMiddlewareFor,
  claudeThinkingOffParams,
  rejectsSamplingParams,
  thinksByDefault,
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

  it("does NOT match claude-sonnet-5 (effort-router frontier ids only; the compat middleware keys on rejectsSamplingParams)", () => {
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

describe("which models the compat middleware wraps (#2768)", () => {
  const transform = async (modelId: string, params: Record<string, unknown>) => {
    const mw = claudeCompatMiddlewareFor(modelId);
    if (!mw) return undefined;
    return (await mw.transformParams!({ type: "generate", params, model: {} } as never)) as Record<string, unknown>;
  };

  it.each(["claude-sonnet-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-mythos-5"])(
    "%s: sampling stripped and the output floor applied (thinks by default)",
    async (id) => {
      expect(rejectsSamplingParams(id)).toBe(true);
      expect(thinksByDefault(id)).toBe(true);
      const out = await transform(id, { temperature: 0.4, topP: 0.9, topK: 5, maxOutputTokens: 300 });
      expect(out).toBeDefined();
      expect(out).not.toHaveProperty("temperature");
      expect(out).not.toHaveProperty("topP");
      expect(out).not.toHaveProperty("topK");
      expect(out!.maxOutputTokens).toBe(CLAUDE5_MIN_OUTPUT_TOKENS);
    },
  );

  it.each(["claude-opus-4-8", "claude-opus-4-7"])("%s: sampling stripped, maxOutputTokens untouched (no default thinking)", async (id) => {
    expect(thinksByDefault(id)).toBe(false);
    const out = await transform(id, { temperature: 0.4, maxOutputTokens: 300 });
    expect(out).not.toHaveProperty("temperature");
    expect(out!.maxOutputTokens).toBe(300);
  });

  it.each(["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-6", "claude-opus-4-70", "gpt-4o", ""])(
    "positive control: %s is not wrapped (it accepts sampling params)",
    (id) => {
      expect(claudeCompatMiddlewareFor(id)).toBeUndefined();
    },
  );
});

describe("claudeThinkingOffParams (raw Messages API callers)", () => {
  it.each([
    ["claude-sonnet-5", { thinking: { type: "disabled" } }],
    ["claude-opus-5", { thinking: { type: "disabled" } }],
    ["claude-opus-4-8", { thinking: { type: "disabled" } }],
    ["claude-haiku-4-5-20251001", { thinking: { type: "disabled" } }],
    ["claude-sonnet-4-5-latest", { thinking: { type: "disabled" } }],
    ["claude-sonnet-5-5", { thinking: { type: "between_tools" } }],
    ["claude-opus-5-5", { output_config: { effort: "low" } }],
    ["claude-fable-5-1", { output_config: { effort: "low" } }],
    ["claude-fable-5", { output_config: { effort: "low" } }],
    ["claude-mythos-5-1", { output_config: { effort: "low" } }],
    ["claude-mythos-5", { output_config: { effort: "low" } }],
  ])("%s", (id, expected) => {
    expect(claudeThinkingOffParams(id)).toEqual(expected);
  });

  it("positive control: an id no table names never gets `disabled` (it could 400)", () => {
    expect(claudeThinkingOffParams("claude-opus-6")).toEqual({ output_config: { effort: "low" } });
    expect(claudeThinkingOffParams("claude-sonnet-5-9")).toEqual({ output_config: { effort: "low" } });
  });
});
