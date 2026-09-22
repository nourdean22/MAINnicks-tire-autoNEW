/**
 * One invoice reconciles one arrival — the planner behind reconcileExpectedArrivals.
 *
 * THE DEFECT THIS PINS. The reconcile was a single UPDATE ... JOIN with no
 * uniqueness: every expected row whose window contained an invoice got that
 * invoice. Three "coming today" rows (Mon, Tue, Wed) and one Wednesday invoice
 * became three `arrived` rows sharing one reconciledInvoiceId, and the weekly
 * digest summed that invoice three times in the line labelled revenue.
 *
 * These tests drive the real planner with candidate pairs shaped exactly as the
 * SQL returns them. The SQL decides eligibility (phone, window, unclaimed); the
 * planner decides which eligible pairs are applied.
 */
import { describe, expect, it } from "vitest";
import { planArrivalReconciliation, type ArrivalCandidate } from "../lib/arrivalReconciliationPlan";

const pair = (
  arrivalId: number,
  expectedDate: string,
  invoiceId: number,
  invoiceDate: string,
  createdTs = arrivalId * 1000,
): ArrivalCandidate => ({ arrivalId, expectedDate, createdTs, invoiceId, invoiceDate });

describe("the three-rows-one-invoice case", () => {
  // Said "coming today" Mon, Tue and Wed; paid once on Wed. Every window
  // contains the Wed invoice, so the old JOIN produced three claims.
  const pairs = [
    pair(1, "2026-09-21", 500, "2026-09-23"), // Mon row
    pair(2, "2026-09-22", 500, "2026-09-23"), // Tue row
    pair(3, "2026-09-23", 500, "2026-09-23"), // Wed row — the visit that happened
  ];

  it("claims the invoice ONCE, for the arrival closest to the visit", () => {
    const plan = planArrivalReconciliation(pairs);
    expect(plan.matches).toEqual([{ arrivalId: 3, invoiceId: 500 }]);
  });

  it("reports the earlier rows as the SAME VISIT, not as no-shows", () => {
    const plan = planArrivalReconciliation(pairs);
    expect(plan.superseded).toEqual([
      { arrivalId: 1, byArrivalId: 3, invoiceId: 500 },
      { arrivalId: 2, byArrivalId: 3, invoiceId: 500 },
    ]);
  });

  it("never lets two arrivals share an invoice, however the input is ordered", () => {
    const shuffled = [pairs[2], pairs[0], pairs[1]];
    const plan = planArrivalReconciliation(shuffled);
    const invoiceIds = plan.matches.map((m) => m.invoiceId);
    expect(new Set(invoiceIds).size).toBe(invoiceIds.length);
    expect(plan.matches).toEqual([{ arrivalId: 3, invoiceId: 500 }]);
  });
});

describe("a customer who genuinely came twice", () => {
  it("reconciles two arrivals to two invoices, oldest invoice first", () => {
    // Expected Mon, came Mon (inv 600); expected Wed, came Wed (inv 601).
    // Mon's window (Mon..Wed) also contains the Wed invoice — the planner
    // must not let the Mon row grab the Wed invoice and strand the Wed row.
    const plan = planArrivalReconciliation([
      pair(10, "2026-09-21", 600, "2026-09-21"),
      pair(10, "2026-09-21", 601, "2026-09-23"),
      pair(11, "2026-09-23", 601, "2026-09-23"),
    ]);
    expect(plan.matches).toEqual([
      { arrivalId: 10, invoiceId: 600 },
      { arrivalId: 11, invoiceId: 601 },
    ]);
    expect(plan.superseded).toEqual([]);
  });
});

describe("what is left alone", () => {
  it("an arrival with no matched invoice is NOT superseded — that is the no-show sweep's call", () => {
    // Two arrivals, one invoice matching only the second: the first has no
    // candidate invoice at all and stays expected.
    const plan = planArrivalReconciliation([pair(20, "2026-09-22", 700, "2026-09-22")]);
    expect(plan.matches).toEqual([{ arrivalId: 20, invoiceId: 700 }]);
    expect(plan.superseded).toEqual([]);
  });

  it("an empty candidate set plans nothing", () => {
    expect(planArrivalReconciliation([])).toEqual({ matches: [], superseded: [] });
  });
});

describe("determinism", () => {
  it("ties on expectedDate go to the earliest-created row, then the lowest id", () => {
    // Two rows for the same day cannot normally coexist (recordExpectedArrival
    // dedupes per phone+day), but the planner must still be total.
    const plan = planArrivalReconciliation([
      pair(31, "2026-09-22", 800, "2026-09-22", 2000),
      pair(30, "2026-09-22", 800, "2026-09-22", 1000),
    ]);
    expect(plan.matches).toEqual([{ arrivalId: 30, invoiceId: 800 }]);
    expect(plan.superseded).toEqual([{ arrivalId: 31, byArrivalId: 30, invoiceId: 800 }]);
  });

  it("the same input in any order yields the identical plan", () => {
    const base = [
      pair(1, "2026-09-21", 500, "2026-09-23"),
      pair(2, "2026-09-22", 500, "2026-09-23"),
      pair(3, "2026-09-23", 500, "2026-09-23"),
      pair(3, "2026-09-23", 501, "2026-09-24"),
      pair(4, "2026-09-24", 501, "2026-09-24"),
    ];
    const a = planArrivalReconciliation(base);
    const b = planArrivalReconciliation([...base].reverse());
    const c = planArrivalReconciliation([base[3], base[1], base[4], base[0], base[2]]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});

describe("POSITIVE CONTROL", () => {
  it("the planner actually discriminates — different inputs, different plans", () => {
    // A planner that returned every pair as a match would pass the "came twice"
    // case; one that returned nothing would pass "left alone". Neither passes
    // this together with the three-rows case above.
    const one = planArrivalReconciliation([pair(1, "2026-09-21", 500, "2026-09-23")]);
    const two = planArrivalReconciliation([
      pair(1, "2026-09-21", 500, "2026-09-23"),
      pair(2, "2026-09-23", 500, "2026-09-23"),
    ]);
    expect(one.matches).toEqual([{ arrivalId: 1, invoiceId: 500 }]);
    expect(two.matches).toEqual([{ arrivalId: 2, invoiceId: 500 }]);
    expect(two.superseded).toEqual([{ arrivalId: 1, byArrivalId: 2, invoiceId: 500 }]);
  });

  it("matched arrivals and superseded arrivals are disjoint, and every invoice appears once", () => {
    const plan = planArrivalReconciliation([
      pair(1, "2026-09-21", 500, "2026-09-23"),
      pair(2, "2026-09-22", 500, "2026-09-23"),
      pair(3, "2026-09-23", 500, "2026-09-23"),
      pair(3, "2026-09-23", 501, "2026-09-24"),
      pair(4, "2026-09-24", 501, "2026-09-24"),
    ]);
    const matched = new Set(plan.matches.map((m) => m.arrivalId));
    for (const s of plan.superseded) expect(matched.has(s.arrivalId)).toBe(false);
    const invoices = plan.matches.map((m) => m.invoiceId);
    expect(new Set(invoices).size).toBe(invoices.length);
  });
});
