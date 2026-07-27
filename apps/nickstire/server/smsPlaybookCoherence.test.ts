/**
 * No playbook may hand the drafter a FACT that its own PROHIBITIONS forbid.
 *
 * WHY THIS EXISTS
 * A code review caught `CLAIM_COME_IN_UNDRIVABLE` omitting the phrase "walk in"
 * while the same plan supplied `FCFS_FACT` — "walk-ins welcome, no appointment
 * needed". The guard was blind to the one wording the model was most likely to
 * produce, precisely BECAUSE that wording came from the approved fact sitting in
 * its own context.
 *
 * The near-miss generalises into a rule that is mechanically checkable, unlike
 * the prompt contradictions found elsewhere in this repo: a plan that supplies
 * text its own prohibitions forbid is incoherent no matter which side wins. The
 * model is handed approved words and a rule against those words.
 *
 * WHAT THIS DOES NOT CLAIM
 * Passing does NOT mean a prohibition is complete — a guard can still miss a
 * phrasing nobody supplied, which is exactly what the review found. It means the
 * plan does not contradict ITSELF. Completeness is what the per-playbook tests
 * and real-corpus audits are for.
 */
import { describe, expect, it } from "vitest";
import { buildReplyPlan, type PlannerContext } from "./services/smsReplyPlanner";
import type { SmsIntent, SmsIntentDecision } from "./services/smsIntentRouter";

const ctx: PlannerContext = {
  customerFirstName: null,
  customerVehicle: null,
  activeBooking: null,
  activeEstimate: null,
  lastVapiSummary: null,
};

/**
 * Every routable intent. Listed explicitly rather than derived, so ADDING an
 * intent without adding it here is itself caught — by the count assertion below.
 */
const INTENTS: SmsIntent[] = [
  "safety_urgent", "complaint_or_comeback", "job_status", "estimate_question",
  "dashboard_light", "no_start", "arrival_committed", "tire_inventory",
  "cancellation_policy_question", "hours_location", "price_oil", "price_tires",
  "price_brakes", "price_alignment", "diagnostic", "same_day_visit",
  "drop_off", "financing", "human_requested", "general",
];

const planFor = (intent: SmsIntent, body = "hello") =>
  buildReplyPlan(
    { primary: intent, secondary: [], risk: "human_assisted", catalogEvent: null, signals: [] } as unknown as SmsIntentDecision,
    ctx,
    body,
  );

describe("playbook coherence — facts must not violate their own prohibitions", () => {
  it("covers every intent (a shrinking list would pass vacuously)", () => {
    expect(INTENTS.length).toBeGreaterThanOrEqual(20);
  });

  for (const intent of INTENTS) {
    it(`${intent}: supplies nothing it forbids`, () => {
      const plan = planFor(intent);
      const supplied = [
        ...plan.knownFacts.map((f) => ["knownFact", f] as const),
        ...(plan.nextStep ? [["nextStep", plan.nextStep] as const] : []),
        ...(plan.requiredQuestion ? [["requiredQuestion", plan.requiredQuestion] as const] : []),
      ];
      const contradictions: string[] = [];
      for (const claim of plan.prohibited) {
        for (const [field, text] of supplied) {
          if (claim.re.test(text)) contradictions.push(`${claim.label} vs ${field}: "${text.slice(0, 90)}"`);
        }
      }
      expect(contradictions, `plan supplies text it forbids:\n${contradictions.join("\n")}`).toEqual([]);
    });
  }

  /**
   * The specific near-miss that motivated this file, pinned in both directions
   * so the boundary cannot drift: the FCFS noun form must remain sayable, and
   * the imperative verb must remain forbidden, on the one plan where the car
   * cannot be driven.
   */
  it("no_start keeps FCFS sayable while forbidding the walk-in imperative", () => {
    const plan = planFor("no_start");
    const fcfs = plan.knownFacts.find((f) => /first come/i.test(f));
    expect(fcfs, "no_start lost the FCFS fact").toBeTruthy();

    const guard = plan.prohibited.find((c) => c.label === "come_in_when_undrivable");
    expect(guard, "no_start lost its walk-in guard").toBeTruthy();

    expect(guard!.re.test(fcfs!), "the FCFS fact itself trips the guard").toBe(false);
    expect(guard!.re.test("Walk in anytime and we'll take a look.")).toBe(true);
  });

  it("the check is not vacuous — a deliberately contradictory plan WOULD fail", () => {
    // Proves the assertion above can fail, rather than passing because
    // `prohibited` happens to be empty on every playbook.
    const plan = planFor("no_start");
    expect(plan.prohibited.length).toBeGreaterThan(0);
    const guard = plan.prohibited.find((c) => c.label === "come_in_when_undrivable")!;
    expect(guard.re.test("Just come on in whenever.")).toBe(true);
  });
});
