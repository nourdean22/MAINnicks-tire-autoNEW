/**
 * The reader must keep the WRITER's state and the READ's state separate.
 *
 * `llm_calls` was written for two weeks with no reader at all. The risk in
 * adding one is this estate's most expensive recurring defect: an empty result
 * rendering as a confident zero. The first draft collapsed writer state and
 * read state into a single field and got two things wrong for it, both caught
 * in review and both pinned here:
 *
 *   · An env flag reading "true" is NOT proof anything is being recorded.
 *     llmLedger latches an internal `disabled` on its first insert failure and
 *     drops every later call until the process restarts. Reporting "live" in
 *     that state presents a frozen window as current usage.
 *   · Recording being off does NOT mean there is nothing to show. Rows already
 *     written are still real, and the first draft skipped the query entirely —
 *     taking the operator's history away at exactly the moment they would look
 *     for it.
 *
 * Also pinned: headline totals come from their own UNBOUNDED aggregate, not
 * from summing the capped lane list, so a window with more than 100
 * (lane, provider) groups cannot silently under-report calls and tokens.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { dbHandle, recordingState } = vi.hoisted(() => ({
  dbHandle: { current: null as unknown },
  recordingState: { current: "on" as "on" | "off" | "stopped_after_error" },
}));

/**
 * Spread the real module — db-helper also exports `dbTyped` and `requireDb`,
 * and serial vitest shares ONE mock registry across every file, so a factory
 * returning only `db` would strip them for later suites (AGENTS.md §3, the
 * winback.test.ts incident).
 */
vi.mock("./lib/db-helper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/db-helper")>();
  return { ...actual, db: () => Promise.resolve(dbHandle.current) };
});

// The writer's state is the writer's to report; the reader must not re-derive
// it from the env var (that was the defect). Driven directly here.
vi.mock("./services/llmLedger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/llmLedger")>();
  return { ...actual, ledgerRecordingState: () => recordingState.current };
});

import { getLlmLedgerSummary } from "./services/llmLedgerRead";

/**
 * Drizzle chain stand-in serving TWO queries in order: the lane aggregate
 * (terminates on `.limit()`) then the totals aggregate (terminates by being
 * awaited after `.where()`).
 */
function queue(results: Array<unknown[] | Error>) {
  const pending = [...results];
  const next = () => {
    const r = pending.shift() ?? [];
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "groupBy", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => next();
  chain.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) => next().then(res, rej);
  return { select: () => chain };
}

const lane = (over: Record<string, unknown> = {}) => ({
  lane: "generateweeklyinsight",
  provider: "gemini",
  calls: 10,
  failed: 0,
  callsWithTokens: 10,
  promptTokens: 1000,
  completionTokens: 500,
  avgLatencyMs: 800,
  maxLatencyMs: 2000,
  ...over,
});

const totals = (over: Record<string, unknown> = {}) => ({
  calls: 10,
  failed: 0,
  callsWithTokens: 10,
  promptTokens: 1000,
  completionTokens: 500,
  groups: 1,
  ...over,
});

