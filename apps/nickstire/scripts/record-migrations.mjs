#!/usr/bin/env node
/**
 * record-migrations.mjs — record VERIFIED hand-applied migrations in __drizzle_migrations.
 *
 * WHY. handleRunMigrations (Admin -> Run migrations / POST /api/admin/run-migrations)
 * applies DDL but never writes the drizzle ledger, so every migration applied that way
 * reads UNRECORDED_* under reconcile-migrations --strict forever (2026-10-02: 0127-0129
 * applied this way, still "blocking"). baseline-migrations-20260812.mjs records EVERY
 * unrecorded file with no scope; this one records only what you name, and only what the
 * reconciler itself proves is already in the schema.
 *
 * SAFETY
 *  · DRY RUN by default; --execute to write. Without --execute no write path is reached.
 *  · --only <prefix,prefix> is REQUIRED (e.g. --only 0127,0128,0129).
 *  · A migration is recorded only if `reconcile-migrations.mjs --report --json` (read-only,
 *    schema-fingerprinted, same DATABASE_URL) classifies it UNRECORDED_BUT_EXACT_MATCH.
 *    Anything else (ABSENT, PARTIAL, UNKNOWN) is refused by name — apply its DDL first.
 *  · INSERT-only, one row per migration, each guarded by a hash check (re-run = no-op).
 *    Backup of the ledger first (CREATE TABLE … LIKE + INSERT … SELECT; TiDB rejects
 *    CREATE … AS SELECT), row count compared before any insert.
 *  · Same row shape drizzle's migrator writes: sha256 of the LF-normalised file as `hash`,
 *    the journal `when` as `created_at`.
 *
 * Usage (from apps/nickstire, with the production env injected — never a pasted key):
 *   railway run --service MAINnicks-tire-auto -- node scripts/record-migrations.mjs --only 0127,0128,0129
 *   railway run --service MAINnicks-tire-auto -- node scripts/record-migrations.mjs --only 0127,0128,0129 --execute
 * Then: node scripts/reconcile-migrations.mjs --strict  (exit 0 is the receipt).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const DRIZZLE = path.join(APP, "drizzle");
const EXECUTE = process.argv.includes("--execute");
const onlyArg = process.argv[process.argv.indexOf("--only") + 1];
if (!process.argv.includes("--only") || !onlyArg || onlyArg.startsWith("--")) {
  console.error("REFUSED: --only <prefix,prefix> is required (e.g. --only 0127,0128,0129).");
  process.exit(2);
}
const only = onlyArg.split(",").map((s) => s.trim()).filter(Boolean);

// 1 · the reconciler's verdict (read-only by construction; it aborts on any non-SELECT/SHOW).
const rec = spawnSync(process.execPath, [path.join(HERE, "reconcile-migrations.mjs"), "--report", "--json"], {
  cwd: APP,
  encoding: "utf8",
  env: process.env,
  maxBuffer: 64 * 1024 * 1024,
});
if (rec.status !== 0) {
  console.error(`REFUSED: reconcile-migrations exited ${rec.status} — cannot verify the schema.\n${rec.stderr}`);
  process.exit(2);
}
const report = JSON.parse(rec.stdout);
console.log(`target db: ${report.target.database} @ ${report.target.host} [fingerprint ${report.target.hostHash}]`);

const journal = JSON.parse(readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"));
const whenByTag = new Map(journal.entries.map((e) => [e.tag, e.when]));
const files = readdirSync(DRIZZLE).filter((f) => /^\d{4}_.*\.sql$/.test(f));

const toRecord = [];
const refused = [];
for (const prefix of only) {
  const file = files.find((f) => f.startsWith(`${prefix}_`));
  if (!file) { refused.push(`${prefix}: no drizzle/${prefix}_*.sql`); continue; }
  const tag = file.replace(/\.sql$/, "");
  const row = report.migrations.find((m) => m.tag === tag);
  const when = whenByTag.get(tag);
  if (when === undefined) { refused.push(`${tag}: not in _journal.json`); continue; }
  if (!row) { refused.push(`${tag}: reconciler did not report it`); continue; }
  if (row.state.startsWith("RECORDED")) { console.log(`  already recorded  ${tag} (${row.state})`); continue; }
  if (row.state !== "UNRECORDED_BUT_EXACT_MATCH") {
    refused.push(`${tag}: ${row.state} — the schema does not match the file; apply its DDL first`);
    continue;
  }
  const text = readFileSync(path.join(DRIZZLE, file), "utf8").replace(/\r\n/g, "\n");
  toRecord.push({ tag, when, hash: crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex") });
}

for (const r of refused) console.log(`  REFUSED           ${r}`);
for (const t of toRecord) console.log(`  ${EXECUTE ? "recording" : "would record"}      ${t.tag}  ${t.hash.slice(0, 16)}…  when=${t.when}`);
if (!EXECUTE) {
  console.log("\nDRY RUN — nothing written. Re-run with --execute.");
  process.exit(refused.length ? 1 : 0);
}
if (toRecord.length === 0) {
  console.log("\nnothing to record.");
  process.exit(refused.length ? 1 : 0);
}

// 2 · write path — reached only with --execute.
const mysql = (await import("mysql2/promise")).default;
const url = process.env.DATABASE_URL;
if (!url) { console.error("REFUSED: DATABASE_URL not in the environment (use railway run)."); process.exit(2); }
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const q = async (sql, args = []) => (await conn.execute(sql, args))[0];
try {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const BAK = `__drizzle_migrations_bak_${stamp}_record`;
  const [{ n: bakExists }] = await q(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [BAK],
  );
  if (Number(bakExists) === 0) {
    await conn.query(`CREATE TABLE \`${BAK}\` LIKE __drizzle_migrations`);
    await conn.query(`INSERT INTO \`${BAK}\` SELECT * FROM __drizzle_migrations`);
  }
  const [{ n: src }] = await q("SELECT COUNT(*) AS n FROM __drizzle_migrations");
  const [{ n: bak }] = await q(`SELECT COUNT(*) AS n FROM \`${BAK}\``);
  if (Number(bakExists) === 0 && Number(src) !== Number(bak)) {
    throw new Error(`backup ${BAK} has ${bak} rows, ledger has ${src} — aborting before any insert`);
  }
  console.log(`  backup ${BAK}: ${bak} rows`);
  for (const t of toRecord) {
    const [{ n }] = await q("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash = ?", [t.hash]);
    if (Number(n) > 0) { console.log(`  SKIP  ${t.tag} — already recorded`); continue; }
    await q("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [t.hash, t.when]);
    console.log(`  DONE  ${t.tag}`);
  }
  const after = new Set((await q("SELECT hash FROM __drizzle_migrations")).map((r) => r.hash));
  const missing = toRecord.filter((t) => !after.has(t.hash)).map((t) => t.tag);
  console.log(`\nread back: ${missing.length ? `STILL MISSING ${missing.join(", ")}` : "every recorded hash is present"}`);
  console.log("next: node scripts/reconcile-migrations.mjs --strict");
  process.exitCode = missing.length || refused.length ? 1 : 0;
} finally {
  await conn.end();
}
