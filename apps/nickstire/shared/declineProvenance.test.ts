/**
 * Q-37 · every "declined" estimate says HOW we know it was declined.
 *
 * Until now a declined estimate was one thing: an ALG estimate with no matching
 * invoice. That is an INFERENCE — 20 of 439 estimates matched (estate plan §6.1),
 * so most "declines" are really "the matcher found nothing". A counter capture is
 * an OBSERVATION: a person heard the customer say no. The two must never render
 * the same, and a failed read of the captures must not render as "inferred"
 * either — that would be the empty-vs-error shape (a failure shown as a fact).
 */
import { describe, it, expect } from "vitest";
import {
  declineProvenance,
  countDeclineProvenance,
  DECLINE_PROVENANCE_LABEL,
  type DeclineCaptureRead,
} from "./declineProvenance";

const ok = (ids: number[]): DeclineCaptureRead => ({ status: "ok", capturedIds: new Set(ids) });

describe("declineProvenance", () => {
  it("a captured estimate is counter-observed, an uncaptured one is inferred", () => {
    const read = ok([7]);
    expect(declineProvenance(7, read)).toBe("counter");
    expect(declineProvenance(8, read)).toBe("inferred");
  });

  it("before the capture table exists, every decline is inferred — nothing could have been captured", () => {
    expect(declineProvenance(7, { status: "not_enabled" })).toBe("inferred");
  });

  it("a FAILED capture read is unknown, never inferred", () => {
    expect(declineProvenance(7, { status: "error", error: "boom" })).toBe("unknown");
  });

  it("counts split three ways and add up to the rows given", () => {
    expect(countDeclineProvenance([1, 2, 3], ok([2]))).toEqual({ counter: 1, inferred: 2, unknown: 0 });
    expect(countDeclineProvenance([1, 2], { status: "error", error: "x" })).toEqual({ counter: 0, inferred: 0, unknown: 2 });
  });

  it("labels say what the evidence is, and the inferred label never claims the customer declined", () => {
    expect(DECLINE_PROVENANCE_LABEL.counter).toMatch(/counter/i);
    expect(DECLINE_PROVENANCE_LABEL.inferred).toMatch(/inferred/i);
    expect(DECLINE_PROVENANCE_LABEL.inferred).toMatch(/no matching invoice/i);
    expect(DECLINE_PROVENANCE_LABEL.unknown).toMatch(/unknown/i);
  });
});

describe("Decision Inbox wording (estimateOpportunityLabel)", () => {
  it("only a counter capture is verified; inferred and unknown never claim a decline", async () => {
    const { estimateOpportunityLabel } = await import("./declineProvenance");
    const counter = estimateOpportunityLabel("counter", 9, 1);
    expect(counter.dataQuality).toBe("verified");
    expect(counter.reason).toMatch(/declined this quote at the counter/);
    for (const p of ["inferred", "unknown"] as const) {
      const l = estimateOpportunityLabel(p, 9, 1);
      expect(l.dataQuality).toBe("inferred");
      expect(l.reason).toMatch(/not proven declined/);
    }
  });
});
