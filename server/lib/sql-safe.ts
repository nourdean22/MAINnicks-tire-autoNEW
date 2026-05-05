/**
 * Typed safe-SQL helpers for raw SQL queries.
 *
 * Replaces the recurring boilerplate found in conversion.ts / intelligence.ts /
 * gatewayTire.ts / others:
 *
 *   const rows = await d.execute(sql`SELECT count(*) as cnt FROM x`)
 *     .catch(() => [[]] as any);
 *   const count = Number((rows as any)?.[0]?.cnt) || 0;
 *
 * → becomes:
 *
 *   const count = await safeCount(d, sql`SELECT count(*) as cnt FROM x`);
 *
 * Why this matters:
 * - Eliminates `as any` boilerplate from every raw-SQL aggregate
 * - Centralizes the catch/fallback contract (one place to add logging)
 * - Adds type safety on the consumer side without forcing schema imports
 * - Keeps the ergonomic tagged-template SQL syntax
 *
 * The DB client is the drizzle MySQL adapter. `.execute()` returns
 * `[ResultSet, FieldPacket[]]` for selects, where ResultSet is RowDataPacket[].
 * mysql2's row shape is opaque, so we accept that boundary and convert eagerly.
 */

import { type SQL } from "drizzle-orm";

// Drizzle's MySQL execute returns this shape — a tuple of [rows, fields]
// where rows is RowDataPacket[] (objects keyed by column alias).
// Typing it as unknown[] is honest about the boundary while staying flexible.
type RawRow = Record<string, unknown>;
type ExecuteResult = [RawRow[], unknown];

interface ExecutableDb {
  execute: (query: SQL) => Promise<unknown>;
}

function asRows(result: unknown): RawRow[] {
  // mysql2 returns [rows, fields]; planetscale-style returns { rows: [...] }
  if (Array.isArray(result)) {
    const tuple = result as ExecuteResult;
    return Array.isArray(tuple[0]) ? tuple[0] : [];
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as RawRow[]) : [];
  }
  return [];
}

/**
 * Execute a raw SQL query, returning typed rows. Returns [] on any error.
 *
 * @example
 * const rows = await safeRowQuery<{ id: number; name: string }>(
 *   d, sql`SELECT id, name FROM customers WHERE active = 1`
 * );
 */
export async function safeRowQuery<T extends RawRow>(
  d: ExecutableDb,
  query: SQL,
): Promise<T[]> {
  try {
    const result = await d.execute(query);
    return asRows(result) as T[];
  } catch {
    return [];
  }
}

/**
 * Execute a SQL aggregate that selects a single number column (typically
 * `count(*) as cnt` or `sum(x) as total`). Returns 0 on any error.
 *
 * Reads the FIRST column of the FIRST row, regardless of alias.
 *
 * @example
 * const count = await safeCount(d, sql`SELECT count(*) as cnt FROM bookings`);
 * const total = await safeCount(d, sql`SELECT sum(amount) as t FROM invoices`);
 */
export async function safeCount(d: ExecutableDb, query: SQL): Promise<number> {
  const rows = await safeRowQuery<RawRow>(d, query);
  if (!rows[0]) return 0;
  // Return the first non-null numeric column value, regardless of alias
  for (const value of Object.values(rows[0])) {
    if (value === null || value === undefined) continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

/**
 * Execute a SQL aggregate that returns a single-row, multi-column result
 * (totals, sums, averages bundled together). Returns the first row typed,
 * or an empty object on error.
 *
 * @example
 * const totals = await safeAggregate<{ leads: number; revenue: number }>(
 *   d, sql`SELECT count(*) as leads, sum(amount) as revenue FROM ...`
 * );
 * console.log(totals.leads ?? 0);
 */
export async function safeAggregate<T extends RawRow>(
  d: ExecutableDb,
  query: SQL,
): Promise<Partial<T>> {
  const rows = await safeRowQuery<T>(d, query);
  return (rows[0] ?? {}) as Partial<T>;
}
