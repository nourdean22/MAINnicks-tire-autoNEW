/**
 * The aggregate query must compile AND map — the state tests can see neither.
 *
 * llmLedgerRead.test.ts replaces the entire drizzle chain with a stub in order
 * to drive the three states. That makes it blind to the query itself: the
 * aggregate expressions, the group-by, the cutoff comparison and the
 * `order by count(*) desc` are invisible to it, so all nine of those tests
 * would pass against SQL that throws the moment TiDB sees it. A suite that
 * cannot observe the failure it exists to catch is the silent-instrument shape
 * this repo keeps finding.
 *
 * The second half matters more than the first. The emitted select list is
 * UNALIASED — `count(*)`, `sum(...)`, `coalesce(...)` with no `as calls` —
 * while llmLedgerRead reads `r.calls`, `r.promptTokens` and so on BY NAME. If
 * drizzle mapped results by object key rather than by position, every one of
 * those would be undefined, `Number(undefined ?? 0)` would be 0, and the panel
 * would render a confident row of zeros: the exact silent-zero class this
 * whole PR is about, hidden behind nine green tests whose stub hands back
 * rows already keyed the convenient way.
 *
 * It is positional. That is verified below rather than assumed, and pinned so
 * a future refactor cannot quietly change it.
 *
 * No connection is opened — toSQL() is pure dialect work and the fake client
 * only records what it was handed.
 */
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";

import { llmCalls } from "../drizzle/schema";
import { buildLaneAggregate, buildWindowTotals } from "./services/llmLedgerQuery";

const WINDOW_DAYS = 7;

/** toSQL() never touches the client; a stub is enough to construct the dialect. */
const dialectOnly = drizzle({ query: () => Promise.resolve([[], []]) } as never);
const compiled = () => buildLaneAggregate(dialectOnly as never, llmCalls, WINDOW_DAYS).toSQL();

