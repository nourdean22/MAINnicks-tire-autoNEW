/**
 * contentRunAttribution — what a piece of content actually earned.
 *
 * The rules these tests defend are all about REFUSING to invent a number:
 *   - an invoice claimed by two runs is counted for NEITHER (no evidence
 *     supports any split, and counting it twice reports revenue that
 *     does not exist)
 *   - only PAID invoices count; work in progress is not revenue
 *   - leads with no utm_content are counted as a NAMED blind spot, not
 *     silently dropped
 *
 * The failure mode being prevented: a report that looks precise, is trusted, and
 * quietly double-counts. This codebase has already shipped fabricated precision
 * twice today.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateContentRunRevenue, buildTrackedUrl, CONTENT_RUN_UTM_PARAM,
  type ContentLeadRow,
} from "./services/contentRunAttribution";

const lead = (over: Partial<ContentLeadRow> = {}): ContentLeadRow => ({
  leadId: 1, utmContent: "run_a", invoiceId: null, invoiceStatus: null, invoiceAmountCents: null, ...over,
});

describe("revenue is only counted when it is real", () => {
  it("credits a run for a uniquely-linked PAID invoice", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: "run_a", invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 48600 }),
    ]);
    expect(s.runs[0]).toMatchObject({ runId: "run_a", leadCount: 1, uniquelyLinkedPaidInvoices: 1, verifiedRevenueCents: 48600 });
  });

  it("does NOT count an unpaid invoice as revenue", () => {
    const s = aggregateContentRunRevenue([
      lead({ invoiceId: 10, invoiceStatus: "open", invoiceAmountCents: 90000 }),
    ]);
    expect(s.runs[0].verifiedRevenueCents).toBe(0);
    expect(s.totals.verifiedRevenueCents).toBe(0);
  });

  it.each(["pending", "partial", "refunded"])("does not count a '%s' invoice as revenue", (status) => {
    // Each exclusion is a decision: pending is not money yet, counting a PARTIAL
    // at full value would overstate, and a refund is money that came back.
    const s = aggregateContentRunRevenue([
      lead({ invoiceId: 10, invoiceStatus: status, invoiceAmountCents: 50000 }),
    ]);
    expect(s.totals.verifiedRevenueCents).toBe(0);
  });

  it("counts a lead with no invoice at all as a lead, not as revenue", () => {
    const s = aggregateContentRunRevenue([lead()]);
    expect(s.runs[0].leadCount).toBe(1);
    expect(s.runs[0].verifiedRevenueCents).toBe(0);
  });
});

describe("an invoice two runs both claim", () => {
  it("is counted for NEITHER — a split would be invented, and both would double-count", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: "run_a", invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 50000 }),
      lead({ leadId: 2, utmContent: "run_b", invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 50000 }),
    ]);
    expect(s.totals.verifiedRevenueCents).toBe(0);
    expect(s.totals.ambiguousInvoiceCount).toBe(1);
    for (const r of s.runs) expect(r.uniquelyLinkedPaidInvoices).toBe(0);
    // Both runs still show their lead — the CONTACT happened even though the
    // revenue cannot be assigned.
    expect(s.runs.map((r) => r.leadCount)).toEqual([1, 1]);
  });

  it("still credits an invoice two leads from the SAME run share", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: "run_a", invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 30000 }),
      lead({ leadId: 2, utmContent: "run_a", invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 30000 }),
    ]);
    expect(s.totals.ambiguousInvoiceCount).toBe(0);
    // One invoice, counted once, despite two leads pointing at it.
    expect(s.runs[0].uniquelyLinkedPaidInvoices).toBe(1);
    expect(s.runs[0].verifiedRevenueCents).toBe(30000);
  });
});

describe("the blind spot is named, not hidden", () => {
  it("counts untracked leads separately and says how many", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: "run_a" }),
      lead({ leadId: 2, utmContent: null }),
      lead({ leadId: 3, utmContent: "   " }),
    ]);
    expect(s.totals.unattributedLeadCount).toBe(2);
    expect(s.totals.attributedLeadCount).toBe(1);
    expect(s.limitations.join(" ")).toMatch(/2 lead\(s\) had no utm_content/);
  });

  it("always states its limits, even on a clean dataset", () => {
    const s = aggregateContentRunRevenue([lead()]);
    expect(s.limitations.length).toBeGreaterThanOrEqual(4);
    expect(s.limitations.join(" ")).toMatch(/walk-in or a direct call is invisible/);
  });
});

describe("cost sits beside revenue", () => {
  it("attaches generation cost so the ratio is honest", () => {
    const s = aggregateContentRunRevenue(
      [lead({ invoiceId: 10, invoiceStatus: "paid", invoiceAmountCents: 48600 })],
      { run_a: 1800 },
    );
    expect(s.runs[0].generationCostCents).toBe(1800);
    expect(s.totals.generationCostCents).toBe(1800);
  });

  it("defaults an unknown cost to zero rather than guessing", () => {
    const s = aggregateContentRunRevenue([lead()]);
    expect(s.runs[0].generationCostCents).toBe(0);
  });
});

describe("ranking", () => {
  it("puts the highest-earning run first — the question the operator is asking", () => {
    const s = aggregateContentRunRevenue([
      lead({ leadId: 1, utmContent: "small", invoiceId: 1, invoiceStatus: "paid", invoiceAmountCents: 5000 }),
      lead({ leadId: 2, utmContent: "big", invoiceId: 2, invoiceStatus: "paid", invoiceAmountCents: 90000 }),
    ]);
    expect(s.runs[0].runId).toBe("big");
  });
});

describe("the tracked link", () => {
  it("carries the run id as utm_content — the run IS the tracking id", () => {
    const url = buildTrackedUrl({ baseUrl: "https://nickstire.org/book", runId: "run_847" });
    expect(url).toContain(`${CONTENT_RUN_UTM_PARAM}=run_847`);
    expect(url).toContain("utm_source=instagram");
    expect(url).toContain("utm_medium=organic");
  });

  it("preserves an existing path and query on the destination", () => {
    const url = buildTrackedUrl({ baseUrl: "https://nickstire.org/services/brakes?ref=x", runId: "run_1" });
    expect(url).toContain("/services/brakes");
    expect(url).toContain("ref=x");
  });

  it("labels a boosted post differently so paid and organic never merge", () => {
    const url = buildTrackedUrl({ baseUrl: "https://nickstire.org/book", runId: "run_1", medium: "paid_reel", campaign: "pothole_spring_2026" });
    expect(url).toContain("utm_medium=paid_reel");
    expect(url).toContain("utm_campaign=pothole_spring_2026");
  });
});
