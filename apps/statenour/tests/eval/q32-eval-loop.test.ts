import { describe, expect, it } from "vitest";
import {
  predictionPoweredPairedDelta,
  q32ReleaseGate,
  q32SelectionReasons,
} from "@/lib/evals/q32-eval-loop";

describe("Q-32 deterministic annotation selector", () => {
  it("selects every named high-value signal exactly once", () => {
    expect(
      q32SelectionReasons({
        feedbackScore: -1,
        verifierBanner: true,
        evidenceGateVerdict: "block",
        contextReceipt: {
          enforced: false,
          entries: [{ kept: false, reason: "below_threshold" }],
        },
      }),
    ).toEqual([
      "thumb_down",
      "l2_banner",
      "evidence_gate_block",
      "dropped_context",
    ]);
  });

  it("does not call advisory budget/redundancy verdicts real dropped context", () => {
    expect(
      q32SelectionReasons({
        evidenceGateVerdict: "pass",
        contextReceipt: {
          enforced: false,
          entries: [
            { kept: false, reason: "over_budget" },
            { kept: false, reason: "redundant" },
          ],
        },
      }),
    ).toEqual([]);
  });

  it("treats current pass aliases and absent evidence verdict as non-blocking", () => {
    for (const verdict of [undefined, "", "pass", "ok", "allow"]) {
      expect(q32SelectionReasons({ evidenceGateVerdict: verdict })).toEqual([]);
    }
  });
});

describe("Q-32 prediction-powered paired release gate", () => {
  it("A/A passes once labels and judge calibration clear the evidence floors", () => {
    const ppi = predictionPoweredPairedDelta({
      predictionDeltas: Array.from({ length: 80 }, () => 0),
      labeledHumanDeltas: Array.from({ length: 30 }, () => 0),
      labeledPredictionDeltas: Array.from({ length: 30 }, () => 0),
    });
    expect(ppi.estimate).toBe(0);
    const verdict = q32ReleaseGate({
      ppi,
      judgeKappa: 0.72,
      labeledCount: 30,
    });
    expect(verdict.pass).toBe(true);
  });

  it("★ planted regression fails even when the judge itself is calibrated", () => {
    const ppi = predictionPoweredPairedDelta({
      predictionDeltas: Array.from({ length: 80 }, () => -0.2),
      labeledHumanDeltas: Array.from({ length: 30 }, () => -0.2),
      labeledPredictionDeltas: Array.from({ length: 30 }, () => -0.2),
    });
    const verdict = q32ReleaseGate({
      ppi,
      judgeKappa: 0.8,
      labeledCount: 30,
    });
    expect(ppi.upper).toBeLessThan(0);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain("REGRESSION");
  });

  it("refuses to call an under-labeled or poorly calibrated run a pass", () => {
    const ppi = predictionPoweredPairedDelta({
      predictionDeltas: [0.1, 0.1],
      labeledHumanDeltas: [0.1, 0.1],
      labeledPredictionDeltas: [0.1, 0.1],
    });
    expect(q32ReleaseGate({ ppi, judgeKappa: 0.9, labeledCount: 12 }).pass).toBe(false);
    expect(q32ReleaseGate({ ppi, judgeKappa: 0.4, labeledCount: 30 }).pass).toBe(false);
  });

  it("returns UNMEASURED instead of zero when the PPI inputs are absent", () => {
    const ppi = predictionPoweredPairedDelta({
      predictionDeltas: [],
      labeledHumanDeltas: [],
      labeledPredictionDeltas: [],
    });
    expect(ppi.estimate).toBeNull();
    expect(q32ReleaseGate({ ppi, judgeKappa: 0.8, labeledCount: 30 }).pass).toBe(false);
  });
});
