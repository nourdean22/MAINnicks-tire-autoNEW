/**
 * Independent nightly backup of the nickstire TiDB database to the private
 * Railway bucket (JOB 2026-10-17-tidb-independent-backup).
 *
 * WHY. Production runs on the free TiDB Cloud Starter tier: daily backups kept
 * for ONE day, no point-in-time restore, and a deleted instance cannot be
 * restored at all (docs.pingcap.com/tidbcloud/backup-and-restore-serverless,
 * read 2026-10-17). Until this job, those console backups were the only copy.
 *
 * WHAT. One gzipped JSON Lines file per table (each line is a JSON array of the
 * row's values in manifest column order, every value as text, binary columns
 * hex) plus a manifest.json (table, class, rows, bytes, sha256, DDL from SHOW
 * CREATE TABLE, columns, key, started/finished, job version) under
 * backups/tidb/<ET date>/. Restore: scripts/tidb-restore-from-backup.mjs.
 *
 * SUCCESS IS COMPLETION. The run throws (cron_log `failed`, named table) unless
 * every table was read, every file is in the bucket listing at its recorded
 * size, and the manifest is listed too. The manifest is written LAST, so a set
 * without one is incomplete by construction and never counts as a backup.
 *
 * Off by default: the tier gates it on TIDB_BACKUP_ENABLED === "true".
 */
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { createLogger } from "../lib/logger";

const log = createLogger("tidb-backup");

export const BACKUP_PREFIX = "backups/tidb/";
const JOB_VERSION = 1;
const RETENTION = { daily: 14, weekly: 8 } as const;
const DEFAULT_BATCH_SIZE = 1000;
const WEEKLY_INTERVAL_DAYS = 7;
const SHOP_TIMEZONE = "America/New_York";
const SET_KEY = /^backups\/tidb\/(\d{4}-\d{2}-\d{2})\/([^/]+)$/;

/**
 * Large tables that are DERIVED and can be regenerated, so they are copied once
 * a week instead of nightly (a week's gap is refillable from their sources).
 * Every other table is copied every night. Default to nightly when unsure.
 */
const WEEKLY_TABLES: Readonly<Record<string, string>> = {
  search_performance:
    "GSC mirror (94 MB): gsc-pipeline upserts it from the Search Console API, which keeps 16 months, so any gap since the last weekly copy can be re-fetched",
  revenue_reconciliation_candidates:
    "derived (70 MB): revenue-reconciliation re-runs every 2h over a rolling window from vapi_call_logs, invoices, leads, bookings and expected_arrivals (all nightly); owner rulings live in revenue_attribution_decisions (nightly)",
};

export interface ColumnSpec {
  name: string;
  /** information_schema DATA_TYPE, lower case. */
  sqlType: string;
  /** "hex": binary column, read as HEX() and restored with UNHEX semantics. */
  encoding: "text" | "hex";
}
export interface TableSpec {
  ddl: string;
  /** Insertable columns in file order (generated columns are excluded). */
  columns: ColumnSpec[];
  /** Primary-key columns; empty when the table has none. */
  keyColumns: string[];
  /** No primary key: page on TiDB's hidden _tidb_rowid, read as a trailing value and never written. */
  hiddenRowId: boolean;
}
export interface BackupSource {
  database: string;
  listTables(): Promise<string[]>;
  describeTable(table: string): Promise<TableSpec>;
  /** Rows as arrays in `spec.columns` order, plus a trailing _tidb_rowid when `spec.hiddenRowId`. */
  readBatch(table: string, spec: TableSpec, after: unknown[] | null, limit: number): Promise<unknown[][]>;
}
export interface StoredObject { key: string; size: number }
export interface BackupStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
  remove(key: string): Promise<void>;
}

interface ManifestTable extends TableSpec {
  table: string;
  class: "nightly" | "weekly";
  key: string;
  rows: number;
  bytes: number;
  sha256: string;
}

function etDateKey(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: SHOP_TIMEZONE });
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

const quoteId = (name: string) => `\`${name.replace(/`/g, "``")}\``;