describe("buildLaneAggregate — emits valid MySQL", () => {
  it("compiles at all", () => {
    expect(() => compiled()).not.toThrow();
    expect(compiled().sql.length).toBeGreaterThan(0);
  });

  it("selects from llm_calls and groups by lane and provider", () => {
    const { sql } = compiled();
    expect(sql).toMatch(/from\s+`llm_calls`/i);
    expect(sql).toMatch(/group by\s+`llm_calls`\.`lane`,\s*`llm_calls`\.`provider`/i);
  });

  it("orders by call count descending — a clause no state test can see", () => {
    expect(compiled().sql).toMatch(/order by\s+count\(\*\)\s+desc/i);
  });

  it("derives the cutoff from the DATABASE clock, never a JS Date", () => {
    const { sql, params } = compiled();

    /**
     * This is the assertion that caught a real bug, so it is worth stating
     * plainly. The first draft did `gte(calledAt, new Date(Date.now() - days))`.
     * Drizzle serialises a Date bound to a TIMESTAMP column into a bare
     * datetime STRING — measured exactly: `"2026-09-09 00:00:00.000"` — and
     * MySQL/TiDB reads a bare literal in the SESSION time zone. The effective
     * cutoff therefore moved by the session offset (4h on Eastern), quietly
     * shortening the window, and no value in the response would have looked
     * wrong. Comparing against `date_sub(now(), ...)` keeps both sides of the
     * comparison in one zone, whatever that zone is.
     */
    expect(sql).toMatch(/`llm_calls`\.`calledAt`\s*>=\s*date_sub\(now\(\), interval \? day\)/i);

    // The window must arrive as a bound number, not spliced into the text.
    expect(params).toContain(WINDOW_DAYS);
    for (const p of params) expect(p).not.toBeInstanceOf(Date);
    // And no datetime literal anywhere: that is the shape of the old bug.
    expect(sql).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("counts token-bearing rows separately from summing them", () => {
    const { sql } = compiled();
    // Both must be present. The sum alone would under-report silently, which
    // is how ALG's partsCost went quiet while the UI kept rendering a number.
    expect(sql).toMatch(/sum\(case when `promptTokens` is not null then 1 else 0 end\)/i);
    expect(sql).toMatch(/coalesce\(sum\(`promptTokens`\), 0\)/i);
  });

  it("coalesces every aggregate so an empty group cannot yield null", () => {
    const { sql } = compiled();
    expect(sql).toMatch(/coalesce\(round\(avg\(`latencyMs`\)\), 0\)/i);
    expect(sql).toMatch(/coalesce\(max\(`latencyMs`\), 0\)/i);
    expect(sql).toMatch(/coalesce\(sum\(`completionTokens`\), 0\)/i);
  });

  it("caps the result set", () => {
    const { sql } = compiled();
    expect(sql).toMatch(/limit\s+(\?|100)/i);
  });

  it("asks for no column this repo cannot render honestly", () => {
    // `max(calledAt)` was in the first draft and came out: nothing rendered it
    // (a reader with no consumer, inside the PR whose thesis is that those are
    // defects), and driver-parsed TiDB DATETIME comes back shifted on Eastern
    // per apps/nickstire/AGENTS.md, so surfacing it needed timezone work
    // nothing was doing.
    expect(compiled().sql).not.toMatch(/`calledAt`\)/i);
  });
});

describe("buildWindowTotals — the headline figures, deliberately unbounded", () => {
  const totals = () => buildWindowTotals(dialectOnly as never, llmCalls, WINDOW_DAYS).toSQL();

  it("compiles at all", () => {
    expect(() => totals()).not.toThrow();
  });

  it("has NO limit and NO group by — that is the entire point of it existing", () => {
    const { sql } = totals();
    /**
     * The lane list is capped at 100 groups. Summing THAT for the headline
     * numbers would drop the least-active groups from "calls" and "tokens"
     * while the panel still offered to show all lanes — under-reporting and
     * looking authoritative doing it. This query must therefore stay
     * ungrouped and uncapped.
     */
    expect(sql).not.toMatch(/\blimit\b/i);
    expect(sql).not.toMatch(/\bgroup by\b/i);
  });

  it("counts distinct lane/provider combinations so truncation is detectable", () => {
    expect(totals().sql).toMatch(/count\(distinct `lane`, `provider`\)/i);
  });

  it("shares the lane query's window predicate, so the two cannot disagree", () => {
    const a = totals().sql;
    const b = compiled().sql;
    const clause = /`llm_calls`\.`calledAt` >= date_sub\(now\(\), interval \? day\)/i;
    expect(a).toMatch(clause);
    expect(b).toMatch(clause);
  });

  it("carries the same nullable-token discipline as the lane rows", () => {
    const { sql } = totals();
    expect(sql).toMatch(/sum\(case when `promptTokens` is not null then 1 else 0 end\)/i);
    expect(sql).toMatch(/coalesce\(sum\(`promptTokens`\), 0\)/i);
  });
});

describe("buildLaneAggregate — result mapping is POSITIONAL, not key-based", () => {
  /**
   * Drives the real drizzle mapper with array-shaped rows, the way mysql2
   * returns them when drizzle asks for `rowsAsArray`. If this ever starts
   * failing, llmLedgerRead's `r.calls` reads have become `undefined` and the
   * panel is rendering zeros that look like measurements.
   */
  const withRows = (row: unknown[]) =>
    drizzle({ query: () => Promise.resolve([[row], []]) } as never);

  it("array positions land on the named fields the reader uses", async () => {
    const d = withRows(["generateweeklyinsight", "gemini", 12, 1, 11, 500, 250, 800, 2000]);
    const [mapped] = (await buildLaneAggregate(d as never, llmCalls, WINDOW_DAYS)) as unknown as Array<
      Record<string, unknown>
    >;

    expect(mapped).toEqual({
      lane: "generateweeklyinsight",
      provider: "gemini",
      calls: 12,
      failed: 1,
      callsWithTokens: 11,
      promptTokens: 500,
      completionTokens: 250,
      avgLatencyMs: 800,
      maxLatencyMs: 2000,
    });
  });

  it("no field the reader reads comes back undefined", async () => {
    const d = withRows(["lane", "ollama", 1, 0, 1, 10, 5, 20, 30]);
    const [mapped] = (await buildLaneAggregate(d as never, llmCalls, WINDOW_DAYS)) as unknown as Array<
      Record<string, unknown>
    >;

    // Named explicitly: `Number(undefined ?? 0)` is 0, so an undefined here
    // would not throw — it would render as a measured zero.
    for (const key of [
      "lane",
      "provider",
      "calls",
      "failed",
      "callsWithTokens",
      "promptTokens",
      "completionTokens",
      "avgLatencyMs",
      "maxLatencyMs",
    ]) {
      expect(mapped[key], `${key} must not be undefined`).toBeDefined();
    }
  });
});
