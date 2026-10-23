/**
 * Apply ONE pass of memory decay (confidence - 0.05, floor 0.1) to the population the nightly dry run reports.
 *
 * Measured on prod 2026-10-23 (docs/research/2026-10-23-brain-usage-map.md, B4): 27,260 candidates, 80% of them
 * telemetry and 65% graph edges. The predicate is NOT re-written here: it is buildDecayWhere() from
 * lib/brain/memory-decay.ts (the same one the dry-run count and BrainMemoryManager.decay use), loaded lazily
 * when a connecting mode runs. That already exempts NEVER_HARD_DELETE_CATEGORIES, pinned_user, operator-authored
 * rows (created_by 'user', source 'manual'), rows on probation and soft-deleted rows.
 *
 * ON TOP OF THAT this script exempts EXTRA_EXEMPT: `tool_embedding` (98 rows). lib/brain/embedding-policy.ts
 * records that tool search reads those rows, and decay would reach them.
 *
 * Like BrainMemoryManager.decay(), the write leaves updated_at alone (the GC's low-confidence arm keys on it).
 * It is a single pass: run it twice and rows decay twice, which is why a second run on the same day is refused
 * (the backup table exists) and why --execute needs --expect=N.
 *
 * Usage (from apps/statenour; the manager runs it on Nour's typed go):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/apply-decay.ts              # plan, no connection
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/apply-decay.ts --read       # counts and ids, SELECT only
 *   railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/apply-decay.ts --execute --expect=<count from --read>
 */
import Module from "node:module";
import { backupExists, backupName, fail, finish, isEntry, runHygiene, toCount, type Db, type HygieneSpec } from "./_run";

export const BATCH = 1000;

/** Exempt from this script on top of buildDecayWhere()'s own list. Tool search reads these rows (embedding-policy.ts). */
export const EXTRA_EXEMPT: readonly string[] = ["tool_embedding"];

/** The base predicate from lib/brain/memory-decay.ts: positional $1 cutoff, $2 exempt categories. */
export interface DecayBase {
  where: string;
  params: [Date, string[]];
}

export function candidateSql(baseWhere: string): string {
  return `SELECT id, confidence::text AS conf, last_seen::text AS seen
  FROM brain_memories
 WHERE ${baseWhere}
   AND category <> ALL($3::text[])
 ORDER BY id`;
}

/**
 * Compare-and-swap on the exact rows read: identity, the confidence and last_seen that were read, and the
 * guards that put the row in scope, re-asserted against the live row. $4 is every exempt category (the base
 * list plus EXTRA_EXEMPT), so a row recategorized between read and write is skipped. updated_at is not set.
 */
export const CAS_SQL = `
UPDATE brain_memories b
   SET confidence = GREATEST(b.confidence - 0.05, 0.1)
  FROM unnest($1::text[], $2::text[], $3::text[]) AS c(id, conf, seen)
 WHERE b.id = c.id
   AND b.confidence::text = c.conf
   AND b.last_seen::text = c.seen
   AND b.confidence > 0.1
   AND b.expires_at IS NULL
   AND b.deleted_at IS NULL
   AND b.category <> ALL($4::text[])
   AND COALESCE(b.created_by, '') <> 'user'
   AND COALESCE(b.source, '') <> 'manual'`;

async function loadBase(): Promise<DecayBase> {
  // lib/brain/memory-decay reaches `server-only` through hard-delete-guard -> memory-recall; plain tsx throws on it
  // at load (the same stub scripts/check-policy-coverage.ts installs). Only the connecting modes get here.
  const cjs = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => (request === "server-only" ? {} : original(request, parent, isMain));
  const { buildDecayWhere } = await import("@/lib/brain/memory-decay");
  return (await buildDecayWhere()) as DecayBase;
}

async function loadCandidates(db: Db, base: DecayBase): Promise<Array<{ id: string; conf: string; seen: string }>> {
  return db.query<{ id: string; conf: string; seen: string }>(candidateSql(base.where), ...base.params, [...EXTRA_EXEMPT]);
}

export interface Deps {
  base?: DecayBase;
}

