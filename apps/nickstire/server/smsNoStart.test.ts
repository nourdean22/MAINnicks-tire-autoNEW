/**
 * "My car won't start" must not be answered with "come on in".
 *
 * THE CROSS-CHANNEL CONTRADICTION
 * VOICE routes a no-start straight to its BROKEN-DOWN / TOWED flow — "won't
 * start" is the FIRST trigger in that list. SMS had no equivalent intent, so the
 * same words fell through to the `general` playbook, whose only approved fact is
 * FCFS_FACT ("The shop is first come, first served — walk-ins welcome, no
 * appointment needed") and whose required question asks whether they want to
 * know "when to come in".
 *
 * Telling someone whose car will not start to walk in is not just unhelpful —
 * they physically cannot comply, and it reads as not having listened. Identical
 * words, two channels, opposite answers.
 *
 * DESIGN UNDER TEST
 * A `no_start` intent mirroring the voice flow, whose plan asks the same
 * highest-value question the phone asks (WHERE IS THE CAR — it decides tow vs
 * jump) and which PROHIBITS the walk-in invitation rather than merely omitting
 * it. Omission is not enforcement: the drafter is a model, and `general` had
 * "walk-ins welcome" sitting in its approved facts.
 */
import { describe, expect, it } from "vitest";
import { routeInboundSms, type SmsRouterContext } from "./services/smsIntentRouter";
import { buildReplyPlan, planViolations, type PlannerContext } from "./services/smsReplyPlanner";

const noCtx: SmsRouterContext = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };
const withBooking: SmsRouterContext = { ...noCtx, hasActiveBooking: true };
const plannerCtx: PlannerContext = {
  customerFirstName: null,
  customerVehicle: null,
  activeBooking: null,
  activeEstimate: null,
  lastVapiSummary: null,
};

const plan = (body: string, ctx: SmsRouterContext = noCtx) =>
  buildReplyPlan(routeInboundSms(body, ctx), plannerCtx, body);

describe("no-start routing", () => {
  const phrases = [
    "my car won't start",
    "car wont start this morning",
    "it won't turn over",
    "my car is dead in the driveway",
    "it just clicks but won't start",
    "battery's dead, needs a jump",
    "truck doesn't start",
    // Review catch (P2): EXPANDED negations. People say "won't start" aloud and
    // type "does not start", so the voice-transcript self-audit could not have
    // surfaced these — only a reader thinking about typed English.
    "my car does not start",
    "it did not start this morning",
    "the van is not starting",
  ];

  for (const p of phrases) {
    it(`routes "${p}" to no_start`, () => {
      expect(routeInboundSms(p, noCtx).primary).toBe("no_start");
    });
  }

  it("an ACTIVE JOB still wins — 'my car' means the one in the shop", () => {
    // job_status is priority 2, no_start is 3, so an in-shop question is not
    // hijacked into a tow conversation.
    expect(routeInboundSms("is my car done yet", withBooking).primary).toBe("job_status");
  });

  it("does NOT fire on ordinary messages", () => {
    for (const p of [
      "how much to start a brake job",
      "what time do you open",
      "do you have 225/50R17",
      "how much is an oil change",
    ]) {
      expect(routeInboundSms(p, noCtx).primary, `false no_start: ${p}`).not.toBe("no_start");
    }
  });
});

