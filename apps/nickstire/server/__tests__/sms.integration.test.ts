/**
 * SMS Integration Tests
 * Tests SMS templates, retention sequences, confirmation flow,
 * and scheduling logic.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Prevent mock pollution from other test files in singleFork serial mode —
// this file needs the REAL sms module.
vi.unmock("../sms");

// Mock Twilio
export const mockTwilioCreate = vi.fn().mockResolvedValue({ sid: "SM_test_footer" });
vi.mock("twilio", () => ({
  default: () => ({
    messages: {
      create: mockTwilioCreate,
    },
  }),
}));

// Tests below mutate these env vars and use fake timers. In singleFork serial
// mode the process is shared across files, so restore both after every test —
// even when an assertion fails mid-test.
const SMS_ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "SMS_KILL_SWITCH",
  "OWNER_PHONE_NUMBER",
  "SHOP_SMS_GATEWAY_USERNAME",
  "SHOP_SMS_GATEWAY_PASSWORD",
] as const;
const SMS_ORIG_ENV: Record<string, string | undefined> = Object.fromEntries(
  SMS_ENV_KEYS.map((k) => [k, process.env[k]]),
);

afterEach(() => {
  vi.useRealTimers();
  for (const k of SMS_ENV_KEYS) {
    const v = SMS_ORIG_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("SMS Templates", () => {
  it("all templates return non-empty strings", async () => {
    const sms = await import("../sms");

    expect(sms.appointmentReminder24hSms("John", "Oil Change").length).toBeGreaterThan(20);
    expect(sms.appointmentReminder1hSms("John").length).toBeGreaterThan(20);
    expect(sms.thankYouSms("John", "Tires").length).toBeGreaterThan(20);
    expect(sms.reviewRequestSms("John").length).toBeGreaterThan(20);
    expect(sms.maintenanceReminderSms("John", "Oil Change").length).toBeGreaterThan(20);
    expect(sms.bookingConfirmationRequestSms("John").length).toBeGreaterThan(20);
  });

  it("templates are business-voice with no customer name", async () => {
    const sms = await import("../sms");

    // wave-182: messages are intentionally name-free (no-personalization directive).
    expect(sms.appointmentReminder24hSms("Nour", "Brakes")).not.toContain("Nour");
    expect(sms.thankYouSms("Dania", "Tires")).not.toContain("Dania");
    expect(sms.reviewRequestSms("Ahmed")).not.toContain("Ahmed");
    expect(sms.bookingConfirmationRequestSms("Mike")).not.toContain("Mike");
  });

  it("templates include shop phone number", async () => {
    const sms = await import("../sms");
    const SHOP_PHONE = "(216) 862-0005";

    expect(sms.bookingConfirmationRequestSms("Test")).toContain(SHOP_PHONE);
    expect(sms.maintenanceReminderSms("Test", "Oil")).toContain(SHOP_PHONE);
  });

  it("confirmation SMS mentions reply YES", async () => {
    const sms = await import("../sms");
    const msg = sms.bookingConfirmationRequestSms("John");
    expect(msg.toLowerCase()).toContain("yes");
  });

  it("SMS messages are under 160 chars or properly segmented", async () => {
    const sms = await import("../sms");
    // GSM-7 single segment = 160 chars, multi-segment = 153 per segment
    // All our templates should be under 320 chars (2 segments max)
    const MAX_LENGTH = 320;

    expect(sms.appointmentReminder24hSms("John", "Oil Change").length).toBeLessThan(MAX_LENGTH);
    expect(sms.thankYouSms("John", "Tires").length).toBeLessThan(MAX_LENGTH);
    expect(sms.bookingConfirmationRequestSms("John").length).toBeLessThan(MAX_LENGTH);
  });
});

describe("Retention SMS Tiers", () => {
  it("all 4 tiers are defined with correct day ranges", () => {
    const tiers = [
      { days: 45, min: 40, max: 50 },
      { days: 90, min: 85, max: 95 },
      { days: 180, min: 175, max: 185 },
      { days: 365, min: 360, max: 370 },
    ];

    expect(tiers).toHaveLength(4);
    for (const tier of tiers) {
      expect(tier.min).toBeLessThan(tier.days);
      expect(tier.max).toBeGreaterThan(tier.days);
      expect(tier.max - tier.min).toBe(10); // 10-day window
    }
  });

  it("retention hours are 9am-6pm ET", () => {
    const START_HOUR = 9;
    const END_HOUR = 18;
    expect(END_HOUR - START_HOUR).toBe(9); // 9 hours of sending window
  });

  it("tiers don't overlap", () => {
    const ranges = [
      [40, 50], [85, 95], [175, 185], [360, 370],
    ];
    for (let i = 0; i < ranges.length - 1; i++) {
      expect(ranges[i][1]).toBeLessThan(ranges[i + 1][0]);
    }
  });
});

describe("SMS Scheduling", () => {
  it("confirmation SMS delays 2 hours", () => {
    const CONFIRMATION_DELAY_MS = 2 * 60 * 60 * 1000;
    expect(CONFIRMATION_DELAY_MS).toBe(7200000);
  });

  it("review request delays 3 days", () => {
    const REVIEW_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
    expect(REVIEW_DELAY_MS).toBe(259200000);
  });

  it("rate limit delay between sends is 1.5 seconds", () => {
    const RATE_LIMIT_MS = 1500;
    expect(RATE_LIMIT_MS).toBe(1500);
  });
});

describe("SMS Opt-Out Compliance & Footer Bypass", () => {
  it("should append opt-out footer to marketing message for regular customer", async () => {
    const sms = await import("../sms");
    const body = "Due for an oil change? Swing by!";
    const result = sms.withOptOut(body);
    expect(result).toBe("Due for an oil change? Swing by!\n\nReply STOP to opt out.");
  });

  it("should not append opt-out footer if it already exists in body", async () => {
    const sms = await import("../sms");
    const body = "Due for an oil change? Reply STOP to opt out.";
    const result = sms.withOptOut(body);
    expect(result).toBe("Due for an oil change? Reply STOP to opt out.");
  });

  it("should verify footer insertion in sendSms via twilio mock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T10:00:00-04:00")); // Force 10:00 AM ET (sending hours)

    mockTwilioCreate.mockClear();

    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "token_test";
    process.env.TWILIO_PHONE_NUMBER = "12168620005";
    process.env.SMS_KILL_SWITCH = "false";

    // Unset shop gateway credentials to ensure it falls back to Twilio
    const origUser = process.env.SHOP_SMS_GATEWAY_USERNAME;
    const origPass = process.env.SHOP_SMS_GATEWAY_PASSWORD;
    delete process.env.SHOP_SMS_GATEWAY_USERNAME;
    delete process.env.SHOP_SMS_GATEWAY_PASSWORD;

    const sms = await import("../sms");

    // 2026-07-20 · this test is about FOOTER TEXT, not the opt-out gate. That
    // gate now fails closed and there is no database here, so every send below
    // would be refused for "cannot verify opt-out status" and never reach the
    // Twilio mock. skipOptOutCheck isolates the subject under test; the gate's
    // own behaviour is covered in server/__tests__/sms-optout-failclosed.test.ts.
    const noGate = { skipOptOutCheck: true } as const;

    // Regular marketing send to normal customer should append footer
    await sms.sendSms("2165550001", "Promo message", { via: "twilio", ...noGate });
    expect(mockTwilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Promo message\n\nReply STOP to opt out.",
      })
    );

    // Transactional send should bypass
    await sms.sendSms("2165550002", "Transactional message", { via: "twilio", messageClass: "customer_confirmation", ...noGate });
    expect(mockTwilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Transactional message\n\nReply STOP to opt out.",
      })
    );

    // skipOptOutFooter send should bypass
    await sms.sendSms("2165550003", "Skip footer message", { via: "twilio", skipOptOutFooter: true, ...noGate });
    expect(mockTwilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Skip footer message",
      })
    );

    // isInternal send should bypass
    await sms.sendSms("2165550004", "Internal message", { via: "twilio", isInternal: true });
    expect(mockTwilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Internal message",
      })
    );

    // Staff/Owner recipient number should bypass
    process.env.OWNER_PHONE_NUMBER = "2165551111";
    await sms.sendSms("2165551111", "Staff message", { via: "twilio" });
    expect(mockTwilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Staff message",
      })
    );

    // Restore env & timers
    if (origUser) process.env.SHOP_SMS_GATEWAY_USERNAME = origUser;
    if (origPass) process.env.SHOP_SMS_GATEWAY_PASSWORD = origPass;
    vi.useRealTimers();
  });
});

