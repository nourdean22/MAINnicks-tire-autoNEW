/**
 * The spoken do-not-call matcher is a compliance instrument in both
 * directions (audit-2026-09-29 F4b):
 *
 *   · a MISS leaves a person who revoked consent callable — 47 CFR
 *     64.1200(a)(10): consent may be revoked "by using any reasonable method to
 *     clearly express a desire not to receive further calls or text messages";
 *   · an OVER-MATCH silently drops a customer who asked for something else
 *     (their waitlist spot, their account's number) out of every reminder and
 *     confirmation call.
 *
 * Shape follows smsResponseParser.safety.test.ts: MUST and MUST-NOT lists. The
 * "was" column is what main (7cc3d809c) returned — the rows where it differs
 * were red before this change. Ambiguous rows resolve to "voice" (a wrong
 * voice suppression costs one call; a missed one is a TCPA violation), and are
 * marked AMBIGUOUS so the choice is visible.
 */
import { describe, expect, it } from "vitest";
import { isSpokenOptOut, spokenOptOutScope, type SpokenOptOutScope } from "./outboundCallCompliance";

type Row = readonly [utterance: string, scope: SpokenOptOutScope, note?: string];

/** MUST suppress, with this scope. */
const MUST: Row[] = [
  // under-matches on main (was: null)
  ["quit calling", "voice"],
  ["Quit calling me please.", "voice"],
  ["No more calls.", "voice"],
  ["no more phone calls please", "voice"],
  ["Can you stop with the calls?", "voice"],
  ["stop the calls", "voice"],
  ["enough with these robocalls", "voice"],
  ["I don't want any more calls.", "voice"],
  ["I dont want calls from you", "voice"],
  ["I don't want you calling me.", "voice"],
  ["I don't want you guys to call me", "voice"],
  ["I don't want to be called.", "voice"],
  ["Just take me off.", "voice", "AMBIGUOUS: no list named → calls only"],
  ["take me off please", "voice", "AMBIGUOUS"],
  ["Lose my number.", "all", "same breadth as the existing 'remove my number'"],
  ["delete my number", "all"],
  ["Don't ever call me again.", "voice"],
  ["please don't call anymore", "voice"],
  ["dont call here anymore", "voice"],
  ["stop ringing me", "voice"],
  ["leave me alone", "voice", "AMBIGUOUS"],
  ["add me to your dnc list", "voice"],
  ["Stop calling and texting me.", "all"],
  ["don't call or text me", "all"],
  ["I don't want you to text me", "all"],
  ["no more texts", "all"],
  ["I don't want to be contacted", "all"],
  ["no me llamen más", "voice"],
  ["deja de llamarme", "voice"],
  ["take me off the appointment and don't call me again", "voice", "the non-list target is dropped, the rest still counts"],
  ["opt me out of these calls", "voice"],
  ["unsubscribe me from the calls", "voice"],
  ["remove me from your calling list", "voice", "was 'all'"],
  ["opt out of the reminder calls", "voice"],
  // already caught on main — kept as regression rows
  ["Please stop calling me.", "voice"],
  ["stop calling", "voice"],
  ["Take me off your list", "all"],
  ["take me off the call list please", "voice"],
  ["Put me on your do not call list", "voice"],
  ["Don't call me again", "voice"],
  ["Don't call me back.", "voice", "AMBIGUOUS: could mean 'about this repair'"],
  ["never call this number again", "voice"],
  ["Remove my number", "all"],
  ["I want to opt out", "all"],
  ["Please stop texting me.", "all"],
  ["Don't contact me again.", "all"],
  ["Unsubscribe me.", "all"],
  ["opt out of everything", "all"],
  ["remove me from your system", "all"],
  ["You guys won't stop calling me!", "voice", "AMBIGUOUS: a complaint about us is a revocation"],
  ["Don't text me, call me instead.", "all", "KNOWN over-suppression: no SMS-only scope from voice (see PR)"],
];

/** MUST NOT suppress. */
const MUST_NOT: Array<readonly [utterance: string, why: string]> = [
  // over-matches on main (was: "all")
  ["remove my number from my old account and put my new one on", "account housekeeping"],
  ["Can you remove me from the waitlist and book me Thursday?", "waitlist, and they want a booking"],
  ["How do I opt out of the newsletter but keep my appointment reminders?", "email newsletter only; keeps reminders"],
  ["can I opt out of the tire protection plan", "a product, not contact"],
  ["how do I unsubscribe from the emails", "email, not calls or texts"],
  // over-matches on main (was: "voice") — new on inbound, where callers narrate
  ["You guys never call me back!", "a complaint that we DON'T call"],
  ["if you don't call me back I'm going somewhere else", "wants a call"],
  ["Don't call me sir, call me Pat.", "a form of address"],
  ["I do not call ahead, I just show up", "their own habit"],
  ["Okay sorry, I'll stop calling you guys so much.", "the caller promising to stop"],
  ["Did you lose my number?", "a question"],
  // would over-match the new arms without their guards
  ["Can you take me off hold?", "hold, not a list"],
  ["take me off speaker", "speaker, not a list"],
  ["take me off the schedule for Thursday", "a booking change"],
  ["Don't take me off the list, I like the reminders.", "negated"],
  ["okay I'll stop bothering you, thanks", "polite sign-off"],
  ["you don't need to call me back, I'll come in Saturday", "declines one callback, not all calls"],
  ["I don't need a call, I'll just come in", "declines one call"],
  // already clean on main — kept as regression rows
  ["Stop, stop — who is this?", "interruption"],
  ["Can you stop by the shop later?", "stop by"],
  ["yeah the brakes are good, thanks", "nothing"],
  ["call me back tomorrow", "wants a call"],
  ["I'll stop in on Saturday", "stop in"],
  ["Don't stop calling me.", "negated"],
  ["Never stop calling me.", "negated"],
  ["I do not want you to stop texting me.", "negated"],
  ["Do not opt me out.", "negated"],
  ["Don't unsubscribe me.", "negated"],
  ["I don't want to unsubscribe", "negated"],
];

describe("spoken do-not-call · MUST suppress", () => {
  it.each(MUST)("%j → %s", (u, scope) => {
    expect(spokenOptOutScope(u)).toBe(scope);
    expect(isSpokenOptOut(u)).toBe(true);
  });
});

describe("spoken do-not-call · MUST NOT suppress", () => {
  it.each(MUST_NOT)("%j (%s)", (u) => {
    expect(spokenOptOutScope(u)).toBeNull();
    expect(isSpokenOptOut(u)).toBe(false);
  });
});
