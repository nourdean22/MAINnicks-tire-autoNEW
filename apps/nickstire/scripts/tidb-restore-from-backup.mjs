/**
 * Restore (or just verify) a nightly TiDB backup set written by
 * server/services/tidbBackup.ts to the private bucket at backups/tidb/<date>/.
 *
 * SAFETY
 * - DRY RUN by default: checks the arguments and the production refusal, prints
 *   the plan, and exits BEFORE connecting to the bucket or any database.
 * - --target-url is required and REFUSED when its host equals, or contains, the
 *   production host from DATABASE_URL. With no DATABASE_URL the script cannot
 *   prove the target is not production, so it refuses.
 * - It never drops, truncates or updates anything: each table is CREATEd from the
 *   manifest DDL (a table that already exists in the target is refused) and then
 *   filled with batched INSERTs. Row counts are checked after each table.
 * - Every file's sha256 and row count are checked against the manifest BEFORE
 *   anything is written.
 *
 * Run (from apps/nickstire, with the bucket env S3_BUCKET, S3_ENDPOINT, S3_REGION,
 * S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, e.g. via `railway run -s MAINnicks-tire-auto --`):
 *   node scripts/tidb-restore-from-backup.mjs --verify-only --date 2026-10-18
 *   node scripts/tidb-restore-from-backup.mjs --date 2026-10-18 --target-url mysql://...   # dry run
 *   node scripts/tidb-restore-from-backup.mjs --date 2026-10-18 --target-url mysql://... --tables customers,invoices --execute
 *
 * Known limit: TiDB Cloud Starter clusters in one region share a gateway host, so a
 * NEW cluster in the production region is refused too. Restore into another region,
 * a local MySQL 8 / TiDB, or ask for the scoped user-prefix rule (see runbook).
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PREFIX = "backups/tidb/";
const INSERT_BATCH_ROWS = 200;
const INSERT_BATCH_BYTES = 2 * 1024 * 1024;

export function parseArgs(argv) {
  const out = { date: undefined, tables: undefined, targetUrl: undefined, execute: false, verifyOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") out.execute = true;
    else if (a === "--verify-only") out.verifyOnly = true;
    else if (a === "--date") out.date = argv[++i];
    else if (a === "--tables") out.tables = String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--target-url") out.targetUrl = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function hostOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.+$/, "").replace(/^\[|\]$/g, "");
    return host || null;
  } catch {
    return null;
  }
}

/** Returns the refusal reason, or null when the target is provably not the production host. */
export function refuseProductionTarget(targetUrl, prodUrl) {
  if (!targetUrl) return "--target-url is required";
  const target = hostOf(targetUrl);
  if (!target) return "target URL is not a parsable mysql:// URL";
  const prod = prodUrl ? hostOf(prodUrl) : null;
  if (!prod) return "DATABASE_URL is not set or not parsable, so the target cannot be proven not to be production";
  if (target === prod) return `target host ${target} IS the production host`;
  if (target.includes(prod)) return `target host ${target} contains the production host ${prod}`;
  return null;
}

/** File values are text; hex columns go back to bytes. */
export function decodeRow(columns, values) {
  return values.map((v, i) => (v !== null && columns[i]?.encoding === "hex" ? Buffer.from(String(v), "hex") : v));
}

/** Checks one table file against its manifest entry. Returns problems (empty = intact) and the parsed rows. */
export function checkTableFile(entry, gz) {
  if (!gz) return { problems: [`${entry.table}: file ${entry.key} is missing from the bucket`], rows: [] };
  const problems = [];
  const sha = createHash("sha256").update(gz).digest("hex");
  if (sha !== entry.sha256) problems.push(`${entry.table}: sha256 ${sha} does not match the manifest's ${entry.sha256}`);
  if (gz.length !== entry.bytes) problems.push(`${entry.table}: ${gz.length} bytes, manifest says ${entry.bytes}`);
  let rows = [];
  try {
    const text = gunzipSync(gz).toString("utf8");
    rows = text.length ? text.replace(/\n$/, "").split("\n").map((l) => JSON.parse(l)) : [];
  } catch (err) {
    problems.push(`${entry.table}: cannot decode (${err instanceof Error ? err.message : String(err)})`);
    return { problems, rows: [] };
  }
  if (rows.length !== entry.rows) problems.push(`${entry.table}: ${rows.length} rows, manifest says ${entry.rows}`);
  const width = entry.columns.length;
  if (rows.some((r) => !Array.isArray(r) || r.length !== width)) problems.push(`${entry.table}: a row does not have ${width} values`);
  return { problems, rows };
}

/** Verify a whole set. `fetchObject(key)` resolves to a Buffer, or undefined when absent. */
export async function verifySet(manifest, fetchObject, only) {
  const problems = [];
  for (const entry of manifest.tables) {
    if (only && !only.includes(entry.table)) continue;
    problems.push(...checkTableFile(entry, await fetchObject(entry.key)).problems);
  }
  return problems;
}

function loadProdUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const line = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
    return line ? line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

