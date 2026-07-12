/**
 * computePromptVariant — cache-partition contract (2026-07-12 review, #5).
 *
 * The system-prompt cache keys (inner 300s + outer 45s) key on the variant
 * this returns. The invariant that matters: two messages that inject
 * DIFFERENT prompt content must get DIFFERENT variants, or one is served the
 * other's cached prompt. Regression guard for the format/slot collapse.
 */
import { describe, it, expect } from "vitest";
import { computePromptVariant } from "@/lib/ai/system-prompt";

describe("computePromptVariant", () => {
  it("plain chat is the default slot, no format", async () => {
    const v = await computePromptVariant("what's on my plate today?");
    expect(v.slot).toBe("default");
    expect(v.formatKey).toBe("");
    expect(v.variant).toBe("default");
  });

  it("a content ask is the content slot", async () => {
    const v = await computePromptVariant("write me an instagram caption about winter tires");
    expect(v.slot).toBe("content");
  });

  it("reel vs carousel content asks get DIFFERENT variants (the bug)", async () => {
    const reel = await computePromptVariant("write me an instagram reel about brake service");
    const carousel = await computePromptVariant("write me an instagram carousel about brake service");
    expect(reel.slot).toBe("content");
    expect(carousel.slot).toBe("content");
    // Same slot, but the format engines differ → variants MUST differ.
    expect(reel.variant).not.toBe(carousel.variant);
    expect(reel.formatKey).toContain("r");
    expect(carousel.formatKey).toContain("c");
  });

  it("format signature is order-independent and stable", async () => {
    const a = await computePromptVariant("make a reel and a carousel about tires");
    const b = await computePromptVariant("make a carousel and a reel about tires");
    expect(a.variant).toBe(b.variant); // same engines fire → same key
    expect(a.formatKey).toBe("rc");
  });

  it("format only differentiates content mode (non-content ignores format words)", async () => {
    // "story" here is not a content-generation ask → default slot, no format key.
    const v = await computePromptVariant("tell me the story of how the shop started");
    expect(v.slot).toBe("default");
    expect(v.formatKey).toBe("");
  });
});
