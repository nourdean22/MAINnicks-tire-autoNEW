/**
 * getSwipeFileSamples — the DB join that makes attentionMicrostructure.ts's
 * comparator queryable instead of a script the operator has to remember to
 * run by hand. Failure mode this guards: a DB outage or one unparsable
 * payload must degrade to an empty/partial sample set, never throw and
 * never silently blank out every OTHER reel's data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let rows: unknown[] | Error = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async () => {
      if (rows instanceof Error) throw rows;
      return [rows];
    },
  }),
}));

import { getSwipeFileSamples } from "./services/attentionMicrostructureStore";

const row = (over: Record<string, unknown> = {}) => ({
  jobId: 1,
  payload: JSON.stringify({
    storyboardBeats: [{ beatNumber: 1, visual: "close-up of tread", onScreenText: "Grinding means metal on metal", endSecond: 4 }],
    ctaType: "send",
  }),
  reach: 1000,
  saved: 20,
  shares: 10,
  skipRate: "0.42",
  ...over,
});

describe("getSwipeFileSamples", () => {
  beforeEach(() => { rows = []; });

  it("joins hook + beat-structure signals to per-reach save/share rates and skip rate", async () => {
    rows = [row()];
    const [s] = await getSwipeFileSamples();
    expect(s.jobId).toBe(1);
    expect(s.hook.textIsClaim).toBe(true);
    expect(s.beatStructure.hasCta).toBe(true);
    expect(s.metrics.savesPerReach).toBeCloseTo(0.02);
    expect(s.metrics.sharesPerReach).toBeCloseTo(0.01);
    expect(s.metrics.skipRate).toBeCloseTo(0.42);
  });

  it("a null metric column stays null, never coerced to zero", async () => {
    rows = [row({ saved: null, shares: null, skipRate: null })];
    const [s] = await getSwipeFileSamples();
    expect(s.metrics.savesPerReach).toBeNull();
    expect(s.metrics.sharesPerReach).toBeNull();
    expect(s.metrics.skipRate).toBeNull();
  });

  it("zero reach cannot produce a rate — null, not Infinity or a divide-by-zero", async () => {
    rows = [row({ reach: 0 })];
    const [s] = await getSwipeFileSamples();
    expect(s.metrics.savesPerReach).toBeNull();
    expect(s.metrics.sharesPerReach).toBeNull();
  });

  it("one unparsable payload is skipped, not thrown, and does not blank out the rest", async () => {
    rows = [row({ jobId: 1, payload: "not json" }), row({ jobId: 2 })];
    const samples = await getSwipeFileSamples();
    expect(samples.map((s) => s.jobId)).toEqual([2]);
  });

  it("a job with no beats at all is skipped rather than crashing on undefined", async () => {
    rows = [row({ payload: JSON.stringify({ storyboardBeats: [] }) })];
    await expect(getSwipeFileSamples()).resolves.toEqual([]);
  });

  it("a DB error degrades to an empty list instead of throwing", async () => {
    rows = new Error("connection refused");
    await expect(getSwipeFileSamples()).resolves.toEqual([]);
  });
});
