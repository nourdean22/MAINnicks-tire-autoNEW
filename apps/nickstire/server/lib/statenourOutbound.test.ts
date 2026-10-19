/**
 * The outbound copies for bdnick.info carry no customer name, phone or customer-written text,
 * keep the counts and ids, and never touch the local objects nickstire's own screens read.
 */
import { describe, expect, it } from "vitest";
import { redactBusinessSyncForStatenour, redactEventDataForStatenour } from "./statenourOutbound";

/** Every value here is an identifier; none may appear anywhere in an outbound body. */
const IDENTIFIERS = [
  "Jane Roe", "2165550101", "John Doe", "2165550102", "Maria Stone", "2165550103",
  "jane@example.test", "Left a voicemail for Maria", "Sam Hill", "1234",
];

const businessPayload = () => ({
  source: "nickstire",
  bookings: { total: 4, thisWeek: 1 },
  customerIntelligence: {
    available: true,
    totalCustomers: 40,
    activeCustomers: 12,
    retentionRate: 33,
    topSpenders: [{ name: "Jane Roe", total: 900, visits: 6, email: "jane@example.test" }],
    atRiskCustomers: [{ name: "John Doe", phone: "2165550102", lastVisit: "2026-05-01", daysSince: 170 }],
    servicePatterns: [{ service: "brakes", count: 9, revenue: 2400 }],
    dayOfWeekPattern: [1, 2, 3, 4, 5, 6, 7],
    peakHours: new Array(24).fill(0),
    actionPlan: "\nCUSTOMER ACTION PLAN:\n• CALL NOW: John Doe (2165550102) — 170d since last visit.",
    // keys nobody listed: must not survive
    customerName: "Jane Roe",
    contact: { phone: "2165550101" },
  },
  customerJourneys: [{ customer: "Maria Stone", events: ["lead_created", "booking_made"], hoursActive: 5 }],
  declinedWork: {
    measured: true,
    totalRecoverable: 800,
    customerCount: 1,
    safetyItemCount: 1,
    topItems: [{
      workOrderId: "wo-1", orderNumber: "WO-1001", customer: "Maria Stone", phone: "2165550103",
      vehicle: "2014 Ford F-150", value: 800, hasSafety: true,
      lines: [{ description: "Front pads", total: 300, declineReason: "price", safetyRelated: true, outreachAt: null, recoveryMethod: null, recoveryNotes: "Left a voicemail for Maria" }],
    }],
  },
  nickAI: { memories: [{ type: "pattern", content: "FULL CONVERSION: Customer \"Sam Hill\" completed full journey" }], memoryCount: 1 },
});

describe("redactBusinessSyncForStatenour", () => {
  it("sends no customer name, phone, email or staff note anywhere in the body", () => {
    const body = JSON.stringify(redactBusinessSyncForStatenour(businessPayload()));
    for (const id of IDENTIFIERS) expect(body).not.toContain(id);
  });

  it("keeps the counts, ages, totals and ids statenour reads", () => {
    const out = redactBusinessSyncForStatenour(businessPayload()) as Record<string, any>;
    expect(out.bookings).toEqual({ total: 4, thisWeek: 1 });
    expect(out.customerIntelligence).toEqual({
      available: true, totalCustomers: 40, activeCustomers: 12, retentionRate: 33,
      topSpenders: [{ total: 900, visits: 6 }],
      atRiskCustomers: [{ lastVisit: "2026-05-01", daysSince: 170 }],
      servicePatterns: [{ service: "brakes", count: 9, revenue: 2400 }],
      dayOfWeekPattern: [1, 2, 3, 4, 5, 6, 7],
      peakHours: new Array(24).fill(0),
    });
    expect(out.customerJourneys).toEqual([{ events: ["lead_created", "booking_made"], hoursActive: 5 }]);
    expect(out.declinedWork).toEqual({
      measured: true, totalRecoverable: 800, customerCount: 1, safetyItemCount: 1,
      topItems: [{
        workOrderId: "wo-1", orderNumber: "WO-1001", vehicle: "2014 Ford F-150", value: 800, hasSafety: true,
        lines: [{ description: "Front pads", total: 300, declineReason: "price", safetyRelated: true, outreachAt: null, recoveryMethod: null }],
      }],
    });
    expect(out.nickAI).toEqual({ memoryCount: 1 });
  });

  it("never mutates the local payload: nickstire's own digests keep the names", () => {
    const local = businessPayload();
    const before = structuredClone(local);
    redactBusinessSyncForStatenour(local);
    expect(local).toEqual(before);
  });

  it("a failed read stays what it was: available:false passes, a null block stays null", () => {
    const out = redactBusinessSyncForStatenour({
      customerIntelligence: { available: false, reason: "customer intelligence read failed — counts unknown, not zero" },
      declinedWork: null,
      customerJourneys: [],
      nickAI: { memories: [], memoryCount: 0 },
    }) as Record<string, unknown>;
    expect(out.customerIntelligence).toEqual({ available: false, reason: "customer intelligence read failed — counts unknown, not zero" });
    expect(out.declinedWork).toBeNull();
    expect(out.customerJourneys).toEqual([]);
    expect(out.nickAI).toEqual({ memoryCount: 0 });
  });

  it("a block of the wrong shape is dropped, not forwarded", () => {
    const out = redactBusinessSyncForStatenour({
      customerIntelligence: "Jane Roe 2165550101",
      declinedWork: ["Maria Stone"],
      customerJourneys: { customer: "Maria Stone" },
      nickAI: "Sam Hill",
    });
    expect(out).toEqual({ customerIntelligence: null, customerJourneys: [], declinedWork: null, nickAI: null });
  });
});

