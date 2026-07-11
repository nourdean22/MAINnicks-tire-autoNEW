import { describe, expect, it } from "vitest";
import { deriveVapiFacts, hasVerifiedDemandCapture } from "../services/vapiMeasurement";

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

describe("Revenue operations denominator contract", () => {
  it("uses qualified inquiries rather than all calls for lead rate", () => {
    expect(rate(2, 5)).toBe(40);
    expect(rate(2, 10)).toBe(20);
  });

  it("returns unavailable instead of a fabricated percentage at zero denominator", () => {
    expect(rate(0, 0)).toBeNull();
  });

  it("does not count a direction, transfer or tool as verified demand capture", () => {
    const facts = deriveVapiFacts({
      reachedTool: true,
      inferredWalkIn: true,
      endedReason: "assistant-forwarded-call",
    });
    expect(facts.toolEngaged).toBe(true);
    expect(facts.walkInDirected).toBe(true);
    expect(facts.transferAttempted).toBe(true);
    expect(hasVerifiedDemandCapture(facts)).toBe(false);
  });

  it("requires a persisted operational identifier for verified capture", () => {
    expect(hasVerifiedDemandCapture(deriveVapiFacts({ leadId: 1 }))).toBe(true);
    expect(hasVerifiedDemandCapture(deriveVapiFacts({ callbackId: 2 }))).toBe(true);
    expect(hasVerifiedDemandCapture(deriveVapiFacts({ bookingId: 3 }))).toBe(true);
  });
});