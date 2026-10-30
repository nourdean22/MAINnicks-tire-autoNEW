/**
 * Upgrade 3 of the Home maxim (2026-10-30): the decision page and the top pending approval each show one
 * decisions maxim (DecisionMaxim, behaviour pinned in tests/components/home-maxim-line.test.tsx). Neither page
 * has a render test, so this pins the wiring: each page renders DecisionMaxim with its own label and the
 * decision's own words, and the actions page renders it once, on the first card, not on every card.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "../..");
const code = (rel: string) =>
  readFileSync(path.join(APP, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

describe("decision surfaces render one decisions maxim", () => {
  it("/decisions/[id] shows it with the decision's title and context, worded for this decision", () => {
    const src = code("app/(mastery)/decisions/[id]/page.tsx");
    expect(src).toMatch(/<DecisionMaxim\s[^>]*label="for this decision"/);
    expect(src).toMatch(/<DecisionMaxim\s[^>]*text=\{\[d\.title, d\.context\]/);
  });

  it("/system/actions shows it on the first pending approval only, from that request's reason", () => {
    const src = code("app/(mastery)/system/actions/page.tsx");
    const uses = src.match(/<DecisionMaxim\b/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(src).toMatch(/index === 0 &&\s*\(?\s*<DecisionMaxim\s[^>]*text=\{req\.reason[^}]*\}[^>]*label="for this approval"/);
  });
});
