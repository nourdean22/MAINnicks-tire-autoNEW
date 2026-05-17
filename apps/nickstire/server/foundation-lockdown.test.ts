/**
 * Phase 29 — Foundation Lockdown Tests
 * Validates data consistency, input validation, and codebase organization
 */
import { describe, it, expect } from "vitest";
import { BUSINESS } from "../shared/business";
import { CITIES } from "../shared/cities";
import { PROBLEM_PAGES, VEHICLE_MAKE_PAGES } from "../shared/seo-pages";
import fs from "fs";
import path from "path";

describe("Business Constants (shared/business.ts)", () => {
  it("should have all required business fields", () => {
    expect(BUSINESS.name).toBe("Nick's Tire & Auto");
    expect(BUSINESS.phone.display).toBe("(216) 862-0005");
    expect(BUSINESS.phone.raw).toBe("2168620005");
    expect(BUSINESS.address.street).toBeTruthy();
    expect(BUSINESS.address.city).toBe("Cleveland");
    expect(BUSINESS.address.state).toBe("OH");
    expect(BUSINESS.address.zip).toBeTruthy();
    expect(BUSINESS.hours.display).toBeTruthy();
    expect(BUSINESS.reviews.rating).toBeGreaterThanOrEqual(4.0);
    expect(BUSINESS.reviews.count).toBeGreaterThanOrEqual(1600);
  });

  it("should have consistent phone number formats", () => {
    expect(BUSINESS.phone.display).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
    expect(BUSINESS.phone.raw).toMatch(/^\d{10}$/);
  });
});

describe("City Pages Data Consistency", () => {
  it("should have unique slugs for all cities", () => {
    const slugs = CITIES.map(c => c.slug);
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(slugs.length);
  });

  it("should have 10+ city pages for local SEO coverage", () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(10);
  });

  it("should have required fields for each city", () => {
    for (const city of CITIES) {
      expect(city.slug).toBeTruthy();
      expect(city.name).toBeTruthy();
      expect(city.metaTitle).toBeTruthy();
      expect(city.metaDescription).toBeTruthy();
      expect(city.heroHeadline).toBeTruthy();
    }
  });
});

describe("Problem Pages Data Consistency", () => {
  it("should have unique slugs for all problem pages", () => {
    const slugs = PROBLEM_PAGES.map(p => p.slug);
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(slugs.length);
  });

  it("should have 10+ problem pages for long-tail SEO", () => {
    expect(PROBLEM_PAGES.length).toBeGreaterThanOrEqual(10);
  });
});

describe("Vehicle Make Pages Data Consistency", () => {
  it("should have unique slugs for all vehicle make pages", () => {
    const slugs = VEHICLE_MAKE_PAGES.map(v => v.slug);
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(slugs.length);
  });

  it("should have 10+ vehicle make pages for brand SEO", () => {
    expect(VEHICLE_MAKE_PAGES.length).toBeGreaterThanOrEqual(10);
  });
});

describe("Sitemap Consistency", () => {
  // 2026-05-05 audit cleanup: client/public/sitemap.xml was deleted because
  // server/_core/index.ts serves /sitemap.xml dynamically from
  // SITEMAP_ROUTES truth in shared/routes.ts. Tests now check the truth
  // source instead of the (deleted) static file.

  it("should have 60+ routes flagged for sitemap inclusion", async () => {
    const { SITEMAP_ROUTES } = await import("../shared/routes");
    expect(SITEMAP_ROUTES.length).toBeGreaterThanOrEqual(60);
  });

  it("every sitemap-flagged route has a path, priority, and changefreq", async () => {
    const { SITEMAP_ROUTES } = await import("../shared/routes");
    for (const r of SITEMAP_ROUTES) {
      expect(r.path).toMatch(/^\/.*/);
      expect(typeof r.priority).toBe("number");
      expect(r.changefreq).toMatch(/^(always|hourly|daily|weekly|monthly|yearly|never)$/);
    }
  });
});

describe("Route Coverage", () => {
  it("should have routes for all city pages", () => {
    // City pages use dynamic routing via shared/routes.ts, not hardcoded in App.tsx
    const routesPath = path.join(__dirname, "../shared/routes.ts");
    const content = fs.readFileSync(routesPath, "utf-8");
    // Routes file should reference city routing pattern
    expect(content).toContain("CITY_PAGES");
    expect(CITIES.length).toBeGreaterThanOrEqual(10);
  });

  it("should have routes for all problem pages", () => {
    const appTsxPath = path.join(__dirname, "../client/src/App.tsx");
    const content = fs.readFileSync(appTsxPath, "utf-8");
    for (const problem of PROBLEM_PAGES) {
      expect(content).toContain(`/${problem.slug}`);
    }
  });

  // Vehicle make page route check removed 2026-04-24 per T5 audit.
  // The VEHICLE_MAKE_PAGES data array still exists in shared/seo-pages.ts
  // (keeps data consistency tests above green) but the corresponding
  // App.tsx routes + VehicleMakePage component were removed because 30d
  // GSC showed zero impressions across all 10 make pages. Revive via
  // git revert if make-level SEO becomes relevant again.
});

describe("Review Count Consistency", () => {
  it("should have consistent review count across all files", () => {
    const pagesDir = path.join(__dirname, "../client/src/pages");
    const files = fs.readdirSync(pagesDir).filter(f => f.endsWith(".tsx"));
    
    for (const file of files) {
      const content = fs.readFileSync(path.join(pagesDir, file), "utf-8");
      // Check no old review count (1,683) exists
      expect(content).not.toContain("1,683");
    }
  });
});

describe("No Duplicate Routes", () => {
  it("should have no duplicate route paths in App.tsx", () => {
    const appTsxPath = path.join(__dirname, "../client/src/App.tsx");
    const content = fs.readFileSync(appTsxPath, "utf-8");
    const routeMatches = content.match(/path=\{"([^"]+)"\}/g) || [];
    const paths = routeMatches.map(m => m.match(/path=\{"([^"]+)"\}/)![1]);
    const uniquePaths = new Set(paths);
    expect(uniquePaths.size).toBe(paths.length);
  });
});
