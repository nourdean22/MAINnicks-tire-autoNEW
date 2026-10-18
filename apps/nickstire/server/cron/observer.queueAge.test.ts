/**
 * Queue-age pass · observer wiring tests.
 *
 * The readers are mocked (their SQL is pinned in queueAgeReaders.test.ts); the
 * observer, the classifier, the formatters and the dedupe are real. The DB is
 * a fake that returns no failing jobs, and the loop-shape contracts are emptied
 * so the only thing that can page here is a queue-age verdict.
 *
 * Positive control first: a planted stuck row must page before any "it stayed
 * quiet" assertion means anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Read = { oldestDueAtMs: number | null; readFailed: boolean; error?: string; skipped?: string };

const h = vi.hoisted(() => {
  const chain = (rows: unknown[]) => Object.assign(Promise.resolve(rows), { limit: async () => rows });
  return {
    telegram: vi.fn(async (_text: string, _channel?: string) => true),
    readers: {} as Record<string, (nowMs: number) => Promise<unknown>>,
    fakeDb: {
      execute: async () => [[]],
      select: () => ({ from: () => ({ where: () => chain([]) }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async () => undefined }),
    },
  };
});

vi.mock("../db", () => ({ getDb: async () => h.fakeDb }));
vi.mock("../services/telegram", () => ({ sendTelegramMessage: (text: string, channel?: string) => h.telegram(text, channel) }));
vi.mock("../services/queueAgeReaders", () => ({ QUEUE_AGE_READERS: h.readers }));
vi.mock("../services/loopShapeContract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/loopShapeContract")>()),
  LOOP_CONTRACTS: [],
}));

const MIN = 60_000;
const NOON_ET = new Date("2026-10-18T16:00:00Z"); // 12:00 EDT, outside quiet hours
const THREE_AM_ET = new Date("2026-10-18T07:00:00Z"); // 03:00 EDT, inside quiet hours

const EMPTY: Read = { oldestDueAtMs: null, readFailed: false };
const stuck = (ageMin: number): Read => ({ oldestDueAtMs: Date.now() - ageMin * MIN, readFailed: false });

function setReads(reads: Record<string, Read | (() => Promise<Read>)>) {
  for (const loop of ["reminder-queue", "followup-cadence", "reel-pipeline", "reel-pipeline:publish"]) {
    const r = reads[loop] ?? EMPTY;
    h.readers[loop] = typeof r === "function" ? r : async () => r;
  }
}

async function freshObserver() {
  vi.resetModules();
  return (await import("./observer")).runCronFailureObserver;
}

const sent = () => h.telegram.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON_ET);
  h.telegram.mockClear();
  setReads({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runCronFailureObserver · queue-age pass", () => {
  it("one stuck, one empty, one readFailed, one skipped (stuck LAST): exactly one alert, unknown in details", async () => {
    const run = await freshObserver();
    setReads({
      "reminder-queue": EMPTY,
      "followup-cadence": { oldestDueAtMs: null, readFailed: true, error: "Unknown column 'touch'" },
      "reel-pipeline": { oldestDueAtMs: null, readFailed: false, skipped: "REEL_GENERATION_ENABLED != 'true'" },
      "reel-pipeline:publish": stuck(300),
    });

    const out = await run();

    expect(h.telegram).toHaveBeenCalledTimes(1);
    const [text] = sent();
    expect(text).toContain("reel-pipeline:publish");
    expect(text).toContain("300m");
    expect(text).not.toContain("reminder-queue");
    expect(text).not.toContain("followup-cadence");
    expect(out.details).toContain("reel-pipeline:publish=stuck");
    expect(out.details).toContain("followup-cadence=unknown");
    expect(out.details).toContain("Unknown column 'touch'");
    expect(out.details).toContain("reminder-queue=empty");
    expect(out.details).toContain("reel-pipeline=skipped");
    expect(out.details).not.toContain("followup-cadence=in-spec");

    // Dedupe honoured: the same stuck loop on the next pass does not re-page.
    h.telegram.mockClear();
    const again = await run();
    expect(h.telegram).not.toHaveBeenCalled();
    expect(again.details).toContain("suppressed (recent): 1");
    expect(again.details).toContain("reel-pipeline:publish=stuck");
  });

  it("positive control: all in-spec is silent, and the same pass pages once a row goes stuck", async () => {
    const run = await freshObserver();
    setReads({ "reminder-queue": stuck(30), "reel-pipeline": stuck(10) });
    const quiet = await run();
    expect(h.telegram).not.toHaveBeenCalled();
    expect(quiet.details).toContain("reminder-queue=in-spec");

    setReads({ "reminder-queue": stuck(24 * 60 + 1) });
    await run();
    expect(h.telegram).toHaveBeenCalledTimes(1);
    expect(sent()[0]).toContain("reminder-queue");
  });

  it("dedupe keys are per loop: a second loop going stuck still pages while the first is suppressed", async () => {
    const run = await freshObserver();
    setReads({ "reel-pipeline:publish": stuck(300) });
    await run();
    expect(h.telegram).toHaveBeenCalledTimes(1);

    h.telegram.mockClear();
    setReads({ "reel-pipeline:publish": stuck(315), "reminder-queue": stuck(2000) });
    await run();
    expect(h.telegram).toHaveBeenCalledTimes(1);
    const [text] = sent();
    expect(text).toContain("reminder-queue");
    expect(text).not.toContain("reel-pipeline:publish");
  });

  it("a loop back in spec clears its active alert with one resolved notice", async () => {
    const run = await freshObserver();
    setReads({ "reel-pipeline": stuck(400) });
    await run();
    h.telegram.mockClear();

    setReads({ "reel-pipeline": EMPTY });
    const out = await run();
    expect(h.telegram).toHaveBeenCalledTimes(1);
    expect(sent()[0]).toContain("queue_age:reel-pipeline");
    expect(out.details).toContain("resolved: 1");

    h.telegram.mockClear();
    await run();
    expect(h.telegram).not.toHaveBeenCalled();
  });

  it("a failed read never counts as recovery: an active alert stays active while the read is unknown", async () => {
    const run = await freshObserver();
    setReads({ "reel-pipeline": stuck(400) });
    await run();
    h.telegram.mockClear();

    setReads({ "reel-pipeline": { oldestDueAtMs: null, readFailed: true, error: "timeout" } });
    const out = await run();
    expect(h.telegram).not.toHaveBeenCalled();
    expect(out.details).toContain("resolved: 0");
    expect(out.details).toContain("reel-pipeline=unknown");
  });

  it("a reader that rejects is unknown for that loop; the other loops are still judged", async () => {
    const run = await freshObserver();
    setReads({
      "reminder-queue": () => Promise.reject(new Error("reader exploded")),
      "reel-pipeline:publish": stuck(300),
    });
    const out = await run();
    expect(out.details).toContain("reminder-queue=unknown");
    expect(out.details).toContain("reader exploded");
    expect(h.telegram).toHaveBeenCalledTimes(1);
  });

  it("quiet hours defer a stuck page instead of sending or dropping it", async () => {
    vi.setSystemTime(THREE_AM_ET);
    const run = await freshObserver();
    setReads({ "reel-pipeline": stuck(400) });
    const out = await run();
    expect(h.telegram).not.toHaveBeenCalled();
    expect(out.details).toContain("quiet-deferred: 1");
    expect(out.details).toContain("reel-pipeline=stuck");
  });
});
