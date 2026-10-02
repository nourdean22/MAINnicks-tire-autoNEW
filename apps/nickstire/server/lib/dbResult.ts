/**
 * Unwrapping a MySQL write result, in one place.
 *
 * drizzle-orm's mysql2 driver types every write as:
 *
 *   type MySqlRawQueryResult = [ResultSetHeader, FieldPacket[]]
 *
 * so `insert()` / `update()` / `delete()` resolve to an ARRAY, and the
 * `insertId` / `affectedRows` a caller wants live at `[0]`. Read the property
 * off the array itself and you get `undefined` — silently, because the value
 * has a plausible fallback:
 *
 *   (result as any).insertId              -> undefined  -> "created" with no id
 *   (result).affectedRows ?? 0            -> 0          -> "not found", always
 *
 * The second shape is the dangerous one: a guard written to detect "no row
 * matched" instead fires on EVERY call, so the operation can never succeed.
 *
 * Raw `db.execute(sql\`...\`)` has the same shape, which is why most call sites
 * in this repo destructure it (`const [result] = await db.execute(...)`) and are
 * correct. The builder calls are the ones that get missed, because they read
 * like they return a plain object.
 *
 * The read-side analogue is `readRows()` below (2026-10-02). Older copies —
 * `rowsFromExecute()` in cron/jobs/vapiCallEval.ts (#1121) and
 * services/opportunityQueue.ts, `extractRows()` in services/engines/shared.ts —
 * predate it and stay where they are tested; new code imports this one, which,
 * unlike engines/shared, pulls in no database module.
 */

/** mysql2's ResultSetHeader, narrowed to the fields anything here reads. */
export interface WriteResult {
  insertId?: number;
  affectedRows?: number;
  changedRows?: number;
}

/**
 * The ResultSetHeader from a drizzle write, whether it arrives wrapped in the
 * `[header, fields]` tuple or already unwrapped by a destructuring caller.
 * Returns an empty object rather than throwing — callers decide what a missing
 * header means, and that decision differs (a missing insertId is a warning; a
 * missing affectedRows must NOT be read as zero).
 */
export function writeResult(result: unknown): WriteResult {
  if (Array.isArray(result)) return (result[0] ?? {}) as WriteResult;
  if (result && typeof result === "object") return result as WriteResult;
  return {};
}

/** The new row's id, or null when the driver did not report one. */
export function insertedId(result: unknown): number | null {
  const n = Number(writeResult(result).insertId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Rows the statement touched, or `null` when the driver reported NOTHING.
 *
 * Null is not zero, and collapsing the two is the whole bug this file exists
 * for: "the driver told us nothing" must never be actioned as "no row matched".
 * Callers that turn a count into a user-visible failure have to handle the
 * null case deliberately.
 */
export function affectedRows(result: unknown): number | null {
  const h = writeResult(result);
  const raw = h.affectedRows ?? h.changedRows;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The row array from a raw `db.execute(sql\`SELECT …\`)`, whether it arrives as the
 * mysql2 `[rows, fields]` tuple or already unwrapped. Anything else is no rows.
 */
export function readRows(result: unknown): Array<Record<string, unknown>> {
  const r = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(r) ? (r as Array<Record<string, unknown>>) : [];
}
