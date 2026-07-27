/**
 * All three channels must know the same do-not-drive hazards.
 *
 * WHAT AN AUDIT OF THE THREE COPIES FOUND
 * `server/diagnose-safety.ts` is the most complete safety authority in the repo
 * — nine red-flag hazards, each with patterns and explicit guidance, running
 * before the AI call so a model outage cannot suppress a warning. It powers the
 * WEBSITE only. Voice and SMS each grew their own partial copy.
 *
 * Voice covered exactly ONE of the nine (flashing MIL, added the same day). The
 * concrete consequence, quoted from the prompt as it stood:
 *
 *   URGENCY LIBRARY:  "Coolant or antifreeze leak / overheating →
 *                      'engines don't survive overheating, even once'"
 *   FLOW 2 Beat 2:    the symptom's URGENCY line + "first-come first-served,
 *                      drop-off makes sense, line gets long mid-day."
 *
 * So a caller who said "my car's running hot" was told the engine may not
 * survive, and then invited to drive it across town. The same person TEXTING
 * got "stop driving, let it cool, arrange a tow"; on /diagnose they got "Pull
 * over and let it cool." Voice was the only channel that could turn a
 * thermostat into a warped head.
 *
 * SMS's tier-0 rule had the same class of hole from the other direction: its
 * pattern used `overheat` followed by \b, which cannot match "overheated" or
 * "overheats", and never mentioned coolant, radiator, running hot or a pegged
 * temp gauge.
 *
 * DESIGN UNDER TEST
 * SMS now UNIONS its own situational pattern with `detectRedFlags`, so coverage
 * can only increase. Voice cannot import code — it is a static prompt — so it
 * carries a `# DO NOT DRIVE IT` block instead, and THIS test holds voice to the
 * authority's list. `RED_FLAG_IDS` is read directly, so adding a hazard to
 * diagnose-safety.ts fails this test until voice covers it too. That is the
 * point: the divergence becomes impossible to ship quietly.
 */
import { describe, expect, it } from "vitest";
import { RED_FLAG_IDS, detectRedFlags } from "./diagnose-safety";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";
import { routeInboundSms } from "./services/smsIntentRouter";

/**
 * How each authority hazard must surface in the spoken prompt.
 *
 * Deliberately an EXPLICIT map rather than a fuzzy search: a new hazard added to
 * diagnose-safety.ts has no entry here, the coverage test below fails, and a
 * human has to decide how voice should say it. Silence is not an option.
 */
const NO_CTX = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };

const VOICE_COVERAGE: Record<string, RegExp> = {
  "brake-failure": /brakes to the floor or not stopping/i,
  "steering-loss": /steering loose or not responding/i,
  "flashing-mil": /FLASHING check-engine light/i,
  "oil-pressure": /oil-pressure light/i,
  overheating: /overheating \/ temp gauge in the red/i,
  "fire-smoke": /smoke or fire/i,
  "fuel-leak": /fuel smell or leak/i,
  "tire-failure": /bulging, shredded or cord-showing tire/i,
  "control-loss": /shaking so bad it'?s hard to control/i,
};

