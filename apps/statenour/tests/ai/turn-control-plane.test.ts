import { describe, expect, it } from "vitest";
import {
  buildCapabilityPlan,
  buildTurnExecutionPhase,
  operationStateFrom,
  responseBudgetFor,
} from "@/lib/ai/chat/turn-control-plane";
import type { ResponseContract } from "@/lib/ai/response-contract";

function contract(overrides: Partial<ResponseContract> = {}): ResponseContract {
  return {
    answerMode: "direct_answer",
    length: "normal",
    outputFormat: "prose",
    shouldAskClarifying: true,
    mustBeRepoGrounded: false,
    mustIncludeEvidence: false,
    mustNotClaimActions: false,
    mustRankOptions: false,
    rankCount: null,
    mustGiveNextMove: false,
    userIsCorrectingDirection: false,
    userIsAskingForCoderPrompt: false,
    userIsManagingConcurrentSessions: false,
    isStatusUpdate: false,
    executeFinalized: false,
    forbiddenMoves: [],
    requiredMoves: [],
    reasons: [],
    ...overrides,
  };
}

describe("responseBudgetFor", () => {
  it("makes the operator's <=80 word default an infrastructure contract", () => {
    expect(responseBudgetFor(contract())).toEqual({
      targetWords: 60,
      hardMaxWords: 80,
      reason: "default operator contract",
    });
  });

  it("allows explicit detailed asks to expand instead of silently truncating them", () => {
    const budget = responseBudgetFor(contract({ length: "detailed" }));
    expect(budget.hardMaxWords).toBeGreaterThan(80);
    expect(budget.reason).toContain("explicitly requested");
  });

  it("does not crush copy/paste prompts into the ordinary 80-word ceiling", () => {
    const budget = responseBudgetFor(
      contract({ answerMode: "copy_paste_prompt", length: "normal", outputFormat: "prompt" }),
    );
    expect(budget.hardMaxWords).toBe(2_000);
  });
});

describe("buildCapabilityPlan", () => {
  it("distinguishes registered, discoverable, and surfaced tools", () => {
    const plan = buildCapabilityPlan({
      registered: ["getTasks", "searchTools", "sendTelegram", "disabledThing"],
      surfaced: ["getTasks", "searchTools"],
      disabled: ["disabledThing"],
      recoveryTools: ["searchTools", "invokeTool"],
      forced: { getTasks: "explicit action intent", notSurfaced: "should disappear" },
    });

    expect(plan.registeredCount).toBe(4);
    expect(plan.discoverable).toEqual(["getTasks", "searchTools", "sendTelegram"]);
    expect(plan.surfaced).toEqual(["getTasks", "searchTools"]);
    expect(plan.recoveryTools).toEqual(["searchTools"]);
    expect(plan.forced).toEqual({ getTasks: "explicit action intent" });
  });

  it("never reports an operator-disabled tool as discoverable even if a caller says it surfaced", () => {
    const plan = buildCapabilityPlan({
      registered: ["dangerousWrite"],
      surfaced: ["dangerousWrite"],
      disabled: ["dangerousWrite"],
    });
    expect(plan.discoverable).toEqual([]);
    expect(plan.surfaced).toEqual([]);
  });
});

describe("operationStateFrom", () => {
  it("keeps timeout/ambiguity distinct from a known failure", () => {
    expect(operationStateFrom({ attempted: true, completionUnknown: true })).toBe(
      "UNKNOWN_COMPLETION",
    );
    expect(operationStateFrom({ attempted: true, knownFailure: true })).toBe("FAILED_KNOWN");
  });

  it("requires independent verification to reach VERIFIED", () => {
    expect(operationStateFrom({ attempted: true, providerAccepted: true })).toBe(
      "PROVIDER_ACCEPTED",
    );
    expect(
      operationStateFrom({ attempted: true, providerAccepted: true, verified: true }),
    ).toBe("VERIFIED");
  });

  it("fails ambiguous attempted mutations to UNKNOWN_COMPLETION, not success", () => {
    expect(operationStateFrom({ attempted: true })).toBe("UNKNOWN_COMPLETION");
  });
});

describe("buildTurnExecutionPhase", () => {
  it("preserves ERROR as ERROR rather than flattening it to an empty recall", () => {
    const phase = buildTurnExecutionPhase({
      traceId: "trace-1",
      phase: "EVIDENCE",
      at: "2026-09-13T14:00:00.000Z",
      recall: { state: "ERROR", reason: "lexical lane timed out" },
    });
    expect(phase.recall).toEqual({ state: "ERROR", reason: "lexical lane timed out" });
    expect(phase.at).toBe("2026-09-13T14:00:00.000Z");
  });
});
