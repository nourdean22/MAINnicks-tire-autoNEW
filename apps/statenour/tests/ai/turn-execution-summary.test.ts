import { describe, expect, it } from "vitest";
import {
  buildTurnExecutionSummary,
  summarizeOperations,
  summarizeRecall,
} from "@/lib/ai/chat/turn-execution-summary";


describe("summarizeRecall", () => {
  it("maps explicit ZERO to measured EMPTY", () => {
    expect(summarizeRecall({ explicitState: "ZERO", hitCount: 0 })).toEqual({
      state: "EMPTY",
      hitCount: 0,
      basis: "EXPLICIT_PROVENANCE",
    });
  });

  it("preserves explicit ERROR instead of fabricating EMPTY", () => {
    const r = summarizeRecall({ explicitState: "ERROR", hitCount: 0, reason: "lexical timeout" });
    expect(r.state).toBe("ERROR");
    expect(r.reason).toBe("lexical timeout");
    expect(r.basis).toBe("EXPLICIT_PROVENANCE");
  });

  it("real observed hits prove OK even when the explicit state is unavailable at this seam", () => {
    const r = summarizeRecall({ hitCount: 3 });
    expect(r.state).toBe("OK");
    expect(r.hitCount).toBe(3);
    expect(r.basis).toBe("OBSERVED_HITS");
  });

  it("no explicit state plus zero receipts is UNMEASURED, never EMPTY", () => {
    const r = summarizeRecall({ hitCount: 0 });
    expect(r.state).toBe("UNMEASURED");
    expect(r.state).not.toBe("EMPTY");
    expect(r.basis).toBe("NO_MEASUREMENT");
  });
});


describe("summarizeOperations", () => {
  it("measures the legacy-ok / strict-verified gap for writes", () => {
    const r = summarizeOperations([
      {
        name: "createTask",
        ok: true,
        effectClass: "write",
        operationState: "PROVIDER_ACCEPTED",
        resultObserved: true,
      },
      {
        name: "getTasks",
        ok: true,
        effectClass: "read",
        operationState: "VERIFIED",
        resultObserved: true,
      },
    ]);

    expect(r.consequentialCount).toBe(1);
    expect(r.legacySdkSuccesses).toBe(1);
    expect(r.strictVerified).toBe(0);
    expect(r.legacyStrictGap).toBe(1);
    expect(r.strictDoneEligible).toBe(false);
    expect(r.operations[0]).toMatchObject({
      tool: "createTask",
      state: "PROVIDER_ACCEPTED",
      retryDecision: "VERIFY_BEFORE_CLAIM",
      mayClaimDoneStrict: false,
    });
  });

  it("unknown completion forces reconciliation", () => {
    const r = summarizeOperations([
      {
        name: "sendMessage",
        ok: true,
        effectClass: "write",
        operationState: "UNKNOWN_COMPLETION",
        resultObserved: false,
      },
    ]);
    expect(r.operations[0].retryDecision).toBe("RECONCILE_BEFORE_RETRY");
    expect(r.operations[0].requiresReconciliation).toBe(true);
    expect(r.strictDoneEligible).toBe(false);
  });

  it("read-only turns have no side-effect Done verdict rather than a meaningless true", () => {
    const r = summarizeOperations([
      {
        name: "getTasks",
        ok: true,
        effectClass: "read",
        operationState: "VERIFIED",
        resultObserved: true,
      },
    ]);
    expect(r.consequentialCount).toBe(0);
    expect(r.strictDoneEligible).toBeNull();
  });
});


describe("buildTurnExecutionSummary", () => {
  it("is JSON-safe, versioned, and keeps the evidence classes distinct", () => {
    const summary = buildTurnExecutionSummary({
      traceId: "trace-7",
      responseBudget: { targetWords: 60, hardMaxWords: 80, reason: "default operator contract" },
      capability: {
        registeredCount: 181,
        discoverableCount: 179,
        surfacedCount: 24,
        disabled: ["brokenTool"],
        forced: { searchTools: "read-safe capability recovery lane" },
        recoveryTools: ["searchTools", "invokeTool"],
      },
      recall: summarizeRecall({ explicitState: "ERROR", reason: "dense lane unavailable" }),
      operationIntegrity: summarizeOperations([]),
      final: {
        wordCount: 72,
        evidenceVerdict: "pass",
        replyGateSeverity: 0,
        entityProvenanceViolations: 0,
      },
    });

    expect(summary.version).toBe(1);
    expect(summary.recall.state).toBe("ERROR");
    expect(summary.capability?.surfacedCount).toBe(24);
    expect(() => JSON.stringify(summary)).not.toThrow();
  });
});
