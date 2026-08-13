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

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)),
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

  it("a DB error degrades to empty history instead of throwing", async () => {
    rows = new Error("connection refused");
    await expect(getRecentReelSignals()).resolves.toEqual({
      topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [],
    });
  });

  it("no rows in the window is empty history, not an error", async () => {
    rows = [];
    const signals = await getRecentReelSignals();
    expect(signals).toEqual({ topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [] });
  });
});
