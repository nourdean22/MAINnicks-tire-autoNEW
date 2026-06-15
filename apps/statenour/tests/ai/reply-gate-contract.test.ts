/**
 * Contract-aware reply-gate tests — verifies request-COMPLIANCE checks
 * (concise/prompt/top-N/repo-grounded/don't-ask/vague). Pure, no model.
 */
import { describe, it, expect } from "vitest";
import { runReplyGateWithContract, runReplyGate } from "@/lib/ai/reply-gate";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { buildResponseContract } from "@/lib/ai/response-contract";

function gate(userText: string, reply: string) {
  const turn = classifyTurn(userText);
  const contract = buildResponseContract(userText, turn);
  return runReplyGateWithContract(reply, userText, null, turn, contract);
}

const LONG = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");

describe("contract gate · concision", () => {
  it("concise requested + bloated reply → flagged", () => {
    const g = gate("keep it concise: is the deploy green?", LONG);
    expect(g.contractSignals.conciseButBloated).toBe(true);
    expect(g.shouldRegen).toBe(true);
  });
  it("concise requested + short reply → clean on that axis", () => {
    const g = gate("keep it concise: is the deploy green?", "Yes — green as of 15:05, deps stage passed.");
    expect(g.contractSignals.conciseButBloated).toBe(false);
  });
});

describe("contract gate · copy-paste prompt", () => {
  it("prompt requested but no fenced block → flagged", () => {
    const g = gate("give me a prompt for the coder", "Sure, here is what the coder should do: build the thing carefully.");
    expect(g.contractSignals.promptNotCopyable).toBe(true);
    expect(g.shouldRegen).toBe(true);
  });
  it("prompt requested WITH fenced block → not flagged", () => {
    const g = gate("give me a prompt for the coder", "Here:\n```\nBuild the auth flow with JWT.\n```");
    expect(g.contractSignals.promptNotCopyable).toBe(false);
  });
});

describe("contract gate · top-N", () => {
  it("top 5 requested but 4 items → mismatch", () => {
    const reply = "1. one\n2. two\n3. three\n4. four";
    expect(gate("give me the top 5 upgrades", reply).contractSignals.rankCountMismatch).toBe(true);
  });
  it("top 5 requested with 5 items → match", () => {
    const reply = "1. one\n2. two\n3. three\n4. four\n5. five";
    expect(gate("give me the top 5 upgrades", reply).contractSignals.rankCountMismatch).toBe(false);
  });
});

describe("contract gate · repo grounding", () => {
  it("repo-grounded requested + generic reply → flagged", () => {
    const g = gate("look at the repo first, then answer", "Yeah, that feature is generally handled somewhere in the codebase and should work fine.");
    expect(g.contractSignals.repoGroundedButGeneric).toBe(true);
  });
  it("repo-grounded requested + reply cites files → not flagged", () => {
    const g = gate("look at the repo first, then answer", "It lives in `lib/ai/reply-gate.ts` via `runReplyGate` and `response-contract.ts`.");
    expect(g.contractSignals.repoGroundedButGeneric).toBe(false);
  });
});

describe("contract gate · don't-ask", () => {
  it("don't-ask + reply asks clarifying → flagged", () => {
    const g = gate("just build it, don't ask me questions", "Sure — which option would you like me to use for the build?");
    expect(g.contractSignals.askedDespiteNoAsk).toBe(true);
  });
  it("don't-ask + reply proceeds → not flagged", () => {
    const g = gate("just build it, don't ask me questions", "Done — built it with the JWT approach since that matches the existing auth.");
    expect(g.contractSignals.askedDespiteNoAsk).toBe(false);
  });
});

describe("contract gate · vague non-completion", () => {
  it("'I can help with that' stub → flagged", () => {
    const g = gate("draft the email to the vendor", "I can help with that! Let me know if you want me to draft it.");
    expect(g.contractSignals.vagueNonCompletion).toBe(true);
  });
});

describe("contract gate · backward compatibility", () => {
  it("still inherits base-gate signals (empty reply)", () => {
    const g = gate("what's the revenue?", "");
    expect(g.signals.empty).toBe(true);
    expect(g.severity).toBe(100);
  });
  it("runReplyGate (legacy) unchanged — clean reply stays clean", () => {
    const turn = classifyTurn("hey");
    const base = runReplyGate("Hey! What's up?", "hey", null, turn);
    expect(base.shouldRegen).toBe(false);
  });
});
