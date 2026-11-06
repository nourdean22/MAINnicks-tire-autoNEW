/**
 * 2026-11-06 · Today showed a lender's text about the owner's own file as "Texting customer ·
 * Urgent text". Today hides a waiting thread only when EVERY open text in it is a lender's
 * (isLenderText, a narrow rule that needs a lender marker), never on the router's wider
 * not_a_customer class, whose bare-link / "sent from my car" / "babe" shapes can be customers.
 * The SMS router still files a lender text not_a_customer so it never becomes a staff item.
 */
import { describe, expect, it } from "vitest";
import { isLenderText, routeInboundSms } from "../services/smsIntentRouter";
import { waitingConversations, type HumanPendingRow } from "../services/smsResponseJobs";

const LENDER = "Hi Nourdean, this is Zara at City Capital. Need to speak with you about updated terms on your $44263 file. Please call me";
const CUSTOMER = "On 12 gmc sierra 1500";
const ctx = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };

const row = (conversationId: number, bodies: string[]): HumanPendingRow => ({
  jobId: conversationId, conversationId, phone: `+1216404${1000 + conversationId}`, customerName: null,
  body: bodies[bodies.length - 1], bodies, waitingMinutes: 1080, overdue: true,
});

describe("a lender's text is not a customer text", () => {
  it("the router files it not_a_customer; a customer's tire text is not (positive control)", () => {
    expect(routeInboundSms(LENDER, ctx).primary).toBe("not_a_customer");
    expect(routeInboundSms(CUSTOMER, ctx).primary).not.toBe("not_a_customer");
  });

  it("isLenderText needs a lender marker", () => {
    expect(isLenderText(LENDER)).toBe(true);
    expect(isLenderText("Following up on the updated terms on your file, please call")).toBe(true);
  });

  it.each([
    ["a bare photo link", "https://drive.google.com/file/d/abc123/view"],
    ["sent from my car", "Is the shop open today? Sent from my car"],
    ["babe", "babe can you check if they have my tires"],
    ["a financing customer", "I got denied on the $1200 application, can I do a smaller amount?"],
    ["a financing customer, again", "did you get the $1200 application I filled out"],
    ["a tire customer", CUSTOMER],
  ])("must NOT hide %s", (_label, text) => {
    expect(isLenderText(text)).toBe(false);
  });

  it("Today hides a thread only when every open text is a lender's", () => {
    const items = waitingConversations([row(1, [LENDER]), row(2, [CUSTOMER]), row(3, [LENDER, CUSTOMER])]);
    expect(items.map((i) => i.conversationId).sort()).toEqual([2, 3]);
  });
});
