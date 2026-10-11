/**
 * Clicks and revenue predictions become measurable (operator "option 1", 2026-10-11).
 *
 * A prediction counts only with ALL THREE: a number, a measured metric (Google/search
 * clicks, or shop sales/revenue in dollars) and a time window. The window is in ET
 * dates, computed from the message time; UTC slicing puts a late-evening message on
 * the wrong day.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory } }));

import { extractPredictions, persistPrediction } from "@/lib/ai/outcome-calibration";

// Tue 2026-10-13 23:30 EDT. UTC already reads Wed 2026-10-14.
const TUE_LATE = new Date("2026-10-14T03:30:00Z");
// Sat 2026-10-17 23:30 EDT. UTC already reads Sun 2026-10-18, the next week.
const SAT_LATE = new Date("2026-10-18T03:30:00Z");

const measured = (text: string, at: Date) =>
  extractPredictions(text, at).filter((p) => p.metric === "clicks" || p.metric === "revenue");

describe("extractPredictions - clicks and revenue with a window", () => {
  it("'Expect about 40 Google clicks tomorrow' -> clicks 40, tomorrow in ET", () => {
    expect(measured("Expect about 40 Google clicks tomorrow.", TUE_LATE)).toEqual([
      expect.objectContaining({ metric: "clicks", value: 40, window: { from: "2026-10-14", to: "2026-10-14" } }),
    ]);
  });

  it("'Tire sales should land near $1,200 this week' -> revenue 1200, Sun-Sat week in ET", () => {
    expect(measured("Tire sales should land near $1,200 this week.", SAT_LATE)).toEqual([
      expect.objectContaining({ metric: "revenue", value: 1200, window: { from: "2026-10-11", to: "2026-10-17" } }),
    ]);
  });

  it("'1200 dollars' parses like '$1,200'", () => {
    expect(measured("I expect revenue around 1200 dollars today.", TUE_LATE)).toEqual([
      expect.objectContaining({ metric: "revenue", value: 1200, window: { from: "2026-10-13", to: "2026-10-13" } }),
    ]);
  });

  it("'next 7 days' starts tomorrow (ET) and spans 7 days across the week boundary", () => {
    expect(measured("We should get 300 search clicks over the next 7 days.", SAT_LATE)).toEqual([
      expect.objectContaining({ metric: "clicks", value: 300, window: { from: "2026-10-18", to: "2026-10-24" } }),
    ]);
  });

  it("a weekday is its next occurrence in ET ('Friday' from Tuesday night -> Oct 16)", () => {
    expect(measured("Sales should hit $2,500 on Friday.", TUE_LATE)).toEqual([
      expect.objectContaining({ metric: "revenue", value: 2500, window: { from: "2026-10-16", to: "2026-10-16" } }),
    ]);
  });

  it("finds one prediction per sentence", () => {
    const got = measured("Expect 40 Google clicks tomorrow. Revenue should be $900 tomorrow.", TUE_LATE);
    expect(got.map((p) => p.metric)).toEqual(["clicks", "revenue"]);
  });

  it.each([
    ["no number", "We should see more clicks than usual this week."],
    ["vague", "This post should do well tomorrow."],
    ["number without a window", "Expect about 40 Google clicks."],
    ["dollars without a window", "Tire sales should land near $1,200."],
    ["window and number, no measured metric", "Expect 40 visitors tomorrow."],
    ["a past weekday is not a window", "Last Friday we did $2,000 in sales."],
    ["a percent is not a click count", "Google clicks should rise 20% this week."],
    ["a percent spelled out is not a click count", "Google clicks should rise 15 percent this week."],
    // A reported actual scored against itself would inflate the accuracy rate.
    ["a report of today's actual is not a prediction", "Revenue today is $1,450 so far."],
    ["a report of clicks is not a prediction", "You got 40 Google clicks today."],
  ])("does not extract: %s", (_label, text) => {
    expect(measured(text, TUE_LATE)).toEqual([]);
  });
});

describe("extractPredictions - engagement and confidence unchanged (CONTROL)", () => {
  // Pinned from main as it is, duplicates included (one row per matching pattern).
  it("the existing engagement + confidence output is identical and carries no window", () => {
    expect(extractPredictions("I think this hits 350+ engagement. Confidence 80%.", TUE_LATE)).toEqual([
      { metric: "engagement", value: 350, rawMatch: "hits 350+ engagement" },
      { metric: "engagement", value: 350, rawMatch: "I think this hits 350" },
      { metric: "engagement", value: 350, rawMatch: "350+ engagement" },
      { metric: "confidence_pct", value: 80, rawMatch: "Confidence 80%" },
    ]);
  });
});

describe("persistPrediction - stores metric, value and window", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the window lands in the row's metadata.predictions", async () => {
    mocks.brainMemory.create.mockResolvedValueOnce({ id: "p1" });
    const predictions = extractPredictions("Expect about 40 Google clicks tomorrow.", TUE_LATE);
    await persistPrediction({ predictions, captionText: "caption" });
    const meta = mocks.brainMemory.create.mock.calls[0][0].data.metadata;
    expect(meta.predictions).toContainEqual(
      expect.objectContaining({ metric: "clicks", value: 40, window: { from: "2026-10-14", to: "2026-10-14" } }),
    );
    expect(meta.resolved).toBe(false);
  });
});
