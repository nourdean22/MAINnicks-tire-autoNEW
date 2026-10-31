/**
 * Blog posts and car-care guides read like the shop wrote them (job
 * 2026-10-30-antislop-humanizer-pages, PR E).
 *
 * Not covered on purpose: `title:` and `metaTitle:` lines (page titles stay untouched, manager
 * ruling 2026-10-30), number and clock ranges ("$40–80", "9am–4pm"), and code comments.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..", "..", "..");
const FILES = ["shared/blog.ts", "shared/guides.ts"] as const;

const DASH = /—|&(?:mdash|#8212);|\s--\s|(?<![0-9%])(?<![0-9][ap]m)–|–(?![0-9$])/;
const NEGATION_TAIL =
  /\bno [a-z'-]+,\s+no [a-z'-]+\b|[,.]\s+no (?:guessing|guesswork|games|gimmicks|surprises|pressure|upsells?|upselling|spin|obligation)\b/i;
const TITLE_FIELD = /^\s*(?:title|metaTitle|seoTitle):/;
// a line of copy: a quoted string, or a field holding one (code lines are not copy)
const STRING_LINE = /^\s*(?:\{\s*)?(?:["'`]|[a-zA-Z]+:\s*["'`])/;

// Lines the review cut; each was a stacked tail or a closer.
const RETIRED = [
  "no pressure, no games",
  "Just honest brake repair at a fair price",
  "Just honest advice from ASE-trained hands",
  "Just honest maintenance to keep your vehicle running right",
  "no upsell, no checkout math",
  "No parts-swapping, no guessing",
  "No shortcuts, no generic substitutions",
  "No charge, no pressure, no appointment",
];

const read = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");

/** Comment lines and title fields removed, lone-dash placeholders blanked; the rest is shop copy. */
export function shopCopyLines(src: string): string[] {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((l) => (TITLE_FIELD.test(l) ? "" : l))
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1").replace(/(["'`])[—–]\1/g, "$1$1"));
}

/** Deepest parenthesis nesting in a line. */
export function parenDepth(line: string): number {
  let d = 0;
  let max = 0;
  for (const ch of line) {
    if (ch === "(") max = Math.max(max, ++d);
    else if (ch === ")") d--;
  }
  return max;
}

describe("matchers catch what they claim (positive control)", () => {
  it("flags planted tells, spares ranges, titles and comments", () => {
    expect(DASH.test("Pads wear fast — you hear it first")).toBe(true);
    expect(DASH.test("June–August")).toBe(true);
    expect(DASH.test("most $40–80")).toBe(false);
    expect(DASH.test("Sunday 9am–4pm")).toBe(false);
    expect(NEGATION_TAIL.test("No pressure, no upselling. Call us.")).toBe(true);
    expect(shopCopyLines('    title: "Brakes — a guide",').join("\n")).not.toMatch(DASH);
    expect(shopCopyLines('    metaTitle: "Brakes — a guide",').join("\n")).not.toMatch(DASH);
    expect(shopCopyLines("  // wave-35 — pillar article").join("\n")).not.toMatch(DASH);
    expect(shopCopyLines('        heading: "Brakes — a guide",').join("\n")).toMatch(DASH);
    expect(parenDepth("a (b (c) d) e")).toBe(2);
    expect(parenDepth("a (b), c (d)")).toBe(1);
    expect(STRING_LINE.test('        content: "Pads (front (rear))"')).toBe(true);
    expect(STRING_LINE.test("  return GUIDES.find((g) => g.slug === slug);")).toBe(false);
  });

  it("reads both files (the scanner saw its subject)", () => {
    for (const rel of FILES) expect(shopCopyLines(read(rel)).filter((l) => l.trim()).length).toBeGreaterThan(500);
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

  it("never nests parentheses in copy (a rewritten aside must not swallow the next one)", () => {
    const copy = (l: string) => STRING_LINE.test(l);
    expect(lines.filter(copy).length).toBeGreaterThan(300);
    expect(lines.map((l, i) => (copy(l) && parenDepth(l) > 1 ? `${i + 1}: ${l.trim().slice(0, 90)}` : "")).filter(Boolean)).toEqual([]);
  });
});
