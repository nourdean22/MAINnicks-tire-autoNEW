/**
 * LLM call ledger — the READER.
 *
 * `services/llmLedger.ts` has been writing one row per invokeLLM() call since
 * migration 0116 was applied and LLM_LEDGER_ENABLED was set on Railway
 * (2026-09-02). Nothing ever read it. drizzle/schema.ts says so in its own
 * comment — "nothing selects from this table" — and a repo-wide grep for
 * `llmCalls` returns only the table definition and its two exported types.
 *
 * That is a WRITER WITH NO READER: the estate has been paying for ~65 call
 * sites' worth of model usage, recording every call, and showing the operator
 * none of it. Same defect shape as the 5-of-30 heartbeat columns that had no
 * producer, approached from the opposite end.
 *
 * THREE STATES, NOT TWO. The gate is the whole reason this file is careful:
 *
 *   live          — the read succeeded. Zero lanes genuinely means zero calls.
 *   not_recording — LLM_LEDGER_ENABLED is not "true", so rows can NEVER exist.
 *                   An empty result here says nothing about AI usage, and
 *                   rendering it as "no activity" would be a confident lie of
 *                   exactly the kind that produced the $0-revenue incident.
 *   unreadable    — the query threw (table absent, database down). UNKNOWN.
 *
 * NO DOLLAR FIGURES. llm_calls records tokens, not cost, and there is no price
 * table in this repo. Multiplying tokens by a hard-coded rate would be
 * fabrication, and a per-model rate that drifts from the vendor's actual
 * pricing is a cache with no invalidation. Tokens are reported; money is not.
 *
 * TOKEN COLUMNS ARE NULLABLE. promptTokens/completionTokens are `int` with no
 * NOT NULL — not every provider returns usage. A bare SUM() over them would
 * silently under-report and look authoritative, which is precisely how ALG's
 * partsCost died: the column kept existing while the values stopped arriving,
 * and the UI kept rendering a number. So every row carries `callsWithTokens`
 * beside the sums, and the caller can see what share of the window the totals
 * actually cover.
 */
import { desc, sql } from "drizzle-orm";

import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";
import { isLedgerEnabled } from "./llmLedger";

const log = createLogger("llm-ledger-read");

type LlmLedgerState = "live" | "not_recording" | "unreadable";

interface LlmLaneRow {
  lane: string;
  provider: string;
  calls: number;
  failed: number;
  /** How many of `calls` actually carried token counts. See the header. */
  callsWithTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
}

interface LlmLedgerSummary {
  state: LlmLedgerState;
  windowDays: number;
  lanes: LlmLaneRow[];
  totals: {
    calls: number;
    failed: number;
    callsWithTokens: number;
    promptTokens: number;
    completionTokens: number;
  };
  /** ISO. When the read ran — not when the newest row was written. */
  generatedAt: string;
}

const empty = (state: LlmLedgerState, windowDays: number): LlmLedgerSummary => ({
  state,
  windowDays,
  lanes: [],
  totals: { calls: 0, failed: 0, callsWithTokens: 0, promptTokens: 0, completionTokens: 0 },
  generatedAt: new Date().toISOString(),
});

/** The handle db() hands back, minus the null it returns when there is none. */
type Db = NonNullable<Awaited<ReturnType<typeof db>>>;
type LlmCallsTable = (typeof import("../../drizzle/schema"))["llmCalls"];

/**
 * The aggregate, pulled out and EXPORTED so a test can compile it.
 *
 * Every state test in llmLedgerRead.test.ts replaces the whole drizzle chain
 * with a stub, which means not one of them can see this query: the aggregate
 * expressions, the group-by, the cutoff comparison and the
 * `order by count(*) desc` were all invisible to nine green tests. That is the
 * silent-instrument shape this repo keeps finding — a suite that would pass
 * whatever the SQL said, including SQL that throws at runtime in production.
 * Extracting the builder lets llmLedgerSql.test.ts push it through a REAL
 * drizzle MySQL dialect and assert the emitted text, so the thing under test
 * is the thing that ships.
 */
