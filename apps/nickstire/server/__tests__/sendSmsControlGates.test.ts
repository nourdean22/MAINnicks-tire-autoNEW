/**
 * The three SMS Revenue Agent OS gates at the sendSms chokepoint
 * (2026-07-29): global pause (hold-not-drop), shop-wide daily cap
 * (refuse), human takeover (suppress unless humanInitiated).
 *
 * smsControl is mocked — its own behavior is pinned in
 * server/smsControl.test.ts; HERE we pin what sendSms DOES with each
 * answer, per message class:
 *   - customer_marketing: pause holds; unreadable pause ALSO holds
 *   - customer_followup:  pause holds; unreadable pause flows (1:1 replies
 *     must not go silent on a DB blip)
 *   - customer_confirmation + internal: exempt from all three gates
 *   - humanInitiated: exempt from takeover only
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("../sms");

let pauseState = { paused: false, readable: true } as { paused: boolean; readable: boolean; reason?: string };
let capResult = { allowed: true, count: 0, cap: 200, readable: true };
let phoneHeld = false;

vi.mock("../services/smsControl", () => ({
  getSmsPauseState: vi.fn(async () => pauseState),
  checkGlobalDailyCap: vi.fn(async () => capResult),
  isPhoneHumanHeld: vi.fn(async () => phoneHeld),
  SMS_GLOBAL_PAUSE_FLAG: "sms_global_pause",
}));

// Minimal DB: opt-out index loads empty; queueForLater's persist succeeds.
// `where` is BOTH awaitable (ensureOptOutCache awaits it directly) and
// chainable (.limit — queueForLater's conversation lookup).
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

const mockTwilioCreate = vi.fn().mockResolvedValue({ sid: "SM_gates_test" });
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: mockTwilioCreate } }),
}));

const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
  "SHOP_SMS_GATEWAY_USERNAME", "SHOP_SMS_GATEWAY_PASSWORD", "SMS_KILL_SWITCH",
] as const;
const ORIG: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  // Fixed weekday noon ET — inside the 8AM–8PM window, so quiet hours never
  // interfere with what these tests assert.
  vi.setSystemTime(new Date("2026-07-29T16:00:00.000Z"));
  pauseState = { paused: false, readable: true };
  capResult = { allowed: true, count: 0, cap: 200, readable: true };
  phoneHeld = false;
  mockTwilioCreate.mockClear();
  // No gateway creds → not configured → legacy Twilio path completes sends.
  delete process.env.SHOP_SMS_GATEWAY_USERNAME;
  delete process.env.SHOP_SMS_GATEWAY_PASSWORD;
  delete process.env.SMS_KILL_SWITCH;
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

describe("global pause gate", () => {
  it("HOLDS (queues, does not drop) a marketing send while paused", async () => {
    pauseState = { paused: true, readable: true };
    const { sendSms } = await import("../sms");
    const res = await sendSms("+12165550199", "We still have your quote on file", { messageClass: "customer_marketing" });
    expect(res.success).toBe(true);
    expect(res.queued).toBe(true);
    expect(res.error).toMatch(/pause/i);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("HOLDS a followup send while paused (readable)", async () => {
    pauseState = { paused: true, readable: true };
    const { sendSms } = await import("../sms");
    const res = await sendSms("+12165550199", "Quick follow-up", { messageClass: "customer_followup" });
    expect(res.queued).toBe(true);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("UNREADABLE pause holds marketing (fail-closed) but lets followup flow (fail-open)", async () => {
    pauseState = { paused: false, readable: false, reason: "db down" };
    const { sendSms } = await import("../sms");

    const marketing = await sendSms("+12165550199", "Marketing ping", { messageClass: "customer_marketing" });
    expect(marketing.queued).toBe(true);
    expect(mockTwilioCreate).not.toHaveBeenCalled();

    const followup = await sendSms("+12165550198", "Answering your question", { messageClass: "customer_followup" });
    expect(followup.queued).toBeUndefined();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });

  it("customer_confirmation is exempt from the pause", async () => {
    pauseState = { paused: true, readable: true };
    const { sendSms } = await import("../sms");
    const res = await sendSms("+12165550199", "You're booked for 2pm", { messageClass: "customer_confirmation" });
    expect(res.queued).toBeUndefined();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });
});

describe("global daily cap gate", () => {
  it("REFUSES an automated send over the cap (no queue — a burst must not roll to tomorrow)", async () => {
    capResult = { allowed: false, count: 200, cap: 200, readable: true };
    const { sendSms } = await import("../sms");
    const res = await sendSms("+12165550199", "One more marketing text", { messageClass: "customer_followup" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/global daily sms cap/i);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("confirmations flow even over the cap", async () => {
    capResult = { allowed: false, count: 200, cap: 200, readable: true };
    const { sendSms } = await import("../sms");
    const res = await sendSms("+12165550199", "You're booked", { messageClass: "customer_confirmation" });
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });
});

describe("human takeover gate at the chokepoint", () => {
  it("SUPPRESSES an automated send to a human-held thread", async () => {
    phoneHeld = true;
    const { sendSms } = await import("../sms");
    const res = await sendSms("+12165550199", "Automated nudge", { messageClass: "customer_followup" });
    expect(res.success).toBe(false);
    expect(res.error).toBe("human_takeover_active");
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("humanInitiated (operator manual send / approved draft) is exempt — no self-deadlock", async () => {
    phoneHeld = true;
    const { sendSms } = await import("../sms");
    const res = await sendSms("+12165550199", "Operator's own reply", {
      messageClass: "customer_followup",
      humanInitiated: true,
    });
    expect(res.error).not.toBe("human_takeover_active");
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });

  it("confirmations are exempt from takeover suppression", async () => {
    phoneHeld = true;
    const { sendSms } = await import("../sms");
    const res = await sendSms("+12165550199", "You're booked", { messageClass: "customer_confirmation" });
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });
});
