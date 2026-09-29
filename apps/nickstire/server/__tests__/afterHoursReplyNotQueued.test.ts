/**
 * An after-hours auto-reply is never held for later (audit 2026-09-29).
 *
 * after_hours_capture says "We're closed right now and open again at
 * {nextOpen}". A web form submitted at 22:00 ET used to hit the 8AM-8PM
 * sending window, sit in the delayed queue, and drain at 08:00, when the shop
 * is open. The same happened behind a global pause or an offline shop gateway.
 * The option sendNowOrDrop makes sendSms refuse to queue such a text: it goes
 * out now, while the words are true, or not at all.
 *
 * Harness: sendSmsControlGates.test.ts (mocked smsControl + minimal DB, Twilio
 * mocked, fake timers). The drain is the REAL delayed-queue processor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("../sms");

let pauseState = { paused: false, readable: true } as { paused: boolean; readable: boolean };

vi.mock("../services/smsControl", () => ({
  getSmsPauseState: vi.fn(async () => pauseState),
  checkGlobalDailyCap: vi.fn(async () => ({ allowed: true, count: 0, cap: 200, readable: true })),
  isPhoneHumanHeld: vi.fn(async () => false),
  SMS_GLOBAL_PAUSE_FLAG: "sms_global_pause",
}));

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

const mockTwilioCreate = vi.fn().mockResolvedValue({ sid: "SM_after_hours" });
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: mockTwilioCreate } }),
}));

const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
  "SHOP_SMS_GATEWAY_USERNAME", "SHOP_SMS_GATEWAY_PASSWORD", "SMS_KILL_SWITCH",
] as const;
const ORIG: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

// Tuesday 2026-09-29, America/New_York (EDT, UTC-4).
const TUE_1900_ET = new Date("2026-09-29T23:00:00.000Z"); // closed, inside the sending window
const TUE_2200_ET = new Date("2026-09-30T02:00:00.000Z"); // closed, quiet hours
const WED_0800_ET = new Date("2026-09-30T12:00:00.000Z"); // open, quiet hours over

const PHONE = "+12165550177";
const AFTER_HOURS_BODY =
  "Thanks for reaching out to Nick's Tire & Auto. We're closed right now and open again at Wednesday 8 AM. Your request is saved for the crew.";
const AFTER_HOURS = { messageClass: "customer_marketing", sendNowOrDrop: true } as const;

const closedTextsSent = () =>
  mockTwilioCreate.mock.calls.filter(([arg]) => /closed right now/i.test(String((arg as { body?: string })?.body)));

/**
 * Run the real drain at 08:00 ET for five one-minute cycles. A queued row is
 * held until its DB id is stamped back, so it needs about three (measured).
 */
async function drainAtEightAm() {
  const { startDelayedQueueProcessor, stopDelayedQueueProcessor } = await import("../sms");
  vi.setSystemTime(WED_0800_ET);
  startDelayedQueueProcessor();
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  stopDelayedQueueProcessor();
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  pauseState = { paused: false, readable: true };
  mockTwilioCreate.mockClear();
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

describe("after-hours auto-reply · sent now or not at all", () => {
  it("at 22:00 ET it is not queued, and no 'closed right now' text goes out at 08:00 ET", async () => {
    vi.setSystemTime(TUE_2200_ET);
    const { sendSms, getSmsStats } = await import("../sms");
    const res = await sendSms(PHONE, AFTER_HOURS_BODY, AFTER_HOURS);
    expect(res.success).toBe(false);
    expect(res.notQueued).toBe(true);
    expect(res.queued).toBeUndefined();
    expect(getSmsStats().delayedQueueSize).toBe(0);

    await drainAtEightAm();
    expect(closedTextsSent()).toHaveLength(0);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("CONTROL: the same text WITHOUT the option is queued at 22:00 and delivered at 08:00 (the defect's mechanism)", async () => {
    vi.setSystemTime(TUE_2200_ET);
    const { sendSms } = await import("../sms");
    const res = await sendSms(PHONE, AFTER_HOURS_BODY, { messageClass: "customer_marketing" });
    expect(res.queued).toBe(true);
    expect(mockTwilioCreate).not.toHaveBeenCalled();

    await drainAtEightAm();
    expect(closedTextsSent()).toHaveLength(1);
  });

  it("is not held behind a global pause either", async () => {
    vi.setSystemTime(TUE_1900_ET);
    pauseState = { paused: true, readable: true };
    const { sendSms, getSmsStats } = await import("../sms");
    const res = await sendSms(PHONE, AFTER_HOURS_BODY, AFTER_HOURS);
    expect(res.success).toBe(false);
    expect(res.notQueued).toBe(true);
    expect(getSmsStats().delayedQueueSize).toBe(0);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL: at 19:00 ET (closed, inside the sending window) it goes out now, word for word", async () => {
    vi.setSystemTime(TUE_1900_ET);
    const { sendSms } = await import("../sms");
    const res = await sendSms(PHONE, AFTER_HOURS_BODY, AFTER_HOURS);
    expect(res.success).toBe(true);
    expect(res.queued).toBeUndefined();
    expect(res.notQueued).toBeUndefined();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    expect(String(mockTwilioCreate.mock.calls[0]![0].body)).toContain(AFTER_HOURS_BODY);
  });
});
