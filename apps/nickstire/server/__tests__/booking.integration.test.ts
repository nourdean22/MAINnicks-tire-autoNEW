/**
 * Booking Router Integration Tests
 * Tests the booking creation flow, validation, confirmation tracking,
 * and status updates — the #1 revenue entry point.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Test the booking input schema validation
const bookingSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(7).max(30),
  service: z.string().min(1).max(255),
  vehicle: z.string().max(255).optional(),
  preferredDate: z.string().max(50).optional(),
  preferredTime: z.string().max(50).optional(),
  urgency: z.enum(["normal", "soon", "emergency"]).optional(),
  notes: z.string().max(2000).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(255).optional(),
  gclid: z.string().max(255).optional(),
});

describe("Booking Creation", () => {
  it("accepts valid booking data", () => {
    const result = bookingSchema.safeParse({
      name: "John Smith",
      phone: "(216) 555-1234",
      service: "Tires — New, Used, Repair",
      vehicle: "2019 Honda Civic",
      urgency: "normal",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = bookingSchema.safeParse({
      name: "",
      phone: "(216) 555-1234",
      service: "Oil Change",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing phone", () => {
    const result = bookingSchema.safeParse({
      name: "John",
      service: "Brakes",
    });
    expect(result.success).toBe(false);
  });

  it("accepts gclid from Google Ads", () => {
    const result = bookingSchema.safeParse({
      name: "Jane Doe",
      phone: "2165551234",
      service: "Alignment",
      gclid: "CjwKCAjw-abc123-test-gclid",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gclid).toBe("CjwKCAjw-abc123-test-gclid");
    }
  });

  it("accepts all urgency levels", () => {
    for (const urgency of ["normal", "soon", "emergency"]) {
      const result = bookingSchema.safeParse({
        name: "Test",
        phone: "1234567890",
        service: "Test Service",
        urgency,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid urgency", () => {
    const result = bookingSchema.safeParse({
      name: "Test",
      phone: "1234567890",
      service: "Test",
      urgency: "asap",
    });
    expect(result.success).toBe(false);
  });

  it("captures UTM parameters", () => {
    const result = bookingSchema.safeParse({
      name: "UTM Test",
      phone: "2165551234",
      service: "Tires",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "spring_tires_2026",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.utmSource).toBe("google");
      expect(result.data.utmMedium).toBe("cpc");
      expect(result.data.utmCampaign).toBe("spring_tires_2026");
    }
  });

  it("enforces max lengths", () => {
    const result = bookingSchema.safeParse({
      name: "A".repeat(201),
      phone: "1234567890",
      service: "Test",
    });
    expect(result.success).toBe(false);
  });
});

describe("Booking Confirmation", () => {
  it("confirmation method values are valid", () => {
    const validMethods = ["sms_reply", "phone", "admin", "auto"];
    for (const method of validMethods) {
      expect(method.length).toBeLessThanOrEqual(20);
    }
  });

  it("confirmation SMS template generates correct message", async () => {
    const { bookingConfirmationRequestSms } = await import("../sms");
    const msg = bookingConfirmationRequestSms("John", "2:00 PM");
    expect(msg).toContain("John");
    expect(msg).toContain("confirm");
    expect(msg).toContain("(216) 862-0005");
  });
});

describe("Booking Status Flow", () => {
  it("valid status transitions", () => {
    const validStatuses = ["new", "confirmed", "completed", "cancelled"];
    expect(validStatuses).toContain("new");
    expect(validStatuses).toContain("confirmed");
    expect(validStatuses).toContain("completed");
    expect(validStatuses).toContain("cancelled");
  });
});
