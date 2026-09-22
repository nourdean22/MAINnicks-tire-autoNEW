/**
 * Recognise a UNIQUE-constraint rejection from mysql2 / TiDB.
 *
 * Why a shared helper: this check existed as ad-hoc copies in
 * services/proposals.ts, services/shopDriverMirror.ts (twice) and
 * services/promiseLedger.ts — each a slightly different regex, one of them
 * (/duplicate/i) loose enough to match "Duplicate column name". All four
 * import this now (2026-09-22); a fifth copy would drift like the others did.
 *
 * What the signal MEANS is the caller's business. On an idempotency index it is
 * usually "someone else already did this" — a success, not a failure — and the
 * caller should re-read rather than surface an error. On a primary key it may be
 * a genuine bug. This function only answers "was it a duplicate-key rejection".
 */
export function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: unknown; errno?: unknown; message?: unknown } | null;
  if (e?.code === "ER_DUP_ENTRY" || e?.errno === 1062) return true;
  const msg = e?.message != null ? String(e.message) : err instanceof Error ? err.message : String(err);
  return /ER_DUP_ENTRY|Duplicate entry|\b1062\b/i.test(msg);
}
