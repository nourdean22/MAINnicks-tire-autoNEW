import { describe, it, expect } from "vitest";
import {
  buildHoldoutLift,
  HOLDOUT_MIN_MATURED_PER_ARM,
  buildLoopScoreboard,
  sendsPerInvoice,
  type LoopRow,
} from "../loopScoreboard";

const row = (over: Partial<LoopRow> = {}): LoopRow => ({
  loop: "retention_d7", attempted: 10, sent: 10, undelivered: 0, replied: 1, optedOut: 0,
  paidInvoicesAfter: 2, revenueObservedCents: 50_000, ...over,
});

describe("buildLoopScoreboard", () => {
  it("ranks by revenue so the operator reads the board top-down", () => {
    const s = buildLoopScoreboard(
      [row({ loop: "a", revenueObservedCents: 100 }), row({ loop: "b", revenueObservedCents: 900 })],
      { windowDays: 180, attributionWindowDays: 30 },
    );
    expect(s.loops.map((l) => l.loop)).toEqual(["b", "a"]);
  });

  it("KEEPS loops that earned nothing — a big spender with no return is the point", () => {
    const s = buildLoopScoreboard(
      [row({ loop: "cross_sell", sent: 575, paidInvoicesAfter: 0, revenueObservedCents: 0 }), row()],
      { windowDays: 180, attributionWindowDays: 30 },
    );
    expect(s.loops.map((l) => l.loop)).toContain("cross_sell");
  });

  it("does not mutate the caller's array", () => {
    const input = [row({ loop: "a", revenueObservedCents: 1 }), row({ loop: "b", revenueObservedCents: 2 })];
    buildLoopScoreboard(input, { windowDays: 30, attributionWindowDays: 30 });
    expect(input.map((l) => l.loop)).toEqual(["a", "b"]);
  });

  it("totals every column", () => {
    const s = buildLoopScoreboard([row(), row()], { windowDays: 180, attributionWindowDays: 30 });
    expect(s.totals).toEqual({ attempted: 20, sent: 20, undelivered: 0, replied: 2, optedOut: 0, paidInvoicesAfter: 4, revenueObservedCents: 100_000 });
  });

  // The cross_sell case: 575 attempted, 301 never went out. Ranking on
  // `attempted` ranks deliverability and calls it copy performance.
  it("warns when messages never left the building", () => {
    const s = buildLoopScoreboard(
      [row({ loop: "cross_sell", attempted: 575, sent: 274, undelivered: 301 })],
      { windowDays: 180, attributionWindowDays: 30 },
    );
    expect(s.totals.undelivered).toBe(301);
    expect(s.limitations.join(" ")).toMatch(/never left the building/);
    expect(s.limitations.join(" ")).toMatch(/delivery problem/i);
  });

  // 135 rows sat in 'sending' with no twilioSid — never handed to Twilio. An
  // `undelivered` count that only caught 'failed' would have called them sent.
  it("counts stuck 'sending' rows as undelivered, not sent", () => {
    const s = buildLoopScoreboard(
      [row({ loop: "declined_45d_P3", attempted: 54, sent: 43, undelivered: 11 })],
      { windowDays: 180, attributionWindowDays: 30 },
    );
    expect(s.totals.sent).toBe(43);
    expect(s.limitations.join(" ")).toMatch(/stuck in 'sending'/);
  });

  it("says nothing about delivery when every message went out", () => {
    const s = buildLoopScoreboard([row()], { windowDays: 180, attributionWindowDays: 30 });
    expect(s.limitations.join(" ")).not.toMatch(/never left the building/);
  });

  it("always ships its limitations — a correlation number without them invites over-reading", () => {
    const s = buildLoopScoreboard([row()], { windowDays: 180, attributionWindowDays: 30 });
    expect(s.limitations.join(" ")).toMatch(/CORRELATION, NOT ATTRIBUTION/);
    expect(s.limitations.join(" ")).toContain("30 days");
  });

  it("says so out loud when sends produced no invoices at all", () => {
    const s = buildLoopScoreboard(
      [row({ sent: 500, paidInvoicesAfter: 0, revenueObservedCents: 0 })],
      { windowDays: 180, attributionWindowDays: 30 },
    );
    expect(s.limitations.join(" ")).toMatch(/No recipient paid an invoice/);
  });

  it("does NOT claim a zero result when nothing was sent either", () => {
    const s = buildLoopScoreboard([], { windowDays: 180, attributionWindowDays: 30 });
    expect(s.limitations.join(" ")).not.toMatch(/No recipient paid an invoice/);
  });
});

describe("sendsPerInvoice", () => {
  it("computes messages per sale", () => {
    expect(sendsPerInvoice(row({ sent: 72, paidInvoicesAfter: 12 }))).toBe(6);
  });

  // Divides by sent, not attempted — an undelivered message cannot have failed
  // to produce a sale.
  it("ignores failed attempts in the ratio", () => {
    expect(sendsPerInvoice(row({ attempted: 575, sent: 274, undelivered: 301, paidInvoicesAfter: 2 }))).toBe(137);
  });

  // The defect this guards: rendering "no ratio" as 0 puts the WORST loop
  // first in an ascending sort, where low sends-per-sale reads as efficient.
  it("returns null — never 0 — when nothing converted", () => {
    expect(sendsPerInvoice(row({ sent: 575, paidInvoicesAfter: 0 }))).toBeNull();
  });
});


