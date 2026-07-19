/**
 * decideContentFormat — the axis the shadow planner did not have.
 *
 * Two properties matter more than any individual rule:
 *   1. PURITY. Same signals, same decision, no I/O. A source scan enforces it,
 *      mirroring the guard already protecting shadowPlanner.
 *   2. NO FABRICATED CONFIDENCE. Thin evidence must produce a decision that SAYS
 *      it is thin. A confident-sounding default is how a guess gets mistaken for
 *      an analysis — this repo has already shipped a fabricated percentage table
 *      and a hardcoded "Tuesdays at 4:30 PM" presented as a finding.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  decideContentFormat, emptyFormatSignals, CONTENT_FORMAT,
  type FormatSignals, type ContentFormat,
} from "./services/contentFormatPlanner";

/** Build signals with everything available, then override what a test cares about. */
const signals = (over: Partial<FormatSignals> = {}): FormatSignals => ({
  recentFormats: { available: true, values: [] },
  mediaOnHand: { available: true, clipCount: 0, photoCount: 0 },
  budget: { available: true, remainingCents: 5000 },
  performance: { available: true, byFormat: {} },
  objective: { available: true, value: null },
  urgency: { available: true, isUrgent: false },
  ...over,
});

const runOf = (f: ContentFormat, n = 3) => Array.from({ length: n }, () => f);

describe("purity — the guarantee the whole planner rests on", () => {
  it("imports nothing that could generate, publish, or touch a database", () => {
    const src = readFileSync(resolve(process.cwd(), "server/services/contentFormatPlanner.ts"), "utf8");
    for (const forbidden of [
      "higgsfieldStudio", "metaSocial", "socialPublish", "reelPipeline", "generationLedger",
      "contentGovernor", "invokeLLM", "_core/llm", "selectiveRepair", "reelBriefGen",
      "carouselBriefGen", "checkWeatherTriggers", "drizzle/schema", "../db",
    ]) {
      expect(src.includes(forbidden), `contentFormatPlanner must not reference ${forbidden}`).toBe(false);
    }
  });

  it("is deterministic — the same signals decide the same way", () => {
    const s = signals({ mediaOnHand: { available: true, clipCount: 6, photoCount: 0 } });
    const a = decideContentFormat(s);
    const b = decideContentFormat(s);
    expect(a).toEqual(b);
  });
});

describe("urgency outranks everything", () => {
  it("chooses a story when there is something time-sensitive to say", () => {
    const d = decideContentFormat(signals({
      urgency: { available: true, isUrgent: true },
      mediaOnHand: { available: true, clipCount: 10, photoCount: 0 },
    }));
    // Even with free footage sitting there, urgency wins — a story's 24-hour
    // lifespan is the point.
    expect(d.format).toBe(CONTENT_FORMAT.story);
    expect(d.codes).toContain("urgency_present");
  });
});

describe("cost gates the reel", () => {
  it("chooses a reel when there is enough footage to make one FREE", () => {
    const d = decideContentFormat(signals({ mediaOnHand: { available: true, clipCount: 5, photoCount: 0 } }));
    expect(d.format).toBe(CONTENT_FORMAT.reel);
    expect(d.codes).toContain("reel_free");
    expect(d.reason).toMatch(/costs nothing new/i);
  });

  it("does NOT choose a paid reel when the budget is below the floor", () => {
    const d = decideContentFormat(signals({
      mediaOnHand: { available: true, clipCount: 0, photoCount: 0 },
      budget: { available: true, remainingCents: 100 },
    }));
    expect(d.format).not.toBe(CONTENT_FORMAT.reel);
    expect(d.codes).toContain("budget_below_reel_floor");
  });

  it("falls to a single post when budget is low AND carousels are fatigued", () => {
    const d = decideContentFormat(signals({
      mediaOnHand: { available: true, clipCount: 0, photoCount: 0 },
      budget: { available: true, remainingCents: 100 },
      recentFormats: { available: true, values: runOf(CONTENT_FORMAT.carousel) },
    }));
    expect(d.format).toBe(CONTENT_FORMAT.single);
    expect(d.codes).toEqual(expect.arrayContaining(["budget_below_reel_floor", "carousel_fatigue"]));
  });
});

