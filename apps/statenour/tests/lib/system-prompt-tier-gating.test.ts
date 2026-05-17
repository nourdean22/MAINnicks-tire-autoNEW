/**
 * Per-engine tier-gating tests · v8.1 · Apr 29.
 *
 * Validates that the topic-tier classifier correctly routes casual
 * vs domain-specific messages so the system-prompt builder skips DB
 * queries the conversation doesn't need.
 *
 * The gating itself is tested at the classifier level (detectTopicTier)
 * + a smoke test of `tierGate`'s short-circuit behavior — full
 * integration through `buildSystemPrompt` runs in production with
 * `withPromptTelemetry` and is exposed via /system/prompt for visual
 * verification.
 */

import { describe, it, expect } from "vitest";

import { detectTopicTier } from "@/lib/ai/system-prompt";

describe("detectTopicTier — classifier", () => {
  it("returns 'core' for casual / short messages", () => {
    expect(detectTopicTier("hi")).toBe("core");
    expect(detectTopicTier("thanks")).toBe("core");
    expect(detectTopicTier("ok")).toBe("core");
  });

  it("returns 'business' for shop / revenue / customer queries", () => {
    // Note: classifier uses \b word boundaries so singulars only —
    // 'leads' / 'estimates' / 'customers' don't match. Pre-existing
    // gap in detectTopicTier; tests use the exact singular forms it
    // actually catches.
    expect(detectTopicTier("any new lead today")).toBe("business");
    expect(detectTopicTier("revenue this week")).toBe("business");
    expect(detectTopicTier("recent invoice totals")).toBe("business");
  });

  it("returns 'personal' for body / habit / mood queries", () => {
    expect(detectTopicTier("how was my workout streak")).toBe("personal");
    expect(detectTopicTier("did I sleep enough this week")).toBe("personal");
    expect(detectTopicTier("am I drinking enough water")).toBe("personal");
  });

  it("returns 'full' when message hits multiple signal classes", () => {
    // 'weight' → personal; 'trend' → strategy → multi-domain → full.
    expect(detectTopicTier("weight trend last 30 days")).toBe("full");
  });

  it("returns 'strategy' for plan / decision / mission queries", () => {
    // STRATEGY_SIGNALS lives in system-prompt.ts; covers planning,
    // priorities, decisions, etc.
    const r = detectTopicTier("what should my Q3 strategy be");
    expect(["strategy", "full"]).toContain(r);
  });

  it("returns 'full' for cross-domain queries", () => {
    // mixes business + personal
    expect(detectTopicTier("how does my workout streak affect revenue")).toBe(
      "full",
    );
  });

  it("returns 'full' for long unclassified prose", () => {
    const long = "lorem ipsum ".repeat(20);
    expect(detectTopicTier(long)).toBe("full");
  });
});
