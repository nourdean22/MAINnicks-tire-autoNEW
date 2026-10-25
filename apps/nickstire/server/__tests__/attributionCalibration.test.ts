/**
 * Band calibration (job 2026-10-25-attribution-self-learning, PR 2).
 *
 * Nour, 2026-10-25: "isnt the voice system self learning and autonimic? it should be learning
 * more n more n doing the attribution by itself." Before a band may confirm itself it is
 * measured: right and wrong counts from the operator's own rulings and from recorded links
 * (a voice arrival reconciled to an invoice, a lead uniquely linked to one) scored by running
 * the recipe blind. Ruling: a band opens at precision >= 0.90 with n >= 20. Under 20 the rate
 * is UNKNOWN, never 0 and never 100. Auto rulings never feed their own calibration.
 */
import { describe, expect, it } from "vitest";

import {
  calibrateBands,
  calibrationWords,
  scoreRecordedLinks,
  type BandRuling,
} from "../lib/attributionCalibration";

const ruling = (band: "strong" | "weak", decision: BandRuling["decision"], n: number): BandRuling[] =>
  Array.from({ length: n }, () => ({ band, decision, source: "human" as const }));
const link = (band: "strong" | "weak", right: boolean, n: number): BandRuling[] =>
  Array.from({ length: n }, () => ({ band, decision: right ? "confirmed" : "rejected", source: "recorded_link" as const }));

describe("calibrateBands · the ruling: 90% with n at least 20", () => {
  it("the threshold is stated once and is what the PR body says", () => {
    expect(calibrateBands([]).threshold).toEqual({ minN: 20, minPrecision: 0.9 });
  });

  it("under 20 the rate is UNKNOWN (null) and the band stays manual, however good the few look", () => {
    const r = calibrateBands([...ruling("weak", "confirmed", 19)]);
    expect(r.bands.weak.n).toBe(19);
    expect(r.bands.weak.precision).toBeNull();
    expect(r.bands.weak.open).toBe(false);
  });

  it("opens at exactly 18 of 20 and stays shut at 17 of 20", () => {
    const open = calibrateBands([...ruling("weak", "confirmed", 18), ...ruling("weak", "rejected", 2)]);
    expect(open.bands.weak.precision).toBe(0.9);
    expect(open.bands.weak.open).toBe(true);
    const shut = calibrateBands([...ruling("weak", "confirmed", 17), ...ruling("weak", "rejected", 3)]);
    expect(shut.bands.weak.precision).toBe(0.85);
    expect(shut.bands.weak.open).toBe(false);
  });

  it("PLANTED: a band under threshold stays manual even when its sibling is open", () => {
    const r = calibrateBands([...link("weak", true, 32), ...ruling("strong", "confirmed", 20), ...ruling("strong", "rejected", 5)]);
    expect(r.bands.weak.open).toBe(true);
    expect(r.bands.strong.precision).toBe(0.8);
    expect(r.bands.strong.open).toBe(false);
  });

  it("an ambiguous ruling is counted apart and is not in n", () => {
    const r = calibrateBands([...ruling("weak", "confirmed", 20), ...ruling("weak", "ambiguous", 7)]);
    expect(r.bands.weak.n).toBe(20);
    expect(r.bands.weak.ambiguous).toBe(7);
    expect(r.bands.weak.open).toBe(true);
  });

  it("keeps the human and recorded-link counts apart so the card can say which", () => {
    const r = calibrateBands([...ruling("weak", "confirmed", 3), ...ruling("weak", "rejected", 1), ...link("weak", true, 20)]);
    expect(r.bands.weak.human).toEqual({ confirmed: 3, rejected: 1, ambiguous: 0 });
    expect(r.bands.weak.recordedLink).toEqual({ right: 20, wrong: 0 });
    expect(r.bands.weak.right).toBe(23);
    expect(r.bands.weak.n).toBe(24);
  });

  it("an auto ruling is refused as input: the gate must not grade its own homework", () => {
    const auto: BandRuling[] = Array.from({ length: 25 }, () => ({ band: "weak", decision: "confirmed", source: "auto" }));
    const r = calibrateBands(auto);
    expect(r.bands.weak.n).toBe(0);
    expect(r.bands.weak.open).toBe(false);
  });

  it("empty input: every band UNKNOWN, nothing open, and it says so", () => {
    const r = calibrateBands([]);
    for (const b of ["strong", "weak"] as const) {
      expect(r.bands[b].n).toBe(0);
      expect(r.bands[b].precision).toBeNull();
      expect(r.bands[b].open).toBe(false);
    }
    expect(r.anyOpen).toBe(false);
  });

  it("POSITIVE CONTROL: the rate moves with the input rather than returning a constant", () => {
    const a = calibrateBands([...ruling("weak", "confirmed", 30), ...ruling("weak", "rejected", 10)]);
    const b = calibrateBands([...ruling("weak", "confirmed", 39), ...ruling("weak", "rejected", 1)]);
    expect(a.bands.weak.precision).toBe(0.75);
    expect(b.bands.weak.precision).toBe(0.975);
  });
});