export const spec: HygieneSpec = {
  name: "apply-decay",

  plan: () => [
    "",
    "1. WHERE = buildDecayWhere() from lib/brain/memory-decay.ts, loaded only by --read / --execute:",
    "     last_seen < now() - 30 days AND confidence > 0.1 AND expires_at IS NULL AND deleted_at IS NULL",
    "     AND category <> ALL(NEVER_HARD_DELETE_CATEGORIES + pinned_user)",
    "     AND COALESCE(created_by,'') <> 'user' AND COALESCE(source,'') <> 'manual'",
    `   plus this script's own exemption: category <> ALL(${JSON.stringify(EXTRA_EXEMPT)})`,
    "2. SELECT the candidates (id, confidence, last_seen; no content):",
    candidateSql("<buildDecayWhere>"),
    "3. --execute only: CREATE TABLE _bak_brain_memories_decay_<yyyymmdd> (id, confidence, updated_at); INSERT INTO it SELECT id, confidence, updated_at FROM brain_memories WHERE id = ANY(<ids>);",
    "   count source vs backup, abort on mismatch; refuse if the backup table already exists.",
    `4. --execute only: compare-and-swap, batches of ${BATCH}:`,
    CAS_SQL,
    "5. --execute only: re-count rows whose confidence is now below the backup's; print the rollback SQL. No statement removes a row.",
  ],

  async read(db, deps?: Deps) {
    const base = deps?.base ?? (await loadBase());
    const rows = await loadCandidates(db, base);
    const where = base.where;
    const byCat = await db.query<{ category: string; n: number }>(
      `SELECT category::text AS category, COUNT(*)::int AS n FROM brain_memories WHERE ${where} AND category <> ALL($3::text[]) GROUP BY category ORDER BY n DESC, category LIMIT 8`,
      ...base.params,
      [...EXTRA_EXEMPT],
    );
    const exempted = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM brain_memories WHERE ${where} AND category = ANY($3::text[])`,
      ...base.params,
      [...EXTRA_EXEMPT],
    );
    return {
      count: rows.length,
      lines: [
        `decay candidates          : ${rows.length}`,
        `exempted by this script   : ${toCount(exempted[0]?.n)} (${EXTRA_EXEMPT.join(",")})`,
        `top categories            : ${byCat.map((c) => `${c.category}=${c.n}`).join(", ") || "(none)"}`,
        `candidate ids             : ${rows.length} (omitted; the list is the --execute read)`,
      ],
    };
  },

  async execute(db, { expect, today, log }, deps?: Deps) {
    const base = deps?.base ?? (await loadBase());
    const rows = await loadCandidates(db, base);
    if (rows.length !== expect) {
      log(`ABORT: the candidate set moved since --read (${rows.length} now, --expect=${expect}). Nothing written.`);
      return 1;
    }
    if (rows.length === 0) {
      log("nothing to do.");
      return 0;
    }
    const bak = backupName("brain_memories", "decay", today);
    if (await backupExists(db, bak)) {
      log(`ABORT: backup table ${bak} already exists (a pass already ran today, or a backup is waiting to be confirmed). Nothing written.`);
      return 1;
    }
    const ids = rows.map((r) => r.id);
    await db.exec(`CREATE TABLE ${bak} AS SELECT id, confidence, updated_at FROM brain_memories WITH NO DATA`);
    await db.exec(`INSERT INTO ${bak} SELECT id, confidence, updated_at FROM brain_memories WHERE id = ANY($1::text[])`, ids);
    const backedUp = toCount((await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${bak}`))[0]?.n);
    log(`backup ${bak}: ${backedUp} of ${ids.length} rows`);
    if (backedUp !== ids.length) {
      log(`ABORT: backup holds ${backedUp} rows, expected ${ids.length}. Nothing swapped. The backup table is left in place.`);
      return 1;
    }
    const rollback = `UPDATE brain_memories b SET confidence = k.confidence\n  FROM ${bak} k WHERE b.id = k.id;`;
    log(`\nROLLBACK (restores confidence; updated_at was never touched):\n${rollback}\n`);

    const exempt = [...base.params[1], ...EXTRA_EXEMPT];
    let swapped = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const b = rows.slice(i, i + BATCH);
      swapped += await db.exec(CAS_SQL, b.map((r) => r.id), b.map((r) => r.conf), b.map((r) => r.seen), exempt);
    }
    const lowered = toCount(
      (await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${bak} k JOIN brain_memories b ON b.id = k.id WHERE b.confidence < k.confidence`))[0]?.n,
    );
    log(`decayed ${swapped} of ${ids.length}; re-count shows ${lowered} rows below their backed-up confidence.`);
    if (swapped !== ids.length || lowered !== swapped) {
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
