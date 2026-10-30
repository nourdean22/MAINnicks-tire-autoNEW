/**
 * W3 (job 2026-10-30-calls-texts-review): bounded catalog replies for the texts
 * the replay eval showed waiting on staff, and the staff-only texts that got a
 * template. Each case is a paraphrase of a real inbound text; none is a quote.
 */
import { describe, expect, it } from "vitest";
import { routeInboundSms, type SmsRouterContext } from "./services/smsIntentRouter";
import { TEMPLATE_VARIANTS } from "./services/smsMessageCatalog";
import { buildReplyPlan } from "./services/smsReplyPlanner";

const noCtx: SmsRouterContext = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };
const route = (b: string) => routeInboundSms(b, noCtx);
const planCtx = { customerFirstName: null, customerVehicle: null, activeBooking: null, activeEstimate: null, lastVapiSummary: null };

describe("alignment questions get the alignment answer, not an inspection pitch", () => {
  const asks = [
    "nothing is wrong with the car I just need an alignment",
    "the car is fine, I only need the alignment, I don't need anything extra",
    "when do you have time for a front alignment on a small sedan and how much",
  ];
  it.each(asks)("%s -> deterministic alignment template", (b) => {
    const d = route(b);
    expect(d.primary).toBe("price_alignment");
    expect(d.risk).toBe("deterministic");
    expect(d.catalogEvent).toBe("price_question_alignment");
  });

  it.each(["I just got new tires and want the alignment checked, how does that work", "just tires and a wheel alignment"])(
    "%s -> the multi-intent draft is grounded on the alignment answer, not an inspection pitch",
    (b) => {
      const d = route(b);
      expect(d.primary).toBe("price_alignment");
      const facts = buildReplyPlan(d, planCtx, b).knownFacts.join(" ");
      expect(facts).toMatch(/we do alignments/i);
      expect(facts).not.toMatch(/starts with an inspection|bring it in for the inspection/i);
    },
  );

  it("every variant names the alignment, says how to come in, and pitches no extra check or price", () => {
    for (const v of TEMPLATE_VARIANTS.price_question_alignment) {
      expect(v).toMatch(/\balignment/i);
      expect(v).toMatch(/(first come|walk[- ]?in|pull up|open)/i);
      expect(v).not.toMatch(/steering|suspension|inspection|what's behind it/i);
      expect(v).not.toMatch(/\$\d/);
    }
  });
});

describe("who-is-this texts get the shop's name and a question", () => {
  it.each(["who is this", "Who's this?", "I'm not familiar?", "Hello?", "hi", "Hey Nick"])("%s -> identity", (b) => {
    const d = route(b);
    expect(d.primary).toBe("identity");
    expect(d.risk).toBe("deterministic");
    expect(d.catalogEvent).toBe("identity");
  });
  it.each(["hey nick how much for brakes", "hello, do you have 225/65R17 tires", "who is open on sunday"])("%s is not identity", (b) => {
    expect(route(b).primary).not.toBe("identity");
  });
  it("every variant names the shop and asks what they need", () => {
    for (const v of TEMPLATE_VARIANTS.identity) {
      expect(v).toMatch(/nick'?s tire/i);
      expect(v).toMatch(/\?$/);
    }
  });
});

describe("a one-word answer to our menu question gets a follow-up question", () => {
  it.each(["Something else", "something else.", "Engine", "other"])("%s -> menu_reply", (b) => {
    const d = route(b);
    expect(d.primary).toBe("menu_reply");
    expect(d.risk).toBe("deterministic");
    expect(d.catalogEvent).toBe("menu_reply");
  });
  it.each(["engine light is on", "something else is wrong with my brakes"])("%s is not a menu reply", (b) => {
    expect(route(b).primary).not.toBe("menu_reply");
  });
  it("every variant asks what the car is doing", () => {
    for (const v of TEMPLATE_VARIANTS.menu_reply) expect(v).toMatch(/\?/);
  });
});

describe("comebacks and named repairs go to staff, never a free-check template", () => {
  it.each([
    "the steering wheel is still a little crooked",
    "you fixed my car last week and it's doing the same thing, stopped again, the starter",
    "everything is fine but an emissions light came on as I drove away, did you clear all the codes?",
    "the alignment is off again since you did it",
    // Codex review of #3417: prior-work language with no date or "still".
    "you did my alignment and now the wheel is crooked",
    "you replaced my tires and now it shakes",
  ])("%s -> complaint_or_comeback", (b) => {
    const d = route(b);
    expect(d.primary).toBe("complaint_or_comeback");
    expect(d.risk).toBe("human_only");
  });

  it("a dashboard light with a named repair is not the free-check template either (Codex review of #3417)", () => {
    const d = route("my check engine light is on and I think the starter is bad");
    expect(d.catalogEvent).toBeNull();
  });

  it("a named repair with several symptoms is not the diagnostic template", () => {
    const d = route("I think my truck needs a timing chain, it throws a code, rattles on the right side and hesitates");
    expect(d.primary).not.toBe("diagnostic");
    expect(d.catalogEvent).toBeNull();
  });

  it.each(["my check engine light is on, how much to scan it", "do you do diagnostics?"])("control: %s keeps the diagnostic template", (b) => {
    expect(route(b).catalogEvent).toBe("price_question_diagnostic");
  });
});
