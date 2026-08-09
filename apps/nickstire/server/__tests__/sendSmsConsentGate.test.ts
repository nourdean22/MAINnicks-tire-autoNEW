/**
 * The TCPA prior-express-written-consent gate at the sendSms chokepoint
 * (2026-08-09).
 *
 * The opt-out index answers "did they say STOP?". This gate answers the
 * question TCPA actually asks of a MARKETING text: can we show they agreed
 * to receive it? The ledger (audit_log `sms.opt_in`) was already being
 * WRITTEN by the booking form, the lead form and the START keyword — nothing
 * read it at send time until now.
 *
 * complianceLog is mocked so these tests pin what sendSms DOES with each
 * answer. What is asserted is the MECHANISM, not merely that a send happened:
 *   - marketing WITHOUT a consent row: shadow lets it fly, enforce refuses
 *   - marketing WITH a consent row: flies in both modes
 *   - an UNREADABLE ledger fails CLOSED under enforce (never "assume yes")
 *   - followup / confirmation / internal are never gated (no prior written
 *     consent is required for a reply to the customer's own message)
 *   - the delayed-queue drain (_forceImmediate) cannot launder a marketing
 *     message past the gate the way it bypasses the volume gates
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("../sms");

// Consent answers, swapped per test. Shape mirrors SmsConsentIndex.
type Index =
  | { ok: true; phones: Set<string>; stale: boolean }
  | { ok: false; reason: string };
let consentIndex: Index = { ok: true, phones: new Set<string>(), stale: false };

vi.mock("../services/complianceLog", () => ({
  getSmsOptInIndex: vi.fn(async () => consentIndex),
}));

// Volume gates open so the consent gate is the only thing under test.
vi.mock("../services/smsControl", () => ({
  getSmsPauseState: vi.fn(async () => ({ paused: false, readable: true })),
  checkGlobalDailyCap: vi.fn(async () => ({ allowed: true, count: 0, cap: 200, readable: true })),
  isPhoneHumanHeld: vi.fn(async () => false),
  SMS_GLOBAL_PAUSE_FLAG: "sms_global_pause",
}));

// Minimal DB: opt-out index loads empty; queueForLater's persist succeeds.
// `where` is BOTH awaitable and chainable — same shape as the sibling
// chokepoint suite in sendSmsControlGates.test.ts.
vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve([] as unknown[]), { limit: async () => [] }),
      }),
    }),
    insert: () => ({ values: () => ({ $returningId: async () => [{ id: 777 }] }) }),
    update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
    execute: async () => [[]],
  }),
  getOrCreateConversation: async () => ({ id: 1 }),
  addSmsMessage: async () => undefined,
}));

const mockTwilioCreate = vi.fn().mockResolvedValue({ sid: "SM_consent_test" });
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: mockTwilioCreate } }),
}));

const CONSENTED = "+12165550142";
const UNKNOWN_PHONE = "+12165550199";

const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
  "SHOP_SMS_GATEWAY_USERNAME", "SHOP_SMS_GATEWAY_PASSWORD", "SMS_KILL_SWITCH",
  "SMS_CONSENT_GATE",
] as const;
const ORIG: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  // Fixed weekday noon ET — inside the 8AM–8PM window, so quiet hours never
  // interfere with what these tests assert.
  vi.setSystemTime(new Date("2026-08-09T16:00:00.000Z"));
  consentIndex = { ok: true, phones: new Set([CONSENTED.slice(-10)]), stale: false };
  mockTwilioCreate.mockClear();
  // No gateway creds → not configured → legacy Twilio path completes sends.
  delete process.env.SHOP_SMS_GATEWAY_USERNAME;
  delete process.env.SHOP_SMS_GATEWAY_PASSWORD;
  delete process.env.SMS_KILL_SWITCH;
  delete process.env.SMS_CONSENT_GATE;
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "tok_test";
  process.env.TWILIO_PHONE_NUMBER = "+12165550100";
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of ENV_KEYS) {
    const v = ORIG[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("consent gate · shadow mode (the shipped default)", () => {
  it("lets an unconsented marketing send through — and counts it as a would-be refusal", async () => {
    const { sendSms, getSmsStats } = await import("../sms");
    const before = getSmsStats().consentGateShadowMisses;

    const res = await sendSms(UNKNOWN_PHONE, "Time for new tires?", { messageClass: "customer_marketing" });

    expect(res.success).toBe(true);
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    // The counter is the whole point of shadow mode: it is the number the
    // operator needs before arming. A pass-through that counts nothing would
    // look identical to a gate that never ran.
    expect(getSmsStats().consentGateShadowMisses).toBe(before + 1);
    expect(getSmsStats().blockedByConsent).toBe(0);
  });

  it("does not count a miss when consent IS on file", async () => {
    const { sendSms, getSmsStats } = await import("../sms");
    const before = getSmsStats().consentGateShadowMisses;

    await sendSms(CONSENTED, "Time for new tires?", { messageClass: "customer_marketing" });

    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    expect(getSmsStats().consentGateShadowMisses).toBe(before);
  });
});

describe("consent gate · enforce mode", () => {
  beforeEach(() => {
    process.env.SMS_CONSENT_GATE = "enforce";
  });

  it("REFUSES a marketing send with no consent record", async () => {
    const { sendSms, getSmsStats } = await import("../sms");
    const before = getSmsStats().blockedByConsent;

    const res = await sendSms(UNKNOWN_PHONE, "Time for new tires?", { messageClass: "customer_marketing" });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no sms consent on file/i);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
    expect(getSmsStats().blockedByConsent).toBe(before + 1);
  });

  it("ALLOWS a marketing send to a phone with a consent record", async () => {
    const { sendSms } = await import("../sms");
    const res = await sendSms(CONSENTED, "Time for new tires?", { messageClass: "customer_marketing" });
    expect(res.success).toBe(true);
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });

  it("FAILS CLOSED when the ledger is unreadable — an unknown answer is not a yes", async () => {
    consentIndex = { ok: false, reason: "database unavailable" };
    const { sendSms } = await import("../sms");

    const res = await sendSms(CONSENTED, "Time for new tires?", { messageClass: "customer_marketing" });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unreadable/i);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("is TERMINAL — withRetry must not spin on a consent refusal", async () => {
    const { sendSmsOrThrow, SmsSendError } = await import("../sms");
    await expect(
      sendSmsOrThrow(UNKNOWN_PHONE, "Time for new tires?", { messageClass: "customer_marketing" }),
    ).rejects.toSatisfy((e: unknown) => e instanceof SmsSendError && e.terminal === true);
  });

  it("the delayed-queue drain cannot launder a marketing send past the gate", async () => {
    // _forceImmediate exempts a replayed message from the VOLUME gates by
    // design. Consent is not a volume gate: a message queued before the gate
    // was armed must still be checked when it finally goes out.
    const { sendSms } = await import("../sms");
    const res = await sendSms(UNKNOWN_PHONE, "Time for new tires?", {
      messageClass: "customer_marketing",
      _forceImmediate: true,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no sms consent on file/i);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("customer_followup is NOT gated — a reply to the customer's own text needs no prior written consent", async () => {
    const { sendSms } = await import("../sms");
    const res = await sendSms(UNKNOWN_PHONE, "Answering your question", { messageClass: "customer_followup" });
    expect(res.success).toBe(true);
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });

  it("customer_confirmation is NOT gated — transactional confirmation of the customer's own action", async () => {
    const { sendSms } = await import("../sms");
    const res = await sendSms(UNKNOWN_PHONE, "You're booked for 2pm", { messageClass: "customer_confirmation" });
    expect(res.success).toBe(true);
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });

  it("internal staff alerts are NOT gated — an outage must not silence its own alarm", async () => {
    consentIndex = { ok: false, reason: "database unavailable" };
    const { sendSms } = await import("../sms");
    const res = await sendSms(UNKNOWN_PHONE, "Gateway offline", { messageClass: "internal" });
    expect(res.success).toBe(true);
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });
});
