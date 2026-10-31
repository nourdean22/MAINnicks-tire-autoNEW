/**
 * Home + tires copy reads like the shop wrote it (job 2026-10-30-antislop-humanizer-pages, PR A).
 *
 * The brand-voice gate (shared/voice.ts -> scripts/lint-brand-voice.ts) bans cliché WORDS. It has
 * no rule for the sentence shapes that make copy read machine-written: dashes as the all-purpose
 * connector, "no X, no Y" tails, and one-line closers that repeat the paragraph. This test fences
 * those shapes in the five files behind /, /tires, /tires/:size and the brand pages, and checks
 * that hours, the used-tire floor and the phone number are read from BUSINESS, not typed in.
 *
 * Not covered on purpose: the used-tire card and the GSC wave-1 lines in TireFinderV2 (measured
 * until the 2026-12-10 read, pinned by gsc-wave1-seo.test.ts), and the "$266" / "lifetime
 * rotations" claims, which wait on Nour's ruling. Customer review quotes are data, not shop copy.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUSINESS } from "@shared/business";

const APP = path.resolve(import.meta.dirname, "..", "..", "..");

const FILES = [
  "client/src/pages/Home.tsx",
  "client/src/pages/TireFinderV2.tsx",
  "client/src/pages/TireSizePage.tsx",
  "client/src/pages/TireBrandPage.tsx",
  "shared/tireBrands.ts",
] as const;

/** Block comments and // comments blanked (a "https://" in a string is kept), offsets preserved. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/** An em or en dash, typed or as an HTML entity, or a spaced double hyphen. */
const DASH = /[—–]|&(?:mdash|ndash|#8212|#8211);|\s--\s/;

/**
 * Lines left alone on purpose, each with its reason and the date it is revisited. GSC wave 1
 * (PR 3368) measures the used-tire card until the 2026-12-10 read; editing it would muddy the read.
 */
const EXEMPT: { file: string; quote: string; until: string; why: string }[] = [
  {
    file: "client/src/pages/TireFinderV2.tsx",
    quote: "When the damage isn't repairable — mounted from our in-stock inventory",
    until: "2026-12-10",
    why: "GSC wave-1 used-tire card, pinned by gsc-wave1-seo.test.ts",
  },
  {
    file: "client/src/pages/Home.tsx",
    quote: "Used tires in Cleveland, from $25 installed (select 12-inch; most $40-80)",
    until: "2026-12-10",
    why: "GSC wave-1 anchor text to /used-tires-cleveland",
  },
];

/** A file's code with comments blanked and its dated exemptions cut out. */
function scannable(rel: string): { raw: string; code: string } {
  const raw = stripComments(read(rel));
  const code = EXEMPT.filter((e) => e.file === rel).reduce((s, e) => s.split(e.quote).join(""), raw);
  return { raw, code };
}

/** Prose dashes. A string that is only a dash ("—", an empty-value placeholder) is not prose. */
export function proseDashes(code: string): string[] {
  const hits: string[] = [];
  code
    .replace(/(["'`])[—–]\1/g, "$1$1")
    .split("\n")
    .forEach((line, i) => {
      if (DASH.test(line)) hits.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  return hits;
}

/** "No pressure, no upsells." / "..., no guessing" as a stacked tail. */
const NEGATION_TAIL = /\bno [a-z'-]+,\s+no [a-z'-]+\b|[,.]\s+no (?:guessing|guesswork|games|gimmicks|surprises|pressure|upsells?)\b/i;

/** Lines retired in PR A: closers, forced jokes and fillers that the humanizer flagged by quote. */
const RETIRED = [
  "The metal doesn't lie",
  "Neither do we",
  "welcome you wish a hotel gave you",
  "Spotify can't identify",
  "real explanation in real English",
  "coffee gets cold",
  "BEST-KEPT SECRET",
  "multiplying the bill",
  "No bots, no buyouts",
];

const read = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");

describe("matchers catch what they claim (positive control)", () => {
  it("flags a planted dash and stacked tail, passes clean copy and a placeholder dash", () => {
    expect(proseDashes(stripComments('<p>Written quote — you approve first.</p>'))).toHaveLength(1);
    expect(proseDashes(stripComments('desc: "Pads -- rotors"'))).toHaveLength(1);
    expect(proseDashes(stripComments("<p>Closed Sunday &mdash; open Monday.</p>"))).toHaveLength(1);
    expect(proseDashes(stripComments('const v = x ?? "—";'))).toEqual([]);
    expect(proseDashes(stripComments("// Home — comment only\n/* a — b */"))).toEqual([]);
    expect(proseDashes(stripComments("<p>Written quote first. You approve it.</p>"))).toEqual([]);
    expect(NEGATION_TAIL.test("Free check. No pressure, no upsells.")).toBe(true);
    expect(NEGATION_TAIL.test("We fix it right, no guessing.")).toBe(true);
    expect(NEGATION_TAIL.test("No appointment needed.")).toBe(false);
  });
});

describe.each(FILES)("%s", (rel) => {
  const exempt = EXEMPT.filter((e) => e.file === rel);
  const { raw, code } = scannable(rel);

  it("has no prose dashes (outside the dated exemptions)", () => {
    expect(proseDashes(code)).toEqual([]);
  });

  it.each(exempt)("exempt line still exists and has not expired ($until, $why)", (e) => {
    // The exemption cannot outlive its line, or its date: after `until` the suite fails until
    // someone rewrites the line or renews the exemption with a new reason.
    expect(raw.includes(e.quote)).toBe(true);
    expect(Date.now()).toBeLessThan(Date.parse(`${e.until}T23:59:59-05:00`));
  });

  it("has no stacked 'no X, no Y' tails", () => {
    expect(code.split("\n").filter((l) => NEGATION_TAIL.test(l))).toEqual([]);
  });

  it("carries none of the retired lines", () => {
    expect(RETIRED.filter((q) => code.includes(q))).toEqual([]);
  });

  it("types no phone number (reads BUSINESS.phone)", () => {
    expect(code.includes(BUSINESS.phone.display)).toBe(false);
  });
});

describe("facts are read from BUSINESS, not typed", () => {
  it("Home renders hours from BUSINESS.hours and the used-tire band from BUSINESS.usedTires", () => {
    const home = scannable("client/src/pages/Home.tsx").code;
    expect(home).not.toMatch(/\b\d{1,2}\s?(?:AM|PM)\b/);
    expect(home).not.toContain("$40-80");
    expect(home).toContain("BUSINESS.hours.fullDisplay");
    expect(home).toContain("BUSINESS.usedTires.typicalBand");
    // The hero cuts the dollar figure out of priceDisplay; a reworded constant must not lose it.
    expect(BUSINESS.usedTires.priceDisplay).toMatch(/\$\d+/);
  });

  it("the Sunday lines on /tires and Home read their hours from BUSINESS, and type no clock time", () => {
    for (const rel of ["client/src/pages/TireFinderV2.tsx", "client/src/pages/Home.tsx"]) {
      const code = scannable(rel).code;
      expect(code).toContain("BUSINESS.hours.sunday");
      // "9am", "9 AM", "4pm", "9:00 AM" in any casing. A clock time typed anywhere in copy fails.
      expect(code.match(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi) ?? []).toEqual([]);
    }
  });

  it("the clock-time matcher sees its defects", () => {
    for (const s of ["Open Sundays, 9am to 4pm", "Sunday 9 AM", "9:00 AM-4:00 PM"]) {
      expect(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i.test(s)).toBe(true);
    }
    expect(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i.test("BUSINESS.hours.sunday")).toBe(false);
  });
});
