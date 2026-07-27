/**
 * Nine hazards, one hardcoded line — and SMS never said 911.
 *
 * `detectRedFlags` returns per-hazard guidance. The SMS path consumed only
 * `.length > 0` (smsIntentRouter.ts:116) and threw the rest away, so every
 * emergency received the same sentence:
 *
 *   "If the vehicle is overheating, smoking, or unsafe: stop driving, let it
 *    cool, arrange a tow."
 *
 * For a FUEL LEAK that is wrong advice — the hazard is ignition, not heat.
 * For a FIRE it is dangerous: the rule's own text says get out and call 911.
 * Grepping the whole server for "911" returned exactly two hits,
 * diagnose-safety.ts and the voice prompt. Voice said it, /diagnose said it,
 * SMS said it NOWHERE.
 *
 * `body` was already a parameter of knownFacts. No plumbing was missing; the
 * facts were simply never asked for.
 */
import { describe, expect, it } from "vitest";
import { routeInboundSms } from "./services/smsIntentRouter";
import { buildReplyPlan } from "./services/smsReplyPlanner";

const CTX = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };
const facts = (body: string) => {
  const d = routeInboundSms(body, CTX);
  return { intent: d.primary, text: buildReplyPlan(d, {} as never, body).knownFacts.join(" | ") };
};

describe("each hazard gets ITS OWN guidance", () => {
  it("a fire tells the customer to call 911 — the word now reaches SMS at all", () => {
    const f = facts("my car is on fire");
    expect(f.intent).toBe("safety_urgent");
    expect(f.text).toContain("911");
  });

  it("a fuel leak says do not START it, never 'let it cool'", () => {
    // Heat is not the hazard here; ignition is. "Let it cool" invites the
    // customer to sit with a leaking fuel line.
    const f = facts("i smell gas and see a puddle");
    expect(f.text).toMatch(/start it/i);
    expect(f.text).toMatch(/away from the building|outside/i);
    expect(f.text).not.toMatch(/let it cool/i);
  });

  it("brake failure says have it TOWED, not let it cool", () => {
    const f = facts("my brakes went out");
    expect(f.text).toMatch(/tow/i);
    expect(f.text).not.toMatch(/let it cool/i);
  });

  it("overheating still says let it cool — the one case where that IS right", () => {
    expect(facts("the engine is overheating").text).toMatch(/cool/i);
  });
});

describe("an emergency crowds out everything else", () => {
  it("brake FAILURE carries no brake PRICING", () => {
    // "brakes" also matches price_brakes, so the fact union handed the drafter
    // a price playbook for someone who cannot stop the car — #1134's defect one
    // layer in.
    const f = facts("my brakes went out");
    expect(f.text).not.toMatch(/pricing|free check|quote/i);
  });

  it("the shop address still survives — the customer needs to know where to send it", () => {
    expect(facts("my brakes went out").text).toMatch(/Euclid/i);
  });
});

describe("the ordinary path is unchanged", () => {
  it("a plain brake price question still gets pricing facts", () => {
    const f = facts("how much for brakes");
    expect(f.intent).toBe("price_brakes");
    expect(f.text).toMatch(/free check|price|quote/i);
  });

  it("a safety match with no red flag still gets a sane fallback", () => {
    // The router's own regex is broader than RED_FLAG_RULES, so safety_urgent
    // can fire with zero flags. That must not produce an empty fact list.
    const d = routeInboundSms("i broke down on the side of the road", CTX);
    if (d.primary === "safety_urgent") {
      const text = buildReplyPlan(d, {} as never, "i broke down on the side of the road").knownFacts.join(" | ");
      expect(text.length).toBeGreaterThan(40);
      expect(text).toMatch(/tow|unsafe/i);
    }
  });
});
