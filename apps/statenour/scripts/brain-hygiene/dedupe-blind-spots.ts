/**
 * Supersede the twin blind_spot rows (cosine distance < 0.05, same category).
 *
 * Measured on prod 2026-10-23 (docs/research/2026-10-23-brain-usage-map.md, B4): 223 live blind_spot rows,
 * 207 with a twin, 24 clusters, 183 removable. All 207 are 2026-08-16 clock-key copies with 0 verdicts and
 * 0 re-sightings, and the nightly writer keys on a hashed identity, so it does not re-create them.
 *
 * SOFT DELETE ONLY. blind_spot is in NEVER_HARD_DELETE_CATEGORIES (lib/brain/hard-delete-guard.ts), and
 * this script has no DELETE statement. A loser gets deleted_at = now() and superseded_by_id = the keeper.
 * A row with a Discover verdict is never a loser; the oldest judged row of a cluster is its keeper, else
 * the oldest row. Nothing in vector_embeddings is touched, so nothing there needs a backup.
 *
 * Usage (from apps/statenour; the manager runs it, one at a time, on Nour's typed go):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/dedupe-blind-spots.ts              # plan, no connection
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/dedupe-blind-spots.ts --read       # counts and ids, SELECT only
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/dedupe-blind-spots.ts --execute --expect=183
 * Run it outside the 03:00-03:20Z mega-evening window (brain-intelligence 03:02, consolidate and dedup 03:17).
 */
import { backupExists, backupName, isEntry, runHygiene, toCount, type Db, type HygieneSpec } from "./_run";

const LIVE = `deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND superseded_by_id IS NULL`;
const THRESHOLD = 0.05;
const BATCH = 1000;

/** Twin pairs among live blind_spot rows. Ids only. */
const PAIRS_SQL = `
WITH v AS (
  SELECT DISTINCT ON ("sourceId") "sourceId", embedding_vec_1536 AS e
    FROM vector_embeddings
   WHERE "sourceType" = 'brain_memory' AND embedding_vec_1536 IS NOT NULL
   ORDER BY "sourceId"
), bs AS (
  SELECT m.id, v.e FROM brain_memories m JOIN v ON v."sourceId" = m.id
   WHERE m.category = 'blind_spot' AND ${LIVE}
)
SELECT a.id AS a, b.id AS b FROM bs a JOIN bs b ON a.id < b.id AND (a.e <=> b.e) < ${THRESHOLD}`;

/** The versions of the rows the decision read, as text so the swap compares exactly what was read. No content column. */
const ROWS_SQL = `
SELECT id,
       (EXTRACT(EPOCH FROM created_at) * 1000)::float8 AS created_ms,
       discovery_verdict AS verdict,
       updated_at::text AS upd,
       last_seen::text AS seen,
       seen_count
  FROM brain_memories
 WHERE category = 'blind_spot' AND ${LIVE} AND id = ANY($1::text[])`;

/**
 * Compare-and-swap on the exact rows read (claim-before-act). Every field the keeper/loser decision read is
 * pinned: identity, category, liveness, the verdict, and the row versions (updated_at, last_seen, seen_count).
 * The keeper must still be live, so a loser is never pointed at a row that was deleted in the meantime.
 */
export const CAS_SQL = `
UPDATE brain_memories b
   SET deleted_at = now(), superseded_by_id = c.keeper_id, updated_at = now()
  FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[]) AS c(id, keeper_id, upd, seen, seen_count)
 WHERE b.id = c.id
   AND b.category = 'blind_spot'
   AND b.deleted_at IS NULL
   AND b.superseded_by_id IS NULL
   AND b.discovery_verdict IS NULL
   AND b.updated_at::text = c.upd
   AND b.last_seen::text = c.seen
   AND b.seen_count = c.seen_count
   AND EXISTS (SELECT 1 FROM brain_memories k WHERE k.id = c.keeper_id AND k.deleted_at IS NULL AND k.superseded_by_id IS NULL)`;

export interface Row {
  id: string;
  createdMs: number;
  verdict: string | null;
  upd: string;
  seen: string;
  seenCount: number;
}
export interface Loser {
  id: string;
  keeperId: string;
  upd: string;
  seen: string;
  seenCount: number;
}

