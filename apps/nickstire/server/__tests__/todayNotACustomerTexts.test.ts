/**
 * 2026-11-06 · Today showed a lender's text about the owner's own file as "Texting customer ·
 * Urgent text". A lender or funding broker is not a shop conversation: the SMS router files it
 * not_a_customer (no staff-queue item), and Today's waiting-text rows leave it out, through the
 * same one rule (isNotACustomerText). A real customer's text stays (positive control).
 */
import { describe, expect, it } from "vitest";
import { isNotACustomerText, routeInboundSms } from "../services/smsIntentRouter";
import { waitingConversations, type HumanPendingRow } from "../services/smsResponseJobs";

const LENDER = "Hi Nourdean, this is Zara at City Capital. Need to speak with you about updated terms on your $44263 file. Please call me";
const CUSTOMER = "On 12 gmc sierra 1500";
const ctx = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };

const row = (conversationId: number, body: string): HumanPendingRow => ({
  jobId: conversationId, conversationId, phone: `+1216404${1000 + conversationId}`, customerName: null, body, waitingMinutes: 1080, overdue: true,
});

describe("a lender's text is not a customer text", () => {
  it("the router files it not_a_customer; a customer's tire text is not (positive control)", () => {
    expect(routeInboundSms(LENDER, ctx).primary).toBe("not_a_customer");
    expect(routeInboundSms(CUSTOMER, ctx).primary).not.toBe("not_a_customer");
    expect(routeInboundSms("Can I make payments on my brakes? got approved for $1500", ctx).primary).not.toBe("not_a_customer");
  });

  it("isNotACustomerText agrees with the router, and a safety text is never hidden", () => {
    expect(isNotACustomerText(LENDER)).toBe(true);
    expect(isNotACustomerText(CUSTOMER)).toBe(false);
    expect(isNotACustomerText("your $500 file — also my brakes failed on the highway, stranded")).toBe(false);
  });

  it("Today's waiting texts leave the lender out and keep the customer", () => {
    const items = waitingConversations([row(1, LENDER), row(2, CUSTOMER)]);
    expect(items.map((i) => i.conversationId)).toEqual([2]);
  });
});
