/**
 * SMS Integration Tests
 * Tests the Twilio SMS module: message templates, phone normalization, and send flow
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the pure functions directly by importing the module
// The actual Twilio client is only created at runtime when sendSms is called

describe("SMS Module", () => {
  describe("Phone Number Normalization", () => {
    // Import the normalizePhone function
    let normalizePhone: (phone: string) => string | null;

    beforeEach(async () => {
      const mod = await import("./sms");
      normalizePhone = (mod as any).normalizePhone;
    });

    it("normalizes 10-digit US number", () => {
      expect(normalizePhone("2168620005")).toBe("+12168620005");
    });

    it("normalizes formatted US number with parens", () => {
      expect(normalizePhone("(216) 862-0005")).toBe("+12168620005");
    });

    it("normalizes dashed US number", () => {
      expect(normalizePhone("216-862-0005")).toBe("+12168620005");
    });

    it("normalizes 11-digit US number starting with 1", () => {
      expect(normalizePhone("12168620005")).toBe("+12168620005");
    });

    it("passes through valid E.164 number", () => {
      expect(normalizePhone("+12168620005")).toBe("+12168620005");
    });

    it("returns null for invalid short number", () => {
      expect(normalizePhone("12345")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(normalizePhone("")).toBeNull();
    });
  });

  describe("Message Templates", () => {
    let bookingConfirmationSms: any;
    let statusUpdateSms: any;
    let thankYouSms: any;
    let reviewRequestSms: any;
    let callbackConfirmationSms: any;
    let maintenanceReminderSms: any;

    beforeEach(async () => {
      const mod = await import("./sms");
      bookingConfirmationSms = mod.bookingConfirmationSms;
      statusUpdateSms = mod.statusUpdateSms;
      thankYouSms = mod.thankYouSms;
      reviewRequestSms = mod.reviewRequestSms;
      callbackConfirmationSms = mod.callbackConfirmationSms;
      maintenanceReminderSms = mod.maintenanceReminderSms;
    });

    it("booking confirmation includes first name and service", () => {
      const msg = bookingConfirmationSms("John Smith", "Brake Repair", "NT-ABC123");
      expect(msg).toContain("John");
      expect(msg).toContain("brake repair");
      expect(msg).toContain("NT-ABC123");
      expect(msg).toContain("Nick's Tire & Auto");
      expect(msg).toContain("(216) 862-0005");
    });

    it("booking confirmation works without ref code", () => {
      const msg = bookingConfirmationSms("Jane Doe", "Oil Change");
      expect(msg).toContain("Jane");
      expect(msg).toContain("oil change");
      expect(msg).not.toContain("Ref:");
    });

    it("status update includes correct stage message", () => {
      const msg = statusUpdateSms("Mike Johnson", "ready", "NT-XYZ789");
      expect(msg).toContain("Mike");
      expect(msg).toContain("READY FOR PICKUP");
      expect(msg).toContain("NT-XYZ789");
    });

    it("status update for in-progress stage", () => {
      const msg = statusUpdateSms("Sarah Lee", "in-progress");
      expect(msg).toContain("Sarah");
      expect(msg).toContain("actively being repaired");
      expect(msg).toContain("nickstire.org/status");
    });

    it("status update for waiting-parts stage", () => {
      const msg = statusUpdateSms("Bob Brown", "waiting-parts");
      expect(msg).toContain("Bob");
      expect(msg).toContain("waiting for parts");
    });

    it("thank-you SMS includes first name and service", () => {
      const msg = thankYouSms("Alice Cooper", "Tire Rotation");
      expect(msg).toContain("Alice");
      expect(msg).toContain("tire rotation");
      expect(msg).toContain("Nick's Tire & Auto");
    });

    it("review request SMS includes Google review link", () => {
      const msg = reviewRequestSms("Tom Wilson");
      expect(msg).toContain("Tom");
      expect(msg).toContain("google.com/local/writereview");
      expect(msg).toContain("Cleveland");
    });

    it("callback confirmation SMS includes business hours", () => {
      const msg = callbackConfirmationSms("Lisa Park");
      expect(msg).toContain("Lisa");
      expect(msg).toContain("callback request");
      expect(msg).toContain("Mon-Sat 9AM-6PM");
    });

    it("maintenance reminder SMS includes service and store info", () => {
      const msg = maintenanceReminderSms("Dave King", "Oil Change", "Based on your last visit 5,000 miles ago.");
      expect(msg).toContain("Dave");
      expect(msg).toContain("oil change");
      expect(msg).toContain("5,000 miles ago");
      expect(msg).toContain("nickstire.org");
    });

    it("all messages are under 1600 characters", () => {
      const messages = [
        bookingConfirmationSms("A Very Long Customer Name Indeed", "Complete Engine Overhaul and Transmission Rebuild", "NT-ABCDEF"),
        statusUpdateSms("A Very Long Customer Name Indeed", "ready", "NT-ABCDEF"),
        thankYouSms("A Very Long Customer Name Indeed", "Complete Engine Overhaul and Transmission Rebuild"),
        reviewRequestSms("A Very Long Customer Name Indeed"),
        callbackConfirmationSms("A Very Long Customer Name Indeed"),
        maintenanceReminderSms("A Very Long Customer Name Indeed", "Complete Engine Overhaul", "Based on your last visit approximately 5,000 miles ago."),
      ];
      messages.forEach((msg) => {
        expect(msg.length).toBeLessThan(1600);
      });
    });
  });

  describe("sendSms without credentials", () => {
    it("returns failure when Twilio is not configured", async () => {
      // Save and clear env vars
      const origSid = process.env.TWILIO_ACCOUNT_SID;
      const origToken = process.env.TWILIO_AUTH_TOKEN;
      const origPhone = process.env.TWILIO_PHONE_NUMBER;
      
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_PHONE_NUMBER;

      // Re-import to get fresh module
      const { sendSms } = await import("./sms");
      const result = await sendSms("+12168620005", "Test message");
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");

      // Restore env vars
      if (origSid) process.env.TWILIO_ACCOUNT_SID = origSid;
      if (origToken) process.env.TWILIO_AUTH_TOKEN = origToken;
      if (origPhone) process.env.TWILIO_PHONE_NUMBER = origPhone;
    });
  });
});