/** Connected components of the twin graph; per cluster the keeper is the oldest judged row, else the oldest row. */
export function planDedupe(pairs: ReadonlyArray<{ a: string; b: string }>, rows: readonly Row[]): { clusters: number; losers: Loser[] } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(x, p);
    return p;
  };
  for (const { a, b } of pairs) {
    if (!byId.has(a) || !byId.has(b)) continue; // a row that is no longer live is dropped, never guessed
    parent.set(find(a), find(b));
  }
  const groups = new Map<string, Row[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const g = groups.get(root) ?? [];
    g.push(byId.get(id)!);
    groups.set(root, g);
  }
  const losers: Loser[] = [];
  let clusters = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    clusters++;
    members.sort((x, y) => x.createdMs - y.createdMs || (x.id < y.id ? -1 : 1));
    const keeper = members.find((m) => m.verdict !== null) ?? members[0];
    for (const m of members) {
      if (m.id === keeper.id || m.verdict !== null) continue;
      losers.push({ id: m.id, keeperId: keeper.id, upd: m.upd, seen: m.seen, seenCount: m.seenCount });
    }
  }
  losers.sort((x, y) => (x.id < y.id ? -1 : 1));
  return { clusters, losers };
}

async function loadPlan(db: Db): Promise<{ pairs: number; clusters: number; losers: Loser[] }> {
  const pairs = await db.query<{ a: string; b: string }>(PAIRS_SQL);
  const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
  if (ids.length === 0) return { pairs: 0, clusters: 0, losers: [] };
  const raw = await db.query<{ id: string; created_ms: number; verdict: string | null; upd: string; seen: string; seen_count: number }>(ROWS_SQL, ids);
  const rows: Row[] = raw.map((r) => ({ id: r.id, createdMs: Number(r.created_ms), verdict: r.verdict, upd: r.upd, seen: r.seen, seenCount: Number(r.seen_count) }));
  const { clusters, losers } = planDedupe(pairs, rows);
  return { pairs: pairs.length, clusters, losers };
}

export const spec: HygieneSpec = {
  name: "dedupe-blind-spots",

  plan: () => [
    "",
    "1. SELECT twin pairs among live blind_spot rows (vector_embeddings.embedding_vec_1536 <=> < 0.05):",
    PAIRS_SQL,
    "2. SELECT the versions of those rows (no content column):",
    ROWS_SQL,
    "3. Cluster in code. Keeper = oldest judged row, else oldest. A judged row is never a loser. Losers = the rest.",
    "4. --execute only: CREATE TABLE _bak_brain_memories_blindspot_dedup_<yyyymmdd> AS SELECT * FROM brain_memories WHERE id = ANY(<losers>);",
    "   count source vs backup, abort on mismatch; refuse if the backup table already exists.",
    `5. --execute only: compare-and-swap, batches of ${BATCH}:`,
    CAS_SQL,
    "6. --execute only: re-count the swapped rows; print the rollback SQL. No statement removes a row.",
  ],

  async read(db) {
    const p = await loadPlan(db);
    return {
      count: p.losers.length,
      lines: [
        `twin pairs (< ${THRESHOLD}) : ${p.pairs}`,
        `clusters                  : ${p.clusters}`,
        `removable (superseded)    : ${p.losers.length}`,
        `loser ids                 : ${p.losers.map((l) => l.id).join(",") || "(none)"}`,
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
    const bak = backupName("brain_memories", "blindspot_dedup", today);
    if (await backupExists(db, bak)) {
      log(`ABORT: backup table ${bak} already exists. Inspect it, then drop or rename it by hand. Nothing written.`);
      return 1;
    }
    const ids = p.losers.map((l) => l.id);
    await db.exec(`CREATE TABLE ${bak} AS SELECT * FROM brain_memories WHERE id = ANY($1::text[])`, ids);
    const backedUp = toCount((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${bak}`))[0]?.n);
    log(`backup ${bak}: ${backedUp} of ${ids.length} rows`);
    if (backedUp !== ids.length) {
      log(`ABORT: backup holds ${backedUp} rows, expected ${ids.length}. Nothing swapped. The backup table is left in place.`);
      return 1;
    }
    const rollback =
      `UPDATE brain_memories b SET deleted_at = k.deleted_at, superseded_by_id = k.superseded_by_id, updated_at = k.updated_at\n` +
      `  FROM ${bak} k WHERE b.id = k.id;`;
    log(`\nROLLBACK (restores the three columns this script wrote):\n${rollback}\n`);

    let swapped = 0;
    for (let i = 0; i < p.losers.length; i += BATCH) {
      const b = p.losers.slice(i, i + BATCH);
      swapped += await db.exec(
        CAS_SQL,
        b.map((l) => l.id),
        b.map((l) => l.keeperId),
        b.map((l) => l.upd),
        b.map((l) => l.seen),
        b.map((l) => l.seenCount),
      );
    }
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
  runHygiene(spec).then((code) => process.exit(code));
}
