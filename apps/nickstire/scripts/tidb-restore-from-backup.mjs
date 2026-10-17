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
 * - The host is compared percent-decoded (as mysql2 dials it); IP-literal hosts
 *   are refused because a name compare cannot judge them.
 * - Weekly tables a night skipped live in an earlier set (manifest.skipped[].lastSet).
 *   Restore and --verify-only then end INCOMPLETE (exit 3) and print the exact
 *   command for that set; they never report success while a table is missing.
 *   Exit codes: 0 complete, 1 error, 2 refused, 3 incomplete.
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

/**
 * The host exactly as mysql2 will dial it. For a non-special scheme like mysql:
 * the URL parser keeps percent-escapes in the hostname, and mysql2 decodes them,
 * so "gate%77ay01..." would pass a raw compare and still connect to "gateway01...".
 * Returns { host } or { error }.
 */
function hostOf(url) {
  let raw;
  try {
    raw = new URL(url).hostname;
  } catch {
    return { error: "not a parsable mysql:// URL" };
  }
  let host;
  try {
    host = decodeURIComponent(raw);
  } catch {
    return { error: `host ${raw} has an invalid percent-escape and cannot be decoded` };
  }
  host = host.toLowerCase().replace(/\.+$/, "").replace(/^\[|\]$/g, "");
  return host ? { host } : { error: "no host" };
}

/** IPv4 in any spelling (dotted, integer, hex) or IPv6: a name compare cannot tell where it points. */
const isIpLiteral = (host) => host.includes(":") || /^[0-9.]+$/.test(host) || /^0x[0-9a-f.x]+$/i.test(host);

/** Returns the refusal reason, or null when the target is provably not the production host. */
export function refuseProductionTarget(targetUrl, prodUrl) {
  if (!targetUrl) return "--target-url is required";
  const t = hostOf(targetUrl);
  if (t.error) return `target URL: ${t.error}`;
  const target = t.host;
  if (isIpLiteral(target)) return `target host ${target} is an IP literal; use a host name (localhost, or the cluster's name) so it can be checked against production`;
  const p = prodUrl ? hostOf(prodUrl) : { error: "unset" };
  if (p.error) return "DATABASE_URL is not set or not parsable, so the target cannot be proven not to be production";
  const prod = p.host;
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

/**
 * Which requested tables this set holds, which weekly tables live in an earlier
 * set (manifest.skipped[].lastSet), and which are unknown. No --tables = all of both.
 */
export function planRestore(manifest, tables) {
  const skipped = manifest.skipped ?? [];
  const wanted = tables ?? [...manifest.tables.map((t) => t.table), ...skipped.map((s) => s.table)];
  const entries = manifest.tables.filter((t) => wanted.includes(t.table));
  const missing = skipped.filter((s) => wanted.includes(s.table)).map((s) => ({ table: s.table, lastSet: s.lastSet ?? null }));
  const unknown = wanted.filter((t) => !entries.some((e) => e.table === t) && !missing.some((m) => m.table === t));
  return { entries, missing, unknown };
}

/** The exact command(s) that finish a partial restore or verify, one per weekly set. */
function followUps(missing, mode) {
  const bySet = new Map();
  for (const m of missing) bySet.set(m.lastSet, [...(bySet.get(m.lastSet) ?? []), m.table]);
  return [...bySet.entries()].map(([set, tables]) =>
    set
      ? mode === "verify"
        ? `node scripts/tidb-restore-from-backup.mjs --verify-only --date ${set} --tables ${tables.join(",")}`
        : `node scripts/tidb-restore-from-backup.mjs --date ${set} --tables ${tables.join(",")} --target-url <same target> --execute`
      : `${tables.join(", ")}: the manifest names no earlier set; list backups/tidb/ for the newest set holding it`,
  );
}

function incompleteLines(date, missing, mode) {
  return [
    `INCOMPLETE ${date}: weekly table(s) ${missing.map((m) => m.table).join(", ")} are not in this set (copied weekly; this night skipped them).`,
    "Follow up with:",
    ...followUps(missing, mode).map((c) => `  ${c}`),
  ];
}

/** --verify-only. code 0 = whole set verified, 3 = present files verified but weekly tables live elsewhere, 1 = problems. */
export async function verifyReport(date, manifest, fetchObject, tables) {
  const plan = planRestore(manifest, tables);
  if (plan.unknown.length) return { code: 1, text: `VERIFY FAILED ${date}: not in this set or its skipped list: ${plan.unknown.join(", ")}` };
  const problems = await verifySet(manifest, fetchObject, plan.entries.map((e) => e.table));
  if (problems.length) return { code: 1, text: `VERIFY FAILED ${date}: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}` };
  const rows = plan.entries.reduce((n, t) => n + t.rows, 0);
  const files = `${plan.entries.length} table file(s), ${rows} rows, sha256 and row counts match the manifest. No database was touched.`;
  if (plan.missing.length) return { code: 3, text: [`Files present in ${date} check out: ${files}`, ...incompleteLines(date, plan.missing, "verify")].join("\n") };
  return { code: 0, text: `VERIFIED ${date}: ${files}` };
}

/**
 * Restore what the set holds into `conn`, then say plainly what it does not
 * hold. code 0 = every requested table restored, 3 = INCOMPLETE (weekly tables
 * live in an earlier set; the follow-up command is printed). Throws on any
 * verification or write error; nothing is written before every file verifies.
 */
export async function restoreFromManifest({ date, manifest, tables, fetchObject, conn, where }) {
  const plan = planRestore(manifest, tables);
  if (plan.unknown.length) throw new Error(`not in the ${date} set or its skipped list: ${plan.unknown.join(", ")}`);
  const files = [];
  for (const entry of plan.entries) {
    const { problems, rows } = checkTableFile(entry, await fetchObject(entry.key));
    if (problems.length) throw new Error(`verification failed, nothing written:\n  - ${problems.join("\n  - ")}`);
    files.push({ entry, rows });
  }
  const lines = [];
  if (files.length) {
    // The backup read every TIMESTAMP in this zone; restoring in the same zone keeps them exact.
    await conn.query("SET time_zone = ?", [/^[+-]\d{2}:\d{2}$/.test(String(manifest.timeZone)) ? manifest.timeZone : "+00:00"]);
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const { entry, rows } of files) {
      await restoreTable(conn, entry, rows);
      lines.push(`restored ${entry.table}: ${entry.rows} rows`);
    }
  }
  if (plan.missing.length) {
    lines.push(`Restored ${files.length} table(s) from ${date} into ${where}; the set is not the whole database:`, ...incompleteLines(date, plan.missing, "restore"));
    return { code: 3, text: lines.join("\n") };
  }
  lines.push(`RESTORED ${files.length} table(s) from ${PREFIX}${date}/ into ${where}; row counts match the manifest.`);
  return { code: 0, text: lines.join("\n") };
}

