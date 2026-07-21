/**
 * A booking must never be auto-cancelled by an ambiguous reply.
 *
 * `parseSmsResponse` feeds the live inbound path — orchestrateSms
 * (services/smsOrchestrator.ts:827), the F25e/Capevace gateway — which runs
 * `UPDATE bookings SET status='cancelled'` + cancelBookingReminders with NO
 * confirmation step. (The old executeAutoAction path — a second, divergent
 * engine on the dormant Twilio /api/sms-webhook route — was retired 2026-07-21.)
 *
 * So whatever this parser calls "cancel" at confidence >= 80 destroys a real
 * appointment for a real customer. Before this test, a bare "No" matched at 95%
 * and the substring rule `/cancel/i` matched "cancellation" — a customer
 * answering "No" to a confirmation text, or asking about the cancellation
 * policy, lost their booking silently.
 *
 * These are the contract. If any of them regress, a customer gets hurt.
 */
import { describe, it, expect } from "vitest";
import { parseSmsResponse } from "./services/smsResponseParser";

describe("parseSmsResponse never auto-cancels on an ambiguous reply", () => {
  // The exact reported bug: a yes/no answer must not cancel a booking.
  it.each(["No", "no", "NO", "Nope", "nope"])("%s does not classify as cancel", (msg) => {
    const r = parseSmsResponse(msg);
    expect(r.intent).not.toBe("cancel");
  });

  it.each(["No", "nope"])("%s routes to a human instead of auto-acting", (msg) => {
    const r = parseSmsResponse(msg);
    expect(r.requiresHuman).toBe(true);
  });

  // The substring hole: "cancellation" contains "cancel" but is not a cancel intent.
  it("a question about the cancellation policy does not classify as cancel", () => {
    expect(parseSmsResponse("what's your cancellation policy?").intent).not.toBe("cancel");
    expect(parseSmsResponse("do you charge a cancellation fee?").intent).not.toBe("cancel");
  });
});

describe("parseSmsResponse still auto-cancels on explicit cancel intent", () => {
  // The safe fix must not break the legitimate fast path: an unambiguous cancel
  // should still auto-cancel so the customer isn't left waiting on a human.
  it.each([
    "cancel",
    "Cancel",
    "please cancel my appointment",
    "need to cancel",
    "can't make it",
    "cant make it",
    "not coming",
  ])("%s classifies as cancel with auto-action", (msg) => {
    const r = parseSmsResponse(msg);
    expect(r.intent).toBe("cancel");
    expect(r.autoAction).toBe("cancel-appointment");
    expect(r.requiresHuman).toBe(false);
  });
});

describe("parseSmsResponse confirm path is unaffected", () => {
  it.each(["yes", "Y", "confirm", "sounds good"])("%s still confirms", (msg) => {
    expect(parseSmsResponse(msg).intent).toBe("confirm");
  });
});
