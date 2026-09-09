/**
 * getRecentReelSignals reads reel_jobs and reduces each payload to the fields
 * buildRepetitionChecks compares against. The failure mode this guards
 * against is silent: a DB outage or one bad row must degrade to "no memory"
 * (never block generation), never throw, and never let one unparsable row
 * blank out the rest of the window.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let rows: Array<{ payload: string }> | Error = [];

vi.mock("../drizzle/schema", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, reelJobs: {} };
});

/** A promise carrying a chained .orderBy().limit() that resolves to the same
 *  value, so the mock satisfies the real `.where().orderBy().limit()` chain. */
function thenable(value: unknown[] | Error) {
  const p = value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  p.catch(() => {});
  return Object.assign(p, { orderBy: () => Object.assign(Promise.resolve(value), { limit: () => p }) });
}

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => thenable(rows),
      }),
    }),
  }),
}));

import { getRecentReelSignals } from "./services/reelRepetitionHistory";

const jobRow = (fields: Partial<{ topic: string; campaignKeyword: string; archetype: string; motionLens: string; objectCharacter: string }>) => ({
  payload: JSON.stringify(fields),
});

describe("getRecentReelSignals", () => {
  beforeEach(() => { rows = []; });

  it("extracts topic/keyword/archetype/motionLens/objectCharacter from each job's payload", async () => {
    rows = [
      jobRow({ topic: "bald tires", campaignKeyword: "PRESSURE", archetype: "myth_bust", motionLens: "handheld", objectCharacter: "tire" }),
      jobRow({ topic: "brake squeal", campaignKeyword: "BRAKES" }),
    ];
    const signals = await getRecentReelSignals();
    expect(signals.topics).toEqual(["bald tires", "brake squeal"]);
    expect(signals.keywords).toEqual(["PRESSURE", "BRAKES"]);
    expect(signals.archetypes).toEqual(["myth_bust"]);
  });

  it("one unparsable payload does not blank out the rest of the window", async () => {
    rows = [{ payload: "not json" }, jobRow({ topic: "good row" })];
    const signals = await getRecentReelSignals();
    expect(signals.topics).toEqual(["good row"]);
  });

  it("a DB error degrades to empty history AND says it could not look", async () => {
    rows = new Error("connection refused");
    // available:false is the load-bearing half. Empty arrays alone are
    // indistinguishable from a quiet week, and read that way an outage scores
    // as perfect originality - so the flag is asserted, not just the shape.
    await expect(getRecentReelSignals()).resolves.toEqual({
      topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [],
      available: false,
    });
  });

  it("no rows in the window is empty history, not an error - and it says it DID look", async () => {
    rows = [];
    const signals = await getRecentReelSignals();
    expect(signals).toEqual({
      topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [],
      available: true,
    });
    // The pair below is the entire point: identical arrays, opposite meanings.
    expect(signals.available).toBe(true);
  });
});
