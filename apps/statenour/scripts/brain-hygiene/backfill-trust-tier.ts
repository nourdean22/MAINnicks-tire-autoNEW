/**
 * Store the trust tier every reader already resolves, for live rows whose trust_tier is NULL (brain backfill W3, 2026-10-30).
 *
 * Measured on prod 2026-10-30 (read-only census): 8,663 live rows NULL, 3,856 of them recall-visible, every one created
 * after the one-shot 2026-09-03 backfill, because only admitMemory stamped the column (remember() now does too, W3).
 * The value written is resolveTrustTier(row) with trustTier NULL: the source-derived tier (classifyTrustTier) tightened
 * by the admission envelope. resolveTrustTier only ever tightens, so readers resolve the same tier before and after:
 * this changes counts, filters and the /brain UI, never what recall trusts.
 *
 * Usage (from apps/statenour; the manager runs it on Nour's go):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/backfill-trust-tier.ts              # plan, no connection
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/backfill-trust-tier.ts --read       # counts by tier, SELECT only
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/backfill-trust-tier.ts --execute --expect=<count from --read>
 */
import { resolveTrustTier, type TrustTier } from "@/lib/brain/memory-trust";
import { applyBatches, backupExists, backupName, fail, finish, isEntry, runHygiene, toCount, type Db, type HygieneSpec } from "./_run";

export const BATCH = 1000;

type Row = { id: string; source: string | null; created_by: string | null; category: string; admission: unknown };

/** Provenance only, never content. */
export const READ_SQL = `
SELECT id, source, created_by, category, metadata->'admission' AS admission
  FROM brain_memories
 WHERE deleted_at IS NULL AND trust_tier IS NULL
 ORDER BY id`;

/** Compare-and-swap on every field the tier was computed from; only trust_tier is written (updated_at untouched). */
export const CAS_SQL = `
UPDATE brain_memories b
   SET trust_tier = c.tier
  FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS c(id, tier, source, category, created_by, admission)
 WHERE b.id = c.id
   AND b.trust_tier IS NULL
   AND b.deleted_at IS NULL
   AND b.source IS NOT DISTINCT FROM c.source
   AND b.category = c.category
   AND b.created_by IS NOT DISTINCT FROM c.created_by
   AND (b.metadata->'admission') IS NOT DISTINCT FROM c.admission::jsonb`;

export function tierFor(r: Row): TrustTier {
  const admission = r.admission && typeof r.admission === "object" ? r.admission : null;
  return resolveTrustTier({ source: r.source, createdBy: r.created_by, category: r.category, metadata: admission ? { admission } : null, trustTier: null });
}

const loadRows = (db: Db) => db.query<Row>(READ_SQL);

function byTier(rows: Row[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(tierFor(r), (counts.get(tierFor(r)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `  ${t.padEnd(18)} ${n}`);
}

export const spec: HygieneSpec = {
  name: "backfill-trust-tier",

  plan: () => [
    "",
    "1. SELECT live rows with trust_tier NULL (provenance only: id, source, created_by, category, metadata->'admission'):",
    READ_SQL,
    "2. In TypeScript: tier = resolveTrustTier(row with trustTier NULL); prints counts per tier.",
    "3. --execute only: CREATE TABLE _bak_brain_memories_trust_null_<yyyymmdd> (id, trust_tier); INSERT the ids; count, abort on mismatch;",
    "   refuse if the backup table already exists.",
    `4. --execute only: compare-and-swap, batches of ${BATCH}:`,
    CAS_SQL,
    "5. --execute only: re-count, print the rollback (SET trust_tier = NULL for the backed-up ids). No statement removes a row.",
  ],

  async read(db) {
    const rows = await loadRows(db);
    return { count: rows.length, lines: [`live rows with trust_tier NULL : ${rows.length}`, "tier each would get:", ...byTier(rows)] };
  },

  async execute(db, { expect, today, log }) {
    const rows = await loadRows(db);
    if (rows.length !== expect) {
      log(`ABORT: the candidate set moved since --read (${rows.length} now, --expect=${expect}). Nothing written.`);
      return 1;
    }
    if (rows.length === 0) {
      log("nothing to do.");
      return 0;
    }
    const bak = backupName("brain_memories", "trust_null", today);
    if (await backupExists(db, bak)) {
      log(`ABORT: backup table ${bak} already exists. Inspect it, then drop or rename it by hand. Nothing written.`);
      return 1;
    }
    const ids = rows.map((r) => r.id);
    await db.exec(`CREATE TABLE ${bak} (id text PRIMARY KEY, trust_tier varchar(20))`);
    await db.exec(`INSERT INTO ${bak} SELECT id, trust_tier FROM brain_memories WHERE id = ANY($1::text[])`, ids);
    const backedUp = toCount((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${bak}`))[0]?.n);
    log(`backup ${bak}: ${backedUp} of ${ids.length} rows`);
    if (backedUp !== ids.length) {
      log(`ABORT: backup holds ${backedUp} rows, expected ${ids.length}. Nothing swapped. The backup table is left in place.`);
      return 1;
    }
    const rollback = `UPDATE brain_memories b SET trust_tier = NULL FROM ${bak} k WHERE b.id = k.id AND k.trust_tier IS NULL;`;
    log(`\nROLLBACK (restores NULL for exactly the backed-up ids):\n${rollback}\n`);

    const set = await applyBatches(
      rows,
      BATCH,
      (b) =>
        db.exec(
          CAS_SQL,
          b.map((r) => r.id),
          b.map((r) => tierFor(r)),
          b.map((r) => r.source),
          b.map((r) => r.category),
          b.map((r) => r.created_by),
          b.map((r) => (r.admission == null ? null : JSON.stringify(r.admission))),
        ),
      (done) => log(`backup ${bak}: ${done} of ${ids.length} rows already set; rollback SQL above`),
    );
    log(`set ${set} of ${ids.length} (a row whose provenance or tier changed since --read is left alone)`);
    return set === ids.length ? 0 : 1;
  },
};

if (isEntry(import.meta.url)) {
  runHygiene(spec).then(finish, fail);
}