/** One keyset page: named columns, strictly after the last key, ordered by key, LIMITed. */
export function buildBatchQuery(table: string, spec: TableSpec, after: unknown[] | null, limit: number): { sql: string; values: unknown[] } {
  const select = spec.columns.map((c) =>
    c.encoding === "hex"
      ? `HEX(${quoteId(c.name)}) AS ${quoteId(c.name)}`
      : c.sqlType === "json"
        ? `CAST(${quoteId(c.name)} AS CHAR) AS ${quoteId(c.name)}`
        : quoteId(c.name),
  );
  if (spec.hiddenRowId) select.push("_tidb_rowid");
  const keyExpr = spec.hiddenRowId ? ["_tidb_rowid"] : spec.keyColumns.map(quoteId);
  const holders = spec.hiddenRowId
    ? ["?"]
    : spec.keyColumns.map((k) => (spec.columns.find((c) => c.name === k)?.encoding === "hex" ? "UNHEX(?)" : "?"));
  let where = "";
  if (after) {
    where = keyExpr.length === 1 ? ` WHERE ${keyExpr[0]} > ${holders[0]}` : ` WHERE (${keyExpr.join(", ")}) > (${holders.join(", ")})`;
  }
  return {
    sql: `SELECT ${select.join(", ")} FROM ${quoteId(table)}${where} ORDER BY ${keyExpr.join(", ")} LIMIT ${Math.max(1, Math.floor(limit))}`,
    values: after ? [...after] : [],
  };
}

/** mysql2 typeCast: every value as its text form (exact, no driver timezone shift); JSON decoded as utf8. */
export function backupTypeCast(field: { type: string; string: (encoding?: string) => string | null }, _next: () => unknown): unknown {
  return field.type === "JSON" ? field.string("utf8") : field.string();
}

type QueryConn = { query: (opts: unknown, values?: unknown[]) => Promise<[unknown, unknown]> };
const BINARY_TYPES = new Set(["binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob", "bit", "geometry", "point", "linestring", "polygon", "multipoint", "multilinestring", "multipolygon", "geometrycollection"]);

/** The production source: one dedicated mysql2 connection created with `backupTypeCast`. */
function createMysqlBackupSource(conn: QueryConn, database: string): BackupSource {
  const rows = async (sql: string, values: unknown[] = []) => (await conn.query({ sql, values }))[0] as Array<Record<string, string | null>>;
  return {
    database,
    async listTables() {
      const r = await rows(
        "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
      );
      return r.map((x) => String(x.t));
    },
    async describeTable(table) {
      const created = await rows(`SHOW CREATE TABLE ${quoteId(table)}`);
      const ddl = String(created[0]?.["Create Table"] ?? "");
      if (!ddl) throw new Error(`SHOW CREATE TABLE returned no DDL for ${table}`);
      const cols = await rows(
        "SELECT COLUMN_NAME AS name, LOWER(DATA_TYPE) AS sqlType, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        [table],
      );
      const columns: ColumnSpec[] = cols
        .filter((c) => !/GENERATED/i.test(String(c.extra ?? "")))
        .map((c) => ({ name: String(c.name), sqlType: String(c.sqlType), encoding: BINARY_TYPES.has(String(c.sqlType)) ? "hex" : "text" }));
      const pk = await rows(
        "SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX",
        [table],
      );
      const keyColumns = pk.map((k) => String(k.name));
      const missing = keyColumns.filter((k) => !columns.some((c) => c.name === k));
      if (missing.length) throw new Error(`${table}: primary-key column(s) ${missing.join(", ")} are generated; not supported`);
      return { ddl, columns, keyColumns, hiddenRowId: keyColumns.length === 0 };
    },
    async readBatch(table, spec, after, limit) {
      const q = buildBatchQuery(table, spec, after, limit);
      return (await conn.query({ sql: q.sql, values: q.values, rowsAsArray: true }))[0] as unknown[][];
    },
  };
}

type S3Like = { send: (command: never) => Promise<unknown> };

function assertDeletableKey(key: string): void {
  if (!SET_KEY.test(key) || key.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new Error(`tidb-backup: refusing to delete ${key}: only objects inside ${BACKUP_PREFIX}<YYYY-MM-DD>/ may be deleted`);
  }
}

