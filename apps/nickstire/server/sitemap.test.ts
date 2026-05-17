import { describe, expect, it, beforeAll } from "vitest";

/**
 * Sitemap & Robots.txt structural tests.
 * Validates route definitions and SEO data without needing a running server.
 */

let SITEMAP_ROUTES: Array<{ path: string; [key: string]: unknown }> = [];

beforeAll(async () => {
  const mod = await import("../shared/routes");
  SITEMAP_ROUTES = mod.SITEMAP_ROUTES || [];
});

describe("sitemap routes", () => {
  it("has public routes defined", () => {
    expect(SITEMAP_ROUTES.length).toBeGreaterThan(10);
  });

  it("includes homepage", () => {
    const paths = SITEMAP_ROUTES.map(r => r.path);
    expect(paths).toContain("/");
  });

  it("includes core service pages", () => {
    const paths = SITEMAP_ROUTES.map(r => r.path);
    expect(paths).toContain("/tires");
    expect(paths).toContain("/brakes");
    expect(paths).toContain("/contact");
  });

  it("does not include admin pages", () => {
    const paths = SITEMAP_ROUTES.map(r => r.path);
    const adminPaths = paths.filter(p => p.includes("/admin"));
    expect(adminPaths).toHaveLength(0);
  });

  it("all routes have valid path format", () => {
    for (const route of SITEMAP_ROUTES) {
      expect(route.path).toMatch(/^\//);
    }
  });
});

describe("robots.txt structure", () => {
  it("index.ts contains robots.txt handler", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/_core/index.ts", "utf8");
    expect(content).toContain("robots.txt");
  });
});
