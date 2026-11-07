/**
 * GBP vs GSC read 2026-11-07. Two gaps:
 *  1. "tire repair near me" / "flat tire repair near me": the homepage ranks (position 7.5 to 8.9)
 *     but no line says we fix flats. The line goes on the homepage services block and /services.
 *     business.ts holds no flat-repair price, so the line carries none.
 *  2. "tire choice": the Business Profile shows 24 searches a month, the site never appears.
 *     /tire-choice-alternative-cleveland reuses the Conrad's compare component.
 *
 * Source-level, like alignment-near-me-copy.test.ts: no DOM, runs before any prerender refresh.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const FLAT_LINE = "Flat tire repair: plug or patch while you wait.";
const ROUTE = "/tire-choice-alternative-cleveland";

const home = read("client/src/pages/Home.tsx");
const services = read("client/src/pages/ServicesOverview.tsx");
const routes = read("shared/routes.ts");
const business = read("shared/business.ts");
/** A missing page file reads as "" so each assertion fails on its own instead of the file failing to load. */
const page = (() => {
  try {
    return read("client/src/pages/compare/TireChoiceAlternative.tsx");
  } catch {
    return "";
  }
})();
const comparison = read("client/src/components/competitor/ComparisonPage.tsx");

const entry = routes.split("\n").find((l) => l.includes(`path: "${ROUTE}"`)) ?? "";
const field = (name: string) => entry.match(new RegExp(`${name}: "((?:[^"\\\\]|\\\\.)*)"`))?.[1] ?? "";

describe("flat tire repair line", () => {
  it("is on the homepage services block", () => {
    expect(home).toContain(FLAT_LINE);
  });
  it("is on /services", () => {
    expect(services).toContain(FLAT_LINE);
  });
  it("carries no dollar figure or time: business.ts holds no flat-repair price", () => {
    expect(business).not.toMatch(/flat[- ](tire )?repair[^\n]*\$\s?\d/i);
    for (const src of [home, services]) {
      const at = src.indexOf(FLAT_LINE);
      expect(src.slice(at, at + FLAT_LINE.length + 40)).not.toMatch(/\$\d|\d+\s?min/i);
    }
  });
});

describe("/tire-choice-alternative-cleveland", () => {
  it("is in the route registry, sitemap and prerender list", () => {
    expect(entry).toMatch(/sitemap: true/);
    expect(entry).toMatch(/prerender: true/);
    expect(entry).toMatch(/group: "comparison"/);
  });
  it("keeps the SEO caps: title under 60, description under 155", () => {
    expect(field("title").length).toBeGreaterThan(0);
    expect(field("title").length).toBeLessThan(60);
    expect(field("description").length).toBeGreaterThan(0);
    expect(field("description").length).toBeLessThan(155);
    expect(field("title")).toMatch(/^Tire Choice Alternative Cleveland/);
  });
  it("page title equals the registry title and uses the shared ComparisonPage", () => {
    expect(page).toContain(`seoTitle="${field("title")}"`);
    expect(page).toMatch(/import ComparisonPage from "@\/components\/competitor\/ComparisonPage"/);
    expect(page).toContain('slug="tire-choice-alternative-cleveland"');
  });
  it("H1 comes from the profile short name", async () => {
    const { COMPETITORS } = await import("../data/competitors");
    expect(COMPETITORS["tire-choice"]?.shortName).toBe("Tire Choice");
  });
  it("is routed, prerendered by the comparison script and listed on the compare hub", () => {
    expect(read("client/src/App.tsx")).toContain(`path={"${ROUTE}"}`);
    expect(read("scripts/prerender-comparison-only.mjs")).toContain(`"${ROUTE}"`);
    expect(read("client/src/pages/compare/CompareHub.tsx")).toContain(`path: "${ROUTE}"`);
  });
  it("makes no claim a Sunday-open competitor falsifies", () => {
    expect(page).not.toMatch(/closed sunday|chains close/i);
    expect(comparison).toMatch(/primary\.openSunday/);
  });
  it("keeps the shop voice: no exclamation mark, em dash, 'financing' or 'premium'", () => {
    const copy = page.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(copy).not.toMatch(/!/);
    expect(copy).not.toMatch(/—/);
    expect(copy).not.toMatch(/financing|premium/i);
  });
});
