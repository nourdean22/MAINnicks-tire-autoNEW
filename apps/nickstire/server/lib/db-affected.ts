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
export function affectedRowCount(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const count = (header as { affectedRows?: unknown } | null | undefined)?.affectedRows;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}