async function readManifest(fetchObject, date) {
  const key = `${PREFIX}${date}/manifest.json`;
  const buf = await fetchObject(key);
  if (!buf) throw new Error(`no manifest at ${key}: the set is missing or incomplete`);
  return JSON.parse(buf.toString("utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("--date YYYY-MM-DD is required");

  if (args.verifyOnly) {
    const fetchObject = await bucketReader();
    const r = await verifyReport(args.date, await readManifest(fetchObject, args.date), fetchObject, args.tables);
    process.stdout.write(`${r.text}\n`);
    process.exit(r.code);
  }

  const refusal = refuseProductionTarget(args.targetUrl, loadProdUrl());
  if (refusal) {
    process.stderr.write(`REFUSED: ${refusal}\n`);
    process.exit(2);
  }
  const target = new URL(args.targetUrl);
  const where = `${decodeURIComponent(target.hostname)}:${target.port || "3306"}${target.pathname}`;

  if (!args.execute) {
    process.stdout.write(
      `DRY RUN: would restore ${args.tables ? args.tables.join(", ") : "every table"} from ${PREFIX}${args.date}/ into ${where}\n` +
        "  1. download each table file and check sha256 + row count against the manifest\n" +
        "  2. CREATE each table from the manifest DDL (refused if it already exists), INSERT in batches, check COUNT(*)\n" +
        "  3. weekly tables that set skipped are reported INCOMPLETE, with the command for the set that holds them\n" +
        "Exiting before connecting to the bucket or any database. Re-run with --execute to restore.\n",
    );
    return;
  }

  const fetchObject = await bucketReader();
  const manifest = await readManifest(fetchObject, args.date);
  const mysql = (await import("mysql2/promise")).default;
  const conn = await mysql.createConnection({ uri: args.targetUrl, multipleStatements: false });
  let r;
  try {
    r = await restoreFromManifest({ date: args.date, manifest, tables: args.tables, fetchObject, conn, where });
  } finally {
    await conn.end().catch(() => {});
  }
  process.stdout.write(`${r.text}\n`);
  process.exit(r.code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