describe("objective shapes the form, but never overrides cost", () => {
  it("an educational objective gets a carousel", () => {
    const d = decideContentFormat(signals({ objective: { available: true, value: "educate_owners" as never } }));
    expect(d.format).toBe(CONTENT_FORMAT.carousel);
    expect(d.codes).toContain("objective_educational");
  });

  it("an offer gets a single post", () => {
    const d = decideContentFormat(signals({ objective: { available: true, value: "seasonal_offer" as never } }));
    expect(d.format).toBe(CONTENT_FORMAT.single);
    expect(d.codes).toContain("objective_offer");
  });

  it("an educational objective does NOT unlock a reel the budget cannot afford", () => {
    // Cost is checked BEFORE objective, deliberately: what we want to say never
    // justifies spending money we do not have.
    const d = decideContentFormat(signals({
      objective: { available: true, value: "educate_owners" as never },
      mediaOnHand: { available: true, clipCount: 0, photoCount: 0 },
      budget: { available: true, remainingCents: 50 },
    }));
    expect(d.format).not.toBe(CONTENT_FORMAT.reel);
  });
});

describe("format fatigue", () => {
  it("breaks a run of three identical formats", () => {
    const d = decideContentFormat(signals({
      recentFormats: { available: true, values: runOf(CONTENT_FORMAT.single) },
    }));
    expect(d.format).not.toBe(CONTENT_FORMAT.single);
    expect(d.codes).toContain("format_fatigue");
  });

  it("does NOT fire on a run shorter than the window", () => {
    const d = decideContentFormat(signals({
      recentFormats: { available: true, values: runOf(CONTENT_FORMAT.single, 2) },
    }));
    expect(d.codes).not.toContain("format_fatigue");
  });

  it("refuses a FREE reel when reels are what the feed is tired of", () => {
    const d = decideContentFormat(signals({
      mediaOnHand: { available: true, clipCount: 8, photoCount: 0 },
      recentFormats: { available: true, values: runOf(CONTENT_FORMAT.reel) },
    }));
    expect(d.format).not.toBe(CONTENT_FORMAT.reel);
  });
});

describe("confidence follows the evidence, not the preference", () => {
  it("grades LOW when almost nothing is available", () => {
    const d = decideContentFormat(emptyFormatSignals());
    expect(d.confidence).toBe("low");
    expect(d.signalsMissing.length).toBeGreaterThanOrEqual(4);
  });

  it("SAYS the evidence was thin instead of sounding certain", () => {
    const d = decideContentFormat(emptyFormatSignals());
    expect(d.codes).toContain("evidence_starved");
    expect(d.reason).toMatch(/treat it as a default, not a recommendation/i);
  });

  it("grades HIGH only when nearly every signal is present", () => {
    expect(decideContentFormat(signals()).confidence).toBe("high");
  });

  it("names the missing signals rather than hiding them", () => {
    const d = decideContentFormat(signals({ budget: { available: false, remainingCents: 0 } }));
    expect(d.signalsMissing).toContain("budget");
    expect(d.signalsUsed).toContain("mediaOnHand");
  });

  it("confidence is a word, never a fabricated percentage", () => {
    // A number implies a calibration nobody measured. This repo already shipped
    // a "70-75% readiness" table with no derivation behind it.
    const d = decideContentFormat(signals());
    expect(["low", "moderate", "high"]).toContain(d.confidence);
    expect(String(d.confidence)).not.toMatch(/\d/);
  });
});

describe("every decision explains itself", () => {
  it("always carries an operator-readable reason and machine codes", () => {
    for (const s of [emptyFormatSignals(), signals(), signals({ urgency: { available: true, isUrgent: true } })]) {
      const d = decideContentFormat(s);
      expect(d.reason.length).toBeGreaterThan(20);
      expect(d.codes.length).toBeGreaterThan(0);
    }
  });
});
