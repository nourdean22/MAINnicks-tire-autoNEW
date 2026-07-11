import { describe, expect, it } from "vitest";
import {
  aggregateVerifiedLeadRevenue,
  buildCallInvoiceCandidates,
  normalizePhone,
} from "../services/revenueAttribution";

describe("revenue attribution contract", () => {
  it("counts one uniquely linked paid invoice exactly once", () => {
    const summary = aggregateVerifiedLeadRevenue([
      {
        leadId: 1,
        source: "callback",
        utmSource: "voice-agent",
        invoiceId: 10,
        invoiceStatus: "paid",
        invoiceAmountCents: 42500,
      },
    ]);
    expect(summary.totals.uniquelyLinkedPaidInvoices).toBe(1);
    expect(summary.totals.verifiedRevenueCents).toBe(42500);
  });

  it("excludes unpaid links from verified revenue", () => {
    const summary = aggregateVerifiedLeadRevenue([
      {
        leadId: 1,
        source: "booking",
        utmSource: null,
        invoiceId: 11,
        invoiceStatus: "pending",
        invoiceAmountCents: 50000,
      },
    ]);
    expect(summary.totals.verifiedRevenueCents).toBe(0);
    expect(summary.totals.unpaidOrMissingInvoiceLinks).toBe(1);
  });

  it("does not double count an invoice claimed by multiple leads", () => {
    const summary = aggregateVerifiedLeadRevenue([
      { leadId: 1, source: "popup", utmSource: "google", invoiceId: 12, invoiceStatus: "paid", invoiceAmountCents: 30000 },
      { leadId: 2, source: "chat", utmSource: "google", invoiceId: 12, invoiceStatus: "paid", invoiceAmountCents: 30000 },
    ]);
    expect(summary.totals.verifiedRevenueCents).toBe(0);
    expect(summary.totals.ambiguousInvoiceCount).toBe(1);
  });

  it("normalizes common phone formats to the final ten digits", () => {
    expect(normalizePhone("+1 (216) 555-1212")).toBe("2165551212");
    expect(normalizePhone("555-1212")).toBeNull();
  });

  it("treats direct call to lead to paid invoice linkage as verified", () => {
    const [candidate] = buildCallInvoiceCandidates({
      calls: [{ callId: 1, phoneNumber: "2165551212", leadId: 9, serviceMention: "brakes", occurredAt: new Date("2026-07-01T10:00:00Z") }],
      paidInvoices: [{ invoiceId: 99, customerPhone: "2165551212", customerId: 7, serviceDescription: "front brakes", paidAt: new Date("2026-07-02T10:00:00Z"), amountCents: 60000 }],
      leadLinks: [{ leadId: 9, invoiceId: 99 }],
    });
    expect(candidate.resolution).toBe("attributed");
    expect(candidate.evidenceLevel).toBe("verified");
    expect(candidate.confidence).toBe(1);
  });

  it("keeps phone, time and service matching in manual review", () => {
    const [candidate] = buildCallInvoiceCandidates({
      calls: [{ callId: 2, phoneNumber: "(216) 555-1212", leadId: null, serviceMention: "brake repair", occurredAt: new Date("2026-07-01T10:00:00Z") }],
      paidInvoices: [{ invoiceId: 100, customerPhone: "216-555-1212", customerId: 8, serviceDescription: "brake repair", paidAt: new Date("2026-07-03T10:00:00Z"), amountCents: 70000 }],
      leadLinks: [],
    });
    expect(candidate.resolution).toBe("manual_review");
    expect(candidate.evidenceLevel).toBe("inferred");
    expect(candidate.confidence).toBe(0.9);
  });

  it("marks multiple plausible paid invoices as ambiguous", () => {
    const [candidate] = buildCallInvoiceCandidates({
      calls: [{ callId: 3, phoneNumber: "2165551212", leadId: null, serviceMention: null, occurredAt: new Date("2026-07-01T10:00:00Z") }],
      paidInvoices: [
        { invoiceId: 101, customerPhone: "2165551212", customerId: 8, serviceDescription: "tires", paidAt: new Date("2026-07-02T10:00:00Z"), amountCents: 40000 },
        { invoiceId: 102, customerPhone: "2165551212", customerId: 8, serviceDescription: "oil change", paidAt: new Date("2026-07-04T10:00:00Z"), amountCents: 9000 },
      ],
      leadLinks: [],
    });
    expect(candidate.resolution).toBe("ambiguous");
    expect(candidate.invoiceId).toBeNull();
  });
});
