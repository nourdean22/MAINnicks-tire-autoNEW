import { describe, it, expect } from "vitest";
import { buildLoopScoreboard, sendsPerInvoice, type LoopRow } from "../loopScoreboard";

const row = (over: Partial<LoopRow> = {}): LoopRow => ({
  loop: "retention_d7", sent: 10, replied: 1, optedOut: 0,
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
    expect(s.totals).toEqual({ sent: 20, replied: 2, optedOut: 0, paidInvoicesAfter: 4, revenueObservedCents: 100_000 });
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

  // The defect this guards: rendering "no ratio" as 0 puts the WORST loop
  // first in an ascending sort, where low sends-per-sale reads as efficient.
  it("returns null — never 0 — when nothing converted", () => {
    expect(sendsPerInvoice(row({ sent: 575, paidInvoicesAfter: 0 }))).toBeNull();
  });
});
