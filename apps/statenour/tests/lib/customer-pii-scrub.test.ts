/**
 * scrubBridgePayload / scrubText / stripSyncCustomerPii rules, one fixture per rule
 * (2026-10-19 review round). Pure functions, no mocks.
 */
import { describe, expect, it } from "vitest";
import { scrubBridgePayload, scrubText, stripSyncCustomerPii } from "@/lib/brain/customer-pii";

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
    const out = scrubBridgePayload({ reason: "Call (216) 555-0199 or jane@example.test", description: "216.555.0100", symptom: "grinding", problem: "+1 216 555 0111" }) as Record<string, string>;
    expect(out.reason).toBe("Call [phone] or [email]");
    expect(out.description).toBe("[phone]");
    expect(out.problem).toBe("[phone]");
    expect(out.symptom).toBe("grinding");
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

  it("drops recoveryNotes and declineReason from the decline lines, keeps the numbers", () => {
    const out = stripSyncCustomerPii(payload()) as { declinedWork: { topItems: Array<{ lines: Array<Record<string, unknown>> }> } };
    expect(out.declinedWork.topItems[0].lines[0]).toEqual({ description: "Rotors", total: 300, safetyRelated: true });
    expect(JSON.stringify(out)).not.toMatch(/Jane|2165550199/);
  });
});
