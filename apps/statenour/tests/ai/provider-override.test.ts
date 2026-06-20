/**
 * tests/ai/provider-override.test.ts · de-Venice control-plane lock.
 *
 * Locks the runtime-provider allowlist that gates which lanes a
 * provider override can pin. The de-Venice sweep retired "venice"
 * (and the legacy "emergency" sentinel) from the runtime set: only
 * the four live lanes — ollama, gemini, openai, anthropic — are
 * runtime providers. `isRuntimeProvider` is the type-guard the
 * override plumbing trusts; a regression that re-admits "venice"
 * would let a dead lane back into the picker / routing path.
 *
 * Pure import test — no mocks, no env. Asserts the real exported
 * values + guard behavior.
 */

import { describe, it, expect } from "vitest";

import { isRuntimeProvider, RUNTIME_PROVIDERS } from "@/lib/ai/provider";

describe("isRuntimeProvider · runtime-lane type guard", () => {
  it("returns true for each of the four live runtime providers", () => {
    expect(isRuntimeProvider("ollama")).toBe(true);
    expect(isRuntimeProvider("gemini")).toBe(true);
    expect(isRuntimeProvider("openai")).toBe(true);
    expect(isRuntimeProvider("anthropic")).toBe(true);
  });

  it("returns false for retired / unknown / non-string inputs", () => {
    // The two retired lanes — the whole point of the de-Venice sweep.
    expect(isRuntimeProvider("venice")).toBe(false);
    expect(isRuntimeProvider("emergency")).toBe(false);
    // Garbage provider names.
    expect(isRuntimeProvider("gpt-9")).toBe(false);
    // Non-string values must not slip past the `typeof v === "string"`
    // narrow — these are the inputs that would otherwise crash a naive
    // `.includes` on a non-array or coerce truthy.
    expect(isRuntimeProvider(undefined)).toBe(false);
    expect(isRuntimeProvider(null)).toBe(false);
    expect(isRuntimeProvider(42)).toBe(false);
    expect(isRuntimeProvider({})).toBe(false);
  });
});

describe("RUNTIME_PROVIDERS · the canonical runtime-lane list", () => {
  it("is exactly the four live lanes, in chain order", () => {
    expect(RUNTIME_PROVIDERS).toEqual(["ollama", "gemini", "openai", "anthropic"]);
    expect(RUNTIME_PROVIDERS).toHaveLength(4);
  });

  it("excludes the retired venice + emergency lanes", () => {
    expect(RUNTIME_PROVIDERS).not.toContain("venice");
    expect(RUNTIME_PROVIDERS).not.toContain("emergency");
  });
});