describe("scoreRecordedLinks · the recipe run blind against the record", () => {
  const day = (d: number, h = 12) => new Date(Date.UTC(2026, 9, d, h));
  const calls = [
    { callId: 1, phoneNumber: "+12165550101", leadId: null, serviceMention: "brakes", occurredAt: day(1) },
    { callId: 2, phoneNumber: "+12165550102", leadId: null, serviceMention: null, occurredAt: day(1) },
    { callId: 3, phoneNumber: null, leadId: null, serviceMention: null, occurredAt: day(1) },
    { callId: 4, phoneNumber: "+12165550104", leadId: null, serviceMention: null, occurredAt: day(1) },
  ];
  const paid = [
    { invoiceId: 901, customerPhone: "2165550101", customerId: null, serviceDescription: "FRONT BRAKES", paidAt: day(3), amountCents: 100 },
    { invoiceId: 902, customerPhone: "2165550102", customerId: null, serviceDescription: "OIL", paidAt: day(4), amountCents: 100 },
    { invoiceId: 903, customerPhone: "2165550104", customerId: null, serviceDescription: "OIL", paidAt: day(2), amountCents: 100 },
    { invoiceId: 904, customerPhone: "2165550104", customerId: null, serviceDescription: "TIRES", paidAt: day(9), amountCents: 100 },
  ];

  it("scores a single blind claim right or wrong against the linked invoice, by band", () => {
    const out = scoreRecordedLinks({
      links: [
        { callId: 1, invoiceId: 901 }, // strong, right (service overlaps)
        { callId: 2, invoiceId: 999 }, // weak, wrong (record says another invoice)
      ],
      calls,
      paidInvoices: paid,
      maxDays: 14,
    });
    expect(out.rulings).toEqual([
      { band: "strong", decision: "confirmed", source: "recorded_link" },
      { band: "weak", decision: "rejected", source: "recorded_link" },
    ]);
    expect(out.noClaim).toBe(0);
  });

  it("a link whose call has no phone or several plausible invoices is not scored, only counted", () => {
    const out = scoreRecordedLinks({
      links: [
        { callId: 3, invoiceId: 901 },
        { callId: 4, invoiceId: 903 },
      ],
      calls,
      paidInvoices: paid,
      maxDays: 14,
    });
    expect(out.rulings).toEqual([]);
    expect(out.noClaim).toBe(2);
  });

  it("a link to a call the log does not have is skipped and counted as missing", () => {
    const out = scoreRecordedLinks({ links: [{ callId: 77, invoiceId: 901 }], calls, paidInvoices: paid, maxDays: 14 });
    expect(out.rulings).toEqual([]);
    expect(out.missingCall).toBe(1);
  });
});

describe("calibrationWords · what the card says, in words, with the count", () => {
  const read = (r: BandRuling[]) => ({
    status: "ok" as const,
    measuredAt: "2026-10-25T12:00:00.000Z",
    ...calibrateBands(r),
    inputs: { humanRulings: 0, recordedLinks: 0, linksScored: 0, linksNoClaim: 0, linksMissingCall: 0 },
    control: { callsWithPhone: 5355, after14d: 508, before14d: 227 },
  });

  it("an open band says it confirms itself, with right of n", () => {
    const w = calibrationWords(read([...link("weak", true, 31), ...ruling("weak", "confirmed", 1)]));
    expect(w.status).toBe("ok");
    expect(w.weak).toMatch(/right 32 of 32/);
    expect(w.weak).toMatch(/confirm themselves/);
    expect(w.weak).toMatch(/31 against the shop's arrival records/);
    expect(w.weak).toMatch(/1 of your rulings/);
  });

  it("under 20 says no measured rate yet and how many so far, never a percentage", () => {
    const w = calibrationWords(read([...link("weak", true, 7)]));
    expect(w.weak).toMatch(/7 checked so far/);
    expect(w.weak).toMatch(/no measured rate yet/);
    expect(w.weak).not.toMatch(/%/);
  });

  it("a measured band under the line says so and keeps the rows manual", () => {
    const w = calibrationWords(read([...ruling("strong", "confirmed", 15), ...ruling("strong", "rejected", 5)]));
    expect(w.strong).toMatch(/right 15 of 20/);
    expect(w.strong).toMatch(/under the 90% line/);
    expect(w.strong).toMatch(/still comes here/);
  });

  it("the control travels with the rate: after and before the call, as percentages of all calls", () => {
    const w = calibrationWords(read([]));
    expect(w.control).toMatch(/9\.5% of calls/);
    expect(w.control).toMatch(/4\.2%/);
    expect(w.control).toMatch(/cannot have caused/);
  });

  it("a failed read says it could not be measured and that nothing confirms itself, never a zero", () => {
    const w = calibrationWords({ status: "failed", error: "ER_NO_SUCH_TABLE" });
    expect(w.status).toBe("failed");
    expect(w.weak).toMatch(/could not be measured/);
    expect(w.weak).toMatch(/nothing confirms itself/i);
    expect(w.weak).not.toMatch(/0 of 0/);
    expect(w.control).toBeNull();
  });
});
