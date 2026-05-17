/**
 * build-your-own-x parser tests · v10.0.52.
 *
 * Locks the parser contract: it must yield a non-trivial catalog
 * with categories + per-tutorial language + URL. If the source
 * markdown format ever drifts (e.g. heading style change), this
 * test fails fast so the /learn page + Nick tool don't silently
 * return zero results.
 */

import { describe, it, expect } from "vitest";
import {
  getCategories,
  totalTutorials,
  searchTutorials,
  getCategoryBySlug,
} from "@/lib/learn/build-your-own-x";

describe("build-your-own-x parser", () => {
  it("loads at least 20 categories", () => {
    const cats = getCategories();
    expect(cats.length).toBeGreaterThanOrEqual(20);
  });

  it("captures at least 200 tutorials total", () => {
    expect(totalTutorials()).toBeGreaterThanOrEqual(200);
  });

  it("each category has a non-empty slug + tutorials", () => {
    for (const cat of getCategories()) {
      expect(cat.slug).toMatch(/^[a-z0-9-]+$/);
      expect(cat.tutorials.length).toBeGreaterThan(0);
      expect(cat.name.length).toBeGreaterThan(0);
    }
  });

  it("most tutorials have a language tag", () => {
    const cats = getCategories();
    const all = cats.flatMap((c) => c.tutorials);
    const withLang = all.filter((t) => t.language).length;
    // At least 80% should have an explicit language label.
    expect(withLang / all.length).toBeGreaterThan(0.8);
  });

  it("every tutorial has an absolute URL", () => {
    for (const cat of getCategories()) {
      for (const t of cat.tutorials) {
        expect(t.url).toMatch(/^https?:\/\//);
      }
    }
  });

  it("getCategoryBySlug resolves a known category", () => {
    const all = getCategories();
    expect(all.length).toBeGreaterThan(0);
    const sample = all[0];
    const found = getCategoryBySlug(sample.slug);
    expect(found?.name).toBe(sample.name);
    expect(getCategoryBySlug("definitely-not-a-category")).toBeNull();
  });

  it("searchTutorials matches by topic", () => {
    const lispResults = searchTutorials({ topic: "lisp" });
    expect(lispResults.length).toBeGreaterThan(0);
    expect(
      lispResults.every((t) =>
        `${t.category} ${t.title}`.toLowerCase().includes("lisp"),
      ),
    ).toBe(true);
  });

  it("searchTutorials filters by language", () => {
    const pythonResults = searchTutorials({ language: "python", limit: 5 });
    expect(pythonResults.length).toBeGreaterThan(0);
    expect(
      pythonResults.every((t) =>
        t.language?.toLowerCase().includes("python"),
      ),
    ).toBe(true);
  });

  it("searchTutorials caps at the requested limit", () => {
    const results = searchTutorials({ topic: "build", limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("searchTutorials with no opts returns the default-limit slice", () => {
    const results = searchTutorials();
    expect(results.length).toBeLessThanOrEqual(20);
    expect(results.length).toBeGreaterThan(0);
  });
});
