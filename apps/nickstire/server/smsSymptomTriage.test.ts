/**
 * Waves C and D — symptoms that reached `general`, and one that reached a human
 * it did not need.
 *
 * A coverage audit mapped every symptom each channel recognises. Voice names
 * coolant leaks, burning smells, wheel-bearing noise, transmission slip and
 * exhaust rattle in its URGENCY LIBRARY. SMS named NONE of them, so each landed
 * on `general`, whose only fact is "first-come first-served, walk-ins welcome"
 * — the shop's drop-in POLICY offered to someone describing a failing part.
 *
 * WHAT IS AND IS NOT HERE, AND WHY
 * `symptom_triage` sits at priority 8, BELOW every pricing rule (6-7).
 * `price_brakes` already owns squeaking/grinding/pulsating and has a working
 * playbook for them; a symptom rule that outranked it would have broken a good
 * path to fix a bad one. This catches only what nothing else claims.
 *
 * "hum" and "droning" are ABSENT on purpose. Across 2,100 production call
 * summaries they appear ZERO times — customers here do not use those words, and
 * a pattern for them would be a mechanism that can never fire. (Frequencies
 * that DID justify inclusion: exhaust/rattle 16, transmission 10, bearing 7.)
 *
 * Stall/died-while-driving goes to `no_start`, not to a red flag: the car is
 * already not driving, and the action — tow it in — is exactly what that
 * playbook delivers.
 */
import { describe, expect, it } from "vitest";
import { routeInboundSms } from "./services/smsIntentRouter";
import { buildReplyPlan } from "./services/smsReplyPlanner";

const CTX = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };
const route = (s: string) => routeInboundSms(s, CTX).primary;

describe("stalling and dying while driving get the tow playbook", () => {
  it.each([
    "it stalls while im driving",
    "car died while driving on the highway",
    "my car shuts off at red lights",
    "it cut out on the freeway",
    "it sputters and quits",
  ])("%s", (t) => expect(route(t)).toBe("no_start"));

  it("is NOT a do-not-drive red flag — the car is already not driving", () => {
    // applySafetyFloor would force "have it towed" onto someone whose only
    // problem is a rough idle.
    expect(route("it stalls at idle sometimes")).not.toBe("safety_urgent");
  });
});

describe("symptoms nothing else claimed now have a home", () => {
  it.each([
    "coolant leak",
    "i have an antifreeze leak",
    "i smell something burning",
    "there is a burning smell",
    "i think my wheel bearing is going out",
    "bad wheel bearing",
    "my transmission is slipping",
    "it wont shift into gear",
    "clunking noise over bumps",
    "my exhaust is loud",
  ])("%s", (t) => expect(route(t)).toBe("symptom_triage"));

  it("the reply refuses to diagnose over text and offers the free check", () => {
    const d = routeInboundSms("my transmission is slipping", CTX);
    const plan = buildReplyPlan(d, {} as never, "my transmission is slipping");
    const facts = plan.knownFacts.join(" ");
    expect(facts).toMatch(/cannot diagnose|free check/i);
    expect(facts).not.toMatch(/first-come|walk-in/i);
  });

  it("asks its ONE question only when the customer has not already said when", () => {
    // The repeat-question defect this arc has hit before comes from asking
    // unconditionally.
    const withCtx = "my transmission slips when driving on the highway";
    const without = "my transmission is slipping";
    const q = (b: string) => buildReplyPlan(routeInboundSms(b, CTX), {} as never, b).requiredQuestion;
    expect(q(withCtx)).toBeNull();
    expect(q(without)).toMatch(/when does it happen/i);
  });
});

describe("pricing rules still win — the new rule sits below them", () => {
  it.each([
    ["how much for brakes", "price_brakes"],
    ["my brakes are grinding", "price_brakes"],
    ["do you have a 225/50R17", "tire_inventory"],
    ["how much is an oil change", "price_oil"],
  ])("%s -> %s", (t, want) => expect(route(t)).toBe(want));
});

describe("exhaust smoke stops burning a human, real smoke still does not", () => {
  it.each([
    "white smoke from the tailpipe",
    "it smokes a little on a cold start",
  ])("%s is not an emergency", (t) => expect(route(t)).not.toBe("safety_urgent"));

  it.each([
    "my car is smoking",
    "smoke pouring from the hood",
    "the wheel is smoking",
  ])("%s IS still an emergency", (t) => expect(route(t)).toBe("safety_urgent"));
});
