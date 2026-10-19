/**
 * Retention for revenue_reconciliation_candidates (JOB 2026-10-18-recon-candidates-retention).
 *
 * The 2-hour reconciliation run (services/revenueReconciliation.ts) re-inserts
 * one row per call in its rolling 21-day window under a new run_id, so the table
 * only grows. Both readers (routers/revenueAttribution.ts, services/promptEvolution.ts)
 * join on MAX(created_at) per call_id, so a row with a newer sibling for the same
 * call is invisible to every reader.
 *
 * Rule: a row is SUPERSEDED when another row of the same call_id has a larger
 * created_at. Rows at the maximum (ties included) are never touched, and nothing
 * is deleted by age: a call older than the window never gets a new row, so its
 * last row must stay.
 *
 * Two parts, both driven from the nightly cleanup cron:
 *  - report (always, read only): rows, distinct calls, superseded. Counts only:
 *    no text column is selected, so nothing here can put a caller's data in a log.
 *  - delete (only while the revenue_recon_retention flag is ON): one single-table
 *    DELETE per call that has more than one row, bounded per run.
 *
 * The SQL builders are pure and take the table name, so they can be run against a
 * TEMPORARY copy of the table to prove them on the real engine before the flag is
 * ever enabled. The table name is interpolated into the text, so it is validated.
 */
import { sql, type SQL } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { isMissingTableError, logSafeErrorMessage } from "../lib/dbErrors";
import { affectedRows, readRows } from "../lib/dbResult";

const log = createLogger("service:recon-candidates-retention");

export const RECON_CANDIDATES_TABLE = "revenue_reconciliation_candidates";
const RECON_RETENTION_FLAG ="revenue_recon_retention";

/**
 * Per-run delete bound. Starting values, not tuned against production.
 * 200 statements: each one is an index lookup on call_id removing at most one
 * window's worth of copies for a call (about 250 at 12 runs a day over 21 days),
 * so a run removes at most about 50k rows in small transactions, and the
 * 444k-row backlog clears in about nine nights. 60 s: a budget checked BEFORE
 * each statement, not a hard stop: one slow DELETE that starts inside the budget
 * can run past it, and only the cleanup job's own outer timeout bounds that worst
 * case. Whatever is left is picked up by the next night's run.
 */
export const MAX_DELETE_STATEMENTS_PER_RUN = 200;
export const MAX_DELETE_MS_PER_RUN = 60_000;

export type SqlStatement = { text: string; params: unknown[] };

function safeTable(table: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(table)) throw new Error(`unsafe table name: ${JSON.stringify(table)}`);
  return `\`${table}\``;
}

/** One grouped read: per call, how many rows and the newest created_at (epoch seconds). No text column. */
export function buildReportSql(table: string = RECON_CANDIDATES_TABLE): SqlStatement {
  return {
    text: `SELECT call_id, COUNT(*) AS n, UNIX_TIMESTAMP(MAX(created_at)) AS latest FROM ${safeTable(table)} GROUP BY call_id`,
    params: [],
  };
}

/**
 * Delete every row of ONE call older than that call's newest row.
 *
 * The bound is compared as integer epoch seconds (UNIX_TIMESTAMP(created_at)), not
 * as a Date round-tripped through the driver: a timezone or DST shift in that trip
 * could move the bound past the newest row and delete it. A single-table DELETE is
 * used because TiDB takes no LIMIT on a multi-table DELETE; the call_id index keeps
 * each statement to one call's rows. `created_at < bound` keeps every row tied at
 * the maximum, which is what the readers see.
 */
export function buildDeleteSupersededSql(callId: number, latestEpoch: number, table: string = RECON_CANDIDATES_TABLE): SqlStatement {
  if (!Number.isSafeInteger(callId)) throw new Error("callId must be an integer");
  if (!Number.isSafeInteger(latestEpoch) || latestEpoch <= 0) throw new Error("latestEpoch must be a positive integer");
  return {
    text: `DELETE FROM ${safeTable(table)} WHERE call_id = ? AND UNIX_TIMESTAMP(created_at) < ?`,
    params: [callId, latestEpoch],
  };
}

/** A builder statement as a drizzle SQL object (flat: text parts as strings, params as bound values). */
export function toDrizzleSql(stmt: SqlStatement): SQL {
  const parts = stmt.text.split("?");
  if (parts.length - 1 !== stmt.params.length) throw new Error("placeholder count does not match params");
  return sql(Object.assign([...parts], { raw: [...parts] }) as unknown as TemplateStringsArray, ...stmt.params);
}

export interface ReconRetentionDeps {
  /** Runs one statement and returns the raw driver result. */
  query(stmt: SqlStatement): Promise<unknown>;
  /** The DB flag, read fresh. A throw closes the delete path and reports the flag as unreadable. */
  isEnabled(): Promise<boolean>;
  now?(): number;
}

