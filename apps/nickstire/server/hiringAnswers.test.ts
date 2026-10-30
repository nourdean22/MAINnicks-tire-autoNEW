/**
 * 2026-10-30 · Nour: callers asking about jobs were reaching staff ("he got a
 * call about the job already"). The receptionist and the SMS bot answer a job
 * question themselves, from shared/jobOpenings.ts: the open roles, Monday open
 * interviews, and the text-to-apply token (the JOB-APPLY intake path from
 * PR 3367 is unchanged). No pay figures in voice: Critical Rule 1 allows only
 * the three anchor prices. Codex review round 1 (7 findings) is pinned below.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS } from "@shared/business";
import {
  OPEN_INTERVIEWS_LINE, OPEN_INTERVIEWS_SHORT, hiringCallerSection, hiringSmsReply, openJobOpenings, startsWithHiringToken,
} from "@shared/jobOpenings";
import { routeInboundSms, type SmsRouterContext } from "./services/smsIntentRouter";
import { getTemplateVariant } from "./services/smsMessageCatalog";
import { buildReplyPlan } from "./services/smsReplyPlanner";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";
import { sliceBlock } from "./testUtils/sourceBlock";

// The careers-candidate-intake format (PR 3367); a rename here must break this file.
const INTAKE_TOKEN = "JOB-APPLY";

const noCtx: SmsRouterContext = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };
const titles = openJobOpenings().map((j) => j.title);

describe("SMS: a job question gets the hiring answer", () => {
  it.each([
    "are you hiring?",
    "Are y'all hiring right now",
    "do you need a mechanic?",
    "I'm looking for a job",
    "how do I apply for the tire tech job",
    "when are the open interviews",
    "are you hiring tire techs?",
    "is the service advisor position still open?",
    // Codex P2: ordinary phrasings.
    "Do you have any job openings?",
    "Do you hire mechanics?",
    "Do you have open positions?",
  ])("%s", (body) => {
    const d = routeInboundSms(body, noCtx);
    expect(d.primary).toBe("job_inquiry");
    expect(d.secondary).toEqual([]);
    expect(d.catalogEvent).toBe("job_inquiry");
  });

  it.each([
    "how long will the brake job take?",
    "my car needs work",
    "can you do the job today",
    "how much for tires",
    "are you open today",
    // Manager review 2026-10-30: customer texts that use "job", "apply" or a role word.
    "can you apply the coupon to my brake job",
    "can I apply the discount to the tire job",
    "I need a job quoted for 4 tires",
    "do you need a tech to look at my car",
    "want a job estimate on brakes",
    "does the tech job include alignment",
    "is the mechanic job done yet",
  ])("control, not a job question: %s", (body) => {
    expect(routeInboundSms(body, noCtx).primary).not.toBe("job_inquiry");
  });

  it("Codex P2: a real second question survives (only words inside the hiring phrase are absorbed)", () => {
    const d = routeInboundSms("Are you hiring, and how much are brakes?", noCtx);
    expect(d.primary).toBe("job_inquiry");
    expect(d.secondary).toContain("price_brakes");
    expect(d.catalogEvent).toBeNull();
  });

  it("Codex P2: the multi-intent planner carries the hiring facts", () => {
    const body = "Are you hiring, and do you offer payment programs?";
    const plan = buildReplyPlan(routeInboundSms(body, noCtx), {
      customerFirstName: null, customerVehicle: null, activeBooking: null, activeEstimate: null, lastVapiSummary: null,
    }, body);
    const facts = plan.knownFacts.join(" ");
    expect(facts).toContain(OPEN_INTERVIEWS_SHORT.replace(/\.$/, ""));
    expect(facts).toContain("nickstire.org/careers");
    expect(facts).toContain(INTAKE_TOKEN);
  });

  it("the reply is built from the facts files and fits one text", () => {
    const { body } = getTemplateVariant("job_inquiry", {}, 0);
    for (const t of titles) expect(body).toContain(t);
    expect(body).toContain(OPEN_INTERVIEWS_SHORT.replace(/\.$/, ""));
    expect(body).toContain(INTAKE_TOKEN);
    expect(body).toContain(BUSINESS.phone.display);
    expect(body).toContain("nickstire.org/careers");
    expect(body).not.toMatch(/\$\d/);
    expect(body.length).toBeLessThanOrEqual(320);
  });

  it("Codex P1: the example is the bare token, never a role the sender did not ask about", () => {
    const { body } = getTemplateVariant("job_inquiry", {}, 0);
    const example = body.match(/"([^"]+)"/)?.[1] ?? "";
    expect(startsWithHiringToken(example)).toBe(true);
    expect(example).toBe(INTAKE_TOKEN);
  });

  it("Codex P2: with no open roles it says so instead of 'we're hiring'", () => {
    const reply = hiringSmsReply(BUSINESS.phone.display, []);
    expect(reply).not.toMatch(/we'?re hiring:/i);
    expect(reply).toMatch(/not hiring right now/i);
    expect(reply).toContain("nickstire.org/careers");
  });
});

describe("voice: the receptionist answers job questions instead of transferring", () => {
  const section = () => sliceBlock(ASSISTANT_SYSTEM_PROMPT, "## JOB / HIRING CALLER", "\n## ", { label: "ASSISTANT_SYSTEM_PROMPT" });

  it("has a hiring section built from the facts files", () => {
    const s = section();
    for (const t of titles) expect(s).toContain(t);
    // The short form: the full line's "a few minutes" breaks the prompt's
    // no-spoken-duration rule (vapi.prompt-durations.test.ts).
    expect(s).toContain(OPEN_INTERVIEWS_SHORT);
    expect(s).toMatch(/walk in with an ID/i);
    expect(s).not.toContain(OPEN_INTERVIEWS_LINE);
    expect(s).toContain(INTAKE_TOKEN);
    expect(s).toContain("nickstire.org/careers");
  });

  it("answers it, offers the text through sendConfirmationSms, and does not transfer unless asked", () => {
    const s = section();
    expect(s).toMatch(/one or two short sentences/i);
    expect(s).toContain("sendConfirmationSms");
    expect(s).toMatch(/not a transfer/i);
    expect(s).toMatch(/Rule 6/);
  });

  it("Codex P1: a caller who says no to the text gets no text (Rule 5 does not apply then)", () => {
    expect(section()).toMatch(/No → do NOT call sendConfirmationSms/);
  });

  it("Codex P1: escalate stays available when Rule 6 applies (closed hours, asked for a person)", () => {
    const s = section();
    expect(s).not.toMatch(/No bookSlot or escalate for a job question/);
    expect(s).toMatch(/escalate only when Rule 6 applies/i);
  });

  it("Codex P2: with no open roles the section says so instead of 'we're hiring'", () => {
    const s = hiringCallerSection(BUSINESS.phone.display, []);
    expect(s).not.toMatch(/We're hiring:/);
    expect(s).toMatch(/not hiring right now/i);
  });

  it("states no pay figure (Critical Rule 1: only the three anchor prices)", () => {
    expect(section()).not.toMatch(/\$\s?\d|\bdollars?\b|\/hr\b/i);
  });

  it("Rule 6's 'outside your tools' transfer no longer swallows a job question", () => {
    const rule6 = sliceBlock(ASSISTANT_SYSTEM_PROMPT, "6. TRANSFER on the caller", "\n# YOUR TOOLS", { label: "ASSISTANT_SYSTEM_PROMPT" });
    expect(rule6).toMatch(/job (question|inquiry)[^.]*JOB \/ HIRING CALLER/i);
  });
});
