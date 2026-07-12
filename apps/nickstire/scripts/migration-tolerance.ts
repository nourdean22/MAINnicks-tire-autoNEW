/**
 * Tolerated-error policy for the idempotent migration runner (db-migrate.ts).
 *
 * Extracted so the "which DB errors mean 'already applied / safe to skip'"
 * decision is unit-testable without a live DB connection. The runner treats a
 * tolerated error as a no-op and continues; an UNtolerated error halts the run
 * (so genuine failures — bad SQL, wrong types — still stop the deploy).
 */

// MySQL/TiDB error CODE strings treated as "already applied — keep going".
// These cover both the "object already exists" case (idempotent re-run) and
// the "object referenced by migration was later dropped" case (migration is
// partially out of date but the schema is fine).
export const TOLERATED_CODES = new Set([
  "ER_TABLE_EXISTS_ERROR",     // 1050: CREATE TABLE on existing
  "ER_DUP_KEYNAME",            // 1061: CREATE INDEX on existing
  "ER_DUP_FIELDNAME",          // 1060: ALTER ADD COLUMN on existing
  "ER_DUP_ENTRY",              // 1062: INSERT on dup primary
  "ER_BAD_FIELD_ERROR",        // 1054: column referenced doesn't exist
  "ER_KEY_COLUMN_DOES_NOT_EXIST", // 1072
  "ER_NO_SUCH_TABLE",          // 1146: table referenced doesn't exist
  "ER_CANT_DROP_FIELD_OR_KEY", // 1091: DROP on missing
  "ER_NO_REFERENCED_ROW_2",    // 1452: FK target missing (rare in migrations)
  "ER_TOO_LONG_KEY",           // 1071: key length limit exceeded
]);

// Numeric errno fallback — some TiDB / MariaDB / forks return non-MySQL code
// strings. Normalize on errno so we still tolerate the right cases.
//
//   8200 — TiDB: "Unsupported creating expression index containing unsafe
//          functions without allow-expression-index in config". Migration 0046
//          creates an expression index on normalized phone
//          (RIGHT(REPLACE(...`phone`...),10)); TiDB Cloud rejects it. The index
//          is NOT load-bearing — every sms_conversations query filters the
//          `phone` column directly (eq / inArray / suffix-LIKE), and that column
//          already stores the normalized value, so the query planner would never
//          use the expression index anyway. Tolerating 8200 lets the runner
//          reach later migrations instead of halting on a redundant,
//          prod-absent index. (Fixes the 2026-07-12 halt that forced 0079/0080
//          to be applied by a one-off script.)
export const TOLERATED_ERRNOS = new Set([1050, 1054, 1060, 1061, 1062, 1072, 1091, 1146, 1071, 8200]);

// Message-substring fallback for engines that don't fill code/errno.
export const TOLERATED_MESSAGE_FRAGMENTS = [
  "already exists",
  "duplicate column",
  "duplicate key",
  "column does not exist",
  "doesn't exist",
  "unknown column",
  "no such table",
  "unsupported creating expression index", // TiDB errno 8200 (see above)
];

export function isTolerableError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; message?: string };
  if (e.code && TOLERATED_CODES.has(e.code)) return true;
  if (e.errno && TOLERATED_ERRNOS.has(e.errno)) return true;
  if (e.message) {
    const lower = e.message.toLowerCase();
    if (TOLERATED_MESSAGE_FRAGMENTS.some((frag) => lower.includes(frag))) return true;
  }
  return false;
}
