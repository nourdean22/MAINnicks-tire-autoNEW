/**
 * tests/ai/reply-gate-brevity.test.ts (2026-08-18, round 2).
 *
 * Round-1 (#1677) waived the CRITIC's spec/length axes for operator-
 * constrained replies — and the live persisted verdict then proved the
 * chip still fired: the quality badge ORs critic.shouldRegen with
 * gate.shouldRegen, and reply-gate's stub-reply signal (severity 80,
 * "stub reply on non-casual turn") re-flagged the exact reply the
 * critic had waived (critic overall=100 + waiver reason, gate sev=80,
 * read from tokenUsage on prod). Two parallel scorers → both must
 * honor the waiver.
 */

import { describe, expect, it } from "vitest";
import { runReplyGate, runReplyGateWithContract } from "@/lib/ai/reply-gate";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { buildResponseContract } from "@/lib/ai/response-contract";
import { critiqueOutput } from "@/lib/ai/chat/output-guardian";

const BREVITY_ASK = "quick check, reply with just OK";

describe("reply-gate · brevity waiver on the stub-reply signal", () => {
  it("the witnessed prod defect end-to-end: waived critic + gate must BOTH clear", () => {
    const turn = classifyTurn(BREVITY_ASK);
    // Guard the test itself: if the classifier ever starts calling this
    // "casual", the stub signal would skip on intent alone and this test
    // would stop exercising the waiver.
    expect(turn.intent).not.toBe("casual");
    const critic = critiqueOutput("OK", "prose", { userPrompt: BREVITY_ASK });
    expect(critic.shouldRegen).toBe(false); // round-1 fix, still holding
    const gate = runReplyGate("OK", BREVITY_ASK, critic, turn);
    expect(gate.signals.stubReply).toBe(true); // factual signal stays visible
    expect(gate.severity).toBe(0);
    expect(gate.shouldRegen).toBe(false);
    expect(gate.reasons.join(" ")).toContain("brevity-requested");
  });

  it("waiver holds on an explicitly non-casual turn signal (classifier-independent)", () => {
    const turn = classifyTurn(BREVITY_ASK);
    const gate = runReplyGate("OK", BREVITY_ASK, null, { ...turn, intent: "factual" });
    expect(gate.severity).toBe(0);
    expect(gate.shouldRegen).toBe(false);
  });

  it("the SAME stub without the constraint still flags — protection intact", () => {
    const ask = "walk me through what happened with the deploy last night";
    const turn = classifyTurn(ask);
    const gate = runReplyGate("OK", ask, null, turn);
    expect(gate.signals.stubReply).toBe(true);
    expect(gate.severity).toBeGreaterThanOrEqual(80);
    expect(gate.shouldRegen).toBe(true);
  });

  it("waiver does NOT excuse an empty reply", () => {
    const turn = classifyTurn(BREVITY_ASK);
    const gate = runReplyGate("", BREVITY_ASK, null, turn);
    expect(gate.signals.empty).toBe(true);
    expect(gate.severity).toBe(100);
    expect(gate.shouldRegen).toBe(true);
  });

  it("waiver does NOT excuse an ungrounded I-don't-know on a factual ask", () => {
    const ask = "yes or no — did the March invoice reconcile?";
    const turn = classifyTurn(ask);
    const gate = runReplyGate("I don't know.", ask, null, turn);
    // Only applies when the turn classifies factual/decision; assert the
    // signal fired and, if intent qualifies, the severity with it.
    expect(gate.signals.iDontKnow).toBe(true);
    if (turn.intent === "factual" || turn.intent === "decision") {
      expect(gate.shouldRegen).toBe(true);
    }
  });

  it("contract path inherits the waiver — ultra-concise ask + obedient stub is clean", () => {
    const turn = classifyTurn(BREVITY_ASK);
    const contract = buildResponseContract(BREVITY_ASK, turn);
    const gate = runReplyGateWithContract("OK", BREVITY_ASK, null, turn, contract);
    expect(gate.shouldRegen).toBe(false);
    expect(gate.severity).toBe(0);
  });
});
