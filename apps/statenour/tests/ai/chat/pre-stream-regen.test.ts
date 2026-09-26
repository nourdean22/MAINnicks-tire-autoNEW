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
 *   - regen wins when the same quality function says it is better, even if not perfect
 */
import { describe, it, expect, vi } from "vitest";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { buildResponseContract } from "@/lib/ai/response-contract";
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
    expect(shouldGateForIntent("creative")).toBe(true);
    expect(shouldGateForIntent("instructional")).toBe(true);
    expect(shouldGateForIntent("procedural")).toBe(true);
    expect(shouldGateForIntent("analytical")).toBe(true);
  });

  it("does NOT gate flow-prioritized intents", () => {
    expect(shouldGateForIntent("casual")).toBe(false);
    expect(shouldGateForIntent("emotional")).toBe(false);
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

  it("ships a measurably better regen even when it still has a minor critic flag", async () => {
    const BETTER_BUT_STILL_FLAGGED =
      "The bottleneck is follow-up. Call the pending customers first, confirm the appointment, " +
      "and use the same reminder step on every booking before changing price or adding another channel.";
    const generateOnce = vi.fn().mockResolvedValue(VAGUE_REPLY);
    const regenOnce = vi.fn().mockResolvedValue(BETTER_BUT_STILL_FLAGGED);

    const result = await maybePreStreamRegen({
      intent: "decision",
      shape: "prose",
      generateOnce,
      regenOnce,
    });

    expect(regenOnce).toHaveBeenCalledOnce();
    expect(result.firstScore.shouldRegen).toBe(true);
    expect(result.regenScore?.shouldRegen).toBe(true);
    expect(result.regenScore?.overall).toBeGreaterThan(result.firstScore.overall);
    expect(result.regenFired).toBe(true);
    expect(result.regenWasBetter).toBe(true);
    expect(result.selectionReason).toBe("higher-overall");
    expect(result.text).toBe(BETTER_BUT_STILL_FLAGGED);
  });

  it("keeps the first attempt when the regen is actually worse", async () => {
    const generateOnce = vi.fn().mockResolvedValue(VAGUE_REPLY);
    const regenOnce = vi.fn().mockResolvedValue("Still vague. Various factors at play here.");

    const result = await maybePreStreamRegen({
      intent: "decision",
      shape: "prose",
      generateOnce,
      regenOnce,
    });

    expect(regenOnce).toHaveBeenCalledOnce();
    expect(result.regenFired).toBe(false);
    expect(result.regenWasBetter).toBe(false);
    expect(result.selectionReason).toBe("first-kept");
    expect(result.text).toBe(VAGUE_REPLY);
  });

  it("repairs response-contract failures even when style alone looks acceptable", async () => {
    const ask = "Give me the top 3 moves, no extra options.";
    const turn = classifyTurn(ask);
    const contract = buildResponseContract(ask, turn);
    const fiveItems = "1. Fix intake\n2. Call leads\n3. Confirm appointments\n4. Cut price\n5. Add radio";
    const threeItems = "1. Fix intake\n2. Call leads\n3. Confirm appointments";
    const generateOnce = vi.fn().mockResolvedValue(fiveItems);
    const regenOnce = vi.fn().mockResolvedValue(threeItems);

    const result = await maybePreStreamRegen({
      intent: "decision",
      shape: "list",
      userPrompt: ask,
      turnSignal: turn,
      responseContract: contract,
      generateOnce,
      regenOnce,
    });

    expect(result.firstAssessment.gate?.contractSignals.rankCountMismatch).toBe(true);
    expect(regenOnce).toHaveBeenCalledOnce();
    expect(result.text).toBe(threeItems);
    expect(result.regenFired).toBe(true);
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

    expect(capturedPrefix.startsWith(REGEN_SYSTEM_PREFIX)).toBe(true);
    expect(capturedPrefix).toContain("MEASURED FAILURES IN THE PRIOR DRAFT");
    expect(capturedPrefix).toContain("spec-density");
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
