/**
 * Intent Router V2 — table-driven tests (ROS-058 follow-up).
 *
 * Every documented misroute of the keyword-includes chain appears here as a
 * regression case, alongside the preserved happy paths. The router is pure, so
 * these tests ARE the routing spec.
 */
import { describe, expect, it } from "vitest";
import { isCancellationPolicyQuestion, routeInboundSms, type SmsRouterContext } from "./services/smsIntentRouter";

const noCtx: SmsRouterContext = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };
const withBooking: SmsRouterContext = { ...noCtx, hasActiveBooking: true };
const withEstimate: SmsRouterContext = { ...noCtx, hasActiveEstimate: true };

describe("the documented misroutes are dead", () => {
  it("'What time will my car be done?' is job status, NOT store hours", () => {
    const d = routeInboundSms("What time will my car be done?", withBooking);
    expect(d.primary).toBe("job_status");
    expect(d.catalogEvent).toBeNull();
  });

  /**
   * 2026-07-27 · DELIBERATELY CHANGED. This previously asserted
   * `dashboard_light`. It now asserts tier-0 safety, and the reason matters.
   *
   * The original point of this case still stands and is preserved: an oil light
   * must never be answered with an oil-CHANGE price. But `dashboard_light` was
   * not a triage intent in practice — its playbook has
   * `requiredQuestion: () => null`, `missingInformation: () => []`, and
   * `nextStep: "Bring the car by for the free check."` It asked nothing and
   * invited the customer to DRIVE.
   *
   * `diagnose-safety.ts` classifies an oil-pressure light as a red flag whose
   * guidance is: "Shut the engine off now. Driving with no oil pressure destroys
   * the engine in minutes — this is a tow, not a drive." The website has said
   * that all along; SMS said "bring the car by."
   *
   * "Oil light" is genuinely ambiguous — pressure (red, critical) vs. change
   * reminder (yellow, routine). That ambiguity is an argument FOR the new route,
   * not against it: safety_urgent is `human_only`, so a person asks which light
   * it is. The costs are not symmetrical — a needless handoff costs minutes, a
   * missed oil-pressure light costs an engine.
   */
  it("'My oil light came on' escalates to safety, and is still NOT an oil-change price", () => {
    const d = routeInboundSms("My oil light came on", noCtx);
    expect(d.primary).toBe("safety_urgent");
    expect(d.risk).toBe("human_only");
    // The original invariant, still held: never answered with a price template.
    expect(d.catalogEvent).toBeNull();
  });

  it("a NON-hazard dashboard light still routes to dashboard_light triage", () => {
    // Guards against the safety union swallowing the whole dashboard_light
    // intent — only the hazards in diagnose-safety.ts may escalate.
    const d = routeInboundSms("my tire pressure light is on again", noCtx);
    expect(d.primary).toBe("dashboard_light");
  });

  it("'Tire pressure light keeps coming back' is triage, NOT tire pricing", () => {
    const d = routeInboundSms("Tire pressure light keeps coming back", noCtx);
    expect(d.primary).toBe("dashboard_light");
  });

  it("'Brakes still grind after the repair' is a comeback — human only, no price menu", () => {
    const d = routeInboundSms("Brakes still grind after the repair", noCtx);
    expect(d.primary).toBe("complaint_or_comeback");
    expect(d.risk).toBe("human_only");
    expect(d.catalogEvent).toBeNull();
  });

  it("'Can you hold the tire until the tow truck arrives?' is coordination, NOT a price", () => {
    const d = routeInboundSms("Can you hold the tire until the tow truck arrives?", noCtx);
    expect(d.primary).toBe("tire_inventory");
    expect(d.catalogEvent).toBeNull();
  });

  it("'What is your cancellation policy?' is a QUESTION, and the action guard sees it", () => {
    const d = routeInboundSms("What is your cancellation policy?", withBooking);
    expect(d.primary).toBe("cancellation_policy_question");
    expect(isCancellationPolicyQuestion("What is your cancellation policy?")).toBe(true);
    expect(isCancellationPolicyQuestion("cancel")).toBe(false);
    expect(isCancellationPolicyQuestion("need to cancel")).toBe(false);
  });
});

describe("multi-intent messages are not flattened", () => {
  it("'Do you have a 225/50R17 used tire and can I come today?' keeps both intents", () => {
    const d = routeInboundSms("Do you have a 225/50R17 used tire and can I come today?", noCtx);
    expect(d.primary).toBe("tire_inventory");
    expect(d.secondary).toContain("same_day_visit");
    expect(d.catalogEvent).toBeNull(); // a template cannot answer two questions
  });

  it("a message that is half price-question, half complaint is a complaint", () => {
    const d = routeInboundSms("how much for brakes? also the last repair made it worse than before", noCtx);
    expect(d.risk).toBe("human_only");
    expect(d.catalogEvent).toBeNull();
  });
});

describe("safety and human-request always route human_only", () => {
  for (const msg of [
    "the car is overheating and there's steam",
    "my brakes went out on the highway",
    "I'm stranded on euclid ave",
    "can I talk to a real person",
  ]) {
    it(`'${msg}' → human_only, no template`, () => {
      const d = routeInboundSms(msg, noCtx);
      expect(d.risk).toBe("human_only");
      expect(d.catalogEvent).toBeNull();
    });
  }
});

describe("state-aware routing", () => {
  it("estimate questions route as estimate_question only with an active estimate", () => {
    expect(routeInboundSms("why is the estimate so high?", withEstimate).primary).toBe("estimate_question");
    expect(routeInboundSms("why is the estimate so high?", noCtx).primary).not.toBe("estimate_question");
  });

  it("'how's my car' with an active booking is job status", () => {
    expect(routeInboundSms("how's my car", withBooking).primary).toBe("job_status");
  });
});

describe("the preserved happy paths still answer deterministically", () => {
  const cases: Array<[string, string, string]> = [
    ["what are your hours?", "hours_location", "hours_location"],
    ["where are you located", "hours_location", "hours_location"],
    ["how much is an oil change", "price_oil", "price_question_oil"],
    ["how much for used tires", "price_tires", "price_question_tires"],
    ["how much for brakes", "price_brakes", "price_question_brakes"],
    ["do you do alignment", "price_alignment", "price_question_alignment"],
    ["failed e-check", "diagnostic", "price_question_diagnostic"],
    ["can I come in today", "same_day_visit", "same_day_visit"],
    ["can I drop off my car", "drop_off", "drop_off"],
  ];
  for (const [msg, intent, catalogEvent] of cases) {
    it(`'${msg}' → ${intent} via template`, () => {
      const d = routeInboundSms(msg, noCtx);
      expect(d.primary).toBe(intent);
      expect(d.catalogEvent).toBe(catalogEvent);
      expect(d.risk).toBe("deterministic");
    });
  }

  it("word boundaries: 'sometimes it squeaks' does not route to hours", () => {
    expect(routeInboundSms("sometimes it squeaks when turning", noCtx).primary).not.toBe("hours_location");
  });

  it("unknown messages fall through to the drafter as general", () => {
    const d = routeInboundSms("hey quick question about my cousin's van", noCtx);
    expect(d.primary).toBe("general");
    expect(d.risk).toBe("human_assisted");
    expect(d.catalogEvent).toBeNull();
  });
});
