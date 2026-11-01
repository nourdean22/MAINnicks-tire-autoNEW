/**
 * scrubBridgePayload / scrubText / stripSyncCustomerPii rules, one fixture per rule
 * (2026-10-19 review round). Pure functions, no mocks.
 */
import { describe, expect, it } from "vitest";
import { scrubBridgePayload, scrubText, stripSyncCustomerPii } from "@/lib/brain/customer-pii";
import { buildCeoContextFromNickSyncPayload } from "@/lib/nickstire/ceo-context";

describe("scrubBridgePayload · allowlist rules", () => {
  it("a non-identity unknown string key is dropped (the identity regex cannot catch it)", () => {
    expect(scrubBridgePayload({ leadId: 1, memo: "Jane Roe called twice", notes: "ask for Sam", n: 2 })).toEqual({ leadId: 1, n: 2 });
  });

  it("an array of strings is dropped, an array of objects is projected", () => {
    expect(scrubBridgePayload({ people: ["Jane Roe", "Sam Doe"], rows: [{ attempts: 2, memo: "Jane" }] })).toEqual({ people: [], rows: [{ attempts: 2 }] });
  });

  it("an id-shaped key keeps its value even when it mentions customer or contact", () => {
    expect(scrubBridgePayload({ customerId: "cus_1", contactId: "c_9", leadId: 4, customerName: "Jane Roe" })).toEqual({
      customerId: "cus_1",
      contactId: "c_9",
      leadId: 4,
    });
  });

  it("identity keys of every common shape are dropped", () => {
    const out = scrubBridgePayload({
      customer_name: "J", fullName: "J R", firstName: "J", lastName: "R", contactName: "J", address: "1 Main St", mobile: "216", email: "a@b.co", callerPhone: "216", who: "J", owner: "J", seen: 1,
    });
    expect(out).toEqual({ seen: 1 });
  });

  it("kept free-text keys have phones and emails masked", () => {
    const out = scrubBridgePayload({ interest: "Call (216) 555-0199 or jane@example.test", service: "216.555.0100", vehicle: "grinding", tire: "+1 216 555 0111" }) as Record<string, string>;
    expect(out.interest).toBe("Call [phone] or [email]");
    expect(out.service).toBe("[phone]");
    expect(out.tire).toBe("[phone]");
    expect(out.vehicle).toBe("grinding");
  });

  // scrubText cannot see a name, so a customer-written or staff-written sentence is not stored at all.
  it("reason, description, reviewText, symptom and problem are dropped at any depth, even with no phone in them", () => {
    const sentence = "I'm Jane Roe, my brakes grind";
    const out = scrubBridgePayload({ reason: sentence, description: sentence, reviewText: sentence, symptom: sentence, problem: sentence, rating: 2, nested: [{ reason: sentence, attempts: 1 }] });
    expect(out).toEqual({ rating: 2, nested: [{ attempts: 1 }] });
    expect(JSON.stringify(out)).not.toContain("Jane");
  });

  it("text and content are kept only when the caller says it is a social draft", () => {
    expect(scrubBridgePayload({ text: "hi", content: "post body", id: "d1" })).toEqual({ id: "d1" });
    expect(scrubBridgePayload({ text: "hi", content: "post body 216-555-0199", id: "d1" }, { keepText: true })).toEqual({
      text: "hi",
      content: "post body [phone]",
      id: "d1",
    });
  });

  it("numbers, booleans and null under non-identity keys survive as counts", () => {
    expect(scrubBridgePayload({ sent: 10, failed: 0, live: true, workOrderId: null })).toEqual({ sent: 10, failed: 0, live: true, workOrderId: null });
  });
});

describe("scrubText", () => {
  it("masks phones in several shapes and emails, leaves ordinary numbers", () => {
    expect(scrubText("a 2165550199 b (216) 555-0199 c 216-555-0199 d 216.555.0199 e +1 216 555 0199 f x@y.org")).toBe(
      "a [phone] b [phone] c [phone] d [phone] e [phone] f [email]",
    );
    expect(scrubText("Order 1042, 3 tires at $612")).toBe("Order 1042, 3 tires at $612");
  });

  // ID_KEY values go through scrubText, so a 13-digit epoch-ms id used to lose its last ten digits.
  it("leaves a digit run longer than a phone number alone (epoch-ms ids)", () => {
    expect(scrubText("evt_1760912345678")).toBe("evt_1760912345678");
    expect(scrubBridgePayload({ eventId: "evt_1760912345678", leadId: "1760912345678" })).toEqual({
      eventId: "evt_1760912345678",
      leadId: "1760912345678",
    });
  });

  it("CONTROL: phones in the usual shapes are still masked, inside a sentence too", () => {
    expect(scrubText("call 216-555-0142")).toBe("call [phone]");
    expect(scrubText("(216) 555 0142")).toBe("[phone]");
    expect(scrubText("+1 216.555.0142")).toBe("[phone]");
    expect(scrubText("2165550142")).toBe("[phone]");
    expect(scrubText("ask 1-216-555-0142, then 216 555 0142.")).toBe("ask [phone], then [phone].");
  });
});