/** Bucket adapter. Objects are private (no ACL is ever sent, no URL is ever built). */
export function createS3BackupStore(s3: S3Like, bucket: string): BackupStore {
  const send = (cmd: unknown) => s3.send(cmd as never);
  return {
    async put(key, body, contentType) {
      await send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async list(prefix) {
      const out: StoredObject[] = [];
      let token: string | undefined;
      do {
        const page = (await send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ...(token ? { ContinuationToken: token } : {}) }))) as {
          Contents?: Array<{ Key?: string; Size?: number }>;
          IsTruncated?: boolean;
          NextContinuationToken?: string;
        };
        for (const o of page.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: Number(o.Size ?? -1) });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async remove(key) {
      assertDeletableKey(key);
      await send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

interface SetInfo { complete: boolean; files: Set<string>; keys: string[] }

function indexSets(listing: StoredObject[]): Map<string, SetInfo> {
  const sets = new Map<string, SetInfo>();
  for (const o of listing) {
    const m = SET_KEY.exec(o.key);
    if (!m) continue; // anything not shaped like a set file is never touched
    const s = sets.get(m[1]) ?? { complete: false, files: new Set<string>(), keys: [] };
    s.keys.push(o.key);
    s.files.add(m[2]);
    if (m[2] === "manifest.json") s.complete = true;
    sets.set(m[1], s);
  }
  return sets;
}

const isWeeklySet = (s: SetInfo) => Object.keys(WEEKLY_TABLES).some((t) => s.files.has(`${t}.jsonl.gz`));

/**
 * Keys to delete: everything in a date set that is not one of the 14 newest
 * complete sets, the 8 newest complete weekly sets, today's set, or an
 * incomplete set newer than the newest complete one. Keys outside
 * backups/tidb/<YYYY-MM-DD>/ are never returned.
 */
export function planRetention(listing: StoredObject[], today: string): string[] {
  const sets = indexSets(listing);
  const complete = [...sets.keys()].filter((d) => sets.get(d)!.complete).sort().reverse();
  const keep = new Set<string>([today, ...complete.slice(0, RETENTION.daily)]);
  for (const d of complete.filter((x) => isWeeklySet(sets.get(x)!)).slice(0, RETENTION.weekly)) keep.add(d);
  const newestComplete = complete[0] ?? "";
  for (const [d, s] of sets) if (!s.complete && d > newestComplete) keep.add(d);
  return [...sets.entries()].filter(([d]) => !keep.has(d)).flatMap(([, s]) => s.keys).sort();
}

async function dumpTable(source: BackupSource, table: string, spec: TableSpec, batchSize: number): Promise<{ body: Buffer; rows: number }> {
  const gzip = createGzip();
  const chunks: Buffer[] = [];
  gzip.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => { gzip.on("end", resolve); gzip.on("error", reject); });
  const keyIdx = spec.hiddenRowId ? [spec.columns.length] : spec.keyColumns.map((k) => spec.columns.findIndex((c) => c.name === k));
  let after: unknown[] | null = null;
  let rows = 0;
  try {
    for (;;) {
      const batch = await source.readBatch(table, spec, after, batchSize);
      if (batch.length === 0) break;
      gzip.write(batch.map((r) => JSON.stringify(r.slice(0, spec.columns.length))).join("\n") + "\n");
      rows += batch.length;
      if (batch.length < batchSize) break;
      after = keyIdx.map((i) => batch[batch.length - 1][i]);
    }
  } catch (err) {
    gzip.destroy();
    throw err;
  }
  gzip.end();
  await finished;
  return { body: Buffer.concat(chunks), rows };
}

export interface BackupRunResult { recordsProcessed: number; details: string }

export async function runTidbBackup(deps: {
  source: BackupSource;
  store: BackupStore;
  now?: () => Date;
  batchSize?: number;
}): Promise<BackupRunResult> {
  const now = deps.now ?? (() => new Date());
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const startedAt = now();
  const date = etDateKey(startedAt);
  const setPrefix = `${BACKUP_PREFIX}${date}/`;
  const manifestKey = `${setPrefix}manifest.json`;

  const before = await deps.store.list(BACKUP_PREFIX);
  if (before.some((o) => o.key === manifestKey)) {
    return { recordsProcessed: 0, details: `${date}: backup set already complete (manifest present); nothing to do` };
  }
  const sets = indexSets(before);

  const tables = await deps.source.listTables();
  const done: ManifestTable[] = [];
  const skipped: Array<{ table: string; class: "weekly"; reason: string }> = [];
  const failures: string[] = [];

  for (const table of tables) {
    const cls = Object.prototype.hasOwnProperty.call(WEEKLY_TABLES, table) ? "weekly" : "nightly";
    if (cls === "weekly") {
      const last = [...sets.entries()]
        .filter(([d, s]) => s.complete && d < date && s.files.has(`${table}.jsonl.gz`))
        .map(([d]) => d)
        .sort()
        .pop();
      if (last && daysBetween(last, date) < WEEKLY_INTERVAL_DAYS) {
        skipped.push({ table, class: "weekly", reason: `weekly table, last copied in set ${last} (${daysBetween(last, date)} days ago): ${WEEKLY_TABLES[table]}` });
        continue;
      }
    }
    try {
      const spec = await deps.source.describeTable(table);
      const { body, rows } = await dumpTable(deps.source, table, spec, batchSize);
      const key = `${setPrefix}${table}.jsonl.gz`;
      await deps.store.put(key, body, "application/gzip");
      done.push({ table, class: cls, key, rows, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), ...spec });
    } catch (err) {
      failures.push(`${table}: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`);
    }
  }

  if (failures.length) {
    throw new Error(`tidb-backup ${date}: FAILED ${failures.length}/${tables.length} table(s), no manifest written: ${failures.join("; ")}`.slice(0, 1900));
  }

  // Completion check: every file must be in the bucket listing at its recorded size.
  const listed = new Map((await deps.store.list(setPrefix)).map((o) => [o.key, o.size]));
  const unconfirmed = done.filter((t) => listed.get(t.key) !== t.bytes).map((t) => `${t.table} (expected ${t.bytes} bytes, listed ${listed.get(t.key) ?? "missing"})`);
  if (unconfirmed.length) {
    throw new Error(`tidb-backup ${date}: FAILED, the bucket listing does not confirm ${unconfirmed.join(", ")}; no manifest written`.slice(0, 1900));
  }

  const manifest = {
    format: "nickstire-tidb-backup",
    jobVersion: JOB_VERSION,
    database: deps.source.database,
    date,
    timeZone: "+00:00",
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    tables: done,
    skipped,
  };
  const manifestBody = Buffer.from(JSON.stringify(manifest, null, 1), "utf8");
  await deps.store.put(manifestKey, manifestBody, "application/json");
  const after = await deps.store.list(BACKUP_PREFIX);
  if (after.find((o) => o.key === manifestKey)?.size !== manifestBody.length) {
    throw new Error(`tidb-backup ${date}: FAILED, manifest.json is not confirmed by the bucket listing`);
  }

  const rows = done.reduce((n, t) => n + t.rows, 0);
  const gzBytes = done.reduce((n, t) => n + t.bytes, 0);
  const summary = `${date}: ${done.length} tables, ${rows} rows, ${(gzBytes / 1048576).toFixed(1)} MB gz, verified in bucket` +
    (skipped.length ? `; weekly not due: ${skipped.map((s) => s.table).join(", ")}` : "");

  const expired = planRetention(after, date);
  try {
    for (const key of expired) await deps.store.remove(key);
  } catch (err) {
    throw new Error(`tidb-backup ${summary}; retention FAILED after the set was verified: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1900));
  }
  log.info("tidb backup complete", { date, tables: done.length, rows, gzBytes, skipped: skipped.length, deleted: expired.length });
  return { recordsProcessed: rows, details: `${summary}; retention deleted ${expired.length} object(s)` };
}

/** The cron entry: a dedicated connection (UTC session, text values) and the private bucket. */
export async function runTidbBackupJob(): Promise<BackupRunResult> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("tidb-backup: DATABASE_URL is not set");
  const { getPrivateBucket } = await import("../storage");
  const { s3, bucket } = await getPrivateBucket();
  const mysql = (await import("mysql2/promise")).default;
  const conn = await mysql.createConnection({ uri: url, typeCast: backupTypeCast as never, connectTimeout: 20_000 });
  try {
    await conn.query("SET time_zone = '+00:00'");
    const [dbRows] = (await conn.query("SELECT DATABASE() AS db")) as unknown as [Array<{ db: string | null }>];
    const database = String(dbRows[0]?.db ?? "");
    return await runTidbBackup({ source: createMysqlBackupSource(conn as unknown as QueryConn, database), store: createS3BackupStore(s3, bucket) });
  } finally {
    await conn.end().catch(() => { /* connection already gone; the run's own result stands */ });
  }
}
