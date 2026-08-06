/**
 * Independent-judge publish gate · doctrine tests.
 *
 * Pins the fail-closed contract the 2026-08-07 operator flip depends on: the
 * measured blind-spot predicate blocks, a dead judge lane blocks, and the
 * IG_SHADOW_JUDGE=false escape hatch restores pre-flip self-eval-only
 * publishing.
 */
import { describe, expect, it } from "vitest";
import { JUDGE_GATE_MIN_TOTAL, shadowJudgeGate } from "./igJudgeGate";

describe("shadowJudgeGate", () => {
  it("judge disabled = no gate, even over a rejecting verdict (the escape hatch)", () => {
    expect(shadowJudgeGate({ total: 10, rejected: true, note: "generic" }, false).block).toBe(false);
    expect(shadowJudgeGate(undefined, false).block).toBe(false);
  });

  it("enabled but no verdict recorded fails CLOSED — silence is not a pass", () => {
    expect(shadowJudgeGate(undefined, true).block).toBe(true);
  });

  it("a judge-lane error fails CLOSED, and the reason carries the error", () => {
    const d = shadowJudgeGate({ error: "402 credits" }, true);
    expect(d.block).toBe(true);
    expect(d.reason).toContain("402 credits");
  });

  it("hard-reject blocks regardless of total (the unanimous generic-visual signature)", () => {
    const d = shadowJudgeGate({ total: 85, rejected: true, note: "generic mechanic imagery" }, true);
    expect(d.block).toBe(true);
    expect(d.reason).toContain("generic mechanic imagery");
  });

  it("blocks below the measured disagreement threshold, clears at and above it", () => {
    expect(shadowJudgeGate({ total: JUDGE_GATE_MIN_TOTAL - 1, rejected: false, note: "" }, true).block).toBe(true);
    expect(shadowJudgeGate({ total: JUDGE_GATE_MIN_TOTAL, rejected: false, note: "" }, true).block).toBe(false);
    expect(shadowJudgeGate({ total: 100, rejected: false, note: "strong" }, true).block).toBe(false);
  });

  it("the threshold IS the readout's disagreement predicate — do not drift them apart", () => {
    // content.shadowJudgeReadout and retro-tournament both count judge < 60
    // (or rejected) as a disagreement; the gate must block exactly that set
    // so the readout keeps measuring the gate's own behavior.
    expect(JUDGE_GATE_MIN_TOTAL).toBe(60);
  });
});
