/**
 * Pure logic for the shop-clock backfill: digit parsing, row classification, plan files and the
 * read-only SQL guard. No I/O. The CLI is backfill-shop-clock.ts; runbook is
 * docs/runbooks/shop-clock-backfill.md.
 *
 * Before 2026-10-14 app writers stored `new Date()` (UTC digits) in shop-day columns. The shop-day
 * convention is the Cleveland wall-clock digits (shopWallClock). A row is corrected only when its
 * digits match its own createdAt AND its source is app-written: the ShopDriver feed rewrites its rows.
 */
import { createHash } from "node:crypto";
import { shopWallClock } from "../../server/lib/timezoneAssert";

export class BackfillError extends Error {}
export class UsageError extends BackfillError {}

export const TOOL_NAME = "shop-clock-backfill";
export const TOOL_VERSION = "1";

export interface TableSpec {
  table: string;
  dateCol: string;
  createdCol: string;
  updatedCol: string;
  sourceCol: string;
  /** Column whose SNAP- prefix marks Snap finance rows. */
  snapCol?: string;
  /** Sources a feed owns and rewrites; never correctable. */
  feedSources: readonly string[];
}

export const TABLES: readonly TableSpec[] = [
  {
    table: "invoices",
    dateCol: "invoiceDate",
    createdCol: "createdAt",
    updatedCol: "updatedAt",
    sourceCol: "source",
    snapCol: "invoiceNumber",
    feedSources: ["shopdriver"],
  },
  {
    table: "alg_estimates",
    dateCol: "estimate_date",
    createdCol: "created_at",
    updatedCol: "updated_at",
    sourceCol: "source",
    feedSources: ["alg", "alg-historical", "wave-97-recovery"],
  },
];

export function tableSpec(table: unknown): TableSpec {
  const spec = TABLES.find((t) => t.table === table);
  if (!spec) throw new BackfillError(`unknown table ${JSON.stringify(table)}`);
  return spec;
}

export const CLASSES = [
  "already_correct",
  "needs_correction",
  "snap_double_converted",
  "post_cutoff_utc_match",
  "feed_owned_utc",
  "other",
] as const;
export type RowClass = (typeof CLASSES)[number];

/** Only these reach the plan file. */
export const PLANNED_CLASSES: readonly RowClass[] = ["needs_correction", "snap_double_converted"];

/** A UTC-digit signature on a row the tool does not own becomes feed_owned_utc. */
const OWNER_GATED: readonly RowClass[] = ["needs_correction", "snap_double_converted", "post_cutoff_utc_match"];

const HOUR_MS = 3_600_000;

// ── digits ──────────────────────────────────────────────────────────────

const DIGITS = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export const msToDigits = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

const describe = (v: unknown): string => (v instanceof Date ? "a Date object" : JSON.stringify(v));

