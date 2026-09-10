/**
 * tests/ai/search-reflections-read-failure.test.ts · 2026-09-10
 *
 * `searchReflections` was half-honest, and the half it got wrong is the
 * half the model reads.
 *
 * The TOTALS were already correct, with the reasoning stated in the
 * source: "null on failure, never 0 -- a count that could not be read is
 * UNKNOWN, and reporting it as zero would reintroduce the exact
 * confident-wrong-number this change exists to remove."
 *
 * The ROWS were not. Both `findMany` calls ended in
 * `.catch((): never[] => [])`, so a Postgres outage produced:
 *
 *   { count: 0, returned: 0, reflections: [], brainDumps: [],
 *     countExact: false }
 *
 * Every field in that payload says "nothing matched." The only dissent is
 * a boolean named for PRECISION, not failure -- and NICK reads it and
 * says "I searched your reflections and found nothing about X." He did
 * not search. That is the recall-provenance defect again, one layer up,
 * and it is worse here because the tool call is the receipt the evidence
 * gate treats as proof the lookup happened.
 *
 * Two failures are kept apart deliberately, because conflating them
 * would throw away good evidence:
 *
 *   · an FTS lane dying is DEGRADATION -- the ILIKE arms still run, so
 *     rows are real but recall is narrower;
 *   · a findMany dying is a FAILED READ -- the list proves nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { findMany: vi.fn() },
  reflection: { findMany: vi.fn(), count: vi.fn() },
  brainDump: { findMany: vi.fn(), count: vi.fn() },
  queryRawUnsafe: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
    reflection: mocks.reflection,
    brainDump: mocks.brainDump,
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));
vi.mock("@/lib/brain/blind-spot-detector", () => ({ detectBlindSpots: vi.fn(async () => []) }));
vi.mock("@/lib/brain/journal-ingest", () => ({ classifyThought: vi.fn() }));
vi.mock("@/lib/brain/knowledge-sync", () => ({ runKnowledgeSync: vi.fn() }));

import { brainTools } from "@/lib/ai/tools/brain";

type Executable = { execute: (args: any, opts?: unknown) => Promise<any> };
const searchReflections = brainTools.searchReflections as unknown as Executable;

const REFLECTION = {
  id: "r1",
  date: new Date("2026-09-01"),
  category: "work",
  insight: "shipping beats planning",
  evidence: "the wave that landed",
  actionable: true,
};
const DUMP = {
  id: "d1",
  date: new Date("2026-09-02"),
  summary: "thinking about the shop",
  rawThoughts: "long prose",
  patterns: "avoidance",
  moodBefore: 6,
};

/** Every lane healthy, so each test only opts INTO the failure it means. */
function allHealthy() {
  mocks.queryRawUnsafe.mockResolvedValue([]);
  mocks.reflection.findMany.mockResolvedValue([REFLECTION]);
  mocks.brainDump.findMany.mockResolvedValue([DUMP]);
  mocks.reflection.count.mockResolvedValue(1);
  mocks.brainDump.count.mockResolvedValue(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  allHealthy();
});

describe("a failed row read is never reported as an empty corpus", () => {
  it("CANARY · both sources down => an explicit error, and the count is disowned", async () => {
    mocks.reflection.findMany.mockRejectedValue(new Error("db down"));
    mocks.brainDump.findMany.mockRejectedValue(new Error("db down"));
    mocks.reflection.count.mockRejectedValue(new Error("db down"));
    mocks.brainDump.count.mockRejectedValue(new Error("db down"));

    const out = await searchReflections.execute({ query: "anxiety", limit: 8 });

    expect(out.error).toBeTruthy();
    expect(out.error).toMatch(/read failed/i);
    expect(out.error).toMatch(/reflections/i);
    expect(out.error).toMatch(/brain dumps/i);
    // The instruction, not just the status. Without this the model is
    // free to read `count: 0` and answer from it anyway.
    expect(out.error).toMatch(/not a measured zero/i);
    expect(out.error).toMatch(/do not say nothing matched/i);
    // And the count must stop claiming to be a measurement.
    expect(out.countIsMeaningful).toBe(false);
  });

  it("CANARY · one source down => rows stay usable, incompleteness stated", async () => {
    // Partial failure. Telling NICK to distrust the surviving rows would
    // discard real evidence; letting him treat the list as complete would
    // let him conclude the subject is absent.
    mocks.brainDump.findMany.mockRejectedValue(new Error("db down"));

    const out = await searchReflections.execute({ query: "anxiety", limit: 8 });

    expect(out.error).toMatch(/brain dumps/i);
    expect(out.error).not.toMatch(/nothing was searched/i);
    expect(out.error).toMatch(/incomplete/i);
    // The reflection that DID come back is still there to be used.
    expect(out.reflections).toHaveLength(1);
    expect(out.countIsMeaningful).toBe(false);
  });
});

describe("CONTROL · a healthy search makes no failure claim", () => {
  /**
   * The load-bearing control. A tool that cries "read failed" on ordinary
   * searches teaches the model to ignore the field, which would leave the
   * original defect in place with extra noise on top.
   */
  it("no error, no degraded note, and the count is a real measurement", async () => {
    const out = await searchReflections.execute({ query: "anxiety", limit: 8 });

    expect(out.error).toBeUndefined();
    expect(out.degraded).toBeUndefined();
    expect(out.countIsMeaningful).toBe(true);
    expect(out.count).toBe(2);
    expect(out.reflections).toHaveLength(1);
    expect(out.brainDumps).toHaveLength(1);
  });

  it("a genuine empty corpus is still a genuine empty", async () => {
    // The whole point of the three-state discipline: a real zero must
    // stay a plain, confident zero.
    mocks.reflection.findMany.mockResolvedValue([]);
    mocks.brainDump.findMany.mockResolvedValue([]);
    mocks.reflection.count.mockResolvedValue(0);
    mocks.brainDump.count.mockResolvedValue(0);

    const out = await searchReflections.execute({ query: "never discussed", limit: 8 });

    expect(out.error).toBeUndefined();
    expect(out.countIsMeaningful).toBe(true);
    expect(out.count).toBe(0);
  });
});

describe("a dead full-text lane is degradation, not failure", () => {
  it("CANARY · FTS down => degraded note, no error, rows still returned", async () => {
    // The ILIKE arms of the OR still run, so this must NOT claim a failed
    // read -- but it must also not pretend recall was as wide as usual.
    mocks.queryRawUnsafe.mockRejectedValue(new Error("no such index"));

    const out = await searchReflections.execute({ query: "mind your business", limit: 8 });

    expect(out.degraded).toBeTruthy();
    expect(out.degraded).toMatch(/full-text/i);
    expect(out.degraded).toMatch(/narrower/i);
    // Crucially NOT an error: the results are real.
    expect(out.error).toBeUndefined();
    expect(out.countIsMeaningful).toBe(true);
    expect(out.reflections).toHaveLength(1);
  });
});
