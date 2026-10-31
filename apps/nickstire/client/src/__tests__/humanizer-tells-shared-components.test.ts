/**
 * The shared components that render on every page read like the shop wrote them (job
 * 2026-10-30-antislop-humanizer-pages, PR G, manager approval 2026-10-31).
 *
 * Scope: every public component under client/src/components. admin/ is not public, and
 * competitor/ComparisonPage.tsx is covered by humanizer-tells-about-compare.test.ts.
 * The exceptions are named one by one below, each with its reason; there is no pattern exemption.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..", "..", "..");
const ROOT = "client/src/components";
const SKIP = /(^|\/)(admin|__tests__)\/|competitor\/ComparisonPage\.tsx$|\.test\.tsx?$/;

const DASH = /—|&(?:mdash|#8212);|\s--\s|(?<![0-9%])(?<![0-9][ap]m)–|–(?![0-9$])/;
const NEGATION_TAIL =
  /\bno [a-z'-]+,\s+no [a-z'-]+\b|[,.]\s+no (?:guessing|guesswork|games|gimmicks|surprises|pressure|upsells?|upselling|spin|obligation)\b/i;

/** Text that keeps its dash on purpose: file -> exact substring and why. */
const EXEMPT: { file: string; text: string; why: string }[] = [
  { file: "CityReviewsBlock.tsx", text: "&mdash; {review.name}", why: "review attribution, a typographic convention" },
  { file: "ServiceReviewsBlock.tsx", text: "&mdash; {review.name}", why: "review attribution, a typographic convention" },
  { file: "conversion/FrictionlessIntentPanel.tsx", text: "TIRE QUOTE (plate lookup) — plate", why: "internal ticket text the desk reads, not page copy" },
  { file: "DropOffRequestCard.tsx", text: "` — ${carAndNeed", why: "internal ticket text the desk reads, not page copy" },
  { file: "Map.tsx", text: "not set — maps disabled", why: "developer console warning" },
  { file: "SiteFooter.tsx", text: "Mon–Sat 8–6", why: "day range, same form as BUSINESS.hours" },
];

const RETIRED = [
  "No appointments to chase, no drop-off needed",
  "never has been",
  "No login, no form",
  "head-to-head, no spin",
  "first come first serve!",
];

function listFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(APP, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) listFiles(rel, out);
    else if (/\.tsx?$/.test(e.name) && !SKIP.test(rel)) out.push(rel);
  }
  return out;
}

/** Comment text (including JSX comments) blanked, lone-dash placeholders blanked; the rest is copy. */
export function copyLines(src: string): string[] {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1").replace(/(["'`])[—–]\1/g, "$1$1"));
}

const FILES = listFiles(ROOT);

describe("matchers catch what they claim (positive control)", () => {
  it("flags planted tells and spares ranges, placeholders and comments", () => {
    expect(DASH.test("Saturday gets slammed — pull up early")).toBe(true);
    expect(DASH.test("$40–80")).toBe(false);
    expect(NEGATION_TAIL.test("No login, no form. Just read it.")).toBe(true);
    expect(copyLines('{x ?? "—"}').join("\n")).not.toMatch(DASH);
    expect(copyLines("{/* note — internal */}").join("\n")).not.toMatch(DASH);
    expect(copyLines("  // note — internal").join("\n")).not.toMatch(DASH);
    expect(copyLines('<p>Got it — the desk knows</p>').join("\n")).toMatch(DASH);
  });

  it("scans the public components (the scanner saw its subject)", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((f) => f.endsWith("InternalLinks.tsx"))).toBe(true);
    expect(FILES.some((f) => f.startsWith(`${ROOT}/admin/`))).toBe(false);
  });

  it("every exemption still exists (a stale exemption hides nothing and must go)", () => {
    for (const e of EXEMPT) expect(fs.readFileSync(path.join(APP, ROOT, e.file), "utf8"), e.file).toContain(e.text);
  });
});

describe("public components", () => {
  it("carry no prose dash outside the named exemptions", () => {
    const bad: string[] = [];
    for (const rel of FILES) {
      const exempt = EXEMPT.filter((e) => rel.endsWith(e.file)).map((e) => e.text);
      copyLines(fs.readFileSync(path.join(APP, rel), "utf8")).forEach((l, i) => {
        if (DASH.test(l) && !exempt.some((t) => l.includes(t))) bad.push(`${rel}:${i + 1}: ${l.trim().slice(0, 80)}`);
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