describe("stripSyncCustomerPii · memories and patterns", () => {
  const payload = () => ({
    source: "nickstire",
    revenue: { today: 100 },
    nickAI: { memories: [{ content: 'Customer "Jane Roe" completed full journey', category: "vip" }], memoryCount: 1 },
    operatorPatterns: [{ topic: "Jane Roe always pays cash", count: 3 }],
    declinedWork: {
      customerCount: 1,
      topItems: [{ workOrderId: 7, customer: "Jane Roe", phone: "2165550199", lines: [{ description: "Rotors", total: 300, declineReason: "Jane said too pricey", recoveryNotes: "left VM for Jane Roe", safetyRelated: true }] }],
    },
  });

  it("drops nickAI and operatorPatterns entirely", () => {
    const out = stripSyncCustomerPii(payload()) as Record<string, unknown>;
    expect("nickAI" in out).toBe(false);
    expect("operatorPatterns" in out).toBe(false);
    expect(out.revenue).toEqual({ today: 100 });
  });

  // GET /api/sync/business re-strips stored rows on read; a row stored after the fix already holds the
  // generated AT-RISK line, so a second strip used to append a second copy.
  it("is idempotent: stripping a stored (already stripped) payload changes nothing", () => {
    const withPlan = {
      customerIntelligence: {
        atRiskCustomers: [
          { name: "Jane Roe", phone: "2165550199", daysSince: 321, lastVisit: "2025-12-01" },
          { name: "Sam Doe", daysSince: 200, lastVisit: "2026-03-01" },
        ],
        topSpenders: [{ name: "Jane Roe", total: 4200, visits: 9 }],
        actionPlan: "\nCUSTOMER ACTION PLAN:\n• CALL NOW: Jane Roe (2165550199) — 321d since last visit.\n• PROTECT: Sam Doe is your #1 spender.\n• MOMENTUM: 3 new customers this month.",
      },
    };
    const once = stripSyncCustomerPii(withPlan);
    const twice = stripSyncCustomerPii(once);
    expect(twice).toEqual(once);
    const plan = (twice as typeof withPlan).customerIntelligence.actionPlan;
    expect(plan.match(/AT-RISK:/g)).toHaveLength(1);
    expect(plan).toContain("MOMENTUM: 3 new customers this month.");
    expect(stripSyncCustomerPii(twice)).toEqual(once);
  });

  // 2026-11-01 · the consumer of the sender's openCount/openTotal/capped reads the STORED row, so
  // both writers between the POST and the brief must keep the three keys (and null must stay null).
  it("keeps declinedWork.openCount/openTotal/capped through the strip and the CEO-context row, null included", () => {
    for (const keys of [
      { openCount: 37, openTotal: 12480.5, capped: true },
      { openCount: null, openTotal: null, capped: true },
    ]) {
      const raw = { source: "nickstire", declinedWork: { ...payload().declinedWork, ...keys } };
      const stripped = stripSyncCustomerPii(raw) as { declinedWork: Record<string, unknown> };
      expect(stripped.declinedWork).toMatchObject(keys);
      const ceo = buildCeoContextFromNickSyncPayload(stripped as Record<string, unknown>);
      expect(ceo.declinedWork).toMatchObject(keys);
    }
  });

  it("drops recoveryNotes and declineReason from the decline lines, keeps the numbers", () => {
    const out = stripSyncCustomerPii(payload()) as { declinedWork: { topItems: Array<{ lines: Array<Record<string, unknown>> }> } };
    expect(out.declinedWork.topItems[0].lines[0]).toEqual({ description: "Rotors", total: 300, safetyRelated: true });
    expect(JSON.stringify(out)).not.toMatch(/Jane|2165550199/);
  });
});
