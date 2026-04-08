/**
 * Business logic tests — verify shared constants and data integrity.
 * These catch typos, missing data, and structural issues in business-critical constants.
 */
import { describe, it, expect } from "vitest";
import { BUSINESS } from "@shared/business";
import { SERVICE_TYPES, SERVICE_CATEGORIES } from "@shared/serviceTypes";
import { TIRE_SIZE_PAGES } from "@shared/tireSizes";

describe("BUSINESS constants", () => {
  it("has correct phone number", () => {
    expect(BUSINESS.phone.display).toBe("(216) 862-0005");
    expect(BUSINESS.phone.href).toBe("tel:2168620005");
    expect(BUSINESS.phone.raw).toBe("2168620005");
  });

  it("has correct address", () => {
    expect(BUSINESS.address.street).toBe("17625 Euclid Ave");
    expect(BUSINESS.address.city).toBe("Cleveland");
    expect(BUSINESS.address.state).toBe("OH");
    expect(BUSINESS.address.zip).toBe("44112");
    expect(BUSINESS.address.full).toContain("17625 Euclid Ave");
    expect(BUSINESS.address.full).toContain("Cleveland");
    expect(BUSINESS.address.full).toContain("44112");
  });

  it("has valid business hours", () => {
    const { structured } = BUSINESS.hours;
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

    for (const day of days) {
      expect(structured[day]).toBeDefined();
      expect(structured[day]).toMatch(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
    }

    // Mon-Sat should be 08:00-18:00
    for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const) {
      expect(structured[day]).toBe("08:00-18:00");
    }
    // Sunday different hours
    expect(structured.sunday).toBe("09:00-16:00");
  });

  it("has valid reviews data", () => {
    expect(BUSINESS.reviews.rating).toBeGreaterThanOrEqual(1);
    expect(BUSINESS.reviews.rating).toBeLessThanOrEqual(5);
    expect(BUSINESS.reviews.count).toBeGreaterThan(0);
    expect(BUSINESS.reviews.source).toBe("Google");
  });

  it("has non-empty service areas", () => {
    expect(BUSINESS.serviceAreas.length).toBeGreaterThan(0);
    expect(BUSINESS.serviceAreas).toContain("Cleveland");
    expect(BUSINESS.serviceAreas).toContain("Euclid");
  });

  it("has valid geo coordinates for Cleveland area", () => {
    expect(BUSINESS.geo.lat).toBeGreaterThan(41);
    expect(BUSINESS.geo.lat).toBeLessThan(42);
    expect(BUSINESS.geo.lng).toBeGreaterThan(-82);
    expect(BUSINESS.geo.lng).toBeLessThan(-81);
  });
});

describe("SERVICE_TYPES data integrity", () => {
  it("has service types defined", () => {
    expect(SERVICE_TYPES.length).toBeGreaterThan(0);
  });

  it("every service has required fields", () => {
    for (const svc of SERVICE_TYPES) {
      expect(svc.id).toBeTruthy();
      expect(svc.name).toBeTruthy();
      expect(svc.category).toBeTruthy();
    }
  });

  it("has no duplicate service IDs", () => {
    const ids = SERVICE_TYPES.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every service category is in SERVICE_CATEGORIES", () => {
    const catSet = new Set(SERVICE_CATEGORIES as readonly string[]);
    for (const svc of SERVICE_TYPES) {
      expect(catSet.has(svc.category)).toBe(true);
    }
  });

  it("includes critical service types", () => {
    const ids = SERVICE_TYPES.map((s) => s.id);
    expect(ids).toContain("oil-change");
    expect(ids).toContain("brake-pads-front");
    expect(ids).toContain("wheel-alignment");
    expect(ids).toContain("battery-replacement");
    expect(ids).toContain("check-engine-diagnostic");
  });
});

describe("TIRE_SIZE_PAGES data integrity", () => {
  it("has tire sizes defined", () => {
    expect(TIRE_SIZE_PAGES.length).toBeGreaterThan(0);
  });

  it("every tire size has required fields", () => {
    for (const page of TIRE_SIZE_PAGES) {
      expect(page.size).toBeTruthy();
      expect(page.slug).toBeTruthy();
      expect(page.commonVehicles.length).toBeGreaterThan(0);
      expect(page.category).toBeTruthy();
      expect(page.metaTitle).toBeTruthy();
      expect(page.metaDescription).toBeTruthy();
    }
  });

  it("has no duplicate tire size slugs", () => {
    const slugs = TIRE_SIZE_PAGES.map((p) => p.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it("tire size format is valid (NNN/NNRNN pattern)", () => {
    for (const page of TIRE_SIZE_PAGES) {
      expect(page.size).toMatch(/^\d{3}\/\d{2}R\d{2}$/);
    }
  });

  it("slugs are URL-safe", () => {
    for (const page of TIRE_SIZE_PAGES) {
      expect(page.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("every tire has a valid category", () => {
    const validCategories = ["SUV/Crossover", "Sedan", "Truck", "Performance"];
    for (const page of TIRE_SIZE_PAGES) {
      expect(validCategories).toContain(page.category);
    }
  });

  it("meta descriptions are under 160 chars", () => {
    for (const page of TIRE_SIZE_PAGES) {
      expect(page.metaDescription.length).toBeLessThanOrEqual(200);
    }
  });
});
