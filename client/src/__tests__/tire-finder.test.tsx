/**
 * Tire Finder Tests — Verify tire data and module integrity
 */
import { describe, it, expect } from "vitest";

describe("Tire Finder Module", () => {
  it("exports a default component", async () => {
    const mod = await import("@/pages/TireFinder");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});

describe("Tire Data Integrity", () => {
  it("tire size pages have valid data", async () => {
    const { TIRE_SIZE_PAGES } = await import("@shared/tireSizes");
    expect(Array.isArray(TIRE_SIZE_PAGES)).toBe(true);
    expect(TIRE_SIZE_PAGES.length).toBeGreaterThan(0);

    for (const page of TIRE_SIZE_PAGES) {
      expect(page.size).toBeTruthy();
      expect(page.slug).toBeTruthy();
      expect(page.slug).toMatch(/^[a-z0-9-]+$/); // URL-safe
    }
  });

  it("no duplicate tire size slugs", async () => {
    const { TIRE_SIZE_PAGES } = await import("@shared/tireSizes");
    const slugs = TIRE_SIZE_PAGES.map((p: { slug: string }) => p.slug);
    const uniqueSlugs = new Set(slugs);
    expect(slugs.length).toBe(uniqueSlugs.size);
  });
});

describe("Financing Options", () => {
  it("financing providers are defined", async () => {
    const { FINANCING_PROVIDERS } = await import("@shared/financing");
    expect(Array.isArray(FINANCING_PROVIDERS)).toBe(true);
    expect(FINANCING_PROVIDERS.length).toBeGreaterThan(0);

    for (const provider of FINANCING_PROVIDERS) {
      expect(provider.name).toBeTruthy();
    }
  });
});
