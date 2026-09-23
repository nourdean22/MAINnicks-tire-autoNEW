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

type Notify = { category: string; subject: string; body: string; html?: string; replyTo?: string; overrideTo?: string[] };
const notifies = () => sendNotification.mock.calls.map((c) => c[0] as Notify);
const ownerEmail = () => notifies().find((n) => !n.overrideTo);
const ackEmail = () => notifies().find((n) => n.overrideTo);
/** The applicant's copy specifically — a confidential owner email is addressed too. */
const applicantCopy = () => notifies().find((n) => n.overrideTo?.[0] === "sam@example.com");
const smsBody = () => String(sendSms.mock.calls[0]?.[1] ?? "");

vi.mock("./email-notify", () => ({ sendNotification: (...a: unknown[]) => sendNotification(...a) }));
vi.mock("./sms", () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }));
vi.mock("./db", () => ({ markCandidateOwnerAlerted: (...a: unknown[]) => markCandidateOwnerAlerted(...a) }));
// ENV is built once at import; read CEO_EMAIL live so a test can set it.
vi.mock("./_core/env", () => ({ ENV: { get ceoEmail() { return process.env.CEO_EMAIL ?? ""; } } }));

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
  recent: { last24h: 0, sameEmail24h: 0, samePhone24h: 0 },
};

const ENV_KEYS = ["CANDIDATE_OWNER_ALERT", "CANDIDATE_OWNER_SMS", "CANDIDATE_ACK_EMAIL", "CANDIDATE_ALERT_PHONE", "CEO_EMAIL"];
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

