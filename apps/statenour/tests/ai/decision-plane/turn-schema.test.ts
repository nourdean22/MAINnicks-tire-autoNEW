import { describe, expect, it } from "vitest";
import {
  TURN_DECISION_STATE_CHARS,
  buildTurnDecisionRequest,
  compareTurnDecision,
  incumbentTurnDecision,
  type TurnDecisionQuestions,
} from "@/lib/ai/decision-plane/turn-schema";
import type { DecisionResult } from "@/lib/ai/decision-plane/types";

describe("turn decision schema", () => {
  it("bounds candidate state without changing the canonical question set", () => {
    const request = buildTurnDecisionRequest("x".repeat(TURN_DECISION_STATE_CHARS + 50));
    expect(request.state).toMatchObject({
      message: "x".repeat(TURN_DECISION_STATE_CHARS),
      truncated: true,
    });
    expect(Object.keys(request.questions)).toContain("needsBackgroundMission");
  });

  it("captures incumbent behavior without pretending there is a mission baseline", () => {
    const incumbent = incumbentTurnDecision({
      turnSignal: {
        complexity: "complex",
        intent: "decision",
        outputShape: "table",
        urgency: "high",
        domain: "business",
        temperature: 0.25,
        useChainOfThought: true,
        useTwoPassCritique: true,
        reasons: [],
      },
      mode: "deep",
      finalTaskType: "deep",
      pythonExecuteIntent: false,
      actionIntent: false,
      webSearchIntent: true,
      webSearchRecency: false,
    });

    expect(incumbent).toMatchObject({
      needsTools: true,
      needsWeb: true,
      needsDeepReasoning: true,
      needsBackgroundMission: null,
    });
  });
});

describe("turn shadow comparison", () => {
  it("scores agreement only on fields the incumbent actually owns", () => {
    const incumbent = incumbentTurnDecision({
      turnSignal: {
        complexity: "simple",
        intent: "factual",
        outputShape: "prose",
        urgency: "low",
        domain: "unknown",
        temperature: 0.2,
        useChainOfThought: false,
        useTwoPassCritique: false,
        reasons: [],
      },
      mode: "standard",
      finalTaskType: "reason",
      pythonExecuteIntent: false,
      actionIntent: false,
      webSearchIntent: false,
      webSearchRecency: false,
    });

    const result = {
      backend: "kev",
      model: "kev-latest",
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 5,
      answers: {
        intent: { type: "choice", choice: "factual", confidence: 1, probabilities: { factual: 1 } },
        complexity: { type: "choice", choice: "simple", confidence: 1, probabilities: { simple: 1 } },
        outputShape: { type: "choice", choice: "prose", confidence: 1, probabilities: { prose: 1 } },
        domain: { type: "choice", choice: "unknown", confidence: 1, probabilities: { unknown: 1 } },
        urgency: { type: "choice", choice: "low", confidence: 1, probabilities: { low: 1 } },
        needsTools: { type: "noul", noul: 0.1 },
        needsWeb: { type: "noul", noul: 0.1 },
        actionRequest: { type: "noul", noul: 0.1 },
        needsDeepReasoning: { type: "noul", noul: 0.1 },
        needsBackgroundMission: { type: "noul", noul: 0.9 },
      },
    } as unknown as DecisionResult<TurnDecisionQuestions>;

    const comparison = compareTurnDecision(result, incumbent);
    expect(comparison.compared).toBe(9);
    expect(comparison.agreements).toBe(9);
    expect(comparison.fields).not.toHaveProperty("needsBackgroundMission");
  });
});
