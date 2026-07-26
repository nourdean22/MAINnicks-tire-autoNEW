/**
 * Commitment detection + stop-selling, and the two discriminating questions.
 *
 * THE FAILURE THIS PREVENTS
 * "Okay I'm coming now" used to route by topic, so a customer who had already
 * said yes could receive a price menu, a qualifying question, or a benefit list.
 * Selling past commitment is the most expensive kind of not-listening, because
 * the sale was already won and the only remaining job was logistics.
 *
 * DESIGN UNDER TEST
 * Commitment is a MODIFIER (`plan.stopSelling`), not just an intent — "brakes are
 * grinding, on my way" still owes the brake answer, minus the pitch. Detection is
 * delegated to detectArrivalIntent so the reply path and the expected_arrival
 * write can never disagree about what counts as a commitment.
 *
 * Also pinned: the pitch prohibitions must NOT fire before commitment (financing
 * is a good answer to "do you finance?"), and the brake/CEL questions must not
 * re-ask something the customer already told us.
 */
import { describe, it, expect } from "vitest";
import { routeInboundSms } from "./services/smsIntentRouter";
import { buildReplyPlan, renderPlanPrompt, planViolations } from "./services/smsReplyPlanner";

const CTX = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };
const PCTX = {
  customerFirstName: null,
  customerVehicle: null,
  activeBooking: null,
  activeEstimate: null,
  lastVapiSummary: null,
};

const plan = (body: string, ctx = CTX) => buildReplyPlan(routeInboundSms(body, ctx), PCTX, body);

describe("commitment detection — real customer wording", () => {
  it.each([
    "Okay I'm coming now",
    "on my way",
    "omw",
    "I'll be there around 3",
    "heading over",
    "I'm dropping it off tomorrow",
    "gonna swing by today",
    "I'll bring the car in tomorrow",
  ])("treats %j as a commitment", (body) => {
    expect(plan(body).stopSelling).toBe(true);
  });

  it.each([
    "can i come today?", // a QUESTION about coming, not a commitment
    "do you have 225/50R17 used?",
    "how much for brakes?",
    "what time do you close",
    "I can't come today", // negation
    "I need to reschedule",
    // Permission questions. "can I drop off my car?" used to be recorded as a
    // real expected arrival (which then reconciled to a no_show and inflated the
    // metric) because the guard only covered the "can i come" phrasing.
    "can I drop off my car?",
    "could I bring it by tomorrow?",
    "do you allow drop off?",
  ])("does NOT treat %j as a commitment", (body) => {
    expect(plan(body).stopSelling).toBe(false);
  });

  it("still counts a commitment that happens to contain a later question", () => {
    // The permission guard is scoped to a modal sitting just before an arrival
    // verb, so an unrelated trailing question does not veto a real commitment.
    expect(plan("I'll be there at 3, can I pay by card?").stopSelling).toBe(true);
  });

  it("routes a bare commitment to arrival_committed", () => {
    expect(routeInboundSms("on my way", CTX).primary).toBe("arrival_committed");
  });

  it("keeps 'can I come today?' as a question intent, not a commitment", () => {
    // The distinction the whole feature rests on: one needs an answer, the other
    // needs logistics. detectArrivalIntent already excludes "can i come".
    const d = routeInboundSms("can i come today?", CTX);
    expect(d.primary).not.toBe("arrival_committed");
    expect(d.signals).not.toContain("arrival_committed");
  });
});

describe("stop-selling changes the plan, not just the prompt", () => {
  it("asks no question once the customer has committed", () => {
    // They are walking into a first-come-first-served shop; any remaining detail
    // is cheaper to collect at the counter than to trade another text for.
    expect(plan("I'm on my way").requiredQuestion).toBeNull();
  });

  it("still answers the substance when commitment rides along with a question", () => {
    // "brakes grinding + heading over" must not collapse to a bare address.
    const p = plan("brakes are grinding, heading over now");
    expect(p.stopSelling).toBe(true);
    expect(p.knownFacts.join(" ")).toMatch(/brake/i);
    expect(p.requiredQuestion).toBeNull(); // ...but no qualifying question
  });

  it("gives the committed customer the address and the FCFS truth", () => {
    const facts = plan("omw").knownFacts.join(" ");
    expect(facts).toMatch(/first come/i);
    expect(facts).toMatch(/17625 Euclid/i);
  });

  it("states the stop-selling contract positively in the drafter prompt", () => {
    // Positive contract in the prompt; regex validators do the enforcing. A
    // negative ban list would both lengthen the prompt and keep the banned
    // phrasing live in the model's context.
    const prompt = renderPlanPrompt(plan("on my way"));
    expect(prompt).toMatch(/ALREADY COMMITTED/);
    expect(prompt).not.toMatch(/ASK EXACTLY ONE QUESTION/);
  });

  it("keeps the reply budget tight for a pure commitment", () => {
    expect(plan("on my way").maxChars).toBeLessThanOrEqual(200);
  });
});

