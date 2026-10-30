/**
 * Supersede exact-duplicate recall-visible memories onto the oldest copy (brain backfill W4, 2026-10-30).
 *
 * Measured on prod 2026-10-30 (read-only census): 1,049 extra rows in 591 groups of identical content within one
 * category among the 17,816 recall-visible rows: archive_document 845, journal_brain_take 89, telemetry_temporal_warn
 * 43 (now telemetry, so out of scope here), emotional_state 31, insight 23. Only key-free categories are touched (DEDUPE_CATEGORIES). Every copy spends a recall slot on text
 * the keeper already carries. Mem0's UPDATE/NOOP and Graphiti's invalidate-not-delete are the borrowed mechanisms.
 *
 * SOFT ONLY, same shape as dedupe-blind-spots.ts. A loser gets deleted_at = now(), superseded_by_id = the keeper and
 * valid_until = now(): live recall drops a superseded row (validityWhere), and as-of recall needs valid_until, because
 * its predicate does not read superseded_by_id (contextual-recall.ts validityWhere / validitySql). The keeper is the
 * oldest row of a group (ties by id). Groups never span categories. Nothing in vector_embeddings is touched: the
 * loser's vector is excluded by the source-liveness filter (pgvector knnSearch, contextual-recall getKnnPoolRows).
 *
 * Usage (from apps/statenour; the manager runs it on Nour's go, outside 03:00-03:20Z):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/dedupe-exact.ts              # plan, no connection
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/dedupe-exact.ts --read       # counts by category, SELECT only
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/dedupe-exact.ts --execute --expect=<count from --read>
 */
import { RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
import { applyBatches, backupExists, backupName, fail, finish, isEntry, runHygiene, toCount, type Db, type HygieneSpec } from "./_run";

const BATCH = 1000;

/**
 * Only categories nobody reads by (category, key). A key-addressed row cannot lose to an older copy: its reader
 * would find the tombstone (identity_snapshot, scoreboard_pinned, qualitative_identity, blind_spot,
 * anticipated_question and journal_brain_take all have findUnique/findFirst/category_key readers). Census
 * 2026-10-30: these five have none, and hold 909 of the 1,009 duplicates.
 */
export const DEDUPE_CATEGORIES: readonly string[] = ["archive_document", "emotional_state", "insight", "nick_advice", "industry_intel"];

/** Recall-visible: the rows the Prisma pool can return (contextual-recall.ts dbFetch). */
const RV = `bm.deleted_at IS NULL AND bm.confidence >= 0.3 AND NOT (bm.category = ANY($1::text[]))
   AND (bm.expires_at IS NULL OR bm.expires_at > now()) AND bm.valid_until IS NULL AND bm.superseded_by_id IS NULL`;

/** Every member of a duplicated (category, content hash) group, with the versions the decision reads. Hashes, never content. */
export const GROUPS_SQL = `
WITH d AS (
  SELECT bm.category, md5(bm.content) AS h FROM brain_memories bm WHERE ${RV} AND bm.category = ANY($2::text[]) GROUP BY 1, 2 HAVING COUNT(*) > 1
)
SELECT bm.id, bm.category, md5(bm.content) AS h,
       (EXTRACT(EPOCH FROM bm.created_at) * 1000)::float8 AS created_ms,
       bm.updated_at::text AS upd, bm.last_seen::text AS seen, bm.seen_count
  FROM brain_memories bm JOIN d ON d.category = bm.category AND d.h = md5(bm.content)
 WHERE ${RV} AND bm.category = ANY($2::text[])`;

/**
 * Compare-and-swap on the exact rows read (claim-before-act): identity, category, content hash, liveness and the
 * row versions. The keeper must still be live with the same hash, so a loser never points at a row that changed.
 */
export const CAS_SQL = `
UPDATE brain_memories b
   SET deleted_at = now(), superseded_by_id = c.keeper_id, valid_until = now(), updated_at = now()
  FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[]) AS c(id, keeper_id, category, h, upd, seen, seen_count)
 WHERE b.id = c.id
   AND b.deleted_at IS NULL
   AND b.superseded_by_id IS NULL
   AND b.category = c.category
   AND md5(b.content) = c.h
   AND b.updated_at::text = c.upd
   AND b.last_seen::text = c.seen
   AND b.seen_count = c.seen_count
   AND EXISTS (SELECT 1 FROM brain_memories k WHERE k.id = c.keeper_id AND k.deleted_at IS NULL AND k.superseded_by_id IS NULL AND md5(k.content) = c.h)`;

export interface Row {
  id: string;
  category: string;
  h: string;
  createdMs: number;
  upd: string;
  seen: string;
  seenCount: number;
}
export interface Loser extends Row {
  keeperId: string;
}

/** One group per (category, hash); the keeper is the oldest row, ties broken by id so every run picks the same one. */
export function planExactDedupe(rows: readonly Row[]): { groups: number; losers: Loser[] } {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.category}\u0000${r.h}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const losers: Loser[] = [];
  let n = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    n++;
    members.sort((x, y) => x.createdMs - y.createdMs || (x.id < y.id ? -1 : 1));
    for (const m of members.slice(1)) losers.push({ ...m, keeperId: members[0].id });
  }
  losers.sort((x, y) => (x.id < y.id ? -1 : 1));
  return { groups: n, losers };
}

