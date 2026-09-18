/**
 * Repair-intake claim guard — the other half of the phone traffic.
 *
 * The tire-safety block covers the product the shop is named for. This covers
 * every call that opens with a symptom: a noise, a pull, a light, a smell. The
 * assistant has not heard the noise and has not seen the car, so it cannot name
 * the part and cannot say whether the car is safe to drive.
 *
 * No primary document is cited here, and that is deliberate — unlike the tire
 * claims, the boundary is not regulatory. It is epistemic. Nobody can diagnose
 * a vehicle over a telephone, so no source is needed to establish that our
 * assistant cannot either.
 *
 * EVERY TEST RUNS IN BOTH DIRECTIONS, same as the tire suite. Each violating
 * phrase is paired with the CORRECT phrasing of the same thought, which must
 * stay clean. A guard that flags the compliant script is a guard staff route
 * around, and then it protects nobody.
 */
import { describe, expect, it } from "vitest";

import { voiceClaimViolations } from "../services/voiceClaimGuard";

/** The guard reads assistant turns, so every fixture is one. */
const turns = (...t: string[]) => t;

describe("naming the failed part from a description", () => {
  it.each([
    "That's your wheel bearing.",
    "It's the alternator.",
    "That's a bad wheel hub.",
    "You need new brake pads.",
    "You need a water pump.",
    "Your alternator is shot.",
    "Your brake pads are worn out.",
    "It's your catalytic converter.",
  ])("VIOLATION: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).toContain("phone_diagnosis_verdict");
  });

  it.each([
    // The hedge allowance is implemented by having no adverb slot in the
    // pattern, so these stay clean without a second allowlist to maintain.
    "It's probably the alternator, but we'd need to test it.",
    "It's usually the brake pads when it squeals like that.",
    "That could be a bearing, a heat shield, or the brakes - we'd have to drive it.",
    "A grinding noise when you brake might mean the pads are down to the backing.",
    "You might need brake pads, but we won't know until we pull the wheel.",
    "Bring it in and we'll put it on the lift and tell you what it actually is.",
    "If it turns out to be a wheel bearing, that's a bigger job than pads.",
  ])("CLEAN: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).not.toContain("phone_diagnosis_verdict");
  });
});

describe("telling a caller whether the car is safe to drive", () => {
  it.each([
    "You're fine to drive it.",
    "It's safe to drive.",
    "You'll be fine to drive on it.",
    "You can definitely make it here.",
    "You can drive on it, no problem.",
    "It's not safe to drive.",
  ])("VIOLATION: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).toContain("drivability_safety_verdict");
  });

  it.each([
    // These are the phrasings the lookbehinds exist to protect. Each one
    // CONTAINS the literal verdict and is nonetheless correct behaviour.
    "We can't tell you whether it's safe to drive without seeing it.",
    "I can't say whether it's safe to drive - that's not something we can judge over the phone.",
    "If it's safe to drive, bring it by and we'll look at it.",
    "If it feels unsafe, don't drive it - call a tow and we'll take it from there.",
    "You're the one who can feel the car, so trust that over anything I could guess at.",
  ])("CLEAN: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).not.toContain("drivability_safety_verdict");
  });
});

describe("the repair-intake guard as a whole", () => {
  it("a fully correct repair-intake answer produces NO violations at all", () => {
    // The positive control that matters. If the compliant script trips
    // anything, the guard is unusable in practice.
    const good = turns(
      "Thanks for calling Nick's Tire and Auto.",
      "A grinding noise when you brake can be a few different things, so I don't want to guess at it.",
      "We'd put it on the lift and pull a wheel before telling you what it is.",
      "I can't say whether it's safe to drive without seeing it - if it feels wrong, don't drive it.",
      "We're at 17625 Euclid Ave and we're open till six today.",
    );
    expect(voiceClaimViolations(good)).toEqual([]);
  });

  it("a single bad turn inside a good call is still caught", () => {
    const mixed = turns(
      "Thanks for calling Nick's Tire and Auto.",
      "That's your wheel bearing.",
      "We're at 17625 Euclid Ave.",
    );
    expect(voiceClaimViolations(mixed)).toContain("phone_diagnosis_verdict");
  });

  it("both repair-intake claims can fire on one call, and stay distinct", () => {
    // They are separate decisions with separate consequences: a wrong part name
    // costs money, a wrong drivability call costs more than that. Merging them
    // into one label would hide which happened.
    const bad = turns("It's the wheel bearing, but you're fine to drive it over.");
    const found = voiceClaimViolations(bad);
    expect(found).toContain("phone_diagnosis_verdict");
    expect(found).toContain("drivability_safety_verdict");
  });

  it("CANARY: the guard is not simply flagging everything", () => {
    // Without this, a regex accidentally matching all text would satisfy every
    // VIOLATION case above and look like a working guard.
    expect(voiceClaimViolations(turns("Thanks for calling. What can I do for you?"))).toEqual([]);
    expect(voiceClaimViolations(turns("We're open till six today."))).toEqual([]);
    expect(voiceClaimViolations(turns("Can I get your name and the year of the car?"))).toEqual([]);
  });

  it("CANARY: the existing claim classes are untouched by these additions", () => {
    // Adding patterns to a shared list can shadow earlier ones. This pins that
    // a tire claim still reports as a tire claim and nothing else.
    expect(voiceClaimViolations(turns("Yeah, we can patch that."))).toEqual([
      "phone_repairability_verdict",
    ]);
  });
});
