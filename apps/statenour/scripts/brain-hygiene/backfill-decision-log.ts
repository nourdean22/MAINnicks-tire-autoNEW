/**
 * Give every live MasteryDecision a decision_log memory keyed decision_<id> (brain backfill W6, 2026-10-30).
 *
 * Measured on prod 2026-10-30 (read-only): 19 live decisions (ids 1-19, created 2026-03-25..04-28), and not one
 * decision_log row keyed decision_<n>. Recall reads brain_memories (decision_log is recall-visible), so those
 * decisions are absent from semantic recall; the 265 decision_log rows that exist are chat-extracted.
 *
 * The row is the one journalDecision writes for a new decision (lib/ai/tools/tasks.ts): category decision_log,
 * key decision_<id>, source decision_journal, confidence 0.8, no expiry, same content shape. It is NOT written
 * through remember(): remember() gives a new decision_log row confidence 0.5 and a 24h expiry, so all 19 would be
 * pruned the next day, and neither live decision_log writer (tasks.ts, conversation-memory.ts) goes through it.
 * valid_from is the decision's own created_at, so as-of recall sees the decision when it was made.
 * The embed-backfill missing lane embeds the rows on its next run (confidence 0.8 >= its 0.2 floor).
 *
 * Additive, so there is nothing to back up. INSERT ... ON CONFLICT (category, key) DO NOTHING is the claim: a key
 * that exists in any state (a soft-deleted row included) is never revived or overwritten, and a second run
 * inserts nothing. Rollback soft-deletes exactly the ids this run inserted.
 *
 * Usage (from apps/statenour; the manager runs it on Nour's go):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/backfill-decision-log.ts              # plan, no connection
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/backfill-decision-log.ts --read       # count and ids, SELECT only
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/backfill-decision-log.ts --execute --expect=<count from --read>
 */
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { resolveTrustTier } from "@/lib/brain/memory-trust";
import { fail, finish, isEntry, runHygiene, type Db, type HygieneSpec } from "./_run";

export const CATEGORY = BRAIN_CATEGORIES.DECISION_LOG;
export const SOURCE = "decision_journal";
export const CONFIDENCE = 0.8;
/** Marks the rows this script wrote, so the rollback can never touch a row a live writer made. */
export const BACKFILL_TAG = "brain-backfill-w6";
/** The tier the live writer's provenance resolves to: decided by the shared resolver, never hand-picked. */
export const TRUST_TIER = resolveTrustTier({ source: SOURCE, category: CATEGORY, createdBy: "system", trustTier: null });

/** Ids only: decisions with no decision_log row at decision_<id> in ANY state. */
export const READ_SQL = `
SELECT d.id
  FROM mastery_decisions d
 WHERE d.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM brain_memories bm WHERE bm.category = $1 AND bm.key = 'decision_' || d.id::text)
 ORDER BY d.id`;

/**
 * journalDecision's content, built in SQL so the script never holds decision text. A missing chosen / stakes /
 * reasoning drops its clause instead of printing "null". chr(8212) is the em dash journalDecision writes.
 */
export const INSERT_SQL = `
INSERT INTO brain_memories (id, category, key, content, confidence, source, expires_at, metadata, created_by,
                            updated_at, valid_from, trust_tier)
SELECT gen_random_uuid()::text, $2, 'decision_' || d.id::text,
       'Decision: "' || d.title || '"'
         || coalesce(' ' || chr(8212) || ' chose "' || nullif(trim(d.chosen), '') || '"', '')
         || coalesce(' (' || nullif(trim(d.stakes), '') || ' stakes)', '')
         || '.'
         || coalesce(' Reasoning: ' || nullif(trim(d.reasoning), ''), ''),
       $3, $4, NULL,
       jsonb_build_object('backfill', $5::text, 'decisionId', d.id, 'evidenceRefs', jsonb_build_array('mastery_decision:' || d.id::text)),
       'system', now(), d.created_at, $6
  FROM mastery_decisions d
 WHERE d.id = ANY($1::int[]) AND d.deleted_at IS NULL
ON CONFLICT (category, key) DO NOTHING
RETURNING id`;

export function rollbackSql(ids: readonly string[]): string {
  const list = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
  return (
    `UPDATE brain_memories SET deleted_at = now(), updated_at = now()\n` +
    ` WHERE id IN (${list || "NULL"}) AND deleted_at IS NULL AND source = '${SOURCE}' AND metadata->>'backfill' = '${BACKFILL_TAG}';`
  );
}

async function loadIds(db: Db): Promise<number[]> {
  return (await db.query<{ id: number }>(READ_SQL, CATEGORY)).map((r) => Number(r.id));
}

export const spec: HygieneSpec = {
  name: "backfill-decision-log",

  plan: () => [
    "",
    "1. SELECT the live decisions with no decision_log row at decision_<id> in any state (ids only):",
    READ_SQL,
    `2. --execute only: one INSERT, idempotent on (category, key); confidence ${CONFIDENCE}, source ${SOURCE}, trust ${TRUST_TIER}, no expiry:`,
    INSERT_SQL,
    "3. --execute only: print the ids inserted and the rollback (a soft delete of exactly those ids). Nothing is updated or removed.",
  ],

  async read(db) {
    const ids = await loadIds(db);
    return { count: ids.length, lines: [`decisions without a decision_log row : ${ids.length}`, `decision ids                         : ${ids.join(",") || "(none)"}`] };
  },

  async execute(db, { expect, log }) {
    const ids = await loadIds(db);
    if (ids.length !== expect) {
      log(`ABORT: the candidate set moved since --read (${ids.length} now, --expect=${expect}). Nothing written.`);
      return 1;
    }
    if (ids.length === 0) {
      log("nothing to do.");
      return 0;
    }
    const inserted = (await db.query<{ id: string }>(INSERT_SQL, ids, CATEGORY, CONFIDENCE, SOURCE, BACKFILL_TAG, TRUST_TIER)).map((r) => r.id);
    log(`inserted ${inserted.length} of ${ids.length} (a key that appeared since --read is skipped, never overwritten).`);
    log(`\nROLLBACK (soft-deletes exactly the rows this run inserted):\n${rollbackSql(inserted)}\n`);
    if (inserted.length !== ids.length) {
      log("MISMATCH: some keys were written by another writer between the read and the insert. Those rows are untouched; re-run --read.");
      return 1;
    }
    return 0;
  },
};

if (isEntry(import.meta.url)) {
  runHygiene(spec).then(finish, fail);
}
