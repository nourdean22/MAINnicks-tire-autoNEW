/**
 * baseline-migrations-20260812.mjs — record hand-applied migrations in
 * `__drizzle_migrations` so the ledger matches the schema.
 *
 * WHY: 13 migrations (0092-0098, 0106-0111) are applied to production but the
 * migration engine has no record of them, so `pnpm run migrations:check` fails
 * on drift that is not real. This is the SAME operation performed on
 * 2026-07-18 for 0082-0090 (see the header of reconcile-migrations.mjs);
 * backup table from that run is `__drizzle_migrations_bak_20260718`.
 *
 * SAFETY
 *  · DRY RUN by default. --apply to execute.
 *  · INSERT-ONLY. There is no UPDATE and no DELETE in this file. Nothing in
 *    `__drizzle_migrations` is modified; nothing in any app table is touched.
 *  · Backs up the whole ledger table to `__drizzle_migrations_bak_20260812`
 *    (skipped if it already exists) AND writes a JSON dump before inserting.
 *  · Every insert is guarded by a hash check, so re-running is a no-op.
 *  · Verifies by reading the ledger back and re-deriving the unrecorded set.
 *
 * PRECONDITION, verified by hand before this was written: every one of the 13
 * reads UNRECORDED_BUT_EXACT_MATCH under `reconcile-migrations.mjs --report`,
 * except 0092 which reads UNRECORDED_AND_PARTIAL_MATCH for a benign, understood
 * reason — production's `sms_response_jobs.status` enum is a SUPERSET of what
 * 0092 declared, because migration 0097 later ADDED `human_pending` /
 * `human_replied`. That is the reconciler's own documented "a later migration
 * legitimately changed the same object" case (its 0003 leads.source example),
 * and after recording it will read RECORDED_BUT_SCHEMA_MISMATCH, which is
 * advisory by design.
 *
 * Usage (from apps/nickstire):
 *   node scripts/baseline-migrations-20260812.mjs            # dry run
 *   node scripts/baseline-migrations-20260812.mjs --apply    # execute
 */
import mysql from "mysql2/promise";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE = path.resolve(HERE, "..", "drizzle");
const BAK = "__drizzle_migrations_bak_20260812";

const url = readFileSync(path.resolve(HERE, "..", ".env"), "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
if (!url) { console.error("no DATABASE_URL"); process.exit(2); }

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const q = async (sql, args = []) => (await conn.execute(sql, args))[0];

/** tag -> journal `when` (epoch ms); drizzle's own migrator records this as created_at. */
const journal = JSON.parse(readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));
const whenByTag = new Map(journal.entries.map((e) => [e.tag, e.when]));

const files = readdirSync(DRIZZLE).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const recorded = new Set((await q("SELECT hash FROM __drizzle_migrations")).map((r) => r.hash));

const pending = [];
for (const f of files) {
  const tag = f.replace(/\.sql$/, "");
  const buf = readFileSync(path.join(DRIZZLE, f));
  const raw = crypto.createHash("sha256").update(buf).digest("hex");
  const lf = crypto.createHash("sha256").update(Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8")).digest("hex");
  if (recorded.has(raw) || recorded.has(lf)) continue;
  const when = whenByTag.get(tag);
  if (when === undefined) { console.error(`REFUSED: ${tag} is not in _journal.json — a file drizzle would not apply must not be recorded as applied.`); process.exit(2); }
  pending.push({ tag, hash: lf, when });
}

console.log(`\nmigration-ledger baseline · ${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`  ledger rows now: ${recorded.size}`);
console.log(`  unrecorded migrations: ${pending.length}`);
for (const p of pending) console.log(`    ${p.tag}  ${p.hash.slice(0, 16)}…`);

if (pending.length === 0) { console.log("\nnothing to do.\n"); await conn.end(); process.exit(0); }

if (!APPLY) {
  console.log(`\n  WOULD back up __drizzle_migrations -> ${BAK} (+ JSON dump)`);
  console.log(`  WOULD insert ${pending.length} row(s). No UPDATE, no DELETE.`);
  console.log("\nDRY RUN — re-run with --apply to execute.\n");
  await conn.end();
  process.exit(0);
}

// 1 · backup (idempotent)
const [{ n: bakExists }] = await q(
  "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
  [BAK],
);
if (bakExists > 0) {
  console.log(`\n  SKIP backup — ${BAK} already exists`);
} else {
  // TiDB rejects `CREATE TABLE ... AS SELECT` ("not implemented yet", err 1105)
  // — witnessed on this very run. The two-step LIKE + INSERT…SELECT form is
  // supported and copies both the structure and the rows.
  await conn.query(`CREATE TABLE \`${BAK}\` LIKE __drizzle_migrations`);
  await conn.query(`INSERT INTO \`${BAK}\` SELECT * FROM __drizzle_migrations`);
  const [{ n: copied }] = await q(`SELECT COUNT(*) AS n FROM \`${BAK}\``);
  console.log(`\n  DONE backup -> ${BAK} (${copied} rows copied)`);
}
const dump = await q("SELECT * FROM __drizzle_migrations ORDER BY created_at ASC");
const dumpPath = path.join(HERE, "..", "reports", `drizzle-migrations-dump-20260812.json`);
writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
console.log(`  DONE JSON dump -> ${path.relative(process.cwd(), dumpPath)} (${dump.length} rows)`);

// 2 · insert (guarded per row)
let inserted = 0;
for (const p of pending) {
  const [{ n }] = await q("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [p.hash]);
  if (n > 0) { console.log(`  SKIP  ${p.tag} — already recorded`); continue; }
  await q("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [p.hash, p.when]);
  inserted++;
  console.log(`  DONE  ${p.tag}`);
}

// 3 · verify by reading back
console.log("\n─── verification (read back, do not trust the writes) ───");
const after = new Set((await q("SELECT hash FROM __drizzle_migrations")).map((r) => r.hash));
const stillMissing = pending.filter((p) => !after.has(p.hash)).map((p) => p.tag);
console.log(`  ledger rows now: ${after.size} (was ${recorded.size}, inserted ${inserted})`);
console.log(`  still unrecorded: ${stillMissing.length === 0 ? "none" : stillMissing.join(", ")}`);
console.log(`  backup table ${BAK}: PRESENT\n`);

await conn.end();
