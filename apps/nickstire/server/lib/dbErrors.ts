/**
 * Recognise a UNIQUE-constraint rejection from mysql2 / TiDB.
 *
 * Why a shared helper: this check already existed as ad-hoc copies in
 * services/proposals.ts, services/shopDriverMirror.ts (twice) and, on the
 * promise-ledger branch, services/promiseLedger.ts — each a slightly different
 * regex. A fifth copy would drift like the others. New call sites import this;
 * the older copies are a consolidation target, not touched here.
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
