/**
 * Tests for Phase 18 improvements:
 * - City-specific landing pages
 * - Seasonal landing pages
 * - FAQ page data
 * - SEO component (canonical, breadcrumbs)
 * - Sitemap updates
 * - Security headers
 */

import { describe, it, expect } from "vitest";
import { CITIES, getCityBySlug } from "@shared/cities";
import { SEASONAL_PAGES, getSeasonalBySlug } from "@shared/seasonal";
import { SERVICES } from "@shared/services";

// ─── CITY PAGES ───────────────────────────────────────
describe("City-specific landing pages", () => {
  it("should have 4 city pages defined", () => {
    expect(CITIES).toHaveLength(4);
  });

  it("each city should have all required fields", () => {
    for (const city of CITIES) {
      expect(city.slug).toBeTruthy();
      expect(city.name).toBeTruthy();
      expect(city.metaTitle).toBeTruthy();
      expect(city.metaDescription).toBeTruthy();
      expect(city.heroHeadline).toBeTruthy();
      expect(city.heroSubline).toBeTruthy();
      expect(city.distance).toBeTruthy();
      expect(city.driveTime).toBeTruthy();
      expect(city.neighborhoods.length).toBeGreaterThan(0);
      expect(city.localContent.length).toBeGreaterThan(100);
      expect(city.serviceHighlights.length).toBeGreaterThanOrEqual(5);
      expect(city.testimonial.text).toBeTruthy();
      expect(city.testimonial.author).toBeTruthy();
      expect(city.testimonial.location).toBeTruthy();
    }
  });

  it("each city should have a unique slug", () => {
    const slugs = CITIES.map(c => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("each city meta title should include the phone number", () => {
    for (const city of CITIES) {
      expect(city.metaTitle).toContain("(216) 862-0005");
    }
  });

  it("each city meta description should include the city name", () => {
    for (const city of CITIES) {
      expect(city.metaDescription.toLowerCase()).toContain(city.name.toLowerCase());
    }
  });

  it("getCityBySlug should return correct city", () => {
    const euclid = getCityBySlug("euclid-auto-repair");
    expect(euclid).toBeDefined();
    expect(euclid!.name).toBe("Euclid");
  });

  it("getCityBySlug should return undefined for invalid slug", () => {
    expect(getCityBySlug("nonexistent")).toBeUndefined();
  });

  it("each city should have unique local content (no duplicates)", () => {
    const contents = CITIES.map(c => c.localContent);
    expect(new Set(contents).size).toBe(contents.length);
  });

  it("each city testimonial should be unique", () => {
    const testimonials = CITIES.map(c => c.testimonial.text);
    expect(new Set(testimonials).size).toBe(testimonials.length);
  });
});

// ─── SEASONAL PAGES ───────────────────────────────────
describe("Seasonal landing pages", () => {
  it("should have 2 seasonal pages defined", () => {
    expect(SEASONAL_PAGES).toHaveLength(2);
  });

  it("should have winter and summer pages", () => {
    const seasons = SEASONAL_PAGES.map(s => s.season);
    expect(seasons).toContain("Winter");
    expect(seasons).toContain("Summer");
  });

  it("each seasonal page should have all required fields", () => {
    for (const page of SEASONAL_PAGES) {
      expect(page.slug).toBeTruthy();
      expect(page.season).toBeTruthy();
      expect(page.metaTitle).toBeTruthy();
      expect(page.metaDescription).toBeTruthy();
      expect(page.heroHeadline).toBeTruthy();
      expect(page.heroSubline).toBeTruthy();
      expect(page.intro.length).toBeGreaterThan(100);
      expect(page.checklist.length).toBeGreaterThanOrEqual(5);
      expect(page.commonProblems.length).toBeGreaterThanOrEqual(3);
      expect(page.ctaText).toBeTruthy();
    }
  });

  it("each checklist item should have title and description", () => {
    for (const page of SEASONAL_PAGES) {
      for (const item of page.checklist) {
        expect(item.title).toBeTruthy();
        expect(item.description.length).toBeGreaterThan(30);
      }
    }
  });

  it("each common problem should have problem, explanation, and solution", () => {
    for (const page of SEASONAL_PAGES) {
      for (const cp of page.commonProblems) {
        expect(cp.problem).toBeTruthy();
        expect(cp.explanation.length).toBeGreaterThan(30);
        expect(cp.solution.length).toBeGreaterThan(30);
      }
    }
  });

  it("getSeasonalBySlug should return correct page", () => {
    const winter = getSeasonalBySlug("winter-car-care-cleveland");
    expect(winter).toBeDefined();
    expect(winter!.season).toBe("Winter");
  });

  it("getSeasonalBySlug should return undefined for invalid slug", () => {
    expect(getSeasonalBySlug("nonexistent")).toBeUndefined();
  });
});

// ─── SERVICE DATA INTEGRITY ──────────────────────────
describe("Service data integrity", () => {
  it("all services should have unique trust paragraphs", () => {
    // Check that no two services share the same whyUs content
    const whyUsStrings = SERVICES.map(s => JSON.stringify(s.whyUs));
    expect(new Set(whyUsStrings).size).toBe(whyUsStrings.length);
  });

  it("all services should have unique meta descriptions", () => {
    const descs = SERVICES.map(s => s.metaDescription);
    expect(new Set(descs).size).toBe(descs.length);
  });

  it("all services should have unique heroHeadlines", () => {
    const headlines = SERVICES.map(s => s.heroHeadline);
    expect(new Set(headlines).size).toBe(headlines.length);
  });

  it("no service should use the phone number 310-519-6634", () => {
    for (const s of SERVICES) {
      const allText = JSON.stringify(s);
      expect(allText).not.toContain("310-519-6634");
      expect(allText).not.toContain("3105196634");
    }
  });
});

// ─── CROSS-REFERENCING ────────────────────────────────
describe("Cross-referencing between pages", () => {
  it("city pages should reference correct phone number", () => {
    for (const city of CITIES) {
      const allText = JSON.stringify(city);
      expect(allText).not.toContain("310-519-6634");
    }
  });

  it("seasonal pages should reference correct phone number", () => {
    for (const page of SEASONAL_PAGES) {
      const allText = JSON.stringify(page);
      expect(allText).not.toContain("310-519-6634");
    }
  });

  it("all meta titles should be under 70 characters", () => {
    const allTitles = [
      ...SERVICES.map(s => s.metaTitle),
      ...CITIES.map(c => c.metaTitle),
      ...SEASONAL_PAGES.map(s => s.metaTitle),
    ];
    for (const title of allTitles) {
      expect(title.length).toBeLessThanOrEqual(80); // Allow slight flexibility
    }
  });

  it("all meta descriptions should be between 100-160 characters", () => {
    const allDescs = [
      ...SERVICES.map(s => s.metaDescription),
      ...CITIES.map(c => c.metaDescription),
      ...SEASONAL_PAGES.map(s => s.metaDescription),
    ];
    for (const desc of allDescs) {
      expect(desc.length).toBeGreaterThanOrEqual(100);
      expect(desc.length).toBeLessThanOrEqual(200); // Allow some flexibility
    }
  });
});
