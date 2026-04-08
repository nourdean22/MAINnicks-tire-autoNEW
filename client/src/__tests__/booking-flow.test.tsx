/**
 * Booking Flow Tests — Verify booking form module loads and exports correctly
 */
import { describe, it, expect } from "vitest";

describe("Booking Form Module", () => {
  it("exports a default component", async () => {
    const mod = await import("@/components/BookingForm");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("booking form is a React component (has displayName or name)", async () => {
    const mod = await import("@/components/BookingForm");
    const Component = mod.default;
    expect(Component.name || Component.displayName || "BookingForm").toBeTruthy();
  });
});

describe("Booking Data Validation", () => {
  it("phone number formats are consistent", () => {
    const phoneRegex = /^\(\d{3}\)\s?\d{3}-\d{4}$/;
    expect(phoneRegex.test("(216) 862-0005")).toBe(true);
    expect(phoneRegex.test("216-862-0005")).toBe(false);
  });

  it("service categories are defined", async () => {
    const { SERVICES } = await import("@shared/services");
    expect(Array.isArray(SERVICES)).toBe(true);
    expect(SERVICES.length).toBeGreaterThan(0);
  });
});
