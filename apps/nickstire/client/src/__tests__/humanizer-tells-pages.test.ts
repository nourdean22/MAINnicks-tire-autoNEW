/**
 * Every public page reads like the shop wrote it (job 2026-10-30-antislop-humanizer-pages, PR H,
 * manager GO 2026-10-31 12:02Z). Scans all of client/src/pages plus shared/seo-pages.ts.
 *
 * Out of scope by ruling, each named:
 * - the GSC wave-1 pages (used tires, wheel alignment), measured until the 2026-12-10 read;
 *   the exemption fails once the date passes;
 * - Careers and JobPage (owned by the tech-hiring lane);
 * - HomeLegacy and TireFinderLegacy (not routed; deletion candidates);
 * - admin pages (not public).
 * Blanked on every line: page titles and meta titles (untouched by ruling), internal desk strings
 * (`problem:`), customer review text (a `text:` line followed by an `author:` line), code and JSX
 * comments, a lone "—" placeholder glyph, and the GSC-pinned TireFinderV2 line. Number and clock ranges
 * keep their en dash, including a range between two `{...}` price expressions.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..", "..", "..");
const PAGES = "client/src/pages";
const EXCLUDED = [
  "UsedTiresClevelandPage.tsx",
  "WheelAlignmentClevelandPage.tsx",
  "Careers.tsx",
  "JobPage.tsx",
  "HomeLegacy.tsx",
  "TireFinderLegacy.tsx",
];
const GSC_UNTIL = "2026-12-10";
/** The GSC wave-1 used-tire card in TireFinderV2, pinned by humanizer-tells-home-tires.test.ts until GSC_UNTIL. */
const GSC_LINE = "When the damage isn't repairable — mounted from our in-stock inventory";

const DASH = /—|&(?:mdash|#8212);|\s--\s|(?<![0-9%])(?<![0-9] ?[ap]m)–|–(?![0-9$])/i;
const NEGATION_TAIL =
  /\bno [a-z'-]+,\s+no [a-z'-]+\b|[,.]\s+no (?:guessing|guesswork|games|gimmicks|surprises|pressure|upsells?|upselling|spin|obligation)\b/i;
const TITLE = /\b(?:title|metaTitle|seoTitle)\s*[:=]/;
const RETIRED = [
  "No pressure, no pushy mechanics",
  "No gimmicks. Just real rewards",
  "no app, no login screen, no typing",
  "No runaround, no repeating yourself",
  "The corner you trusted",
];

function listPages(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(APP, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "admin" && e.name !== "__tests__") listPages(rel, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !EXCLUDED.includes(e.name)) out.push(rel);
  }
  return out;
}

/** Lines of copy with titles, desk strings, review quotes, comments and placeholders blanked. */
export function copyLines(src: string): string[] {
  const lines = src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/);
  return lines.map((l, i) => {
    if (TITLE.test(l) || /^\s*problem:\s*[`"]/.test(l)) return "";
    if (/^\s*text:\s*["`]/.test(l) && /^\s*author:/.test(lines[i + 1] ?? "")) return "";
    return l
      .replace(/(^|[^:"'`\\])\/\/.*$/, "$1")
      .replace(/(["'`])[—–]\1/g, "$1$1")
      .replace(/>\s*—\s*</g, "><")
      .replace(/\}\s?–\s?(?=\$?\{|$)/g, "} ")
      .replace(GSC_LINE, "");
  });
}

const FILES = [...listPages(PAGES), "shared/seo-pages.ts"];

describe("matchers catch what they claim (positive control)", () => {
  it("flags planted tells and spares ranges, titles, desk strings, quotes and placeholders", () => {
    expect(DASH.test("Saturday gets slammed — pull up early")).toBe(true);
    expect(DASH.test("Monday–Saturday")).toBe(true);
    expect(DASH.test("Sunday 9 AM–4 PM")).toBe(false);
    expect(DASH.test("$40–80")).toBe(false);
    expect(copyLines('    title: "Brakes — Cleveland",').join("\n")).not.toMatch(DASH);
    expect(copyLines('<SEOHead title={`Inspection — ${x}`} />').join("\n")).not.toMatch(DASH);
    expect(copyLines("    problem: `Fleet — ${x}`,").join("\n")).not.toMatch(DASH);
    expect(copyLines('    text: "Great shop — fast",\n    author: "A.",').join("\n")).not.toMatch(DASH);
    expect(copyLines('    text: "Great shop — fast",\n    note: "x",').join("\n")).toMatch(DASH);
    expect(copyLines('<div className="x">—</div>').join("\n")).not.toMatch(DASH);
    expect(copyLines("  /** Slug — of the article */").join("\n")).not.toMatch(DASH);
    expect(copyLines("  ${x.low} – ${x.high}").join("\n")).not.toMatch(DASH);
    expect(copyLines("  {x.hoursLow}–").join("\n")).not.toMatch(DASH);
    expect(copyLines("  {x.name} – call us").join("\n")).toMatch(DASH);
  });

  it("scans the public pages (the scanner saw its subject)", () => {
    expect(FILES.length).toBeGreaterThan(80);
    expect(FILES).toContain("client/src/pages/BlogPost.tsx");
    expect(FILES.some((f) => f.includes("/admin/"))).toBe(false);
    for (const x of EXCLUDED) expect(fs.existsSync(path.join(APP, PAGES, x)), x).toBe(true);
    expect(fs.readFileSync(path.join(APP, PAGES, "TireFinderV2.tsx"), "utf8")).toContain(GSC_LINE);
  });

  it("the GSC exemption has not expired", () => {
    expect(Date.now()).toBeLessThan(Date.parse(`${GSC_UNTIL}T23:59:59-05:00`));
  });
});

describe("public pages and shared/seo-pages.ts", () => {
  it("carry no prose dash in copy", () => {
    const bad: string[] = [];
    for (const rel of FILES) {
      copyLines(fs.readFileSync(path.join(APP, rel), "utf8")).forEach((l, i) => {
        if (DASH.test(l)) bad.push(`${rel}:${i + 1}: ${l.trim().slice(0, 80)}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("carry no stacked 'no X, no Y' tails and none of the retired lines", () => {
    const bad: string[] = [];
    for (const rel of FILES) {
      const src = fs.readFileSync(path.join(APP, rel), "utf8");
      copyLines(src).forEach((l, i) => { if (NEGATION_TAIL.test(l)) bad.push(`${rel}:${i + 1}: ${l.trim().slice(0, 80)}`); });
      for (const r of RETIRED) if (src.includes(r)) bad.push(`${rel}: retired "${r}"`);
    }
    expect(bad).toEqual([]);
  });
});
