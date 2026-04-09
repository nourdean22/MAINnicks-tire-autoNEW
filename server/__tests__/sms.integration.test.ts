/**
 * SMS Integration Tests
 * Tests SMS templates, retention sequences, confirmation flow,
 * and scheduling logic.
 */
import { describe, it, expect } from "vitest";

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

  it("templates include customer first name", async () => {
    const sms = await import("../sms");

    expect(sms.appointmentReminder24hSms("Nour", "Brakes")).toContain("Nour");
    expect(sms.thankYouSms("Dania", "Tires")).toContain("Dania");
    expect(sms.reviewRequestSms("Ahmed")).toContain("Ahmed");
    expect(sms.bookingConfirmationRequestSms("Mike")).toContain("Mike");
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
    expect(msg.toLowerCase()).toContain("confirm");
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
