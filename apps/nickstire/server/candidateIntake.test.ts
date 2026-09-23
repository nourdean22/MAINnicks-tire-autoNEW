/**
 * What happens after a /careers submission is saved (server/services/candidateIntake.ts).
 *
 * The defect this guards (measured 2026-09-22): candidates.submit saved the
 * row and alerted nobody. The operator asked on 2026-09-23 for an immediate
 * text to his own mobile from the store line plus an email, and for the
 * applicant acknowledgement to be on.
 *
 * The tests assert BEHAVIOUR on the send boundary (who receives what, through
 * which channel, under which declared intent) with the transports mocked —
 * never that a function "exists". Everything goes through runCandidateIntake,
 * the one entry point production calls; the message builders are private.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
const sendSms = vi.fn();
const markCandidateOwnerAlerted = vi.fn();

type Notify = { category: string; subject: string; body: string; overrideTo?: string[] };
const notifies = () => sendNotification.mock.calls.map((c) => c[0] as Notify);
const ownerEmail = () => notifies().find((n) => !n.overrideTo);
const ackEmail = () => notifies().find((n) => n.overrideTo);
const smsBody = () => String(sendSms.mock.calls[0]?.[1] ?? "");

vi.mock("./email-notify", () => ({ sendNotification: (...a: unknown[]) => sendNotification(...a) }));
vi.mock("./sms", () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }));
vi.mock("./db", () => ({ markCandidateOwnerAlerted: (...a: unknown[]) => markCandidateOwnerAlerted(...a) }));

import { runCandidateIntake, type IntakeCandidate } from "./services/candidateIntake";
import { OPERATOR_MOBILE_LAST10 } from "./services/nonCustomerFilter";

const base: IntakeCandidate = {
  id: 41,
  name: "Sam Wrench",
  phone: "(216) 555-0142",
  email: "sam@example.com",
  positionTitle: "Automotive Technician",
  experienceLevel: "senior",
  message: "8 years, mostly brakes and suspension",
  intent: "apply",
  moveReasons: null,
  refCode: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  priorIds: [],
};

const ENV_KEYS = ["CANDIDATE_OWNER_ALERT", "CANDIDATE_OWNER_SMS", "CANDIDATE_ACK_EMAIL", "CANDIDATE_ALERT_PHONE"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  sendNotification.mockReset().mockResolvedValue({ emailSent: true, pushSent: false, recipients: [], throttled: false });
  sendSms.mockReset().mockResolvedValue({ success: true });
  markCandidateOwnerAlerted.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("defaults (operator instruction 2026-09-23): email + text to the operator + applicant ack", () => {
  it("sends the owner email, the owner text and the applicant email", async () => {
    await runCandidateIntake(base);
    expect(ownerEmail()).toBeTruthy();
    expect(ackEmail()?.overrideTo).toEqual(["sam@example.com"]);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(markCandidateOwnerAlerted).toHaveBeenCalledWith(41);
  });

  it("owner email reaches the shop AND CEO inboxes; the applicant copy never pushes to the owner", async () => {
    // email-notify ROUTING_TABLE: high_value = shop + CEO + push; follow_up =
    // no default recipients, no push. "lead" would have reached the shop only.
    await runCandidateIntake(base);
    expect(ownerEmail()?.category).toBe("high_value");
    expect(ackEmail()?.category).toBe("follow_up");
  });

  it("texts the OPERATOR'S mobile from the store line with internal intent — never the applicant", async () => {
    await runCandidateIntake(base);
    const [to, , opts] = sendSms.mock.calls[0] as [string, string, { via: string; messageClass: string }];
    expect(to).toBe(`+1${OPERATOR_MOBILE_LAST10}`);
    expect(to).not.toContain("5550142");
    // Without messageClass "internal" sendSms's internal-line guard refuses an
    // automated send to this number (sendSmsInternalLineGuard.test.ts).
    expect(opts).toEqual({ via: "shop", messageClass: "internal" });
  });

  it("the applicant is never texted, whatever the intent", async () => {
    for (const intent of ["apply", "confidential", "shop_tour", "talent_network", "apprentice"] as const) {
      sendSms.mockClear();
      await runCandidateIntake({ ...base, intent });
      for (const call of sendSms.mock.calls) expect(call[0]).toBe(`+1${OPERATOR_MOBILE_LAST10}`);
    }
  });

  it("no email address means no applicant email, and the owner alerts still go", async () => {
    await runCandidateIntake({ ...base, email: null });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });
});

describe("each send has its own kill switch", () => {
  it("CANDIDATE_OWNER_ALERT=off stops only the owner email", async () => {
    process.env.CANDIDATE_OWNER_ALERT = "off";
    await runCandidateIntake(base);
    expect(ownerEmail()).toBeUndefined();
    expect(ackEmail()).toBeTruthy();
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("CANDIDATE_OWNER_SMS=off stops only the text", async () => {
    process.env.CANDIDATE_OWNER_SMS = "off";
    await runCandidateIntake(base);
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("CANDIDATE_ACK_EMAIL=off stops only the applicant email", async () => {
    process.env.CANDIDATE_ACK_EMAIL = "off";
    await runCandidateIntake(base);
    expect(ackEmail()).toBeUndefined();
    expect(ownerEmail()).toBeTruthy();
  });

  it("CANDIDATE_ALERT_PHONE overrides the destination; garbage disables rather than misroutes", async () => {
    process.env.CANDIDATE_ALERT_PHONE = "216-000-1234";
    await runCandidateIntake(base);
    expect(sendSms.mock.calls[0][0]).toBe("+12160001234");
    sendSms.mockClear();
    process.env.CANDIDATE_ALERT_PHONE = "not-a-phone";
    await runCandidateIntake(base);
    expect(sendSms).not.toHaveBeenCalled();
  });
});

describe("a failed send never throws out of intake (the application is already saved)", () => {
  it("swallows transport errors on every lane", async () => {
    sendNotification.mockRejectedValue(new Error("mail down"));
    sendSms.mockRejectedValue(new Error("gateway down"));
    await expect(runCandidateIntake(base)).resolves.toBeUndefined();
    expect(markCandidateOwnerAlerted).not.toHaveBeenCalled();
  });

  it("does not stamp ownerAlertedAt when the mailer did not send", async () => {
    sendNotification.mockResolvedValue({ emailSent: false, pushSent: false, recipients: [], throttled: false });
    await runCandidateIntake(base);
    expect(markCandidateOwnerAlerted).not.toHaveBeenCalled();
  });
});

describe("message content", () => {
  it("a confidential lead is flagged to contact discreetly in both the email and the text", async () => {
    await runCandidateIntake({ ...base, intent: "confidential", moveReasons: "no_flat_rate,schedule" });
    expect(ownerEmail()?.body).toMatch(/CONFIDENTIAL/);
    expect(ownerEmail()?.body).toMatch(/Would move for: Off flat rate, Better schedule/);
    expect(smsBody()).toMatch(/discreetly/);
  });

  it("a repeat applicant is called out; an unrunnable duplicate check says so instead of implying 'new'", async () => {
    await runCandidateIntake({ ...base, priorIds: [7, 3] });
    expect(ownerEmail()?.body).toMatch(/REPEAT: same phone as candidate #7, #3/);
    expect(smsBody()).toMatch(/REPEAT/);
    sendNotification.mockClear();
    await runCandidateIntake({ ...base, priorIds: null });
    expect(ownerEmail()?.body).toMatch(/Duplicate check: could not run/);
  });

  it("the applicant ack promises nothing the site does not already promise", async () => {
    await runCandidateIntake(base);
    const apply = ackEmail()!.body;
    expect(apply).toMatch(/within 48 hours/);
    expect(apply).toMatch(/don't add you to any mailing list/);
    sendNotification.mockClear();
    await runCandidateIntake({ ...base, intent: "confidential" });
    expect(ackEmail()!.body).toMatch(/won't contact your current shop/);
  });
});
