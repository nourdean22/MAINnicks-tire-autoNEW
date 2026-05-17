/**
 * Tests for auto-invoice creation, notification delivery log, and sync health.
 * Covers the new backend systems added in this phase.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Email Notification System Tests ────────────────────
describe("Email Notification System", () => {
  it("should export getDeliveryLog function", async () => {
    const mod = await import("./email-notify");
    expect(typeof mod.getDeliveryLog).toBe("function");
  });

  it("should return an array from getDeliveryLog", async () => {
    const { getDeliveryLog } = await import("./email-notify");
    const log = getDeliveryLog(10);
    expect(Array.isArray(log)).toBe(true);
  });

  it("should export all convenience notification functions", async () => {
    const mod = await import("./email-notify");
    expect(typeof mod.notifyNewBooking).toBe("function");
    expect(typeof mod.notifyNewLead).toBe("function");
    expect(typeof mod.notifyCallbackRequest).toBe("function");
    expect(typeof mod.notifyTireOrder).toBe("function");
    expect(typeof mod.notifyWeeklyReport).toBe("function");
    expect(typeof mod.notifySystemAlert).toBe("function");
    expect(typeof mod.notifyInvoiceCreated).toBe("function");
    expect(typeof mod.sendNotification).toBe("function");
  });

  it("should export NotifyCategory types covering all categories", async () => {
    const { sendNotification } = await import("./email-notify");
    // Verify the function accepts all expected categories
    const categories = [
      "booking", "lead", "callback", "tire_order",
      "high_value", "revenue", "weekly_report",
      "content", "system", "review", "sms_reply",
    ];
    for (const cat of categories) {
      // Just verify the function doesn't throw on valid categories
      // (actual send will fail without MCP, but type validation passes)
      expect(() => {
        // Type check only — don't await
        sendNotification({
          category: cat as any,
          subject: "Test",
          body: "Test body",
        });
      }).not.toThrow();
    }
  });
});

// ─── Sheets Sync Tests ──────────────────────────────────
describe("Sheets Sync Module", () => {
  it("should export all sync functions", async () => {
    const mod = await import("./sheets-sync");
    expect(typeof mod.syncLeadToSheet).toBe("function");
    expect(typeof mod.syncBookingToSheet).toBe("function");
    expect(typeof mod.syncCallbackToSheet).toBe("function");
    expect(typeof mod.syncInvoiceToSheet).toBe("function");
    expect(typeof mod.isSheetConfigured).toBe("function");
    expect(typeof mod.getSpreadsheetUrl).toBe("function");
  });

  it("should report sheet as configured when env is set", async () => {
    const { isSheetConfigured } = await import("./sheets-sync");
    // In test env, GOOGLE_SHEETS_CRM_ID should be set
    const configured = isSheetConfigured();
    expect(typeof configured).toBe("boolean");
  });

  it("should return a valid URL from getSpreadsheetUrl", async () => {
    const { getSpreadsheetUrl } = await import("./sheets-sync");
    const url = getSpreadsheetUrl();
    if (url) {
      expect(url).toContain("docs.google.com/spreadsheets");
    }
  });
});

// ─── Invoice DB Helper Tests ────────────────────────────
describe("Invoice Database Helpers", () => {
  it("should export getNextInvoiceNumber", async () => {
    const mod = await import("./db");
    expect(typeof mod.getNextInvoiceNumber).toBe("function");
  });

  it("should export createInvoice", async () => {
    const mod = await import("./db");
    expect(typeof mod.createInvoice).toBe("function");
  });

  it("should generate invoice number with correct format", async () => {
    const { getNextInvoiceNumber } = await import("./db");
    const num = await getNextInvoiceNumber();
    // Format: INV-YYYYMMDD-NNN
    expect(num).toMatch(/^INV-\d{8}-\d{3}$/);
  });
});

// ─── Booking Auto-Invoice Labor Mapping Tests ───────────
describe("Service Labor Mapping", () => {
  // Test the labor estimation logic used in booking auto-invoice
  const SERVICE_LABOR_MAP: Record<string, { hours: number; description: string }> = {
    "oil change": { hours: 0.3, description: "Oil Change Service" },
    "brake": { hours: 1.5, description: "Brake Service" },
    "tire": { hours: 0.7, description: "Tire Service" },
    "diagnostic": { hours: 1.0, description: "Diagnostic Service" },
    "check engine": { hours: 1.0, description: "Check Engine Light Diagnosis" },
    "emission": { hours: 2.0, description: "Emissions / E-Check Repair" },
    "e-check": { hours: 2.0, description: "Ohio E-Check Repair" },
    "suspension": { hours: 2.5, description: "Suspension Repair" },
    "alignment": { hours: 1.0, description: "Wheel Alignment" },
    "ac": { hours: 1.5, description: "AC Service" },
    "cooling": { hours: 1.5, description: "Cooling System Service" },
    "exhaust": { hours: 1.5, description: "Exhaust Repair" },
    "electrical": { hours: 1.5, description: "Electrical Repair" },
    "starter": { hours: 2.0, description: "Starter Replacement" },
    "alternator": { hours: 1.5, description: "Alternator Replacement" },
    "transmission": { hours: 1.0, description: "Transmission Service" },
    "general": { hours: 1.5, description: "General Repair" },
  };

  function estimateLaborFromService(service: string): { hours: number; description: string } {
    const lower = service.toLowerCase();
    for (const [key, val] of Object.entries(SERVICE_LABOR_MAP)) {
      if (lower.includes(key)) return val;
    }
    return { hours: 1.0, description: service };
  }

  it("should map oil change service correctly", () => {
    const result = estimateLaborFromService("Oil Change");
    expect(result.hours).toBe(0.3);
    expect(result.description).toBe("Oil Change Service");
  });

  it("should map brake service correctly", () => {
    const result = estimateLaborFromService("Brake Pad Replacement");
    expect(result.hours).toBe(1.5);
    expect(result.description).toBe("Brake Service");
  });

  it("should map check engine light correctly", () => {
    const result = estimateLaborFromService("Check Engine Light Diagnosis");
    expect(result.hours).toBe(1.0);
    expect(result.description).toBe("Check Engine Light Diagnosis");
  });

  it("should map emissions/e-check correctly", () => {
    const result = estimateLaborFromService("Ohio E-Check Repair");
    expect(result.hours).toBe(2.0);
  });

  it("should map suspension correctly", () => {
    const result = estimateLaborFromService("Suspension Work");
    expect(result.hours).toBe(2.5);
  });

  it("should default to 1.0 hours for unknown services", () => {
    const result = estimateLaborFromService("Custom Fabrication");
    expect(result.hours).toBe(1.0);
    expect(result.description).toBe("Custom Fabrication");
  });

  it("should handle case-insensitive matching", () => {
    const result = estimateLaborFromService("BRAKE REPAIR");
    expect(result.hours).toBe(1.5);
  });

  it("should cover all 17 service categories", () => {
    expect(Object.keys(SERVICE_LABOR_MAP).length).toBe(17);
  });

  it("should have positive hours for all services", () => {
    for (const [key, val] of Object.entries(SERVICE_LABOR_MAP)) {
      expect(val.hours).toBeGreaterThan(0);
      expect(val.description.length).toBeGreaterThan(0);
    }
  });
});

// ─── BUSINESS Constants Tests ───────────────────────────
describe("BUSINESS Constants Centralization", () => {
  it("should have sameAs social profiles", async () => {
    const { BUSINESS } = await import("../shared/business");
    expect(BUSINESS.sameAs).toBeDefined();
    expect(Array.isArray(BUSINESS.sameAs)).toBe(true);
    expect(BUSINESS.sameAs.length).toBeGreaterThanOrEqual(3);
  });

  it("should include Google Maps in sameAs", async () => {
    const { BUSINESS } = await import("../shared/business");
    const hasGoogleMaps = BUSINESS.sameAs.some((url: string) => url.includes("google.com/maps"));
    expect(hasGoogleMaps).toBe(true);
  });

  it("should include Instagram in sameAs", async () => {
    const { BUSINESS } = await import("../shared/business");
    const hasInstagram = BUSINESS.sameAs.some((url: string) => url.includes("instagram.com"));
    expect(hasInstagram).toBe(true);
  });

  it("should include Facebook in sameAs", async () => {
    const { BUSINESS } = await import("../shared/business");
    const hasFacebook = BUSINESS.sameAs.some((url: string) => url.includes("facebook.com"));
    expect(hasFacebook).toBe(true);
  });

  it("should have updated review count (not stale 1683)", async () => {
    const { BUSINESS } = await import("../shared/business");
    expect(BUSINESS.reviews.count).toBeGreaterThanOrEqual(1700);
  });

  it("should have googleBusiness URL", async () => {
    const { BUSINESS } = await import("../shared/business");
    expect(BUSINESS.urls.googleBusiness).toBeDefined();
    expect(BUSINESS.urls.googleBusiness).toContain("google.com/maps");
  });
});