describe("redactEventDataForStatenour", () => {
  it.each([
    ["nickstire:booking", { bookingId: 7, customer: "Jane Roe", phone: "2165550101", service: "brakes", vehicle: "2012 Civic", urgency: "normal", refCode: "REF7" }, { bookingId: 7, service: "brakes", vehicle: "2012 Civic", urgency: "normal", refCode: "REF7" }],
    ["nickstire:lead", { leadId: 8, customer: "Jane Roe", phone: "2165550101", source: "web", urgencyScore: 3, interest: "call me Jane" }, { leadId: 8, source: "web", urgencyScore: 3 }],
    ["nickstire:callback", { customer: "John Doe", phone: "2165550102", reason: "call John at 2165550102" }, {}],
    ["nickstire:emergency", { name: "John Doe", phone: "2165550102", description: "flat on I-90, I am John", urgency: "high" }, { urgency: "high" }],
    ["nickstire:review", { rating: 5, reviewText: "Sam Hill fixed it", customerName: "Sam Hill" }, { rating: 5 }],
    ["nickstire:revenue", { kind: "invoice_paid", invoiceNumber: "INV-1", customer: "Jane Roe", totalAmount: 200, method: "card" }, { kind: "invoice_paid", invoiceNumber: "INV-1", totalAmount: 200, method: "card" }],
    ["nickstire:estimate", { kind: "repair", vehicle: "2012 Civic", symptom: "John says it grinds", service: "brakes", issueCount: 2, source: "ai_estimate_static" }, { kind: "repair", vehicle: "2012 Civic", service: "brakes", issueCount: 2, source: "ai_estimate_static" }],
    ["payment_received", { orderNumber: "PO-1", amount: 300, customerName: "Jane Roe", cardLast4: "1234" }, { orderNumber: "PO-1", amount: 300 }],
    ["campaign_sent", { type: "cross-sell-outreach-v2", customerId: 74, phone: "2165550103", service: "alignment", confidence: 0.8, reason: "Maria Stone is due", predictionId: "pred-1" }, { type: "cross-sell-outreach-v2", service: "alignment", confidence: 0.8, predictionId: "pred-1" }],
    ["stage_changed", { callbackId: 3, newStatus: "completed", notes: "Talked to Maria Stone" }, { callbackId: 3, newStatus: "completed" }],
    ["stage_changed", { workOrderId: 9, newStatus: "in_progress", changedBy: "Sam Hill", note: "John Doe waiting" }, { workOrderId: 9, newStatus: "in_progress" }],
  ] as const)("%s keeps ids, enums and amounts, drops names, phones and written text", (type, data, expected) => {
    const out = redactEventDataForStatenour(type, data);
    expect(out).toEqual(expected);
    for (const id of IDENTIFIERS) expect(JSON.stringify(out)).not.toContain(id);
  });

  it("an unknown key on a known type is dropped (customerName, fullName, email, a nested contact)", () => {
    expect(redactEventDataForStatenour("nickstire:booking", {
      bookingId: 1, customerName: "Jane Roe", fullName: "Jane Roe", email: "jane@example.test", contact: { phone: "2165550101" },
    })).toEqual({ bookingId: 1 });
  });

  it("the shop's own social content passes whole (control: the allowlist is not applied to it)", () => {
    const draft = { id: "draft-1", content: "Brake check this week", status: "pending", platforms: ["instagram"], sourceMetadata: { topic: "brakes" } };
    expect(redactEventDataForStatenour("social_draft:sync", draft)).toEqual(draft);
    expect(redactEventDataForStatenour("social_posted", { platforms: ["gbp"], success: true })).toEqual({ platforms: ["gbp"], success: true });
  });

  it("does not mutate the event the local log and alerts keep", () => {
    const data = { bookingId: 7, customer: "Jane Roe", phone: "2165550101" };
    redactEventDataForStatenour("nickstire:booking", data);
    expect(data).toEqual({ bookingId: 7, customer: "Jane Roe", phone: "2165550101" });
  });

  it("data that is not an object sends nothing", () => {
    expect(redactEventDataForStatenour("nickstire:lead", "Jane Roe 2165550101")).toEqual({});
    expect(redactEventDataForStatenour("nickstire:lead", null)).toEqual({});
  });
});
