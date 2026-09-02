/**
 * tests/security/migration-apply-error-classification.test.ts
 * 2026-09-02 · from a review finding on PR #2086.
 *
 * POST /api/system/apply-pending-migration ran registry SQL against
 * PRODUCTION and swallowed any error matching `/already exists|duplicate/i`
 * as "skip". PostgreSQL reports a failed unique-index build with the word
 * "duplicated" in it, so the exact failure the index-restore migration
 * documents as expected was recorded as skipped, the loop continued, and the
 * route answered `applied: true` with no index created.
 *
 * The migration's own header asserted the opposite — that the route "stops at
 * the failing statement and returns it. Nothing is half-done." That claim was
 * written without reading the executor. It is corrected in the same commit as
 * this file.
 *
 * The tests below use REAL PostgreSQL error text, not paraphrases, because
 * the defect was entirely about which literal words appear in a message.
 */
import { describe, expect, it } from "vitest";
import {
  classifyStatementError,
  indexNamesCreatedBy,
  DATA_CONFLICT_ERROR,
  SKIPPABLE_ERROR,
} from "@/lib/db/migration-apply-safety";

/** What Postgres actually says when a unique index cannot be built. */
const PG_UNIQUE_BUILD_FAILURE =
  'could not create unique index "scheduled_actions_idempotency_key_uniq"\n' +
  "DETAIL:  Key (idempotency_key)=(abc-123) is duplicated.";

/** What Postgres says when the object is simply already there. */
const PG_ALREADY_EXISTS = 'relation "chat_messages_searchable_tsv_idx" already exists';

describe("apply-pending-migration · a data conflict is a failure, not a skip", () => {
  it("PLANTED POSITIVE · the old pattern really would have swallowed this", () => {
    // The regression in one line. If this ever stops matching, the defect
    // being guarded never existed and this whole file is theatre.
    expect(/already exists|duplicate/i.test(PG_UNIQUE_BUILD_FAILURE)).toBe(true);
  });

  it("fails on a unique index that could not be built", () => {
    expect(classifyStatementError(PG_UNIQUE_BUILD_FAILURE)).toBe("fail");
  });

  it("fails on a plain unique-violation message", () => {
    expect(
      classifyStatementError('duplicate key value violates unique constraint "reflections_pkey"'),
    ).toBe("fail");
  });

  it("still skips a genuine already-exists collision", () => {
    // The narrowing must not break real idempotency — re-running a migration
    // has to stay a no-op, which is the property the whole registry relies on.
    expect(classifyStatementError(PG_ALREADY_EXISTS)).toBe("skip");
    expect(classifyStatementError('type "OutcomeRating" already exists')).toBe("skip");
    expect(classifyStatementError("duplicate column name: outcome_rating")).toBe("skip");
  });

  it("fails closed on anything it does not recognise", () => {
    // The default matters more than either pattern: this route has prod
    // credentials and no dry run, so an unfamiliar error must stop the run.
    expect(classifyStatementError("connection terminated unexpectedly")).toBe("fail");
    expect(classifyStatementError("permission denied for table scheduled_actions")).toBe("fail");
    expect(classifyStatementError("")).toBe("fail");
  });

  /**
   * TWO INDEPENDENT LAYERS reject the build-failure message, and each alone is
   * sufficient: SKIPPABLE_ERROR was narrowed so "is duplicated" no longer
   * matches it, AND DATA_CONFLICT_ERROR catches it first regardless.
   *
   * That redundancy is deliberate, but it made the first version of this file
   * a BLIND canary: deleting either layer left classifyStatementError() still
   * returning "fail", so a mutation run scored green and proved nothing. The
   * two assertions below pin the layers SEPARATELY, so losing either one is
   * detected even though the composite behaviour would still look correct.
   */
  it("layer 1 · the skip pattern must NOT match a data conflict", () => {
    // Breaks if SKIPPABLE_ERROR is widened back toward /duplicate/i — which is
    // exactly the original defect.
    expect(SKIPPABLE_ERROR.test(PG_UNIQUE_BUILD_FAILURE)).toBe(false);
    // ...while still matching the collisions it exists for.
    expect(SKIPPABLE_ERROR.test(PG_ALREADY_EXISTS)).toBe(true);
    expect(SKIPPABLE_ERROR.test("duplicate key name foo")).toBe(true);
  });

  it("layer 2 · the data-conflict pattern must match, and is checked first", () => {
    // Breaks if DATA_CONFLICT_ERROR is removed or loses this alternative.
    expect(DATA_CONFLICT_ERROR.test(PG_UNIQUE_BUILD_FAILURE)).toBe(true);
    // Ordering: a message matching BOTH must classify as fail, not skip.
    const both = 'could not create unique index "x" — relation already exists';
    expect(DATA_CONFLICT_ERROR.test(both) && SKIPPABLE_ERROR.test(both)).toBe(true);
    expect(classifyStatementError(both)).toBe("fail");
  });
});

describe("apply-pending-migration · post-apply verification knows what to look for", () => {
  const RESTORE = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_actions_idempotency_key_uniq" ON "scheduled_actions"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "task_events_idempotency_key_uniq" ON "task_events"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "goal_events_idempotency_key_uniq" ON "goal_events"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "reflections_idempotency_key_uniq" ON "reflections"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "decision_replays_idempotency_key_uniq" ON "decision_replays"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS "chat_messages_searchable_tsv_idx" ON "chat_messages" USING GIN ("searchable_tsv")`,
  ];

  it("extracts every index name the restore migration creates", () => {
    expect(indexNamesCreatedBy(RESTORE)).toEqual([
      "scheduled_actions_idempotency_key_uniq",
      "task_events_idempotency_key_uniq",
      "goal_events_idempotency_key_uniq",
      "reflections_idempotency_key_uniq",
      "decision_replays_idempotency_key_uniq",
      "chat_messages_searchable_tsv_idx",
    ]);
  });

  it("handles the spellings the registry actually uses", () => {
    expect(
      indexNamesCreatedBy([
        `CREATE INDEX "plain_idx" ON "t"("c")`,
        `create unique index if not exists "lower_case_idx" on "t"("c")`,
        `CREATE UNIQUE INDEX CONCURRENTLY "concurrent_idx" ON "t"("c")`,
      ]),
    ).toEqual(["plain_idx", "lower_case_idx", "concurrent_idx"]);
  });

  it("PLANTED POSITIVE · returns nothing for statements that create no index", () => {
    // An extractor that returned names for DROP INDEX would make the caller
    // demand the presence of indexes a migration just removed.
    expect(
      indexNamesCreatedBy([
        `DROP INDEX IF EXISTS "brain_memories_lastSeen_idx"`,
        `ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "outcome_lesson" TEXT`,
        `CREATE TABLE IF NOT EXISTS "goal_stats" ("id" TEXT NOT NULL)`,
      ]),
    ).toEqual([]);
  });
});
