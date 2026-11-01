/**
 * Humanizer pass 2 (job 2026-11-01-chat-humanizer-w6): the facts the rewrite moved onto
 * BUSINESS, and the floors the sentence-level edits must not break. ProblemPage said "4"
 * payment programs while BUSINESS lists five providers, and the filter that cut flattery
 * from city paragraphs once emptied East Cleveland's to "".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS } from "@shared/business";
import { CITIES } from "@shared/cities";
import { NEIGHBORHOODS } from "@shared/neighborhoods";

const read = (rel: string) => readFileSync(resolve(__dirname, "../../..", rel), "utf8");
const TEMPLATES = ["client/src/pages/ProblemPage.tsx", "client/src/pages/CityPage.tsx"];

describe("provider count and founding year come from BUSINESS", () => {
  it.each(TEMPLATES)("%s types no provider or program count", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/\b(?:\d+|four|five|six)\s+(?:providers|payment programs)\b/i);
    expect(src).not.toMatch(/>\s*\d+\s*<\/div>\s*<div[^>]*>\s*Payment Programs/);
    expect(src).not.toMatch(/\bsince 2018\b|SINCE 2018/);
  });

  it("ProblemPage renders the count and the year from BUSINESS", () => {
    const src = read("client/src/pages/ProblemPage.tsx");
    expect(src).toContain("{BUSINESS.financing.providers.length}</div>");
    expect(src).toContain("{BUSINESS.founded.year}");
    expect(BUSINESS.financing.providers.length).toBeGreaterThan(0);
  });

  it("positive control: the typed-count pattern catches the line this PR removed", () => {
    expect('mb-2">4</div>\n  <div className="x">Payment Programs').toMatch(
      />\s*\d+\s*<\/div>\s*<div[^>]*>\s*Payment Programs/,
    );
    expect("payment programs from five providers").toMatch(/\b(?:\d+|four|five|six)\s+(?:providers|payment programs)\b/i);
  });
});

describe("local paragraphs survive the sentence-level rewrite", () => {
  it("every city paragraph is over 100 characters and unique", () => {
    for (const c of CITIES) expect(c.localContent.length, c.slug).toBeGreaterThan(100);
    expect(new Set(CITIES.map((c) => c.localContent)).size).toBe(CITIES.length);
  });

  it("every neighborhood paragraph is over 200 characters and unique", () => {
    for (const n of NEIGHBORHOODS) expect(n.localContent.length, n.slug).toBeGreaterThan(200);
    expect(new Set(NEIGHBORHOODS.map((n) => n.localContent)).size).toBe(NEIGHBORHOODS.length);
  });

  it("no neighborhood description is left as a bare 'Auto repair for' fragment", () => {
    for (const n of NEIGHBORHOODS) {
      expect(n.description, n.slug).not.toMatch(/^Auto repair for (?:right|on|near|minutes|convenient)\b/);
      expect(n.description.length, n.slug).toBeGreaterThan(20);
    }
  });
});