async function loadPlan(db: Db): Promise<{ groups: number; losers: Loser[] }> {
  const raw = await db.query<{ id: string; category: string; h: string; created_ms: number; upd: string; seen: string; seen_count: number }>(
    GROUPS_SQL,
    [...RECALL_EXCLUDE_CATEGORIES],
    [...DEDUPE_CATEGORIES],
  );
  return planExactDedupe(raw.map((r) => ({ id: r.id, category: r.category, h: r.h, createdMs: Number(r.created_ms), upd: r.upd, seen: r.seen, seenCount: Number(r.seen_count) })));
}

export const spec: HygieneSpec = {
  name: "dedupe-exact",

  plan: () => [
    "",
    "1. SELECT every member of a duplicated (category, md5(content)) group among recall-visible rows (ids, hashes and versions; no content):",
    GROUPS_SQL,
    "2. Group in code. Keeper = oldest row (ties by id). Losers = the rest. Groups never span categories.",
    "3. --execute only: CREATE TABLE _bak_brain_memories_exact_dedup_<yyyymmdd> (LIKE brain_memories); INSERT the losers; count, abort on mismatch;",
    "   refuse if the backup table already exists.",
    `4. --execute only: compare-and-swap, batches of ${BATCH}:`,
    CAS_SQL,
    "5. --execute only: re-count the superseded losers; print the rollback SQL. No statement removes a row.",
  ],

  async read(db) {
    const p = await loadPlan(db);
    const byCat = new Map<string, number>();
    for (const l of p.losers) byCat.set(l.category, (byCat.get(l.category) ?? 0) + 1);
    return {
      count: p.losers.length,
      lines: [
        `duplicate groups        : ${p.groups}`,
        `removable (superseded)  : ${p.losers.length}`,
        "by category:",
        ...[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `  ${c.padEnd(28)} ${n}`),
      ],
    };
  },

  async execute(db, { expect, today, log }) {
    const p = await loadPlan(db);
    if (p.losers.length !== expect) {
      log(`ABORT: the candidate set moved since --read (${p.losers.length} now, --expect=${expect}). Nothing written.`);
      return 1;
    }
    if (p.losers.length === 0) {
      log("nothing to do.");
      return 0;
    }
    const bak = backupName("brain_memories", "exact_dedup", today);
    if (await backupExists(db, bak)) {
      log(`ABORT: backup table ${bak} already exists. Inspect it, then drop or rename it by hand. Nothing written.`);
      return 1;
    }
    const ids = p.losers.map((l) => l.id);
    await db.exec(`CREATE TABLE ${bak} (LIKE brain_memories)`);
    await db.exec(`INSERT INTO ${bak} SELECT * FROM brain_memories WHERE id = ANY($1::text[])`, ids);
    const backedUp = toCount((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${bak}`))[0]?.n);
    log(`backup ${bak}: ${backedUp} of ${ids.length} rows`);
    if (backedUp !== ids.length) {
      log(`ABORT: backup holds ${backedUp} rows, expected ${ids.length}. Nothing swapped. The backup table is left in place.`);
      return 1;
    }
    const rollback =
      `UPDATE brain_memories b SET deleted_at = k.deleted_at, superseded_by_id = k.superseded_by_id, valid_until = k.valid_until, updated_at = k.updated_at\n` +
      `  FROM ${bak} k WHERE b.id = k.id AND b.superseded_by_id IS NOT NULL AND b.deleted_at IS NOT NULL;`;
    log(`\nROLLBACK (restores the four columns this script wrote, only on rows still superseded):\n${rollback}\n`);

    const swapped = await applyBatches(
      p.losers,
      BATCH,
      (b) =>
        db.exec(
          CAS_SQL,
          b.map((l) => l.id),
          b.map((l) => l.keeperId),
          b.map((l) => l.category),
          b.map((l) => l.h),
          b.map((l) => l.upd),
          b.map((l) => l.seen),
          b.map((l) => l.seenCount),
        ),
      (done) => log(`backup ${bak}: ${done} of ${ids.length} rows already swapped; rollback SQL above`),
    );
    const now = toCount(
      (await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM brain_memories WHERE id = ANY($1::text[]) AND deleted_at IS NOT NULL AND superseded_by_id IS NOT NULL`, ids))[0]?.n,
    );
    log(`swapped ${swapped} of ${ids.length}; re-count shows ${now} superseded.`);
    if (swapped !== ids.length || now !== ids.length) {
      log("MISMATCH: some rows changed between the read and the swap (the compare-and-swap skipped them). Re-run --read; roll back with the SQL above if needed.");
      return 1;
    }
    log(`ROLLBACK (again, for the record):\n${rollback}`);
    return 0;
  },
};

if (isEntry(import.meta.url)) {
  runHygiene(spec).then(finish, fail);
}