describe("buildHoldoutLift", () => {
  it("stays UNMEASURED when no durable assignments exist", () => {
    const h = buildHoldoutLift();
    expect(h.status).toBe("UNMEASURED");
    expect(h.incrementalGrossRevenueCents).toBeNull();
    expect(h.netValueStatus).toBe("UNMEASURED_PROVIDER_COST");
  });

  it("stays COLLECTING until both arms have a full attribution window", () => {
    const h = buildHoldoutLift({
      experimentId: "contact:retention_d90:v1",
      treatmentAssigned: 85,
      controlAssigned: 15,
      treatmentMatured: 20,
      controlMatured: 0,
      treatmentPaidInvoices: 2,
      controlPaidInvoices: 0,
      treatmentRevenueCents: 30_000,
      controlRevenueCents: 0,
    });
    expect(h.status).toBe("COLLECTING");
    expect(h.incrementalGrossRevenueCents).toBeNull();
  });

  it("computes incremental gross revenue from matured randomized arms only", () => {
    const h = buildHoldoutLift({
      experimentId: "contact:retention_d90:v1",
      treatmentAssigned: 100,
      controlAssigned: 40,
      treatmentMatured: 80,
      controlMatured: 32,
      treatmentPaidInvoices: 8,
      controlPaidInvoices: 2,
      treatmentRevenueCents: 80_000,
      controlRevenueCents: 16_000,
    });
    expect(h.status).toBe("OBSERVED_HOLDOUT");
    expect(h.treatmentRevenuePerAssignedCents).toBe(1_000);
    expect(h.controlRevenuePerAssignedCents).toBe(500);
    expect(h.incrementalGrossRevenuePerTreatmentCents).toBe(500);
    expect(h.incrementalGrossRevenueCents).toBe(40_000);
    expect(h.netValueCents).toBeNull();
  });

  it("stays COLLECTING while either arm is under the matured minimum — one lucky control is not a lift", () => {
    const base = {
      experimentId: "contact:winback:v1",
      treatmentAssigned: 200,
      controlAssigned: 40,
      treatmentPaidInvoices: 20,
      controlPaidInvoices: 0,
      treatmentRevenueCents: 200_000,
      controlRevenueCents: 0,
    };
    const thinControl = buildHoldoutLift({
      ...base,
      treatmentMatured: 200,
      controlMatured: HOLDOUT_MIN_MATURED_PER_ARM - 1,
    });
    expect(thinControl.status).toBe("COLLECTING");
    expect(thinControl.incrementalGrossRevenueCents).toBeNull();

    const atMinimum = buildHoldoutLift({
      ...base,
      treatmentMatured: 200,
      controlMatured: HOLDOUT_MIN_MATURED_PER_ARM,
    });
    expect(atMinimum.status).toBe("OBSERVED_HOLDOUT");
  });

  it("preserves negative lift instead of flooring a losing lane at zero", () => {
    const h = buildHoldoutLift({
      experimentId: "contact:campaign:12:v1",
      treatmentAssigned: 40,
      controlAssigned: 40,
      treatmentMatured: 40,
      controlMatured: 40,
      treatmentPaidInvoices: 1,
      controlPaidInvoices: 4,
      treatmentRevenueCents: 10_000,
      controlRevenueCents: 32_000,
    });
    expect(h.incrementalGrossRevenuePerTreatmentCents).toBe(-550);
    expect(h.incrementalGrossRevenueCents).toBe(-22_000);
  });

  it("counts causal measurement states without turning cost into profit", () => {
    const observed = buildHoldoutLift({
      experimentId: "contact:retention_d7:v1",
      treatmentAssigned: 40,
      controlAssigned: 30,
      treatmentMatured: 40,
      controlMatured: 30,
      treatmentPaidInvoices: 2,
      controlPaidInvoices: 0,
      treatmentRevenueCents: 20_000,
      controlRevenueCents: 0,
    });
    const collecting = buildHoldoutLift({
      experimentId: "contact:review_request:v1",
      treatmentAssigned: 10,
      controlAssigned: 2,
      treatmentMatured: 0,
      controlMatured: 0,
      treatmentPaidInvoices: 0,
      controlPaidInvoices: 0,
      treatmentRevenueCents: 0,
      controlRevenueCents: 0,
    });
    const s = buildLoopScoreboard(
      [
        row({ loop: "retention_d7", holdout: observed }),
        row({ loop: "review_request", holdout: collecting }),
        row({ loop: "legacy" }),
      ],
      { windowDays: 180, attributionWindowDays: 30 },
    );
    expect(s.causalMeasurement).toEqual({
      observedHoldoutLanes: 1,
      collectingLanes: 1,
      unmeasuredLanes: 1,
      providerCostMeasured: false,
    });
    expect(s.limitations.join(" ")).toMatch(/NET P&L IS UNMEASURED/);
  });
});
