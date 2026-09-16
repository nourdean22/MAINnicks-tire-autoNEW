/**
 * The two `llm_calls` aggregates, as compilable units.
 *
 * Split out of llmLedgerRead.ts for a concrete reason: the state tests there
 * stub the entire drizzle chain, so they are blind to the SQL — the aggregate
 * expressions, the group-by, the window predicate and the order-by were
 * invisible to nine green tests, which is how a timezone bug survived review.
 * A separate module lets llmLedgerSql.test.ts push these through a real
 * drizzle dialect and assert the emitted text.
 *
 * They live here rather than as exports of llmLedgerRead because an export
 * whose only cross-file consumer is a test is an orphan by this repo's knip
 * gate, and rightly so. Here they are consumed by production code across a
 * real module boundary, and the seam is honest: query construction on this
 * side, state interpretation on the other.
 */
import { desc, sql } from "drizzle-orm";

import type { db } from "../lib/db-helper";

/** The handle db() hands back, minus the null it returns when there is none. */
type Db = NonNullable<Awaited<ReturnType<typeof db>>>;
type LlmCallsTable = (typeof import("../../drizzle/schema"))["llmCalls"];

/**
 * Lane rows are capped; the totals query below deliberately is not. Not
 * exported — the reader derives "is this list a subset?" from
 * `totals.groups > lanes.length` rather than from this number, so exporting it
 * would be an unconsumed export, which the knip orphan gate correctly rejects.
 */
const LANE_LIMIT = 100;

/**
 * The window predicate, shared by both aggregates so they cannot disagree
 * about which rows they are describing.
 *
 * The cutoff is computed BY THE DATABASE, and that is load-bearing. The first
 * draft passed `new Date(Date.now() - days * 86400_000)`. Drizzle serialises a
 * Date bound to a TIMESTAMP column into a bare datetime string — measured
 * exactly: `"2026-09-09 00:00:00.000"` — and MySQL/TiDB reads a bare literal
 * in the SESSION time zone. The effective cutoff therefore moved by the
 * session offset (4h on Eastern), silently shortening the window, and nothing
 * in the result would have looked wrong. `date_sub(now(), interval ? day)`
 * keeps both sides of the comparison in one zone whatever that zone is —
 * which is what apps/nickstire/AGENTS.md means by computing ages in SQL
 * rather than in JS.
 */
const withinWindow = (table: LlmCallsTable, windowDays: number) =>
  sql`${table.calledAt} >= date_sub(now(), interval ${windowDays} day)`;

/** Busiest (lane, provider) groups in the window, capped at LANE_LIMIT. */
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
    .where(withinWindow(table, windowDays))
    .groupBy(table.lane, table.provider)
    .orderBy(desc(sql`count(*)`))
    .limit(LANE_LIMIT);
}

/**
 * Headline totals over the WHOLE window — no group-by, no limit.
 *
 * Separate from the lane list on purpose. Summing the capped lane rows would
 * drop the least-active groups from the headline calls, failures and tokens
 * while the panel still offered to "show all lanes": under-reporting, and
 * looking authoritative while doing it. `groups` counts the distinct
 * combinations so the caller can tell when its list is a subset.
 */
export function buildWindowTotals(d: Db, table: LlmCallsTable, windowDays: number) {
  return d
    .select({
      calls: sql<number>`count(*)`,
      failed: sql<number>`sum(case when ${table.ok} = 0 then 1 else 0 end)`,
      callsWithTokens: sql<number>`sum(case when ${table.promptTokens} is not null then 1 else 0 end)`,
      promptTokens: sql<number>`coalesce(sum(${table.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${table.completionTokens}), 0)`,
      groups: sql<number>`count(distinct ${table.lane}, ${table.provider})`,
    })
    .from(table)
    .where(withinWindow(table, windowDays));
}
