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
import { desc, gte, sql } from "drizzle-orm";

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
  lastCallAt: string | null;
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

/**
 * Per-lane aggregates over the trailing `windowDays`.
 *
 * Aggregated in SQL rather than by pulling rows into JS: apps/nickstire/AGENTS.md
 * requires age and day-bucket arithmetic to happen in SQL, because driver-parsed
 * TiDB DATETIME values come back shifted on Eastern. The cutoff is passed as a
 * bound Date parameter, so no interval string is interpolated.
 */
export async function getLlmLedgerSummary(windowDays: number): Promise<LlmLedgerSummary> {
  if (!isLedgerEnabled()) return empty("not_recording", windowDays);

  try {
    const { llmCalls } = await import("../../drizzle/schema");
    const d = await db();
    if (!d) return empty("unreadable", windowDays);

    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const rows = await d
      .select({
        lane: llmCalls.lane,
        provider: llmCalls.provider,
        calls: sql<number>`count(*)`,
        failed: sql<number>`sum(case when ${llmCalls.ok} = 0 then 1 else 0 end)`,
        callsWithTokens: sql<number>`sum(case when ${llmCalls.promptTokens} is not null then 1 else 0 end)`,
        promptTokens: sql<number>`coalesce(sum(${llmCalls.promptTokens}), 0)`,
        completionTokens: sql<number>`coalesce(sum(${llmCalls.completionTokens}), 0)`,
        avgLatencyMs: sql<number>`coalesce(round(avg(${llmCalls.latencyMs})), 0)`,
        maxLatencyMs: sql<number>`coalesce(max(${llmCalls.latencyMs}), 0)`,
        lastCallAt: sql<string | null>`max(${llmCalls.calledAt})`,
      })
      .from(llmCalls)
      .where(gte(llmCalls.calledAt, cutoff))
      .groupBy(llmCalls.lane, llmCalls.provider)
      .orderBy(desc(sql`count(*)`))
      .limit(100);

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
      lastCallAt: string | Date | null;
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
      lastCallAt: r.lastCallAt ? new Date(r.lastCallAt).toISOString() : null,
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