async function bucketReader() {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not set");
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";
  const s3 = endpoint
    ? new S3Client({ region, endpoint, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" } })
    : new S3Client({ region });
  return async (key) => {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (err?.name === "NoSuchKey" || err?.name === "NotFound") return undefined;
      throw err;
    }
  };
}

const q = (name) => `\`${String(name).replace(/`/g, "``")}\``;

async function restoreTable(conn, entry, rows) {
  const [exists] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [entry.table]);
  if (Number(exists[0].n) > 0) throw new Error(`${entry.table} already exists in the target; this script only creates new tables`);
  if (!/^CREATE TABLE /i.test(String(entry.ddl))) throw new Error(`${entry.table}: manifest DDL is not a CREATE TABLE statement`);
  await conn.query(entry.ddl);
  const cols = entry.columns.map((c) => q(c.name)).join(", ");
  const rowHolder = `(${entry.columns.map(() => "?").join(", ")})`;
  let batch = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await conn.query(`INSERT INTO ${q(entry.table)} (${cols}) VALUES ${batch.map(() => rowHolder).join(", ")}`, batch.flat());
    batch = [];
    bytes = 0;
  };
  for (const r of rows) {
    batch.push(decodeRow(entry.columns, r));
    bytes += JSON.stringify(r).length;
    if (batch.length >= INSERT_BATCH_ROWS || bytes >= INSERT_BATCH_BYTES) await flush();
  }
  await flush();
  const [count] = await conn.query(`SELECT COUNT(*) AS n FROM ${q(entry.table)}`);
  if (Number(count[0].n) !== entry.rows) throw new Error(`${entry.table}: target holds ${count[0].n} rows after restore, manifest says ${entry.rows}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("--date YYYY-MM-DD is required");
  const setPrefix = `${PREFIX}${args.date}/`;

  if (args.verifyOnly) {
    const fetchObject = await bucketReader();
    const manifestBuf = await fetchObject(`${setPrefix}manifest.json`);
    if (!manifestBuf) throw new Error(`no manifest at ${setPrefix}manifest.json: the set is missing or incomplete`);
    const manifest = JSON.parse(manifestBuf.toString("utf8"));
    const problems = await verifySet(manifest, fetchObject, args.tables);
    const tables = manifest.tables.filter((t) => !args.tables || args.tables.includes(t.table));
    const rows = tables.reduce((n, t) => n + t.rows, 0);
    if (problems.length) {
      process.stdout.write(`VERIFY FAILED ${args.date}: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write(`VERIFIED ${args.date}: ${tables.length} table file(s), ${rows} rows, sha256 and row counts match the manifest. No database was touched.\n`);
    return;
  }

  const refusal = refuseProductionTarget(args.targetUrl, loadProdUrl());
  if (refusal) {
    process.stderr.write(`REFUSED: ${refusal}\n`);
    process.exit(2);
  }
  const target = new URL(args.targetUrl);
  const where = `${target.hostname}:${target.port || "3306"}${target.pathname}`;

  if (!args.execute) {
    process.stdout.write(
      `DRY RUN: would restore ${args.tables ? args.tables.join(", ") : "every table"} from ${setPrefix} into ${where}\n` +
        "  1. download each table file and check sha256 + row count against the manifest\n" +
        "  2. CREATE each table from the manifest DDL (refused if it already exists), INSERT in batches, check COUNT(*)\n" +
        "Exiting before connecting to the bucket or any database. Re-run with --execute to restore.\n",
    );
    return;
  }

  const fetchObject = await bucketReader();
  const manifestBuf = await fetchObject(`${setPrefix}manifest.json`);
  if (!manifestBuf) throw new Error(`no manifest at ${setPrefix}manifest.json: the set is missing or incomplete`);
  const manifest = JSON.parse(manifestBuf.toString("utf8"));
  const entries = manifest.tables.filter((t) => !args.tables || args.tables.includes(t.table));
  const unknown = (args.tables ?? []).filter((t) => !manifest.tables.some((e) => e.table === t));
  if (unknown.length) throw new Error(`not in the ${args.date} set: ${unknown.join(", ")} (weekly tables may be in an earlier set)`);

  const files = [];
  for (const entry of entries) {
    const { problems, rows } = checkTableFile(entry, await fetchObject(entry.key));
    if (problems.length) throw new Error(`verification failed, nothing written:\n  - ${problems.join("\n  - ")}`);
    files.push({ entry, rows });
  }

  const mysql = (await import("mysql2/promise")).default;
  const conn = await mysql.createConnection({ uri: args.targetUrl, multipleStatements: false });
  try {
    // The backup read every TIMESTAMP in this zone; restoring in the same zone keeps them exact.
    await conn.query("SET time_zone = ?", [/^[+-]\d{2}:\d{2}$/.test(String(manifest.timeZone)) ? manifest.timeZone : "+00:00"]);
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const { entry, rows } of files) {
      await restoreTable(conn, entry, rows);
      process.stdout.write(`restored ${entry.table}: ${entry.rows} rows\n`);
    }
  } finally {
    await conn.end().catch(() => {});
  }
  process.stdout.write(`RESTORED ${files.length} table(s) from ${setPrefix} into ${where}; row counts match the manifest.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