export function buildLaneAggregate(d: Db, table: LlmCallsTable, windowDays: number) {
  return d
    .select({
      lane: table.lane,
      provider: table.provider,
      calls: sql<number>`count(*)`,
      failed: sql<number>`sum(case when ${table.ok} = 0 then 1 else 0 end)`,
      callsWithTokens: sql<number>`sum(case when ${table.promptTokens} is not null then 1 else 0 end)`,
      promptTokens: sql<number>`coalesce(sum(${table.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${table.completionTokens}), 0)`,
      avgLatencyMs: sql<number>`coalesce(round(avg(${table.latencyMs})), 0)`,
      maxLatencyMs: sql<number>`coalesce(max(${table.latencyMs}), 0)`,
    })
    .from(table)
    /**
     * The cutoff is computed BY THE DATABASE, not in JS, and that is load-bearing.
     *
     * The first draft passed `new Date(Date.now() - days * 86400_000)`. Drizzle
     * serialises a Date for a TIMESTAMP column into a bare datetime string —
     * measured: `"2026-09-09 00:00:00.000"` — and MySQL/TiDB interprets a bare
     * literal in the SESSION time zone. So the real cutoff moved by whatever
     * the session offset happened to be (4h on Eastern), silently shortening
     * the window, and nothing in the result would have looked wrong.
     *
     * `date_sub(now(), interval ? day)` compares `calledAt` against a value
     * produced in the same zone the column is read in, so the comparison is
     * offset-free whatever the session is set to. This is what
     * apps/nickstire/AGENTS.md means by computing ages in SQL rather than JS.
     */
    .where(sql`${table.calledAt} >= date_sub(now(), interval ${windowDays} day)`)
    .groupBy(table.lane, table.provider)
    .orderBy(desc(sql`count(*)`))
    .limit(100);
}

/**
 * Per-lane aggregates over the trailing `windowDays`.
 *
 * Aggregated in SQL rather than by pulling rows into JS, and the window cutoff
 * is derived from the database's own `now()` rather than the process clock —
 * see the comment on the `where` clause in buildLaneAggregate for the measured
 * reason. `windowDays` reaches SQL as a bound parameter; nothing is
 * interpolated into the statement text.
 */
export async function getLlmLedgerSummary(windowDays: number): Promise<LlmLedgerSummary> {
  if (!isLedgerEnabled()) return empty("not_recording", windowDays);

  try {
    const { llmCalls } = await import("../../drizzle/schema");
    const d = await db();
    if (!d) return empty("unreadable", windowDays);

    const rows = await buildLaneAggregate(d, llmCalls, windowDays);

    /**
     * The shape the driver actually hands back, which is NOT the shape the
     * `sql<number>` annotations claim. mysql2 returns DECIMAL/BIGINT aggregates
     * as strings, so `count(*)` and every `sum(...)` above can arrive as
     * `"12"`. That is why the coercion below exists rather than being defensive
     * clutter: `"12" + "7"` is `"127"`, and two lanes summed without Number()
     * would have rendered a plausible, wrong total. Typed explicitly because
     * tsc could not infer past the aggregate expressions.
     */
    type RawRow = {
      lane: string;
      provider: string;
      calls: number | string | null;
      failed: number | string | null;
      callsWithTokens: number | string | null;
      promptTokens: number | string | null;
      completionTokens: number | string | null;
      avgLatencyMs: number | string | null;
      maxLatencyMs: number | string | null;
    };

    const lanes: LlmLaneRow[] = (rows as unknown as RawRow[]).map((r) => ({
      lane: String(r.lane),
      provider: String(r.provider),
      calls: Number(r.calls ?? 0),
      failed: Number(r.failed ?? 0),
      callsWithTokens: Number(r.callsWithTokens ?? 0),
      promptTokens: Number(r.promptTokens ?? 0),
      completionTokens: Number(r.completionTokens ?? 0),
      avgLatencyMs: Number(r.avgLatencyMs ?? 0),
      maxLatencyMs: Number(r.maxLatencyMs ?? 0),
    }));

    return {
      state: "live",
      windowDays,
      lanes,
      totals: lanes.reduce(
        (acc, l) => ({
          calls: acc.calls + l.calls,
          failed: acc.failed + l.failed,
          callsWithTokens: acc.callsWithTokens + l.callsWithTokens,
          promptTokens: acc.promptTokens + l.promptTokens,
          completionTokens: acc.completionTokens + l.completionTokens,
        }),
        { calls: 0, failed: 0, callsWithTokens: 0, promptTokens: 0, completionTokens: 0 },
      ),
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    // A failed read is UNKNOWN, never an empty ledger.
    log.error("llm ledger read failed", { error: err instanceof Error ? err.message : String(err) });
    return empty("unreadable", windowDays);
  }
}
