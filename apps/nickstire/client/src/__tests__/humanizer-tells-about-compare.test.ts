/**
 * About, Contact, FAQ and the compare pages read like the shop wrote them (job
 * 2026-10-30-antislop-humanizer-pages, PR D).
 *
 * Not covered on purpose: number and clock ranges ("$40–80", "9am–4pm") are typography, and a
 * lone "—" placeholder for a missing value is a table glyph, not prose.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..", "..", "..");
const COMPARE_DIR = "client/src/pages/compare";

const FILES = [
  "client/src/pages/About.tsx",
  "client/src/pages/Contact.tsx",
  "client/src/pages/FAQ.tsx",
  "shared/global-faq.ts",
  "client/src/components/competitor/ComparisonPage.tsx",
  "client/src/data/competitors.ts",
  ...fs
    .readdirSync(path.join(APP, COMPARE_DIR))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `${COMPARE_DIR}/${f}`),
];

const DASH = /—|&(?:mdash|#8212);|\s--\s|(?<![0-9%])(?<![0-9][ap]m)–|–(?![0-9$])/;
const NEGATION_TAIL =
  /\bno [a-z'-]+,\s+no [a-z'-]+\b|[,.]\s+no (?:guessing|guesswork|games|gimmicks|surprises|pressure|upsells?|upselling|spin|obligation)\b/i;

// Lines the review cut or rewrote; each was a tail, a closer or a claim with no source.
const RETIRED = [
  "Monday, Saturday",
  "no pressure, no obligation",
  "No phone tree, no call-center",
  "a feature, not a bug",
  "Reliable in a chain way",
  "no marketing budget",
  "Not because the law makes us",
  "The differentiator isn't hours, it's",
  "Both sides, no spin",
  "The metal doesn't lie",
];

const read = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");

/** Comment text removed and lone-dash placeholders blanked; the rest is shop copy. */
export function shopCopyLines(src: string): string[] {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1").replace(/(["'`])[—–]\1/g, "$1$1"));
}

describe("matchers catch what they claim (positive control)", () => {
  it("flags planted tells, spares ranges, a placeholder and a comment", () => {
    expect(DASH.test("Pull up any day — no appointment")).toBe(true);
    expect(DASH.test("Monday–Saturday")).toBe(true);
    expect(DASH.test("most $40–80")).toBe(false);
    expect(DASH.test("Sunday 9am–4pm")).toBe(false);
    expect(NEGATION_TAIL.test("Here's the real read. Both sides, no spin.")).toBe(true);
    expect(shopCopyLines('nicks={a.ownership ?? "—"}').join("\n")).not.toMatch(DASH);
    expect(shopCopyLines("  // Roundup list — Nick's first").join("\n")).not.toMatch(DASH);
    expect(shopCopyLines('  title: "Roundup — Nick\'s first",').join("\n")).toMatch(DASH);
  });

  it("scans every compare page (the scanner saw its subject)", () => {
    expect(FILES.filter((f) => f.startsWith(COMPARE_DIR)).length).toBeGreaterThanOrEqual(15);
  });
});

describe.each(FILES)("%s", (rel) => {
  const src = read(rel);
  const lines = shopCopyLines(src);

  it("has no prose dashes in shop copy", () => {
    expect(lines.map((l, i) => (DASH.test(l) ? `${i + 1}: ${l.trim().slice(0, 90)}` : "")).filter(Boolean)).toEqual([]);
  });

  it("has no stacked 'no X, no Y' tails", () => {
    expect(lines.filter((l) => NEGATION_TAIL.test(l)).map((l) => l.trim().slice(0, 90))).toEqual([]);
  });

  it("carries none of the retired lines", () => {
    expect(RETIRED.filter((r) => src.includes(r))).toEqual([]);
  });
});

describe("ComparisonPage keeps its missing-value placeholder", () => {
  it('shows "—" when a competitor has no ownership on file', () => {
    expect(read("client/src/components/competitor/ComparisonPage.tsx").match(/ownership \?\? "—"/g)).toHaveLength(2);
  });
});
