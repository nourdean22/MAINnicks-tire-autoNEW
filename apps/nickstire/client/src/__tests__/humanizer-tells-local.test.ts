/**
 * City, neighborhood and near-me pages read like the shop wrote them (job
 * 2026-10-30-antislop-humanizer-pages, PR C), plus the meta DESCRIPTIONS in shared/routes.ts.
 * Titles are untouched on purpose (manager ruling 2026-10-30: descriptions only).
 *
 * Not covered on purpose:
 * - customer review text (a `text:` field next to an `author:`): a customer's words are
 *   evidence, not shop copy, and are never rewritten;
 * - the route descriptions of the GSC wave-1 pages (PR 3368), measured until the 2026-12-10
 *   read. The exemption fails once the date passes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..", "..", "..");

const FILES = [
  "shared/neighborhoods.ts",
  "shared/cities.ts",
  "client/src/pages/CityPage.tsx",
  "client/src/pages/NeighborhoodPage.tsx",
  "client/src/pages/TireShopNearMePage.tsx",
  "client/src/pages/AutoRepairNearMePage.tsx",
  "client/src/pages/AreasServed.tsx",
] as const;

const GSC_PATHS = ["/used-tires-cleveland", "/wheel-alignment-cleveland", "/emissions", "/alignment"];
const GSC_UNTIL = "2026-12-10";
// The job pages belong to the tech-hiring lane (PRs 3367/3370, 2026-10-30); their copy describes
// the job ("no pressure upsells" is a duty), so this pass leaves it to that lane.
const OWNED_ELSEWHERE = /^\/careers\//;

const DASH = /—|&(?:mdash|#8212);|\s--\s|(?<![0-9%])–|–(?![0-9$])/;
const NEGATION_TAIL = /\bno [a-z'-]+,\s+no [a-z'-]+\b|[,.]\s+no (?:guessing|guesswork|games|gimmicks|surprises|pressure|upsells?)\b/i;
const HONEST_DOUBLED = /\bhonest [a-z]+,\s+honest [a-z]+/i;

const read = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");

/** Comment lines and customer review lines removed; the rest is shop copy. */
export function shopCopyLines(src: string): string[] {
  const lines = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).split(/\r?\n/);
  return lines
    .map((l, i) => {
      if (/^\s*text:\s*["`]/.test(l) && /^\s*author:/.test(lines[i + 1] ?? "")) return "";
      return l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1");
    })
    .map((l) => l.replace(/(["'`])[—–]\1/g, "$1$1"));
}

/** Each route description with its path, skipping nothing. */
export function routeDescriptions(src: string): { path: string; description: string }[] {
  const out: { path: string; description: string }[] = [];
  for (const m of src.matchAll(/description:\s*(["`])((?:\\.|(?!\1).)*)\1/g)) {
    const before = src.slice(Math.max(0, (m.index ?? 0) - 600), m.index);
    const paths = [...before.matchAll(/path:\s*["`]([^"`]+)["`]/g)];
    out.push({ path: paths.length ? paths[paths.length - 1][1] : "", description: m[2] });
  }
  return out;
}

describe("matchers catch what they claim (positive control)", () => {
  it("flags planted tells, spares a number range, a placeholder and a customer quote", () => {
    expect(DASH.test("Pull up any day — no appointment")).toBe(true);
    expect(DASH.test("$30.00–$37.50/hr")).toBe(false);
    expect(NEGATION_TAIL.test("No appointment, no pressure, just a straight answer.")).toBe(true);
    expect(HONEST_DOUBLED.test("Honest parts, honest work.")).toBe(true);
    expect(shopCopyLines('    text: "Great — shop",\n    author: "A.",').join("\n")).not.toMatch(DASH);
    expect(shopCopyLines('    text: "Great — shop",\n    note: "x",').join("\n")).toMatch(DASH);
    expect(routeDescriptions('{ path: "/x", title: "T — a", description: "D" }')).toEqual([{ path: "/x", description: "D" }]);
  });
});

describe.each(FILES)("%s", (rel) => {
  const lines = shopCopyLines(read(rel));

  it("has no prose dashes in shop copy", () => {
    expect(lines.map((l, i) => (DASH.test(l) ? `${i + 1}: ${l.trim().slice(0, 90)}` : "")).filter(Boolean)).toEqual([]);
  });

  it("has no stacked 'no X, no Y' tails and no 'Honest X, honest Y'", () => {
    expect(lines.filter((l) => NEGATION_TAIL.test(l) || HONEST_DOUBLED.test(l)).map((l) => l.trim().slice(0, 90))).toEqual([]);
  });
});

describe("shared/routes.ts meta descriptions", () => {
  const all = routeDescriptions(read("shared/routes.ts"));
  const scanned = all.filter((d) => !GSC_PATHS.includes(d.path) && !OWNED_ELSEWHERE.test(d.path));

  it("reads every route description (the scanner saw its subject)", () => {
    expect(all.length).toBeGreaterThan(200);
    expect(scanned.length).toBeLessThan(all.length);
  });

  it("no description outside the GSC pages carries a prose dash, a stacked tail or a doubled 'honest'", () => {
    const bad = scanned.filter((d) => DASH.test(d.description) || NEGATION_TAIL.test(d.description) || HONEST_DOUBLED.test(d.description));
    expect(bad.map((d) => d.path)).toEqual([]);
  });

  it("the GSC exemption has not expired", () => {
    expect(Date.now()).toBeLessThan(Date.parse(`${GSC_UNTIL}T23:59:59-05:00`));
  });
});
