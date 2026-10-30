/**
 * 2026-10-30 · Nour: callers asking about jobs were reaching staff ("he got a
 * call about the job already"). The receptionist and the SMS bot answer a job
 * question themselves, from shared/jobOpenings.ts: the open roles, Monday open
 * interviews, and the text-to-apply token (the JOB-APPLY intake path from
 * PR 3367 is unchanged). No pay figures in voice: Critical Rule 1 allows only
 * the three anchor prices.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS } from "@shared/business";
import { HIRING_SMS_TOKEN, OPEN_INTERVIEWS_LINE, OPEN_INTERVIEWS_SHORT, openJobOpenings, startsWithHiringToken } from "@shared/jobOpenings";
import { routeInboundSms, type SmsRouterContext } from "./services/smsIntentRouter";
import { getTemplateVariant } from "./services/smsMessageCatalog";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";
import { sliceBlock } from "./testUtils/sourceBlock";

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
  ])("control, not a job question: %s", (body) => {
    expect(routeInboundSms(body, noCtx).primary).not.toBe("job_inquiry");
  });

  it("the reply is built from the facts files and fits one text", () => {
    const { body } = getTemplateVariant("job_inquiry", {}, 0);
    for (const t of titles) expect(body).toContain(t);
    expect(body).toContain(OPEN_INTERVIEWS_SHORT.replace(/\.$/, ""));
    expect(body).toContain(HIRING_SMS_TOKEN);
    expect(body).toContain(BUSINESS.phone.display);
    expect(body).toContain("nickstire.org/careers");
    expect(body).not.toMatch(/\$\d/);
    expect(body.length).toBeLessThanOrEqual(320);
  });

  it("the example it gives starts with the exact token the intake routes on", () => {
    const { body } = getTemplateVariant("job_inquiry", {}, 0);
    const example = body.match(/"([^"]+)"/)?.[1] ?? "";
    expect(startsWithHiringToken(example)).toBe(true);
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
    expect(s).toContain(HIRING_SMS_TOKEN);
    expect(s).toContain("nickstire.org/careers");
  });

  it("answers it, offers the text through sendConfirmationSms, and does not transfer unless asked", () => {
    const s = section();
    expect(s).toMatch(/one or two short sentences/i);
    expect(s).toContain("sendConfirmationSms");
    expect(s).toMatch(/not a transfer/i);
    expect(s).toMatch(/Rule 6/);
  });

  it("states no pay figure (Critical Rule 1: only the three anchor prices)", () => {
    expect(section()).not.toMatch(/\$\s?\d|\bdollars?\b|\/hr\b/i);
  });

  it("Rule 6's 'outside your tools' transfer no longer swallows a job question", () => {
    const rule6 = sliceBlock(ASSISTANT_SYSTEM_PROMPT, "6. TRANSFER on the caller", "\n# YOUR TOOLS", { label: "ASSISTANT_SYSTEM_PROMPT" });
    expect(rule6).toMatch(/job (question|inquiry)[^.]*JOB \/ HIRING CALLER/i);
  });
});
