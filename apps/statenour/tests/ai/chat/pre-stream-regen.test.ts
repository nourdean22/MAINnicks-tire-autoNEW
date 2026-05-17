/**
 * tests/ai/chat/pre-stream-regen.test.ts · v10.0.492
 *
 * Locks the Tier 2 pre-stream regen orchestration. Module is
 * deliberately decoupled from LLM clients · we pass mock generators
 * to assert the gating + winner-selection logic without touching the
 * provider chain.
 *
 * Mirrors ADR-0011 Tier 2 contract:
 *   - intent NOT in regen-gated set → never regen, ship first attempt
 *   - first attempt passes critic → never regen, ship first attempt
 *   - first attempt fails critic + intent gated → run regen
 *   - regen wins only if cleaner AND higher overall
 */
import { describe, it, expect, vi } from "vitest";
import {
  maybePreStreamRegen,
  shouldGateForIntent,
  REGEN_SYSTEM_PREFIX,
} from "@/lib/ai/chat/pre-stream-regen";

const VAGUE_REPLY =
  "Yes that depends on various factors and there are many ways to look at it. " +
  "Consider the options and choose what works best for you in the situation. " +
  "The path forward will take many shapes based on the specifics of your case.";

const CONCRETE_REPLY =
  "Today: 12 leads opened, 3 callbacks pending, 5 estimates worth $4,200. " +
  "autonicks shows 8 drops booked this week. Nick handles 2 jobs at 9:30am. " +
  "Run cleanup this month before 5/15.";

describe("pre-stream-regen · intent gating", () => {
  it("gates regen-worthy intents", () => {
    expect(shouldGateForIntent("factual")).toBe(true);
    expect(shouldGateForIntent("decision")).toBe(true);
    expect(shouldGateForIntent("instructional")).toBe(true);
    expect(shouldGateForIntent("procedural")).toBe(true);
    expect(shouldGateForIntent("analytical")).toBe(true);
  });

  it("does NOT gate flow-prioritized intents", () => {
    expect(shouldGateForIntent("casual")).toBe(false);
    expect(shouldGateForIntent("emotional")).toBe(false);
    expect(shouldGateForIntent("creative")).toBe(false);
    expect(shouldGateForIntent("reflective")).toBe(false);
  });
});

describe("pre-stream-regen · orchestration", () => {
  it("ships first attempt when intent is not gated, even if vague", async () => {
    const generateOnce = vi.fn().mockResolvedValue(VAGUE_REPLY);
    const regenOnce = vi.fn().mockResolvedValue(CONCRETE_REPLY);

    const result = await maybePreStreamRegen({
      intent: "casual",
      shape: "prose",
      generateOnce,
      regenOnce,
    });

    expect(result.text).toBe(VAGUE_REPLY);
    expect(result.regenFired).toBe(false);
    expect(regenOnce).not.toHaveBeenCalled();
    expect(result.firstScore.shouldRegen).toBe(true);
  });

  it("ships first attempt when it passes critic, even if intent gated", async () => {
    const generateOnce = vi.fn().mockResolvedValue(CONCRETE_REPLY);
    const regenOnce = vi.fn().mockResolvedValue(VAGUE_REPLY);

    const result = await maybePreStreamRegen({
      intent: "factual",
      shape: "prose",
      generateOnce,
      regenOnce,
    });

    expect(result.text).toBe(CONCRETE_REPLY);
    expect(result.regenFired).toBe(false);
    expect(regenOnce).not.toHaveBeenCalled();
  });

  it("regens on factual intent when first attempt fails critic", async () => {
    const generateOnce = vi.fn().mockResolvedValue(VAGUE_REPLY);
    const regenOnce = vi.fn().mockResolvedValue(CONCRETE_REPLY);

    const result = await maybePreStreamRegen({
      intent: "factual",
      shape: "prose",
      generateOnce,
      regenOnce,
    });

    expect(regenOnce).toHaveBeenCalledOnce();
    expect(result.text).toBe(CONCRETE_REPLY);
    expect(result.regenFired).toBe(true);
    expect(result.regenWasBetter).toBe(true);
    expect(result.firstScore.shouldRegen).toBe(true);
    expect(result.regenScore?.shouldRegen).toBe(false);
  });

  it("ships the first attempt when regen ALSO fails (two bad replies)", async () => {
    const generateOnce = vi.fn().mockResolvedValue(VAGUE_REPLY);
    const regenOnce = vi
      .fn()
      .mockResolvedValue("Still vague. Various factors at play here.");

    const result = await maybePreStreamRegen({
      intent: "decision",
      shape: "prose",
      generateOnce,
      regenOnce,
    });

    expect(regenOnce).toHaveBeenCalledOnce();
    expect(result.regenFired).toBe(false);
    expect(result.regenWasBetter).toBe(false);
    // Ship first attempt back (less-bad of two bad replies).
    expect(result.text).toBe(VAGUE_REPLY);
  });

  it("passes the regen prefix to the regen function", async () => {
    let capturedPrefix = "";
    const generateOnce = vi.fn().mockResolvedValue(VAGUE_REPLY);
    const regenOnce = vi.fn().mockImplementation(async (args) => {
      capturedPrefix = args.suggestedSystemPrefix;
      return CONCRETE_REPLY;
    });

    await maybePreStreamRegen({
      intent: "factual",
      shape: "prose",
      generateOnce,
      regenOnce,
    });

    expect(capturedPrefix).toBe(REGEN_SYSTEM_PREFIX);
    expect(capturedPrefix).toContain("SPECIFIC numbers");
    expect(capturedPrefix).toContain("hedging");
  });

  it("populates latency telemetry across both attempts", async () => {
    const generateOnce = vi.fn().mockResolvedValue(VAGUE_REPLY);
    const regenOnce = vi.fn().mockResolvedValue(CONCRETE_REPLY);

    const result = await maybePreStreamRegen({
      intent: "factual",
      shape: "prose",
      generateOnce,
      regenOnce,
    });

    expect(result.durationMs.first).toBeGreaterThanOrEqual(0);
    expect(result.durationMs.regen).toBeGreaterThanOrEqual(0);
    expect(result.durationMs.total).toBeGreaterThanOrEqual(
      result.durationMs.first,
    );
  });
});
