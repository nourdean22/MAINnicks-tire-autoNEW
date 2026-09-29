import { describe, expect, it } from "vitest";
import {
  assertDifferentJudgeFamily,
  cohensKappa,
  hasActualContextThresholdDrop,
  hasEvidenceGateBlock,
  isL2VerifierBanner,
  pairedPpiDeltaInterval,
  selectQ32Turn,
} from "@/lib/evals/q32-regression";

describe("Q-32 deterministic selector", () => {
  it("selects each required signal without raw-text export", () => {
    const selected = selectQ32Turn({
      id: "m1",
      createdAt: new Date("2026-09-29T15:00:00Z"),
      feedbackScore: -1,
      content:
        "[VERIFIER · v10.0.162] ⚠ I claimed action(s) but no matching tool call fired.\nprivate body",
      model: "minimax-m3",
      provider: "ollama",
      tokenUsage: {
        traceId: "trace-1",
        evidenceGate: { verdict: "block" },
        contextReceipt: {
          enforced: false,
          entries: [
            { kept: false, reason: "below_threshold" },
            { kept: false, reason: "over_budget" },
          ],
        },
      },
    });

    expect(selected?.signals).toEqual([
      "thumbs_down",
      "l2_verifier_banner",
      "evidence_gate_block",
      "context_threshold_drop",
    ]);
    expect(selected?.traceId).toBe("trace-1");
    expect(selected?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(selected)).not.toContain("private body");
  });

  it("does not mistake the advisory over-budget receipt for actually dropped context", () => {
    expect(
      hasActualContextThresholdDrop({
        contextReceipt: {
          enforced: false,
          droppedCount: 1,
          entries: [{ kept: false, reason: "over_budget" }],
        },
      }),
    ).toBe(false);
    expect(
      hasActualContextThresholdDrop({
        contextReceipt: {
          enforced: false,
          entries: [{ kept: false, reason: "below_threshold" }],
        },
      }),
    ).toBe(true);
  });

  it("recognizes the shadow evidence-gate block and only action-honesty verifier banners", () => {
    expect(hasEvidenceGateBlock({ evidenceGate: { verdict: "block", shadowOnly: true } })).toBe(true);
    expect(hasEvidenceGateBlock({ evidenceGate: { verdict: "pass" } })).toBe(false);

    expect(
      isL2VerifierBanner(
        "[VERIFIER · v10.0.162] ⚠ claimed action(s) (createTask) but tool call(s) failed.",
      ),
    ).toBe(true);
    expect(
      isL2VerifierBanner(
        "[VERIFIER · v10.0.162] ⚠ The response references retired infrastructure as current.",
      ),
    ).toBe(false);
  });

  it("returns null when none of the four deterministic signals fired", () => {
    expect(
      selectQ32Turn({
        id: "m2",
        createdAt: "2026-09-29T15:00:00Z",
        feedbackScore: 1,
        content: "all good",
        tokenUsage: { evidenceGate: { verdict: "pass" } },
      }),
    ).toBeNull();
  });
});

describe("Q-32 judge independence", () => {
  it("requires a different model family", () => {
    expect(() => assertDifferentJudgeFamily("minimax-m3", "gpt-5.6")).not.toThrow();
    expect(() => assertDifferentJudgeFamily("gpt-5.6-sol", "gpt-5-mini")).toThrow(
      /different model family/,
    );
    expect(() => assertDifferentJudgeFamily("unknown-house-model", "gpt-5.6")).toThrow(
      /known candidate/,
    );
  });
});

describe("Q-32 paired PPI delta", () => {
  it("A/A rerun centers at zero and includes zero", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      judgeBaseline: i % 2,
      judgeCandidate: i % 2,
      ...(i < 30
        ? { humanBaseline: i % 2, humanCandidate: i % 2 }
        : {}),
    }));
    const result = pairedPpiDeltaInterval(items);
    expect(result.estimate).toBe(0);
    expect(result.lower).toBeLessThanOrEqual(0);
    expect(result.upper).toBeGreaterThanOrEqual(0);
    expect(result.labeled).toBe(30);
  });

  it("a planted regression produces a wholly negative interval", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      judgeBaseline: 1,
      judgeCandidate: i % 10 === 0 ? 1 : 0,
      ...(i < 40
        ? { humanBaseline: 1, humanCandidate: i % 8 === 0 ? 1 : 0 }
        : {}),
    }));
    const result = pairedPpiDeltaInterval(items);
    expect(result.estimate).toBeLessThan(0);
    expect(result.upper).toBeLessThan(0);
  });

  it("human correction can reverse a biased judge estimate", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      judgeBaseline: 0.8,
      judgeCandidate: 0.6,
      ...(i < 30 ? { humanBaseline: 0.5, humanCandidate: 0.7 } : {}),
    }));
    const result = pairedPpiDeltaInterval(items);
    expect(result.judgeMeanDelta).toBeCloseTo(-0.2);
    expect(result.correctionMean).toBeCloseTo(0.4);
    expect(result.estimate).toBeCloseTo(0.2);
  });
});

describe("Q-32 human/judge agreement", () => {
  it("computes Cohen kappa for the double-labeled promotion gate", () => {
    const human = [true, true, false, false, true, false, true, false];
    const judge = [true, true, false, false, true, false, false, true];
    const kappa = cohensKappa(human, judge);
    expect(kappa).not.toBeNull();
    expect(kappa!).toBeGreaterThan(0);
    expect(kappa!).toBeLessThan(1);
  });

  it("returns null for mismatched or empty label arrays", () => {
    expect(cohensKappa([], [])).toBeNull();
    expect(cohensKappa([true], [])).toBeNull();
  });
});