describe("confidential means owner-only (the form promises it)", () => {
  // Codex review on #2557: high_value routes to the SHOP inbox too, so an
  // employed tech's private inquiry reached a shared inbox.
  it("a confidential lead's email goes to the CEO inbox alone", async () => {
    process.env.CEO_EMAIL = "owner@example.com";
    await runCandidateIntake({ ...base, intent: "confidential" });
    const owner = notifies().find((n) => n.overrideTo?.[0] === "owner@example.com");
    expect(owner?.body).toMatch(/CONFIDENTIAL/);
    // every owner-alert email for this lead is addressed, none uses default routing
    expect(notifies().filter((n) => !n.overrideTo)).toHaveLength(0);
  });

  it("no CEO address configured -> no confidential email at all, but the owner text still fires", async () => {
    await runCandidateIntake({ ...base, intent: "confidential", email: null });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("a normal application still uses shop + CEO routing", async () => {
    process.env.CEO_EMAIL = "owner@example.com";
    await runCandidateIntake(base);
    expect(ownerEmail()?.category).toBe("high_value");
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

  it("stamps ownerAlertedAt when the TEXT lands even though the mailer did not send (email has been failing)", async () => {
    sendNotification.mockResolvedValue({ emailSent: false, pushSent: false, recipients: [], throttled: false });
    await runCandidateIntake(base);
    expect(markCandidateOwnerAlerted).toHaveBeenCalledWith(41);
  });

  it("does not stamp ownerAlertedAt when neither lane landed (text only queued, email not sent)", async () => {
    sendNotification.mockResolvedValue({ emailSent: false, pushSent: false, recipients: [], throttled: false });
    sendSms.mockResolvedValue({ success: true, queued: true });
    await runCandidateIntake(base);
    expect(markCandidateOwnerAlerted).not.toHaveBeenCalled();
  });
});

describe("message content", () => {
  it("a confidential lead is flagged to contact discreetly in both the email and the text", async () => {
    process.env.CEO_EMAIL = "owner@example.com";
    await runCandidateIntake({ ...base, intent: "confidential", moveReasons: "no_flat_rate,schedule" });
    const owner = notifies().find((n) => n.overrideTo?.[0] === "owner@example.com");
    expect(owner?.body).toMatch(/CONFIDENTIAL/);
    expect(owner?.body).toMatch(/Would move for: Off flat rate, Better schedule/);
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

  it("the owner text stays GSM-7 for every intent (one em dash would force UCS-2: 70 chars/segment, not 160)", async () => {
    // talent_network's label carries an em dash; the template once did too.
    for (const intent of ["apply", "confidential", "shop_tour", "talent_network", "apprentice"] as const) {
      sendSms.mockClear();
      await runCandidateIntake({ ...base, intent, refCode: "mike-snap-on", priorIds: [7] });
      expect(smsBody()).toMatch(/^[\n\x20-\x7E]+$/);
      if (intent === "talent_network") expect(smsBody()).toMatch(/not ready - keep me in mind/i);
    }
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

describe("audit fixes (2026-09-23)", () => {
  it("the owner text goes out BEFORE the owner email is attempted", async () => {
    const order: string[] = [];
    sendSms.mockImplementation(async () => (order.push("sms"), { success: true }));
    sendNotification.mockImplementation(async () => (order.push("email"), { emailSent: true, pushSent: false, recipients: [], throttled: false }));
    await runCandidateIntake(base);
    expect(order.slice(0, 2)).toEqual(["sms", "email"]);
  });

  it("a confidential text names nobody (it leaves from the store phone staff can read)", async () => {
    await runCandidateIntake({ ...base, intent: "confidential" });
    const text = smsBody();
    expect(text).toMatch(/PRIVATE CAREERS INQUIRY #41/);
    expect(text).not.toContain("Sam");
    expect(text).not.toContain("555-0142");
    expect(text).not.toMatch(/employed/i);
  });

  it("a confidential owner email sends no push (follow_up) and goes to the CEO inbox alone", async () => {
    process.env.CEO_EMAIL = "owner@example.com";
    await runCandidateIntake({ ...base, intent: "confidential" });
    const owner = notifies().find((n) => n.overrideTo?.[0] === "owner@example.com");
    expect(owner?.category).toBe("follow_up");
  });

  it("a confidential applicant's reply goes to the owner, not the shared shop inbox", async () => {
    process.env.CEO_EMAIL = "owner@example.com";
    await runCandidateIntake({ ...base, intent: "confidential" });
    expect(applicantCopy()?.replyTo).toBe("owner@example.com");
    sendNotification.mockClear();
    await runCandidateIntake(base);
    expect(applicantCopy()?.replyTo).toBeUndefined();
  });

  it("no applicant name in any owner subject (notifyOwner logs the title)", async () => {
    for (const intent of ["apply", "confidential", "shop_tour", "talent_network", "apprentice"] as const) {
      sendNotification.mockClear();
      process.env.CEO_EMAIL = "owner@example.com";
      await runCandidateIntake({ ...base, intent });
      for (const n of notifies().filter((x) => x.overrideTo?.[0] !== "sam@example.com")) {
        expect(n.subject).not.toContain("Sam");
        expect(n.subject).toContain("#41");
      }
    }
  });

  it("emails carry escaped HTML with the line breaks kept", async () => {
    await runCandidateIntake({ ...base, message: "Ask about <script>x</script>\nsecond line" });
    const html = ownerEmail()!.html!;
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toMatch(/<br>/);
    expect(ackEmail()!.html).toMatch(/<br>/);
  });

  it("a link typed as the name never reaches the owner's phone or email as a link", async () => {
    await runCandidateIntake({ ...base, name: "Win big https://evil.example/claim now" });
    expect(smsBody()).not.toMatch(/https?:|evil\.example/);
    expect(smsBody()).toContain("[link removed]");
    // (the email's own "Admin: https://nickstire.org/admin" line is ours)
    expect(ownerEmail()!.body).not.toContain("evil.example");
    expect(ownerEmail()!.body).toMatch(/Name: Win big \[link removed\] now/);
    sendSms.mockClear();
    await runCandidateIntake({ ...base, name: "Sam Wrench" });
    expect(smsBody()).toContain("Sam Wrench");
  });

  it("the acknowledgement greets by one plain word, never by free text", async () => {
    await runCandidateIntake({ ...base, name: "https://evil.example/win Smith" });
    expect(ackEmail()!.body).toMatch(/^Hi there,/);
    expect(ackEmail()!.body).not.toContain("evil");
    sendNotification.mockClear();
    await runCandidateIntake({ ...base, name: "José O'Neil" });
    expect(ackEmail()!.body).toMatch(/^Hi José,/);
  });

  describe("brakes (from the table, so a restart does not reset them)", () => {
    it("a same-phone repeat within 24h gets no second text; the email still goes", async () => {
      await runCandidateIntake({ ...base, recent: { last24h: 1, sameEmail24h: 0, samePhone24h: 1 } });
      expect(sendSms).not.toHaveBeenCalled();
      expect(ownerEmail()).toBeTruthy();
    });

    it("at 20 alerts in 24h the owner lanes stop (the row is still saved)", async () => {
      await runCandidateIntake({ ...base, recent: { last24h: 20, sameEmail24h: 0, samePhone24h: 0 } });
      expect(sendSms).not.toHaveBeenCalled();
      expect(ownerEmail()).toBeUndefined();
      sendSms.mockClear();
      await runCandidateIntake({ ...base, recent: { last24h: 19, sameEmail24h: 0, samePhone24h: 0 } });
      expect(sendSms).toHaveBeenCalledTimes(1);
    });

    it("one acknowledgement per address per day, and none past 30 a day", async () => {
      await runCandidateIntake({ ...base, recent: { last24h: 1, sameEmail24h: 1, samePhone24h: 0 } });
      expect(ackEmail()).toBeUndefined();
      sendNotification.mockClear();
      await runCandidateIntake({ ...base, recent: { last24h: 30, sameEmail24h: 0, samePhone24h: 0 } });
      expect(ackEmail()).toBeUndefined();
    });

    it("an uncountable budget still alerts the owner but sends no applicant email", async () => {
      await runCandidateIntake({ ...base, recent: null });
      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(ownerEmail()).toBeTruthy();
      expect(ackEmail()).toBeUndefined();
    });
  });
});
