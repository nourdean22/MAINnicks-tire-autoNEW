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

/**
 * Opt-out over-match (2026-09-23). The unsubscribe rule matched any reply that
 * STARTS with a keyword, so a customer asking "Stop by around 3?" or saying
 * "End of the day works" was silently unsubscribed from every text. These
 * phrasings cannot be a revocation; they now go to a person. Every real
 * opt-out, punctuated or phrased, still unsubscribes.
 */
describe("parseSmsResponse unsubscribes on an opt-out, not on a visit", () => {
  it.each([
    "STOP", "Stop.", "stop!", "STOP ALL", "Stopall", "Unsubscribe", "opt out", "Opt-out", "OPTOUT", "Revoke",
    "End", "END.", "Quit", "remove me", "Stop texting me", "stop sending these", "Remove me from your list",
  ])("%s unsubscribes", (msg) => {
    expect(parseSmsResponse(msg).intent).toBe("unsubscribe");
  });

  it.each([
    "Stop by around 3?", "Can I stop in tomorrow", "stop over after work", "I'll stop at the shop at noon",
    "stop off on my way", "End of the day works", "end up needing 2 tires",
  ])("%s does not unsubscribe", (msg) => {
    const r = parseSmsResponse(msg);
    expect(r.intent).not.toBe("unsubscribe");
    expect(r.autoAction).not.toBe("unsubscribe-customer");
  });
});

/**
 * Revocation first (2026-09-23, audit item B). Two defects, both pinned here:
 *
 * 1. Rule order. PATTERNS is first-hit, and the opt-out rule sat AFTER the
 *    confirm, cancel and decline rules. "STOP. Cancel all texts" matched
 *    `\bcancel\b` first, so the orchestrator CANCELLED the customer's booking
 *    and recorded no opt-out. A reply that revokes consent is honoured before
 *    anything else in it is acted on (47 CFR 64.1200(a)(10): any reasonable
 *    means; missing a real opt-out is the worse error).
 * 2. The #2587 visit carve-outs used `\s+`, which spans a newline, and carved
 *    out every "stop at" / "stop off" / "end of". "STOP" + a new line starting
 *    "In the future" no longer unsubscribed, nor did "Stop at once".
 *
 * A bare "Cancel" stays cancel-my-appointment on purpose (the design note for
 * the consent ledger, F5, leaves that to counsel).
 */
const MUST_UNSUBSCRIBE = [
  // an opt-out that also says cancel, yes or too expensive
  "STOP. Cancel all texts",
  "Unsubscribe me, cancel",
  "Stop texting me, too expensive",
  "Yes, stop texting me",
  // a keyword followed by a new line
  "STOP\nIn the future please call me instead",
  "Stop\nat least until next month",
  // keywords that only look like the visit carve-outs
  "Stop at once",
  "stop off my list",
  "End of discussion",
  "End of story, stop texting me",
  // plain-English revocations
  "cancel all texts",
  "cancel my texts",
  "Please cancel all text messages",
  "stop texting me",
  "please stop texting me",
  "Can you stop sending me messages",
  "no more texts",
  "No more messages please",
  "don't text me",
  "Dont text me anymore",
  "Don\u2019t text me",
  "do not contact me",
  "remove me from your list",
  "Please remove me from your list",
  "Take me off your list",
  "please unsubscribe me",
  "I want to opt out",
];

const MUST_NOT_UNSUBSCRIBE = [
  // visits (#2587 and the corpus research's own probes)
  "Stop by around 3?",
  "Stop by around 3 ok?",
  "can you stop by?",
  "stop in tomorrow",
  "Stop at 3pm ok?",
  "Stop at around noon",
  "stop off at the shop later",
  "stop off on my way",
  "End of the day works",
  "End of day works for me",
  "end up needing 2 tires",
  // appointment language
  "Cancel",
  "need to cancel",
  "please cancel my appointment",
  "Don't cancel my appointment",
  "what's your cancellation policy?",
  "remove me from tomorrow's appointment",
  "Remove me from my booking",
  "take me off the schedule",
  "take my number off the calendar",
  // explicit negation of a would-be opt-out
  "Don't stop texting me",
  "Never stop texting me",
  "I do not want to unsubscribe",
  "Please don't opt me out",
  "Do not remove me from your list",
  "Don't cancel all texts",
  // a spam footer is not the sender revoking anything
  "Win a gift card! Reply STOP to end",
  "Win a gift card! Reply STOP to unsubscribe",
  "Your code is 1234. Txt STOP to opt out",
];

describe("an opt-out is honoured before confirm, cancel or decline", () => {
  it.each(MUST_UNSUBSCRIBE)("%j unsubscribes", (msg) => {
    const r = parseSmsResponse(msg);
    expect(r.intent).toBe("unsubscribe");
    expect(r.autoAction).toBe("unsubscribe-customer");
    expect(r.extractedData?.message).toBe(msg.trim());
  });

  it.each(MUST_NOT_UNSUBSCRIBE)("%j does not unsubscribe", (msg) => {
    const r = parseSmsResponse(msg);
    expect(r.intent).not.toBe("unsubscribe");
    expect(r.autoAction).not.toBe("unsubscribe-customer");
  });

  it.each(["Cancel", "need to cancel", "please cancel my appointment"])(
    "%j is still cancel-my-appointment, not an opt-out",
    (msg) => {
      const r = parseSmsResponse(msg);
      expect(r.intent).toBe("cancel");
      expect(r.autoAction).toBe("cancel-appointment");
    },
  );

  it.each(["Stop by around 3?", "stop off at the shop later", "End of the day works"])(
    "%j goes to a person, never silently acted on",
    (msg) => {
      expect(parseSmsResponse(msg).requiresHuman).toBe(true);
    },
  );
});
