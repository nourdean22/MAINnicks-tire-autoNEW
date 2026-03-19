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
  it("should have 60+ URLs in the static sitemap", () => {
    const sitemapPath = path.join(__dirname, "../client/public/sitemap.xml");
    const content = fs.readFileSync(sitemapPath, "utf-8");
    const urlCount = (content.match(/<url>/g) || []).length;
    expect(urlCount).toBeGreaterThanOrEqual(60);
  });

  it("should have lastmod dates on all sitemap entries", () => {
    const sitemapPath = path.join(__dirname, "../client/public/sitemap.xml");
    const content = fs.readFileSync(sitemapPath, "utf-8");
    const urlCount = (content.match(/<url>/g) || []).length;
    const lastmodCount = (content.match(/<lastmod>/g) || []).length;
    expect(lastmodCount).toBe(urlCount);
  });
});

describe("Route Coverage", () => {
  it("should have routes for all city pages", () => {
    const appTsxPath = path.join(__dirname, "../client/src/App.tsx");
    const content = fs.readFileSync(appTsxPath, "utf-8");
    for (const city of CITIES) {
      expect(content).toContain(`/${city.slug}`);
    }
  });

  it("should have routes for all problem pages", () => {
    const appTsxPath = path.join(__dirname, "../client/src/App.tsx");
    const content = fs.readFileSync(appTsxPath, "utf-8");
    for (const problem of PROBLEM_PAGES) {
      expect(content).toContain(`/${problem.slug}`);
    }
  });

  it("should have routes for all vehicle make pages", () => {
    const appTsxPath = path.join(__dirname, "../client/src/App.tsx");
    const content = fs.readFileSync(appTsxPath, "utf-8");
    for (const vehicle of VEHICLE_MAKE_PAGES) {
      expect(content).toContain(`/${vehicle.slug}`);
    }
  });
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
