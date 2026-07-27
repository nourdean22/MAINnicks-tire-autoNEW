/**
 * Read the affected-row count off a Drizzle/mysql2 write result.
 *
 * Drizzle's mysql2 driver resolves `.update()` to `[ResultSetHeader, FieldPacket[]]`,
 * but several call sites in this server read `.affectedRows` off the result directly
 * (see cron/index.ts:158, cron/jobs/crudAutomation.ts:200) while others index `[0]`
 * (cron/jobs/cleanup.ts:35). Both shapes are handled here so callers stop guessing.
 *
 * Defaults to 0 — an unreadable result counts as NOT claimed. Callers use this to
 * gate irreversible external work (publishing to Meta), where "assume it worked"
 * means double-posting to a live account. Failing closed costs a retry; failing
 * open costs a duplicate the operator cannot unsend.
 */
import { writeResult } from "./dbResult";

/**
 * Shares ONE unwrap with dbResult.ts. Those two files were briefly duplicating
 * this logic (my own, same day) — two copies of a shape rule drift apart.
 *
 * The CONTRACTS stay different on purpose, and that difference is the point:
 *   affectedRowCount()  unreadable -> 0     "not claimed", fail closed
 *   dbResult.affectedRows()  unreadable -> null  "we were told nothing"
 *
 * Zero is right here because callers gate irreversible external work on it.
 * Null is right there because callers turn the count into a user-visible
 * "not found", and reporting a missing row when the driver simply said nothing
 * is exactly the bug that made shareCards.trackShare throw on every call.
 */
export function affectedRowCount(result: unknown): number {
  const count = writeResult(result).affectedRows;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}
