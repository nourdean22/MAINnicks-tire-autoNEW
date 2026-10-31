/**
 * Services and problem pages read like the shop wrote them (job 2026-10-30-antislop-humanizer-pages,
 * PR B). Same fence as humanizer-tells-home-tires.test.ts, over the files behind /services, the
 * GenericServicePage routes, the ProblemPage template (13 routes), /brakes, /diagnostics,
 * /check-engine-light-diagnostic and /synthetic-oil-change.
 *
 * Not covered on purpose: the emissions entries in shared/services.ts and
 * client/src/data/serviceConversionData.tsx. They feed /emissions, which GSC wave 1 (PR 3368)
 * measures until the 2026-12-10 read; editing them would muddy that read. Each exemption fails
 * once its date passes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sliceBlock } from "../../../server/testUtils/sourceBlock";

const APP = path.resolve(import.meta.dirname, "..", "..", "..");

const FILES = [
  "client/src/pages/ServicesOverview.tsx",
  "client/src/pages/GenericServicePage.tsx",
  "client/src/pages/ProblemPage.tsx",
  "client/src/pages/BrakeRepairPage.tsx",
  "client/src/pages/DiagnosticsPage.tsx",
  "client/src/pages/CheckEngineLightDiagnosticPage.tsx",
  "client/src/pages/SyntheticOilChangePage.tsx",
  "client/src/components/FocusedServicePage.tsx",
  "client/src/data/serviceConversionData.tsx",
  "shared/services.ts",
] as const;

/** GSC wave-1 blocks, cut out of the scan until the read. Markers must exist (sliceBlock throws). */
const EXEMPT_BLOCKS: { file: string; start: string; end: string; until: string }[] = [
  { file: "shared/services.ts", start: 'slug: "emissions"', end: 'slug: "oil-change"', until: "2026-12-10" },
  { file: "client/src/data/serviceConversionData.tsx", start: "  emissions: {", end: '  "ac-repair": {', until: "2026-12-10" },
];

export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/** Prose dashes: any em dash, a spaced double hyphen, or an en dash that is not a number range. */
const DASH = /—|&(?:mdash|#8212);|\s--\s|(?<![0-9%])–|–(?![0-9$])/;

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

const NEGATION_TAIL = /\bno [a-z'-]+,\s+no [a-z'-]+\b|[,.]\s+no (?:guessing|guesswork|games|gimmicks|surprises|pressure|upsells?)\b/i;

/** Lines retired in PR B, by quote. */
const RETIRED = [
  "that's it. No games",
  "No pressure, no upsells",
  "No guesswork. No unnecessary repairs",
  "No stock photos",
  "No pressure upsell",
  "Here's how.",
  "Whether you need a simple pad swap",
  "Whether you need brake repair",
  "no parts-swapping guesswork",
];

const read = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");

function scannable(rel: string): string {
  let src = stripComments(read(rel));
  for (const b of EXEMPT_BLOCKS.filter((e) => e.file === rel)) {
    src = src.split(sliceBlock(src, b.start, b.end, { label: rel })).join("");
  }
  return src;
}

describe("matchers catch what they claim (positive control)", () => {
  it("flags a planted dash and stacked tail, spares a number range, a placeholder and a comment", () => {
    expect(proseDashes("<p>Written quote — you approve first.</p>")).toHaveLength(1);
    expect(proseDashes('a: "Belt: 30 min–1 hr"')).toHaveLength(1);
    expect(proseDashes('a: "Pads -- rotors"')).toHaveLength(1);
    expect(proseDashes('miles: "7,500–10,000 mi", value: "$3,500–$5,500"')).toEqual([]);
    expect(proseDashes('const v = x ?? "—";')).toEqual([]);
    expect(proseDashes(stripComments("// a — comment\n/* b — c */"))).toEqual([]);
    expect(NEGATION_TAIL.test("Free check. No pressure, no upsells.")).toBe(true);
    expect(NEGATION_TAIL.test("to the exact component. No guesswork.")).toBe(true);
    expect(NEGATION_TAIL.test("No appointment needed.")).toBe(false);
  });
});

describe.each(FILES)("%s", (rel) => {
  const code = scannable(rel);

  it("has no prose dashes (outside the dated GSC blocks)", () => {
    expect(proseDashes(code)).toEqual([]);
  });

  it("has no stacked 'no X, no Y' tails", () => {
    expect(code.split("\n").filter((l) => NEGATION_TAIL.test(l))).toEqual([]);
  });

  it("carries none of the retired lines", () => {
    expect(RETIRED.filter((q) => code.includes(q))).toEqual([]);
  });
});

describe.each(EXEMPT_BLOCKS)("GSC exemption in $file", (b) => {
  it("still finds its block and has not expired ($until)", () => {
    expect(sliceBlock(read(b.file), b.start, b.end, { label: b.file }).length).toBeGreaterThan(200);
    expect(Date.now()).toBeLessThan(Date.parse(`${b.until}T23:59:59-05:00`));
  });
});
