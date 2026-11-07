/**
 * GSC 2026-11-07 audit, section 1: alignment demand sat on page 2 for the
 * "near me" phrasings (141 queries, 3,941 impressions, position ~15). The page
 * must carry the exact phrases people type, in the H1, the intro and the FAQ,
 * and the two hub pages must link to it with the same words.
 *
 * Source-level, like seo-title-single-source.test.ts: no DOM, runs before any
 * prerender refresh. The <title> is NOT asserted here; it comes from the
 * route registry (seo-title-single-source.test.ts pins that).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sliceBlock } from "../../../server/testUtils/sourceBlock";

const PAGES = resolve(process.cwd(), "client/src/pages");
const read = (file: string) => readFileSync(resolve(PAGES, file), "utf8");
const page = read("WheelAlignmentClevelandPage.tsx");

/** The config object between buildConfig and the default export: live copy only. */
const config = sliceBlock(page, "const buildConfig", "export default function", { label: "WheelAlignmentClevelandPage" });
const copy = config.replace(/^\s*\/\/.*$/gm, "");
/** Description, eyebrow, H1 and intro: the lines this change owns (the pricing block below is older copy). */
const head = sliceBlock(copy, "description:", "startingPrice:", { label: "alignment head copy" });

describe("/wheel-alignment-cleveland carries the page-1 phrasings", () => {
  it.each([
    ["wheel alignment near me", /wheel alignment near me/i],
    ["4 wheel alignment", /\b4[ -]wheel alignment/i],
    ["car alignment near me", /car alignment near me/i],
    ["alignment cost", /alignment cost/i],
    ["alignment check", /alignment check/i],
  ])("says %s", (_label, re) => {
    expect(copy).toMatch(re);
  });

  it("leads the H1 and the intro with the near-me phrase", () => {
    expect(copy).toMatch(/h1:\s*"WHEEL ALIGNMENT NEAR ME/);
    expect(copy).toMatch(/sub:[^\n]*wheel alignment near me/i);
  });

  it("takes address and walk-in facts from BUSINESS, not literals", () => {
    expect(copy).toMatch(/BUSINESS\.address\.street/);
    expect(copy).toMatch(/BUSINESS\.model\.walkIns/);
  });

  it("keeps the shop voice in the head and intro: no exclamation mark, em dash, guarantee or 'financing'", () => {
    expect(head).not.toMatch(/!/);
    expect(head).not.toMatch(/—/);
    expect(head).not.toMatch(/guarantee/i);
    expect(head).not.toMatch(/financing/i);
  });

  it("adds no dollar figure to the head or intro (prices stay in tiers and the existing FAQ)", () => {
    expect(head).not.toMatch(/\$\d/);
  });
});

describe("hub pages link to the alignment page with the same words", () => {
  it("homepage browse block anchor says 'near me'", () => {
    expect(read("Home.tsx")).toMatch(/<a href="\/wheel-alignment-cleveland"[^>]*>Wheel Alignment Near Me<\/a>/);
  });
  it("/services quick path says 'near me'", () => {
    expect(read("ServicesOverview.tsx")).toMatch(
      /href: "\/wheel-alignment-cleveland", title: "STEERING", detail: "Alignment near me"/,
    );
  });
});
