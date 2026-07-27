/**
 * A missed safety phrasing does not fall to something harmless. It falls to an
 * AUTO-SENDING PRICE TEMPLATE.
 *
 * `price_brakes`, `price_tires` and `diagnostic` are risk:"deterministic" with a
 * catalogEvent, so smsOrchestrator compiles the canned template and auto-sends
 * it — no drafter, no reply plan, no planViolations. Anything the safety layer
 * fails to catch therefore does not merely go unanswered; it gets answered with
 * a price menu.
 *
 * Measured against the real router on 2026-07-27, before this fix:
 *
 *   "i lost my brakes"                 -> price_brakes   (auto: price_question_brakes)
 *   "the brakes are not working"       -> price_brakes
 *   "my brakes are failing"            -> price_brakes
 *   "brakes are gone"                  -> price_brakes
 *   "blew a tire"                      -> price_tires
 *   "bubble in my tire"                -> price_tires
 *   "my tire is shredded"              -> price_tires
 *   "check engine light started blinking" -> diagnostic
 *   "check engine light keeps flashing"   -> diagnostic
 *
 * Someone reporting total brake loss received an automated brake price quote.
 *
 * THREE DISTINCT STRUCTURAL CAUSES, none of them a missing word:
 *   1. ADJACENCY  — `lost\s+brakes?` cannot cross a possessive ("lost MY brakes")
 *   2. AUXILIARY  — `light\s+(is\s+)?flashing` admits only "is", not
 *                   "started" / "keeps" / "went"
 *   3. WORD ORDER — `(tire)\s+(blew)` is noun-first and cannot see "blew a tire"
 *
 * This is the same family as the bulging-tire fix already recorded at
 * diagnose-safety.ts — that one was fixed for a single word, not for the class.
 * Hence the false-positive block below: widening safety patterns is only safe if
 * ordinary pricing questions still route to pricing.
 */
import { describe, expect, it } from "vitest";
import { routeInboundSms } from "./services/smsIntentRouter";
import { detectRedFlags } from "./diagnose-safety";

const CTX = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };
const route = (s: string) => routeInboundSms(s, CTX).primary;

describe("brake failure reaches the safety lane, not the price menu", () => {
  it.each([
    "i lost my brakes",
    "i lost all my brakes",
    "the brakes are not working",
    "my brakes are failing",
    "the brake is failing",
    "brakes are gone",
    "brakes are going out",
    "my brakes gave out",
    "my brakes went out",
  ])("%s", (text) => {
    expect(route(text)).toBe("safety_urgent");
    expect(detectRedFlags(text).length).toBeGreaterThan(0);
  });
});

describe("structural tire failure reaches the safety lane", () => {
  it.each([
    "blew a tire",
    "blew out my tire",
    "bubble in my tire",
    "bubble on the sidewall",
    "my tire is shredded",
    "my tire is bulging",
  ])("%s", (text) => {
    expect(route(text)).toBe("safety_urgent");
  });
});

describe("a flashing MIL survives an ordinary auxiliary verb", () => {
  it.each([
    "check engine light started blinking",
    "check engine light keeps flashing",
    "engine light went flashing",
    "check engine light is flashing",
  ])("%s", (text) => {
    expect(route(text)).toBe("safety_urgent");
  });
});

/**
 * The other half. Widening a safety pattern is only correct if it does not
 * swallow the ordinary questions that pay the bills — a price enquiry pushed
 * into `human_only` costs the shop a lead and the operator their attention.
 */
describe("ordinary questions still route to pricing, not safety", () => {
  it.each([
    ["how much for brakes", "price_brakes"],
    ["what does a brake job cost", "price_brakes"],
    ["do you sell tires", "price_tires"],
    ["price on a tire", "price_tires"],
  ])("%s -> %s", (text, expected) => {
    expect(route(text)).toBe(expected);
  });

  it("a brake LIGHT that is not working is not brake failure", () => {
    // The state pattern must not reach across the noun "light".
    expect(route("my brake light is not working")).not.toBe("safety_urgent");
  });

  it("reassurance phrasing is still excluded", () => {
    // "no brake NOISE" is the customer ruling the hazard OUT.
    expect(route("no brake noise at all")).not.toBe("safety_urgent");
    expect(route("brake noise, just want a routine check")).not.toBe("safety_urgent");
  });

  it("a steady check-engine light is not the flashing hazard", () => {
    expect(route("check engine light is on")).not.toBe("safety_urgent");
  });
});