describe("the no-start plan cannot invite the customer to drive in", () => {
  it("forbids the walk-in invitation", () => {
    const p = plan("my car won't start");
    expect(p.prohibited.map((c) => c.label)).toContain("come_in_when_undrivable");
  });

  for (const draft of [
    "No problem — pull up any time today and we'll take a look.",
    "Come on in, we're first come first served.",
    "Just bring the car in and we'll check it out.",
    "You can drive it over whenever.",
    "Swing by today and we'll get you taken care of.",
  ]) {
    it(`flags a draft that says: "${draft.slice(0, 40)}…"`, () => {
      expect(planViolations(plan("my car won't start"), draft)).toContain("come_in_when_undrivable");
    });
  }

  /**
   * Review catch (P1). The first version of CLAIM_COME_IN_UNDRIVABLE did not
   * contain the phrase "walk in" — while the plan hands the drafter FCFS_FACT
   * ("walk-ins welcome, no appointment needed"). The guard omitted the single
   * phrase the model was most likely to echo, because that phrase came from an
   * approved fact sitting in its own context.
   *
   * The verb must fire and the noun must not, so both directions are pinned.
   */
  it("flags the WALK IN invitation the model is most likely to echo", () => {
    for (const draft of [
      "Walk in anytime and we'll take a look.",
      "You can just walk in — no appointment needed.",
      "Walk on in whenever you're ready.",
    ]) {
      expect(planViolations(plan("my car won't start"), draft), `missed: ${draft}`)
        .toContain("come_in_when_undrivable");
    }
  });

  it("does NOT flag the neutral FCFS fact itself (walk-ins, the noun)", () => {
    for (const draft of [
      "No appointment needed — walk-ins welcome once it's here.",
      "We're first come, first served. Walk ins welcome any day we're open.",
    ]) {
      expect(planViolations(plan("my car won't start"), draft), `false positive: ${draft}`)
        .not.toContain("come_in_when_undrivable");
    }
  });

  it("ALLOWS the honest tow-aware reply", () => {
    const good =
      "Sounds like it needs a tow or a jump to get here. Where's the car right now — at home, at work, or roadside? Once it lands we'll look and put the price in writing first.";
    expect(planViolations(plan("my car won't start"), good)).toEqual([]);
  });

  it("still allows the address and the FCFS fact — a no-start customer needs both", () => {
    const good = "We're at 17625 Euclid Ave. No appointment needed once it's here — first come, first served.";
    expect(planViolations(plan("my car won't start"), good)).toEqual([]);
  });

  it("asks WHERE THE CAR IS — the same discriminator the phone asks", () => {
    const p = plan("my car won't start");
    expect(p.requiredQuestion).toMatch(/where'?s the car/i);
    expect(p.missingInformation.join(" ")).toMatch(/where the vehicle is/i);
  });

  /**
   * Caught by a self-audit against REAL customer speech, not by review. A live
   * caller said: "I need a tow. It's on a hundred twenty fifty Kinsman." The
   * first version of this playbook would have replied "Where's the car right
   * now?" — the identical repeat-question defect that had just been fixed on the
   * check-engine discriminator. Porting a question between channels without
   * porting its guard is evidently easy to do twice.
   */
  it("does NOT re-ask when the customer already gave the location", () => {
    for (const body of [
      "I need a tow. It's on 12050 Kinsman",
      "car won't start, it's at home in my driveway",
      "won't turn over — I'm at work",
      "it's dead on the side of the road",
      "needs a tow, I'm in the parking lot at the mall",
      "won't start, stuck on Euclid Ave",
    ]) {
      const p = plan(body);
      expect(p.requiredQuestion, `re-asked despite location: "${body}"`).toBeNull();
      expect(p.missingInformation).toEqual([]);
    }
  });

  it("STILL asks when no location is given (the guard is not a blanket off-switch)", () => {
    for (const body of ["my car won't start", "it just clicks", "battery is dead"]) {
      expect(plan(body).requiredQuestion, `failed to ask: "${body}"`).toMatch(/where'?s the car/i);
    }
  });

  it("does not promise a callback", () => {
    expect(planViolations(plan("my car won't start"), "Someone will call you back shortly."))
      .toContain("callback_promise");
  });
});

describe("the prohibition is not vacuous", () => {
  it("the same walk-in copy is FINE for an ordinary price question", () => {
    // If this fired everywhere it would be useless — the plan is what scopes it.
    const ordinary = plan("how much for used tires");
    expect(planViolations(ordinary, "Pull up and we'll check your size.")).toEqual([]);
  });
});
