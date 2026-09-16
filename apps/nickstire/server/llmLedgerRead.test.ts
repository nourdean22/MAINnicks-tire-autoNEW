/**
 * The LLM ledger reader must distinguish THREE states, not two.
 *
 * `llm_calls` has been written since 2026-09-02 and had no reader at all. The
 * risk in adding one is the estate's most expensive recurring defect: an empty
 * result rendering as a confident zero. There are three genuinely different
 * reasons this panel can show nothing, and conflating any two of them is the
 * $0-revenue incident in a new costume:
 *
 *   not_recording — the gate is off, so rows CANNOT exist
 *   unreadable    — the read failed
 *   live + []     — the ledger is on and genuinely nothing ran
 *
 * Only the third is a fact about AI usage. These assert that, plus the
 * nullable-token trap: promptTokens has no NOT NULL, so a bare SUM would
 * under-report authoritatively — the exact shape of ALG's partsCost going
 * quiet while the UI kept rendering a number.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { dbHandle } = vi.hoisted(() => ({
  dbHandle: { current: null as unknown } as { current: unknown },
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

import { getLlmLedgerSummary } from "./services/llmLedgerRead";

/** Minimal stand-in for the drizzle select chain this reader uses. */
function selectReturning(rows: unknown[] | (() => never)) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "groupBy", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => (typeof rows === "function" ? rows() : Promise.resolve(rows));
  return { select: () => chain };
}

const laneRow = (over: Partial<Record<string, unknown>> = {}) => ({
  lane: "generateweeklyinsight",
  provider: "gemini",
  calls: 10,
  failed: 0,
  callsWithTokens: 10,
  promptTokens: 1000,
  completionTokens: 500,
  avgLatencyMs: 800,
  maxLatencyMs: 2000,
  lastCallAt: "2026-09-16T12:00:00Z",
  ...over,
});

describe("getLlmLedgerSummary — three states", () => {
  beforeEach(() => {
    dbHandle.current = null;
    vi.stubEnv("LLM_LEDGER_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gate off → not_recording, NOT an empty ledger", async () => {
    vi.stubEnv("LLM_LEDGER_ENABLED", "");
    const s = await getLlmLedgerSummary(7);
    expect(s.state).toBe("not_recording");
    expect(s.lanes).toEqual([]);
    expect(s.totals.calls).toBe(0);
  });

  it("gate off is reported even when the word 'false' is used rather than unset", async () => {
    vi.stubEnv("LLM_LEDGER_ENABLED", "false");
    expect((await getLlmLedgerSummary(7)).state).toBe("not_recording");
  });

  it("no database handle → unreadable, NOT zero", async () => {
    dbHandle.current = null;
    expect((await getLlmLedgerSummary(7)).state).toBe("unreadable");
  });

  it("a throwing query → unreadable, NOT zero", async () => {
    dbHandle.current = selectReturning(() => {
      throw new Error("Table 'llm_calls' doesn't exist");
    });
    const s = await getLlmLedgerSummary(7);
    expect(s.state).toBe("unreadable");
    expect(s.totals.calls).toBe(0);
  });

  it("gate on, query succeeds, nothing ran → live with an HONEST zero", async () => {
    dbHandle.current = selectReturning([]);
    const s = await getLlmLedgerSummary(7);
    expect(s.state).toBe("live");
    expect(s.lanes).toEqual([]);
  });

  it("aggregates lanes and totals", async () => {
    dbHandle.current = selectReturning([
      laneRow(),
      laneRow({ lane: "maybeproposecallactions", calls: 4, failed: 1, callsWithTokens: 4, promptTokens: 200, completionTokens: 100 }),
    ]);
    const s = await getLlmLedgerSummary(30);
    expect(s.state).toBe("live");
    expect(s.windowDays).toBe(30);
    expect(s.lanes).toHaveLength(2);
    expect(s.totals).toMatchObject({ calls: 14, failed: 1, promptTokens: 1200, completionTokens: 600 });
  });

  it("token coverage is reported separately, so a partial sum cannot pose as complete", async () => {
    // 10 calls, only 3 of which returned usage. A bare SUM() would render
    // "300 tokens" as though it described all ten.
    dbHandle.current = selectReturning([laneRow({ calls: 10, callsWithTokens: 3, promptTokens: 200, completionTokens: 100 })]);
    const s = await getLlmLedgerSummary(7);
    expect(s.totals.calls).toBe(10);
    expect(s.totals.callsWithTokens).toBe(3);
  });

  it("string aggregates from the MySQL driver are coerced, not concatenated", async () => {
    // DECIMAL/BIGINT aggregates arrive as strings often enough that this is a
    // real failure mode: "12" + "7" summed as strings would render 127.
    dbHandle.current = selectReturning([
      laneRow({ calls: "12", promptTokens: "100", completionTokens: "0", failed: "0", callsWithTokens: "12" }),
      laneRow({ lane: "other", calls: "7", promptTokens: "50", completionTokens: "0", failed: "0", callsWithTokens: "7" }),
    ]);
    const s = await getLlmLedgerSummary(7);
    expect(s.totals.calls).toBe(19);
    expect(s.totals.promptTokens).toBe(150);
  });

  it("never reports a cost — the table has no price and this repo has no rate card", async () => {
    dbHandle.current = selectReturning([laneRow()]);
    const s = await getLlmLedgerSummary(7);
    const serialized = JSON.stringify(s).toLowerCase();
    expect(serialized).not.toContain("cost");
    expect(serialized).not.toContain("usd");
  });
});
