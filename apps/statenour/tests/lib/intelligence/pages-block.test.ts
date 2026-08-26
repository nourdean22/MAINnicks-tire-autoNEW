/**
 * Page counts reach the brief. The psychological reads do not.
 *
 * `page-intelligence.ts` had zero production consumers. It works — probed
 * against prod 2026-08-26, 57ms, a 460-char report. But its output mixes two
 * different kinds of statement:
 *
 *   FACT       "Most visited (7d): /(68), /chat(62), /missions(45)"
 *   FACT       "not visited in 3+ days: Stats, Business, Strategy"
 *   FACT       "21 visits after 11pm"
 *   INFERENCE  "correlates with overthinking and poor next-day performance"
 *   INFERENCE  "Nour may be using conversation as procrastination"
 *
 * The inferences may be right. They are still unearned by anything this module
 * measured — it counted page rows; it did not measure next-day performance or
 * procrastination. And the destination has a documented history with exactly
 * that: 26 of the brief's last 32 editions (81.3%) carried CRITICAL, and the
 * marker was INVERTED at both extremes. A confident psychological read on that
 * surface is the same defect with a new source.
 *
 * The last describe block is the one that matters: it asserts the composer never
 * touches `insights`. Without it, "facts only" is a comment, not a property.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  renderPagesBlock,
  LATE_NIGHT_FLOOR,
  type PageFacts,
} from "@/lib/intelligence/pages-block";

/** The shape prod returned on 2026-08-26. */
const LIVE: PageFacts = {
  topPages: [
    { page: "/", count: 68 },
    { page: "/chat", count: 62 },
    { page: "/missions", count: 45 },
    { page: "/journal", count: 15 },
    { page: "/brain", count: 12 },
  ],
  blindSpots: ["Stats", "Business", "Strategy"],
  lateNightCount: 21,
  avgDailyVisits: 30,
};

describe("renderPagesBlock · counts, verbatim", () => {
  it("prints the real numbers, not adjectives", () => {
    const out = renderPagesBlock(LIVE);
    expect(out).toContain("/chat (62)");
    expect(out).toContain("68");
    expect(out).toMatch(/~30 views\/day/);
  });

  it("names the blind spots, because that is the actionable half", () => {
    const out = renderPagesBlock(LIVE);
    for (const s of LIVE.blindSpots) expect(out).toContain(s);
    expect(out).toMatch(/3\+ days/);
  });

  it("THE COUNT, NOT THE BOOLEAN: 21 after 11pm, with no claim attached", () => {
    // `lateNightUsage` is `lateNightCount > 3` — that threshold is somebody's
    // opinion about what counts as a lot. The number lets the reader decide.
    const out = renderPagesBlock(LIVE);
    expect(out).toContain("21 visits after 11pm");
    expect(out, "no diagnosis may ride along").not.toMatch(/overthink|procrastinat|poor next-day/i);
  });

  it("stays quiet when the late-night count is noise", () => {
    const quiet = renderPagesBlock({ ...LIVE, lateNightCount: LATE_NIGHT_FLOOR });
    expect(quiet).not.toMatch(/after 11pm/);
  });

  it("EMPTY IS NOT UNMEASURED", () => {
    const measured = renderPagesBlock({ ...LIVE, topPages: [] });
    expect(measured).toMatch(/no page visits recorded/i);
    expect(measured).not.toContain("UNMEASURED");

    const failed = renderPagesBlock(null);
    expect(failed).toContain("UNMEASURED");
    expect(failed).toMatch(/not a claim/i);
  });

  it("POSITIVE CONTROL: a real render is substantial, not a bare heading", () => {
    const out = renderPagesBlock(LIVE);
    expect(out.split("\n").filter((l) => l.trim()).length).toBeGreaterThan(3);
    expect(out).toContain("## Attention · surfaces");
  });
});

describe("the wiring · facts cross the boundary, inference does not", () => {
  const composer = () => readFileSync("lib/intelligence/compose-daily-brief.ts", "utf8");

  it("the composer renders it and it reaches the returned text", () => {
    const src = composer();
    expect(src).toContain("renderPagesBlock");
    expect(src).toContain("analyzePagePatterns");
    expect(src).toMatch(/\$\{pagesBlock\}/);
  });

  it("THE EXCLUSION: the composer never touches `insights`", () => {
    // The load-bearing assertion of this file. Comments stripped, because the
    // composer EXPLAINS why insights are excluded and naming them in prose is
    // not passing them — a distinction an earlier canary of mine got wrong.
    const code = composer()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("insights");
    expect(code).not.toContain("lateNightUsage"); // the boolean, not the count
  });

  it("THE CONTRACT: pagesBlock is NOT handed to generateText", () => {
    const src = composer();
    const promptStart = src.indexOf("const promptText =");
    const promptEnd = src.indexOf("const queue = await loadOperatorQueue()");
    expect(promptStart).toBeGreaterThan(-1);
    expect(promptEnd).toBeGreaterThan(promptStart);
    const region = src.slice(promptStart, promptEnd);
    expect(region).not.toContain("pagesBlock");
    expect(region).not.toContain("analyzePagePatterns");
  });

  it("a failed read cannot take the block with it", () => {
    const src = composer();
    const at = src.indexOf("pagesBlock = renderPagesBlock({");
    expect(at).toBeGreaterThan(-1);
    const around = src.slice(Math.max(0, at - 300), at + 500);
    expect(around).toMatch(/try\s*\{/);
    expect(around).toMatch(/renderPagesBlock\(null\)/);
  });
});