/** 'YYYY-MM-DD HH:MM:SS' read as UTC epoch ms; anything else throws instead of being guessed at. */
export function digitsToMs(value: unknown): number {
  const m = typeof value === "string" ? DIGITS.exec(value) : null;
  if (!m) throw new BackfillError(`expected 'YYYY-MM-DD HH:MM:SS' digits, got ${describe(value)} (is dateStrings on?)`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (msToDigits(ms) !== value) throw new BackfillError(`not a real timestamp: ${value}`);
  return ms;
}

const wallMs = (ms: number): number => shopWallClock(new Date(ms)).getTime();

/**
 * Digits for an ALG date string (zone-less shop-clock text). Read as UTC so the digits survive on any
 * machine; null when unreadable. Used by backfill-historical-estimates.ts.
 */
export function algDateDigits(raw: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : /(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : msToDigits(d.getTime());
}

// ── arguments ───────────────────────────────────────────────────────────

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** A real calendar instant with a zone: no hour 24, no second 60, no offset past 23:59, no day the month lacks. */
export function parseInstant(name: string, value: unknown): number {
  const bad = () => new UsageError(`--${name} must be an ISO instant with a zone, like 2026-10-15T03:05:00Z (got ${describe(value)})`);
  const m = typeof value === "string" ? ISO_INSTANT.exec(value) : null;
  if (!m) throw bad();
  const part = (i: number): number => (m[i] === undefined ? 0 : Number(m[i]));
  const [y, mo, d] = [part(1), part(2), part(3)];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) throw bad();
  if (part(4) > 23 || part(5) > 59 || part(6) > 59 || part(7) > 23 || part(8) > 59) throw bad();
  const ms = Date.parse(value as string);
  if (Number.isNaN(ms)) throw bad();
  return ms;
}

export interface PlanArgs {
  cutoff: string;
  snapBugStart: string;
  snapFixCutoff: string;
  tolMinutes: number;
  sources: string[];
  estimateSources: string[];
}

export interface ClassifyConfig {
  cutoffMs: number;
  snapBugStartMs: number;
  snapFixCutoffMs: number;
  tolMs: number;
  /** Per table: sources the tool may correct. */
  ownedSources: Readonly<Record<string, ReadonlySet<string>>>;
}

export interface RawClassifyArgs {
  cutoff?: string;
  snapBugStart?: string;
  snapFixCutoff?: string;
  tolMinutes?: string;
  sources?: string;
  estimateSources?: string;
}

function parseSources(flag: string, value: string | undefined, fallback: string, spec: TableSpec): string[] {
  const list = (value ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of list) {
    if (!/^[a-z0-9_-]+$/i.test(s)) throw new UsageError(`--${flag}: bad source name ${JSON.stringify(s)}`);
    if (spec.feedSources.includes(s.toLowerCase())) throw new UsageError(`--${flag}: "${s}" rows belong to a feed that rewrites them; they are never corrected`);
  }
  return Array.from(new Set(list)).sort();
}

/** Every classification argument is required: nothing here has a guessed default except the source lists. */
export function parseClassifyConfig(raw: RawClassifyArgs): { cfg: ClassifyConfig; args: PlanArgs } {
  const need = (flag: string, v: string | undefined): string => {
    if (v === undefined) throw new UsageError(`--${flag} is required`);
    return v;
  };
  const cutoffMs = parseInstant("cutoff", need("cutoff", raw.cutoff));
  const snapBugStartMs = parseInstant("snap-bug-start", need("snap-bug-start", raw.snapBugStart));
  const snapFixCutoffMs = parseInstant("snap-fix-cutoff", need("snap-fix-cutoff", raw.snapFixCutoff));
  const tolText = need("tol-minutes", raw.tolMinutes);
  const tolMinutes = /^\d+$/.test(tolText) ? Number(tolText) : NaN;
  // Under 2h keeps the 4-5h offset between the UTC and wall-clock readings from overlapping.
  if (!(tolMinutes >= 1 && tolMinutes <= 60)) throw new UsageError(`--tol-minutes must be a whole number from 1 to 60 (got ${JSON.stringify(tolText)})`);
  if (snapBugStartMs >= snapFixCutoffMs) throw new UsageError("--snap-bug-start must be before --snap-fix-cutoff");
  const sources = parseSources("sources", raw.sources, "manual,stripe", tableSpec("invoices"));
  const estimateSources = parseSources("estimate-sources", raw.estimateSources, "", tableSpec("alg_estimates"));
  return {
    cfg: {
      cutoffMs,
      snapBugStartMs,
      snapFixCutoffMs,
      tolMs: tolMinutes * 60_000,
      ownedSources: { invoices: new Set(sources), alg_estimates: new Set(estimateSources) },
    },
    args: {
      cutoff: new Date(cutoffMs).toISOString(),
      snapBugStart: new Date(snapBugStartMs).toISOString(),
      snapFixCutoff: new Date(snapFixCutoffMs).toISOString(),
      tolMinutes,
      sources,
      estimateSources,
    },
  };
}

// ── classification ──────────────────────────────────────────────────────

export interface ScanRow {
  id: number;
  stored: string;
  created: string;
  source: string;
  isSnap: boolean;
}

export interface Classified {
  class: RowClass;
  /** Target digits; set only for planned classes. */
  to?: string;
}

export function classifyRow(table: string, row: ScanRow, cfg: ClassifyConfig): Classified {
  const stored = digitsToMs(row.stored);
  const created = digitsToMs(row.created);
  const wall = wallMs(created);
  const near = (target: number) => Math.abs(stored - target) <= cfg.tolMs;

  const hits: RowClass[] = [];
  if (near(wall)) hits.push("already_correct");
  if (created < cfg.cutoffMs && near(created)) hits.push("needs_correction");
  // The buggy path converted twice, so the same function is applied twice here.
  if (row.isSnap && created >= cfg.snapBugStartMs && created < cfg.snapFixCutoffMs && near(wallMs(wall))) hits.push("snap_double_converted");
  if (created >= cfg.cutoffMs && near(created) && !near(wall)) hits.push("post_cutoff_utc_match");
  if (hits.length > 1) throw new BackfillError(`${table} id ${row.id} matches ${hits.join(" and ")}; classes must not overlap`);

  const cls = hits[0] ?? "other";
  if (OWNER_GATED.includes(cls) && !cfg.ownedSources[table]?.has(row.source)) return { class: "feed_owned_utc" };
  return PLANNED_CLASSES.includes(cls) ? { class: cls, to: msToDigits(wall) } : { class: cls };
}

export type ClassifiedRow = ScanRow & Classified;

// ── probe summary ───────────────────────────────────────────────────────

export const BUCKETS = ["utc_match", "minus_4h", "minus_5h", "minus_8h", "minus_10h", "other"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Where stored - createdAt falls, in whole-hour offsets, within the tolerance. */
export function diffBucket(storedDigits: string, createdDigits: string, tolMs: number): Bucket {
  const d = digitsToMs(storedDigits) - digitsToMs(createdDigits);
  const offsets: Array<[Bucket, number]> = [["utc_match", 0], ["minus_4h", 4], ["minus_5h", 5], ["minus_8h", 8], ["minus_10h", 10]];
  for (const [name, hours] of offsets) if (Math.abs(d + hours * HOUR_MS) <= tolMs) return name;
  return "other";
}

const ANOMALY_BUCKETS: readonly Bucket[] = ["minus_8h", "minus_10h"];

/**
 * An app-written row that no class explains but whose digits sit a whole 8 or 10 hours behind createdAt:
 * the double-conversion signature. verify refuses to call a run clean while one exists.
 */
export function isOtherAnomaly(table: string, row: ClassifiedRow, cfg: ClassifyConfig): boolean {
  return row.class === "other" && cfg.ownedSources[table]?.has(row.source) === true && ANOMALY_BUCKETS.includes(diffBucket(row.stored, row.created, cfg.tolMs));
}

export interface ClassStats {
  count: number;
  minCreated?: string;
  maxCreated?: string;
  sample: Array<{ id: number; created: string; stored: string; source: string }>;
}

export interface TableSummary {
  scanned: number;
  buckets: Record<Bucket, number>;
  classes: Record<RowClass, ClassStats>;
  /** createdAt month -> rows and per-class counts. */
  months: Record<string, { rows: number } & Partial<Record<RowClass, number>>>;
  feedBySource: Record<string, number>;
  postCutoff: { rows: number; alreadyCorrect: number };
}

export function summarizeTable(rows: readonly ClassifiedRow[], cfg: ClassifyConfig): TableSummary {
  const summary: TableSummary = {
    scanned: rows.length,
    buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>,
    classes: Object.fromEntries(CLASSES.map((c) => [c, { count: 0, sample: [] as ClassStats["sample"] }])) as Record<RowClass, ClassStats>,
    months: {},
    feedBySource: {},
    postCutoff: { rows: 0, alreadyCorrect: 0 },
  };
  for (const r of rows) {
    summary.buckets[diffBucket(r.stored, r.created, cfg.tolMs)]++;
    const c = summary.classes[r.class];
    c.count++;
    if (c.minCreated === undefined || r.created < c.minCreated) c.minCreated = r.created;
    if (c.maxCreated === undefined || r.created > c.maxCreated) c.maxCreated = r.created;
    if (c.sample.length < 5) c.sample.push({ id: r.id, created: r.created, stored: r.stored, source: r.source });
    const month = (summary.months[r.created.slice(0, 7)] ??= { rows: 0 });
    month.rows++;
    month[r.class] = (month[r.class] ?? 0) + 1;
    if (r.class === "feed_owned_utc") summary.feedBySource[r.source] = (summary.feedBySource[r.source] ?? 0) + 1;
    if (digitsToMs(r.created) >= cfg.cutoffMs) {
      summary.postCutoff.rows++;
      if (r.class === "already_correct") summary.postCutoff.alreadyCorrect++;
    }
  }
  return summary;
}

// ── plan file ───────────────────────────────────────────────────────────

export interface PlanRow {
  table: string;
  id: number;
  from: string;
  to: string;
  class: RowClass;
}

export interface Plan {
  tool: string;
  toolVersion: string;
  args: PlanArgs;
  host: string;
  database: string;
  generatedFromRowCount: number;
  rows: PlanRow[];
  sha256: string;
}

/** JSON with sorted keys, so a hash survives a round trip through a file. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const planHash = (body: Omit<Plan, "sha256">): string => createHash("sha256").update(canonicalJson(body)).digest("hex");

function checkRow(r: PlanRow): void {
  tableSpec(r.table);
  if (!Number.isSafeInteger(r.id) || r.id <= 0) throw new BackfillError(`plan row has a bad id: ${describe(r.id)}`);
  digitsToMs(r.from);
  digitsToMs(r.to);
  if (r.from === r.to) throw new BackfillError(`${r.table} id ${r.id}: from equals to`);
  if (!PLANNED_CLASSES.includes(r.class)) throw new BackfillError(`${r.table} id ${r.id}: class ${r.class} is never applied`);
}

export function buildPlan(input: { args: PlanArgs; host: string; database: string; scannedRows: number; rows: readonly PlanRow[] }): Plan {
  const order = (t: string) => TABLES.findIndex((s) => s.table === t);
  const rows = input.rows
    .map((r) => ({ table: r.table, id: r.id, from: r.from, to: r.to, class: r.class }))
    .sort((a, b) => order(a.table) - order(b.table) || a.id - b.id);
  rows.forEach(checkRow);
  const body = { tool: TOOL_NAME, toolVersion: TOOL_VERSION, args: input.args, host: input.host, database: input.database, generatedFromRowCount: input.scannedRows, rows };
  return { ...body, sha256: planHash(body) };
}

/** Reads a plan file's text; the embedded hash must match the content. */
export function parsePlan(text: string): Plan {
  let plan: Plan;
  try {
    plan = JSON.parse(text) as Plan;
  } catch {
    throw new BackfillError("plan file is not valid JSON");
  }
  if (!plan || plan.tool !== TOOL_NAME || !Array.isArray(plan.rows) || typeof plan.sha256 !== "string") throw new BackfillError("not a shop-clock-backfill plan file");
  const { sha256, ...body } = plan;
  if (planHash(body) !== sha256) throw new BackfillError("plan file hash does not match its content; regenerate it, do not edit it");
  plan.rows.forEach(checkRow);
  return plan;
}

/** Planned rows whose shop DATE changes versus rows that only move within the same day. */
export function dayChanges(rows: readonly PlanRow[]): { dayChange: number; timeOnly: number } {
  const dayChange = rows.filter((r) => r.from.slice(0, 10) !== r.to.slice(0, 10)).length;
  return { dayChange, timeOnly: rows.length - dayChange };
}

// ── SQL ─────────────────────────────────────────────────────────────────

export interface SqlConn {
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

const WRITE_WORDS = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|TRUNCATE|ALTER|RENAME|GRANT|REVOKE|CALL|LOAD|LOCK|SHARE|OUTFILE|DUMPFILE)\b/i;

/** TiDB has no session read-only mode, so this allowlist is the only thing keeping read commands read-only. */
export function assertReadOnlySql(sql: string): void {
  const text = typeof sql === "string" ? sql.trim() : "";
  const refuse = (why: string): never => {
    throw new BackfillError(`read-only guard refused (${why}): ${text.slice(0, 80)}`);
  };
  if (/^SET\s+time_zone\s*=\s*'\+00:00'$/i.test(text)) return;
  if (/;|\/\*|\*\/|--|#/.test(text)) refuse("statement separator or comment");
  if (!/^(SELECT|SHOW)\b/i.test(text)) refuse("only SELECT, SHOW and SET time_zone = '+00:00' are allowed");
  if (WRITE_WORDS.test(text)) refuse("write or locking keyword");
}

export function readOnlyConn(inner: SqlConn): SqlConn {
  return {
    query: async (sql, params) => {
      assertReadOnlySql(sql);
      return inner.query(sql, params);
    },
    end: () => inner.end(),
  };
}

const ident = (name: string): string => `\`${name}\``;

function assertIds(ids: readonly number[]): void {
  for (const id of ids) if (!Number.isSafeInteger(id) || id <= 0) throw new BackfillError(`refusing to inline id ${describe(id)}`);
}

export function backupTableName(table: string, stamp: string): string {
  if (!/^\d{8}$/.test(stamp)) throw new UsageError(`--stamp must be yyyymmdd (got ${JSON.stringify(stamp)})`);
  return `_bak_${tableSpec(table).table}_shopclock_${stamp}`;
}

export const TZ_REPORT_SQL = "SELECT @@global.time_zone AS globalTz, @@session.time_zone AS sessionTz, @@system_time_zone AS systemTz";
export const TZ_PIN_SQL = "SET time_zone = '+00:00'";
export const TZ_CHECK_SQL = "SELECT @@session.time_zone AS sessionTz";

export function scanSql(s: TableSpec): string {
  const snap = s.snapCol ? `COALESCE(${ident(s.snapCol)} LIKE 'SNAP-%', 0)` : "0";
  return `SELECT ${ident("id")} AS id, ${ident(s.dateCol)} AS stored, ${ident(s.createdCol)} AS created, ${ident(s.sourceCol)} AS source, ${snap} AS isSnap FROM ${ident(s.table)} ORDER BY ${ident("id")}`;
}

export function columnsSql(s: TableSpec): { sql: string; params: string[] } {
  const cols = ["id", s.dateCol, s.createdCol, s.updatedCol, s.sourceCol, ...(s.snapCol ? [s.snapCol] : [])];
  return {
    sql: `SELECT COLUMN_NAME AS col, DATA_TYPE AS dataType, EXTRA AS extra FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (${cols.map(() => "?").join(", ")})`,
    params: [s.table, ...cols],
  };
}

export const TABLE_EXISTS_SQL = "SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?";

// TiDB rejects CREATE TABLE ... AS SELECT, so the backup is LIKE + INSERT ... SELECT.
export function createBackupSql(s: TableSpec, stamp: string): string {
  return `CREATE TABLE ${ident(backupTableName(s.table, stamp))} LIKE ${ident(s.table)}`;
}

export function insertBackupSql(s: TableSpec, stamp: string, ids: readonly number[]): string {
  assertIds(ids);
  return `INSERT INTO ${ident(backupTableName(s.table, stamp))} SELECT * FROM ${ident(s.table)} WHERE ${ident("id")} IN (${ids.join(", ")})`;
}

export const backupIdsSql = (s: TableSpec, stamp: string): string =>
  `SELECT ${ident("id")} AS id FROM ${ident(backupTableName(s.table, stamp))} ORDER BY ${ident("id")}`;

export const backupValuesSql = (s: TableSpec, stamp: string): string =>
  `SELECT ${ident("id")} AS id, ${ident(s.dateCol)} AS v FROM ${ident(backupTableName(s.table, stamp))} ORDER BY ${ident("id")}`;

/** Compare-and-swap on the value that was read. Self-assigning updatedCol stops its ON UPDATE from firing. */
export function casUpdateSql(s: TableSpec, preserveUpdatedAt: boolean): string {
  const keep = preserveUpdatedAt ? `, ${ident(s.updatedCol)} = ${ident(s.updatedCol)}` : "";
  return `UPDATE ${ident(s.table)} SET ${ident(s.dateCol)} = ?${keep} WHERE ${ident("id")} = ? AND ${ident(s.dateCol)} = ?`;
}

/** Rows whose updatedAt differs between the live table and its backup (NULL-safe). */
export const updatedAtMovedSql = (s: TableSpec, stamp: string): string =>
  `SELECT COUNT(*) AS moved FROM ${ident(s.table)} l JOIN ${ident(backupTableName(s.table, stamp))} b ON b.${ident("id")} = l.${ident("id")} WHERE NOT (l.${ident(s.updatedCol)} <=> b.${ident(s.updatedCol)})`;

export const currentValueSql = (s: TableSpec): string => `SELECT ${ident(s.dateCol)} AS v FROM ${ident(s.table)} WHERE ${ident("id")} = ?`;
