/**
 * classifyModelId · one canonical model-id → provider classifier · v10.0.531
 *
 * Consolidates the three copies that had drifted (inferProviderName,
 * stream-error-handler inline branch, modelToProvider). The last one lacked the
 * slash-first branch and misattributed OpenRouter ids ("google/gemini-2.5-flash")
 * to the native gemini lane — blinding the cost HUD to OpenRouter traffic.
 * These tests lock in the fix + the anti-drift invariant (all sites agree).
 */
import { describe, it, expect } from "vitest";
import { classifyModelId } from "@/lib/ai/provider";
import { modelToProvider } from "@/lib/ai/provider-health";
import { inferProviderName } from "@/lib/ai/stream-with-fallback";

describe("classifyModelId", () => {
  const cases: Array<[string, string | null]> = [
    // OpenRouter vendor-prefixed ids — THE FIX (modelToProvider used to say gemini/openai/anthropic)
    ["google/gemini-2.5-flash", "openrouter"],
    ["openai/gpt-4o", "openrouter"],
    ["anthropic/claude-3-5-sonnet", "openrouter"],
    ["deepseek/deepseek-chat", "openrouter"],
    // Google native "models/" form is NOT OpenRouter
    ["models/gemini-2.5-flash", "gemini"],
    ["gemini-2.5-flash", "gemini"],
    ["gemini-3.5-flash", "gemini"],
    // ollama native colon-tag + bare registry substrings
    ["gpt-oss:120b", "ollama"],
    ["qwen3:14b", "ollama"],
    ["glm-5", "ollama"],
    ["deepseek-v4", "ollama"],
    // native openai / anthropic (never slash-prefixed)
    ["gpt-4o", "openai"],
    ["o3-mini", "openai"],
    ["claude-3-5-sonnet", "anthropic"],
    ["", null],
  ];

  it.each(cases)("classifies %s → %s", (id, expected) => {
    expect(classifyModelId(id)).toBe(expected);
  });

  it("null/undefined → null", () => {
    expect(classifyModelId(null)).toBeNull();
    expect(classifyModelId(undefined)).toBeNull();
  });

  it("modelToProvider now attributes OpenRouter correctly (regression for the fixed bug)", () => {
    expect(modelToProvider("google/gemini-2.5-flash")).toBe("openrouter");
    expect(modelToProvider("openai/gpt-4o")).toBe("openrouter");
    expect(modelToProvider("gemini-2.5-flash")).toBe("gemini"); // native lane still gemini
  });

  it("inferProviderName + modelToProvider agree on the same id (can't drift)", () => {
    for (const id of ["google/gemini-2.5-flash", "gpt-oss:120b", "gpt-4o", "claude-3-5-sonnet", "glm-5"]) {
      expect(inferProviderName({ modelId: id })).toBe(modelToProvider(id));
    }
  });
});
