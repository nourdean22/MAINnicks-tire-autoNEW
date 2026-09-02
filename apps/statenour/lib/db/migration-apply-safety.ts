/**
 * lib/db/migration-apply-safety.ts
 *
 * How POST /api/system/apply-pending-migration decides whether a failed
 * statement is survivable.
 *
 * EXTRACTED from that route on 2026-09-02 in response to a review finding on
 * PR #2086. The route runs registry SQL through `$executeRawUnsafe` against
 * PRODUCTION from a browser tab, so its error classification is a safety
 * boundary; it lived inline as one regex and could not be tested without
 * importing Prisma to inspect a string.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS EXISTS TO PREVENT
 * ══════════════════════════════════════════════════════════════════════
 *
 * The test was `/already exists|duplicate/i` -> record "skip", keep going.
 * PostgreSQL reports a failed unique-index build like this:
 *
 *     could not create unique index "scheduled_actions_idempotency_key_uniq"
 *     DETAIL:  Key (idempotency_key)=(abc) is duplicated.
 *
 * "duplicated" contains "duplicate". So the statement was skipped, the loop
 * continued, and the route answered `applied: true` with the index NOT
 * created. The operator's next step is to promote the SQL and run
 * `prisma migrate resolve --applied`, which marks a migration done that never
 * happened — while the uniqueness guard the migration existed to restore is
 * still absent and the schema sentinel still reports drift.
 *
 * The two errors could not be more different:
 *
 *   · "already exists" (42P07) — the object is there. The desired end state
 *     holds. Skipping is correct idempotency.
 *   · "is duplicated" (23505) — the DATA conflicts with the constraint being
 *     created. The end state is unreachable without deleting rows, which is a
 *     judgement about which record is real. A migration must not make it, and
 *     must not pretend it did not need making.
 *
 * One regex cannot serve both, and the one that was there resolved the
 * ambiguity in the dangerous direction.
 */

/** Errors meaning the object already exists — the end state holds. */
export const SKIPPABLE_ERROR = /already exists|duplicate object|duplicate column|duplicate key name/i;

/**
 * Errors meaning the DATA conflicts with the constraint being created.
 *
 * Deliberately overlaps SKIPPABLE_ERROR on the word "duplicate"; classify()
 * checks this one FIRST so the narrower, more dangerous reading wins.
 */
export const DATA_CONFLICT_ERROR = /could not create unique index|is duplicated|duplicate key value violates/i;

export type StatementOutcome = "skip" | "fail";

/**
 * Classify a statement error. Anything not positively recognised as a
 * harmless object collision is a failure — the default is to stop, because
 * this route has production credentials and no dry run.
 */
export function classifyStatementError(message: string): StatementOutcome {
  if (DATA_CONFLICT_ERROR.test(message)) return "fail";
  return SKIPPABLE_ERROR.test(message) ? "skip" : "fail";
}

/**
 * Index names a statement list claims to create, for post-apply verification.
 *
 * Quoted names only — every registered CREATE INDEX uses them, and matching
 * bare identifiers would need real SQL parsing to avoid false positives.
 * A statement list that creates no indexes returns [], which the caller reads
 * as "nothing to verify" rather than as "verification passed".
 */
export function indexNamesCreatedBy(statements: readonly string[]): string[] {
  const names: string[] = [];
  for (const stmt of statements) {
    const m = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i.exec(
      stmt,
    );
    if (m) names.push(m[1]);
  }
  return names;
}