describe("voice knows every do-not-drive hazard the website does", () => {
  it("the coverage map accounts for EVERY authority hazard", () => {
    const unmapped = RED_FLAG_IDS.filter((id) => !(id in VOICE_COVERAGE));
    expect(
      unmapped,
      `diagnose-safety.ts gained hazard(s) with no voice coverage decided: ${unmapped.join(", ")}`,
    ).toEqual([]);
  });

  it("the map has no stale entries pointing at removed hazards", () => {
    const stale = Object.keys(VOICE_COVERAGE).filter((id) => !RED_FLAG_IDS.includes(id));
    expect(stale, `stale coverage entries: ${stale.join(", ")}`).toEqual([]);
  });

  for (const [id, re] of Object.entries(VOICE_COVERAGE)) {
    it(`prompt covers hazard: ${id}`, () => {
      expect(ASSISTANT_SYSTEM_PROMPT).toMatch(re);
    });
  }

  /**
   * The heading at line start — NOT the first occurrence of the phrase. The tow
   * flow REFERENCES "# DO NOT DRIVE IT" in its trigger list, and that reference
   * appears earlier in the prompt, so a plain indexOf reads the wrong span. The
   * first version of this test did exactly that and asserted against the
   * BROKEN-DOWN pitch.
   */
  const blockStart = (): number => {
    const m = /^# DO NOT DRIVE IT/m.exec(ASSISTANT_SYSTEM_PROMPT);
    expect(m, "# DO NOT DRIVE IT heading missing").toBeTruthy();
    return m!.index;
  };

  it("the block routes to the tow flow and forbids remote diagnosis", () => {
    const i = blockStart();
    const block = ASSISTANT_SYSTEM_PROMPT.slice(i, i + 900);
    expect(block).toMatch(/tow, not a drive/i);
    expect(block).toMatch(/BROKEN-DOWN/);
    expect(block).toMatch(/never name the cause/i);
    expect(block).toMatch(/911/);
  });

  it("the tow flow lists the block as a trigger, so the two are wired", () => {
    const i = ASSISTANT_SYSTEM_PROMPT.indexOf("Triggers: won't start");
    expect(i).toBeGreaterThan(-1);
    expect(ASSISTANT_SYSTEM_PROMPT.slice(i, i + 220)).toMatch(/DO NOT DRIVE IT/);
  });

  it("overheating no longer sits ONLY in the come-in-now urgency library", () => {
    // The original defect: the sole overheating line lived in URGENCY LIBRARY,
    // which FLOW 2 Beat 2 pairs with "first-come first-served, drop-off makes
    // sense" — an instruction to drive it in.
    const dnd = blockStart();
    const urg = ASSISTANT_SYSTEM_PROMPT.indexOf("# URGENCY LIBRARY");
    expect(urg).toBeGreaterThan(-1);
    // The override must be stated BEFORE the urgency library it overrides.
    expect(dnd).toBeLessThan(urg);
  });
});

describe("SMS routes every authority hazard to tier-0 safety", () => {
  /** Phrases a real customer texts, one per hazard, drawn from the patterns. */
  const PHRASES: Record<string, string> = {
    "brake-failure": "my brakes went to the floor and it wont stop",
    "steering-loss": "the steering wheel is loose and not responding",
    "flashing-mil": "my check engine light is flashing",
    "oil-pressure": "the oil pressure light came on",
    overheating: "car has been running hot all morning",
    "fire-smoke": "there is smoke pouring from the hood",
    "fuel-leak": "i smell gas and there is fuel leaking",
    "tire-failure": "my tire is bulging and i can see the cords",
    "control-loss": "it shakes so bad i can barely control it",
  };

  it("has a phrase for every authority hazard", () => {
    expect(RED_FLAG_IDS.filter((id) => !(id in PHRASES))).toEqual([]);
  });

  for (const [id, phrase] of Object.entries(PHRASES)) {
    it(`routes "${phrase.slice(0, 44)}…" to safety_urgent (${id})`, () => {
      const decision = routeInboundSms(phrase, NO_CTX);
      const intents = [decision.primary, ...(decision.secondary ?? [])];
      expect(intents, `hazard ${id} did not reach tier-0 safety`).toContain("safety_urgent");
    });
  }

  it("the previously-missed phrasings now route (the \\b-after-stem hole)", () => {
    for (const p of ["the car overheated yesterday", "it overheats every time", "coolant is pouring out"]) {
      const d = routeInboundSms(p, NO_CTX);
      expect([d.primary, ...(d.secondary ?? [])], `missed: ${p}`).toContain("safety_urgent");
    }
  });

  it("does NOT route ordinary non-hazard messages to safety", () => {
    for (const p of ["how much for an oil change", "do you have 225/65r17 in stock", "what time do you close"]) {
      const d = routeInboundSms(p, NO_CTX);
      expect([d.primary, ...(d.secondary ?? [])], `false safety route: ${p}`).not.toContain("safety_urgent");
    }
  });

  it("detectRedFlags itself still catches what the old SMS pattern missed", () => {
    // Pins the actual reason the union was needed, not just its effect.
    expect(detectRedFlags("the car overheated").length).toBeGreaterThan(0);
    expect(/\b(overheat|overheating)\b/i.test("the car overheated")).toBe(false);
  });
});
