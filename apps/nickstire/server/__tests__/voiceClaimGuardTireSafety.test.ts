/**
 * Tire-safety claim guard — the boundary between useful and dangerous.
 *
 * These claims differ in kind from the rest of the guard. A fabricated wait
 * time costs goodwill; a repairability verdict given over the phone can put an
 * unsafe tire back on a car. The line is not "what can we prove" but "what can
 * anyone determine without seeing the tire".
 *
 * EVERY TEST HERE RUNS IN BOTH DIRECTIONS. A detector that fires on everything
 * is as useless as one that fires on nothing, and this module's own header
 * records why: noise buries the claims that cost money. So each violating
 * phrase is paired with the CORRECT phrasing of the same thought, which must
 * stay clean.
 *
 * Sources for the boundaries (verified against primary documents 2026-09-18):
 *  · USTMA, Puncture Repair Procedures — demount for internal inspection;
 *    1/4in limit; no shoulder/sidewall repair; plug-only and on-the-wheel are
 *    "NOT ACCEPTABLE".
 *  · NHTSA — sets NO age interval; its words are "some vehicle and tire
 *    manufacturers recommend".
 *  · Subaru SB 03-75-15 — the only primary AWD drivetrain-damage warning, and
 *    its applicability is the 2015MY WRX STI.
 */
import { describe, expect, it } from "vitest";

import { voiceClaimViolations } from "../services/voiceClaimGuard";

/** The guard reads assistant turns, so every fixture is one. */
const turns = (...t: string[]) => t;

describe("phone repairability verdict", () => {
  it.each([
    "Yeah, we can patch that.",
    "Sure, we can plug it for you.",
    "We'll just plug that and you're good.",
    "That's definitely repairable.",
  ])("VIOLATION: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).toContain("phone_repairability_verdict");
  });

  it.each([
    "We'd need to get the tire off the wheel to see whether it can be repaired safely.",
    "If it's in the tread and under a quarter inch it's usually repairable, but we can't confirm until we look at it.",
    "Bring it by and we'll inspect the tire before we say either way.",
    "A puncture bigger than a quarter inch isn't repairable.",
  ])("CLEAN: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).not.toContain("phone_repairability_verdict");
  });
});

describe("improper repair offer", () => {
  it.each([
    "We can plug it right on the car.",
    "We'll patch that while it's still on the wheel.",
    "We can fix it on the rim, takes two minutes.",
  ])("VIOLATION: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).toContain("improper_tire_repair_offer");
  });

  it.each([
    "We take the tire off the wheel, inspect it inside, then patch and plug it properly.",
    "A plug on its own isn't an acceptable repair — it needs a patch on the inside too.",
  ])("CLEAN: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).not.toContain("improper_tire_repair_offer");
  });
});

describe("tire age safety verdict", () => {
  it.each([
    "Your tires are expired.",
    "Those are too old, they're unsafe.",
    "Your tires are illegal at that age.",
    "NHTSA says you have to replace tires after six years.",
    "NHTSA recommends replacing them at ten years.",
  ])("VIOLATION: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).toContain("tire_age_safety_verdict");
  });

  it.each([
    "Some vehicle and tire manufacturers recommend replacing tires that are six to ten years old, regardless of tread.",
    "The last four digits of the DOT code give the week and year — 0308 is the third week of 2008.",
    "Once tires pass five years most manufacturers want them looked at annually.",
  ])("CLEAN: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).not.toContain("tire_age_safety_verdict");
  });

  it("the misattribution is the specific thing caught", () => {
    // NHTSA sets no interval. Attributing one to the regulator is the clearest
    // instance of borrowed authority in this domain.
    expect(voiceClaimViolations(turns("NHTSA says six years."))).toContain("tire_age_safety_verdict");
    expect(
      voiceClaimViolations(turns("Some manufacturers recommend six years.")),
    ).not.toContain("tire_age_safety_verdict");
  });
});

describe("AWD absolute claim", () => {
  it.each([
    "One new tire will destroy your differential.",
    "That would ruin your drivetrain.",
    "You have to replace all four.",
  ])("VIOLATION: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).toContain("awd_absolute_claim");
  });

  it.each([
    "All-wheel-drive vehicles can have matching requirements, so we'd check what yours calls for before promising a single tire.",
    "You have to replace all four if your vehicle's manufacturer requires matched tread.",
    "On some all-wheel-drive vehicles the manufacturer wants all four matched.",
  ])("CLEAN: %s", (t) => {
    expect(voiceClaimViolations(turns(t))).not.toContain("awd_absolute_claim");
  });
});

describe("the guard as a whole", () => {
  it("a fully correct tire-safety answer produces NO violations at all", () => {
    // The positive control that matters: if the compliant script still trips
    // something, the guard is unusable and staff will route around it.
    const good = turns(
      "Thanks for calling Nick's Tire and Auto.",
      "We'd need to take the tire off the wheel and inspect it from the inside before we can say whether it's repairable.",
      "If the puncture is in the shoulder or the sidewall it can't be repaired at all.",
      "Some vehicle and tire manufacturers recommend replacing tires at six to ten years regardless of tread.",
      "All-wheel-drive vehicles can have matching requirements, so we'd check what yours calls for.",
    );
    expect(voiceClaimViolations(good)).toEqual([]);
  });

  it("a single bad turn inside a good call is still caught", () => {
    const mixed = turns(
      "Thanks for calling Nick's Tire and Auto.",
      "Yeah, we can patch that.",
      "We're at 17625 Euclid Ave.",
    );
    expect(voiceClaimViolations(mixed)).toContain("phone_repairability_verdict");
  });

  it("CANARY: the guard is not simply flagging everything", () => {
    // Without this, a regex accidentally matching all text would satisfy every
    // VIOLATION case above and look like a working guard.
    expect(voiceClaimViolations(turns("Thanks for calling. What can I do for you?"))).toEqual([]);
    expect(voiceClaimViolations(turns("We're open till six today."))).toEqual([]);
  });
});