export type ReconRetentionResult =
  | { state: "unavailable" }
  | {
      state: "measured";
      rows: number;
      calls: number;
      /** rows minus distinct calls. Ties at the maximum make it an upper bound on what the DELETE removes. */
      superseded: number;
      /** Rows the DELETEs removed this run; null when the driver reported no count (unknown, not zero). */
      deleted: number | null;
      /** "unreadable" = the fresh flag read failed: nothing was deleted, and it is not a silent off. */
      flag: "on" | "off" | "unreadable";
      /** More duplicate calls were left than the per-run bound allowed; the next run continues. */
      truncated: boolean;
      deleteFailed: boolean;
    };

type Group = { callId: number; n: number; latest: number };

function parseGroups(raw: unknown): Group[] | null {
  const rows = readRows(raw);
  const groups: Group[] = [];
  for (const r of rows) {
    const callId = Number(r.call_id);
    const n = Number(r.n);
    const latest = Number(r.latest);
    // A row that does not parse means the read is not what we think it is: UNKNOWN, never a smaller count.
    // The newest time is also the DELETE bound, so one that is not epoch seconds (a unit slip would read far
    // in the future) must not reach a DELETE: it could sit above the newest row. Allow a day of clock slack.
    const plausibleEpochCeiling = Math.floor(Date.now() / 1000) + 86_400;
    if (!Number.isSafeInteger(callId) || !Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(latest) || latest <= 0 || latest > plausibleEpochCeiling) return null;
    groups.push({ callId, n, latest });
  }
  // A non-array result reads as no rows from readRows; an array result with zero groups is a real empty table.
  if (!Array.isArray(raw)) return null;
  return groups;
}

/**
 * The delete path's flag read: the feature_flags row, fresh from the database, never the cached
 * isEnabled(). That cache swallows a failed refresh and returns the last value it had, so after an
 * operator turns the flag OFF a process whose refresh keeps failing would go on deleting. Here a
 * missing row is OFF, a true value is ON, and ANY other outcome (a failed read, a result that is not
 * a flag row) throws, which the caller reports as "flag unreadable" with no DELETE issued.
 */
export async function readRetentionFlagFresh(query: ReconRetentionDeps["query"]): Promise<boolean> {
  const raw = await query({ text: "SELECT `value` FROM feature_flags WHERE `key` = ? LIMIT 1", params: [RECON_RETENTION_FLAG] });
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) throw new Error("feature flag read returned an unreadable result");
  const rows = readRows(raw);
  if (rows.length === 0) return false;
  const v = rows[0].value;
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  throw new Error("feature flag row has an unreadable value");
}

export async function reconCandidatesRetention(deps: ReconRetentionDeps): Promise<ReconRetentionResult> {
  const now = deps.now ?? Date.now;

  let groups: Group[] | null;
  try {
    groups = parseGroups(await deps.query(buildReportSql()));
  } catch (err) {
    if (isMissingTableError(err)) log.info("recon candidates table missing: nothing to report");
    else log.warn("recon candidates report failed", { error: logSafeErrorMessage(err) });
    return { state: "unavailable" };
  }
  if (!groups) {
    log.warn("recon candidates report returned an unreadable result");
    return { state: "unavailable" };
  }

  const rows = groups.reduce((sum, g) => sum + g.n, 0);
  const calls = groups.length;
  const superseded = rows - calls;

  let enabled = false;
  let flag: "on" | "off" | "unreadable" = "off";
  try {
    enabled = await deps.isEnabled();
    flag = enabled ? "on" : "off";
  } catch {
    enabled = false; // an unreadable flag closes the delete path, and says so
    flag = "unreadable";
  }

  let deleted: number | null = 0;
  let truncated = false;
  let deleteFailed = false;
  if (enabled) {
    const duplicates = groups.filter((g) => g.n > 1).sort((a, b) => b.n - a.n || a.callId - b.callId);
    const start = now();
    let issued = 0;
    for (const g of duplicates) {
      if (issued >= MAX_DELETE_STATEMENTS_PER_RUN || now() - start >= MAX_DELETE_MS_PER_RUN) {
        truncated = true;
        break;
      }
      issued += 1;
      try {
        const removed = affectedRows(await deps.query(buildDeleteSupersededSql(g.callId, g.latest)));
        deleted = deleted === null || removed === null ? null : deleted + removed;
      } catch (err) {
        log.warn("recon candidates delete stopped on an error", { error: logSafeErrorMessage(err) });
        deleteFailed = true;
        break;
      }
    }
  }

  const result: ReconRetentionResult = {
    state: "measured",
    rows,
    calls,
    superseded,
    deleted,
    flag,
    truncated,
    deleteFailed,
  };
  log.info("recon candidates retention", { rows, calls, superseded, deleted, flag: result.flag, truncated, deleteFailed });
  return result;
}

/** The suffix cleanupOldData appends to its `details` string (counts only). */
export function reconRetentionDetails(r: ReconRetentionResult): string {
  if (r.state === "unavailable") return "recon candidates: unavailable";
  const base = `recon candidates: rows ${r.rows}, calls ${r.calls}, superseded ${r.superseded}, deleted ${r.deleted ?? "unknown"} (flag ${r.flag})`;
  return base + (r.truncated ? ", remainder next run" : "") + (r.deleteFailed ? ", delete stopped on an error" : "");
}