describe("getLlmLedgerSummary — writer state and read state are independent", () => {
  beforeEach(() => {
    dbHandle.current = null;
    recordingState.current = "on";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the writer as off WITHOUT suppressing the history it already wrote", async () => {
    // The regression: the first draft returned early here and showed nothing,
    // so turning recording off also hid a month of real rows.
    recordingState.current = "off";
    dbHandle.current = queue([[lane()], [totals()]]);

    const s = await getLlmLedgerSummary(7);
    expect(s.recording).toBe("off");
    expect(s.read).toBe("ok");
    expect(s.lanes).toHaveLength(1);
    expect(s.totals.calls).toBe(10);
  });

  it("surfaces a writer that stopped after a write failure — a flag check cannot see this", async () => {
    recordingState.current = "stopped_after_error";
    dbHandle.current = queue([[lane()], [totals()]]);

    const s = await getLlmLedgerSummary(7);
    expect(s.recording).toBe("stopped_after_error");
    expect(s.read).toBe("ok");
  });

  it("no database handle → unreadable, and still reports what the writer is doing", async () => {
    recordingState.current = "on";
    dbHandle.current = null;

    const s = await getLlmLedgerSummary(7);
    expect(s.read).toBe("unreadable");
    expect(s.recording).toBe("on");
    expect(s.totals.calls).toBe(0);
  });

  it("a throwing query → unreadable, NOT zero", async () => {
    dbHandle.current = queue([new Error("Table 'llm_calls' doesn't exist")]);
    const s = await getLlmLedgerSummary(7);
    expect(s.read).toBe("unreadable");
    expect(s.lanes).toEqual([]);
  });

  it("recording on, read ok, nothing ran → an HONEST zero", async () => {
    dbHandle.current = queue([[], [totals({ calls: 0, callsWithTokens: 0, promptTokens: 0, completionTokens: 0, groups: 0 })]]);
    const s = await getLlmLedgerSummary(7);
    expect(s.recording).toBe("on");
    expect(s.read).toBe("ok");
    expect(s.lanes).toEqual([]);
    expect(s.totals.calls).toBe(0);
  });

  it("totals come from the UNBOUNDED aggregate, not from summing the capped lane list", async () => {
    // 2 lanes returned, but the window really holds 140 groups and 5,000 calls.
    // Summing the rows would have reported 14 calls and claimed to be complete.
    dbHandle.current = queue([
      [lane({ calls: 10 }), lane({ lane: "other", calls: 4 })],
      [totals({ calls: 5000, failed: 12, callsWithTokens: 4000, promptTokens: 900000, completionTokens: 400000, groups: 140 })],
    ]);

    const s = await getLlmLedgerSummary(30);
    expect(s.totals.calls).toBe(5000);
    expect(s.totals.groups).toBe(140);
    expect(s.lanes).toHaveLength(2);
    expect(s.lanesTruncated).toBe(true);
  });

  it("lanesTruncated is false when the list already covers every group", async () => {
    dbHandle.current = queue([[lane()], [totals({ groups: 1 })]]);
    expect((await getLlmLedgerSummary(7)).lanesTruncated).toBe(false);
  });

  it("token coverage is reported separately, so a partial sum cannot pose as complete", async () => {
    dbHandle.current = queue([
      [lane({ calls: 10, callsWithTokens: 3 })],
      [totals({ calls: 10, callsWithTokens: 3, promptTokens: 200, completionTokens: 100 })],
    ]);
    const s = await getLlmLedgerSummary(7);
    expect(s.totals.calls).toBe(10);
    expect(s.totals.callsWithTokens).toBe(3);
  });

  it("string aggregates from the MySQL driver are coerced, not concatenated", async () => {
    // DECIMAL/BIGINT aggregates arrive as strings often enough that this is a
    // real failure mode: "12" + "7" summed as strings would render 127.
    dbHandle.current = queue([
      [lane({ calls: "12", promptTokens: "100" })],
      [totals({ calls: "19", promptTokens: "150", groups: "2" })],
    ]);
    const s = await getLlmLedgerSummary(7);
    expect(s.totals.calls).toBe(19);
    expect(s.totals.promptTokens).toBe(150);
    expect(s.lanes[0].calls).toBe(12);
  });

  it("a non-numeric aggregate degrades to 0 rather than NaN reaching the UI", async () => {
    dbHandle.current = queue([[lane({ calls: "not-a-number" })], [totals()]]);
    const s = await getLlmLedgerSummary(7);
    expect(Number.isNaN(s.lanes[0].calls)).toBe(false);
    expect(s.lanes[0].calls).toBe(0);
  });

  it("never reports a cost — the table has no price and this repo has no rate card", async () => {
    dbHandle.current = queue([[lane()], [totals()]]);
    const serialized = JSON.stringify(await getLlmLedgerSummary(7)).toLowerCase();
    expect(serialized).not.toContain("cost");
    expect(serialized).not.toContain("usd");
  });
});
