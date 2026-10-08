/**
 * getRecentReelSignals reads reel_jobs and reduces each payload to the fields
 * buildRepetitionChecks compares against. The failure mode this guards
 * against is silent: a DB outage or one bad row must degrade to "no memory"
 * (never block generation), never throw, and never let one unparsable row
 * blank out the rest of the window.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let rows: Array<{ payload: string; createdAt?: Date }> | Error = [];

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

import {
  classifyCtaFamily,
  durationBucket,
  getRecentReelSignals,
} from "./services/reelRepetitionHistory";
import { classifyHookGrammar } from "../shared/reelHookGrammar";

const EMPTY_SHAPE = {
  topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [],
  hookGrammars: [], structurePatternIds: [], ctaFamilies: [], durationBuckets: [], topicAges: [],
};

const jobRow = (
  fields: Partial<{
    topic: string; campaignKeyword: string; archetype: string; motionLens: string; objectCharacter: string;
    structurePatternId: string; selectedCaption: string; ask: { kind: string };
    storyboardBeats: Array<{ beatNumber: number; startSecond: number; endSecond: number; onScreenText: string }>;
  }>,
  createdAt?: Date,
) => ({ payload: JSON.stringify(fields), ...(createdAt ? { createdAt } : {}) });

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

  it("surfaces hook grammar, structure id, CTA family, duration bucket and topic age (Wave B dims)", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000 - 1000);
    rows = [
      jobRow({
        topic: "grinding brakes",
        structurePatternId: "pat-7",
        selectedCaption: "Send this to someone whose brakes grind.",
        ask: { kind: "profile" },
        storyboardBeats: [
          { beatNumber: 1, startSecond: 0, endSecond: 4, onScreenText: "Why do my brakes grind?" },
          { beatNumber: 2, startSecond: 4, endSecond: 21, onScreenText: "metal on metal" },
        ],
      }, twoDaysAgo),
      // No beats, no caption, no ask: contributes nothing to the new arrays —
      // a job without a hook has no grammar, and "none" is not asserted here.
      jobRow({ topic: "wiper blades" }),
    ];
    const signals = await getRecentReelSignals();
    expect(signals.hookGrammars).toEqual(["symptom_question"]);
    expect(signals.structurePatternIds).toEqual(["pat-7"]);
    expect(signals.ctaFamilies).toEqual(["send"]);
    expect(signals.durationBuckets).toEqual(["20s"]);
    expect(signals.topicAges).toEqual([
      { topic: "grinding brakes", daysAgo: 2 },
      { topic: "wiper blades", daysAgo: Number.NaN },
    ]);
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
    await expect(getRecentReelSignals()).resolves.toEqual({ ...EMPTY_SHAPE, available: false });
  });

  it("no rows in the window is empty history, not an error - and it says it DID look", async () => {
    rows = [];
    const signals = await getRecentReelSignals();
    expect(signals).toEqual({ ...EMPTY_SHAPE, available: true });
    // The pair below is the entire point: identical arrays, opposite meanings.
    expect(signals.available).toBe(true);
  });
});

describe("classifyHookGrammar", () => {
  it("names the five grammars and refuses an empty hook", () => {
    expect(classifyHookGrammar("“My car shakes at 60.”")).toBe("customer_quote");
    expect(classifyHookGrammar("My tire light keeps coming on")).toBe("customer_quote");
    expect(classifyHookGrammar("Why does your tire light come on in October?")).toBe("symptom_question");
    expect(classifyHookGrammar("3 signs your battery dies this week")).toBe("number_lead");
    expect(classifyHookGrammar("Stop ignoring that grinding noise")).toBe("command");
    expect(classifyHookGrammar("Grinding means metal on metal")).toBe("direct_statement");
    expect(classifyHookGrammar("   ")).toBe("unknown");
    expect(classifyHookGrammar(undefined)).toBe("unknown");
  });

  it("a quoted question is a quote, not a question (order is deliberate)", () => {
    expect(classifyHookGrammar("“Is it safe to drive on this?”")).toBe("customer_quote");
  });
});

describe("classifyCtaFamily", () => {
  it("reads the caption CTA before the declared ask, because the ask defaults to profile", () => {
    expect(classifyCtaFamily("Send this to someone whose tires are bald.", "profile")).toBe("send");
    expect(classifyCtaFamily("DM us TREAD for a quick check", "profile")).toBe("dm");
    expect(classifyCtaFamily("Call us before the freeze.", "profile")).toBe("call");
    expect(classifyCtaFamily("Book your inspection today", "profile")).toBe("book");
    expect(classifyCtaFamily("Stop by Euclid Ave this week", "profile")).toBe("visit");
    expect(classifyCtaFamily("Full breakdown link in bio", "dm")).toBe("profile");
    expect(classifyCtaFamily("Save this for your next oil change", null)).toBe("save");
  });

  it("falls back to the declared ask only when the caption asks nothing", () => {
    expect(classifyCtaFamily("Grinding means metal on metal.", "visit")).toBe("visit");
    expect(classifyCtaFamily("Grinding means metal on metal.", null)).toBe("none");
    expect(classifyCtaFamily(undefined, "weird")).toBe("none");
  });
});

describe("durationBucket", () => {
  it("buckets the declared end second to 5 s and is null without beats", () => {
    expect(durationBucket([{ endSecond: 4 }, { endSecond: 22 }])).toBe("20s");
    expect(durationBucket([{ endSecond: 33 }])).toBe("35s");
    expect(durationBucket([])).toBeNull();
    expect(durationBucket(undefined)).toBeNull();
    expect(durationBucket([{ endSecond: 0 }])).toBeNull();
  });
});
