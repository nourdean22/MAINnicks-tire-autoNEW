/**
 * One <title> per URL, and the route registry is where it comes from.
 *
 * WHY (2026-10-07 site crawl as Googlebot): /alignment and
 * /wheel-alignment-cleveland both served
 *
 *     <title>Wheel Alignment Cleveland · Free Pull-Check · No Pay Til Yes | Nick's</title>
 *
 * while shared/routes.ts held two DISTINCT titles for them — including the
 * wave-181.6 "near me" CTR rewrite for /alignment, which therefore never
 * shipped. Each page passed its own literal to SEOHead, and scripts/prerender.mjs
 * only overrides a title it recognises as a DEFAULT, so the component literal
 * won and the registry was decorative. validate:routes checks the registry;
 * nothing checked that a page actually used it.
 *
 * The same crawl found two blog articles with byte-identical <title> and H1
 * (spring-car-maintenance-checklist vs -cleveland), competing for one query.
 *
 * Two rules, both source-level so they run without a DOM and before any
 * prerender refresh:
 *   1. Pages that have a registry entry take their SEOHead title FROM it.
 *   2. No two static blog articles share a title or metaTitle.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BLOG_ARTICLES } from "@shared/blog";
import { getRouteByPath } from "@shared/routes";

const PAGES = resolve(process.cwd(), "client/src/pages");
const read = (file: string) => readFileSync(resolve(PAGES, file), "utf8");

// Every page here once hard-coded a title that collided with a sibling's.
const REGISTRY_TITLED_PAGES: Array<{ file: string; path: string }> = [
  { file: "AlignmentPage.tsx", path: "/alignment" },
  { file: "WheelAlignmentClevelandPage.tsx", path: "/wheel-alignment-cleveland" },
];

describe("SEO titles come from one source", () => {
  for (const { file, path } of REGISTRY_TITLED_PAGES) {
    it(`${file} takes its title from the registry entry for ${path}`, () => {
      const src = read(file);
      expect(getRouteByPath(path)?.title, `${path} must be registered`).toBeTruthy();
      expect(src, `${file} must read getRouteByPath("${path}")`).toMatch(
        new RegExp(`getRouteByPath\\("${path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"\\)\\??\\.title`),
      );
      // The literal that shipped twice. Any hard-coded "Wheel Alignment ..."
      // title in these files is the regression this test exists for.
      expect(src).not.toMatch(/title(?:=|:\s*)["']Wheel Alignment/);
    });
  }

  it("registry titles for the two alignment pages differ from each other", () => {
    const a = getRouteByPath("/alignment")?.title;
    const b = getRouteByPath("/wheel-alignment-cleveland")?.title;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("no two static blog articles share a title or metaTitle", () => {
    const seen = new Map<string, string[]>();
    for (const a of BLOG_ARTICLES) {
      for (const key of [`title:${a.title}`, `metaTitle:${a.metaTitle}`]) {
        seen.set(key, [...(seen.get(key) ?? []), a.slug]);
      }
    }
    const dupes = [...seen].filter(([, slugs]) => slugs.length > 1);
    expect(dupes, JSON.stringify(dupes)).toEqual([]);
  });
});