describe("planViolations blocks the pitch AFTER commitment only", () => {
  const PITCHES: Array<[string, string]> = [
    ["social proof", "Got it! We have 1,700+ reviews and 4.9 stars."],
    ["service list", "Got it. We also do tires, brakes and more."],
    ["financing", "Got it. We also offer financing if you need it."],
    ["benefit restatement", "Great choice! Free check plus a written quote."],
  ];

  it.each(PITCHES)("flags a %s pitch to a committed customer", (_label, draft) => {
    const violations = planViolations(plan("I'm on my way"), draft);
    expect(violations.some((v) => v.startsWith("pitch_after_commitment"))).toBe(true);
  });

  it("lets the honest logistics reply through untouched", () => {
    // The exact wording the feature exists to produce.
    const draft =
      "Got it — I've noted that you're heading over. We're at 17625 Euclid Ave, first come, first served.";
    expect(planViolations(plan("I'll be there around 3"), draft)).toEqual([]);
  });

  it("does NOT flag financing when the customer actually asked about financing", () => {
    // The prohibitions are commitment-scoped on purpose: this same sentence is a
    // correct answer earlier in the conversation.
    const p = plan("do you offer financing?");
    expect(p.stopSelling).toBe(false);
    expect(planViolations(p, "Financing is available, including options for limited credit.")).toEqual([]);
  });
});

describe("discriminating questions — one resolvable gap, not a dodge", () => {
  it("asks the brake symptom question instead of only 'free check'", () => {
    const p = plan("how much for brakes?");
    expect(p.requiredQuestion).toBe("Is it squeaking, grinding or shaking?");
    // The distinction must be present so "it depends" reads as expertise.
    expect(p.knownFacts.join(" ")).toMatch(/squeak/i);
    expect(p.knownFacts.join(" ")).toMatch(/rotor/i);
  });

  it("does NOT re-ask the symptom the customer already gave", () => {
    const p = plan("my brakes are grinding, how much?");
    expect(p.requiredQuestion).toBeNull();
    expect(p.missingInformation).toEqual([]);
  });

  it("asks solid-or-flashing for a check-engine light", () => {
    const p = plan("how much to scan my check engine light?");
    expect(p.requiredQuestion).toBe("Is the light solid or flashing?");
    expect(p.knownFacts.join(" ")).toMatch(/clearing a code does not fix/i);
  });

  it("does NOT re-ask when the customer already said it is flashing", () => {
    expect(plan("check engine light is flashing, can you scan it?").requiredQuestion).toBeNull();
  });

  it("never quotes a brake dollar amount in the approved facts", () => {
    // ROS-058: $149 brakes / $79 alignment existed nowhere in BUSINESS.
    expect(plan("how much for brakes?").knownFacts.join(" ")).not.toMatch(/\$\d/);
  });
});

describe("review #1099 P2 — an asked-for answer is not a pitch", () => {
  it("still allows financing when a COMMITTED customer asks about it", () => {
    // Suppressing the unprompted pitch must never suppress a direct answer.
    // Refusing to answer "do you take payments?" is a worse failure than the
    // pitch the prohibition exists to prevent.
    const p = plan("on my way, do you take payment plans?");
    expect(p.stopSelling).toBe(true);
    expect(planViolations(p, "Financing is available — ask at the counter when you get here.")).toEqual([]);
  });

  it("still blocks UNPROMPTED financing for a committed customer", () => {
    const p = plan("I'm on my way");
    expect(planViolations(p, "Got it. We also offer financing if you need it.")).toContain(
      "pitch_after_commitment:unprompted_financing",
    );
  });

  it("keeps the other pitch prohibitions active when financing was asked about", () => {
    const p = plan("omw, do you finance?");
    expect(planViolations(p, "Sure! Also we have 1,700+ reviews.")).toContain(
      "pitch_after_commitment:social_proof",
    );
  });
});

describe("router financing rule — the \b bug that hid the whole intent", () => {
  // `\b(financ|payment plan|...)\b` could not match "financing", "finance" or
  // "payment plans": a trailing \b needs a boundary right after "financ"/"plan",
  // which does not exist mid-word. Only the exact singular ever fired, so the
  // most common phrasing fell through to `general`.
  it.each([
    "do you offer financing?",
    "can I finance it",
    "do you take payment plans?",
    "payment plan",
    "no credit check?",
  ])("routes %j to the financing intent", (body) => {
    const d = routeInboundSms(body, CTX);
    expect([d.primary, ...d.secondary]).toContain("financing");
  });

  it("does not fire on unrelated words containing the letters", () => {
    const d = routeInboundSms("what are your hours?", CTX);
    expect([d.primary, ...d.secondary]).not.toContain("financing");
  });
});
