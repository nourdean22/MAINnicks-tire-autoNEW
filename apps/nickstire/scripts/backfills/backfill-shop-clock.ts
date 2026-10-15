/**
 * Corrects shop-day dates that app writers stored as UTC digits (invoices.invoiceDate,
 * alg_estimates.estimate_date). Subcommands: probe | plan | snapshot | apply | verify | rollback.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/backfills/backfill-shop-clock.ts <subcommand> ...
 *
 * probe, plan and verify only read. snapshot, apply and rollback print the SQL they would run and
 * stop unless --execute is given. Runbook: docs/runbooks/shop-clock-backfill.md. Classification
 * rules and the source-ownership rule: shopClockBackfill.ts. Reads DATABASE_URL from the process
 * environment only (no dotenv), so a stray .env cannot choose the database.
 */
import fs from "node:fs";
import path from "node:path";
import {
  BackfillError,
  BUCKETS,
  CLASSES,
  TABLES,
  UsageError,
  backupIdsSql,
  backupTableName,
  backupValuesSql,
  buildPlan,
  casUpdateSql,
  classifyRow,
  columnsSql,
  createBackupSql,
  currentValueSql,
  dayChanges,
  insertBackupSql,
  isOtherAnomaly,
  parseClassifyConfig,
  parsePlan,
  readOnlyConn,
  scanSql,
  summarizeTable,
  TABLE_EXISTS_SQL,
  TZ_CHECK_SQL,
  TZ_PIN_SQL,
  TZ_REPORT_SQL,
  updatedAtMovedSql,
  type ClassifiedRow,
  type ClassifyConfig,
  type Plan,
  type PlanRow,
  type ScanRow,
  type SqlConn,
  type TableSpec,
  type TableSummary,
} from "./shopClockBackfill";

export const BATCH_SIZE = 200;
const BACKUP_CHUNK = 500;

export interface CliDeps {
  env: Readonly<Record<string, string | undefined>>;
  connect(config: { uri: string }): Promise<SqlConn>;
  readFile(file: string): string;
  /** Must refuse to overwrite an existing file. */
  writeFile(file: string, data: string): void;
  out(line: string): void;
}

// ── arguments ───────────────────────────────────────────────────────────

type Flags = Record<string, string>;
interface CommandSpec {
  flags: string[];
  bool?: string[];
}

const CLASSIFY_FLAGS = ["cutoff", "snap-bug-start", "snap-fix-cutoff", "tol-minutes", "sources", "estimate-sources"];
const PLAN_FLAGS = ["plan", "stamp", "preserve-updated-at"];
const COMMANDS: Record<string, CommandSpec> = {
  probe: { flags: CLASSIFY_FLAGS },
  plan: { flags: [...CLASSIFY_FLAGS, "out"] },
  verify: { flags: CLASSIFY_FLAGS },
  snapshot: { flags: ["plan", "stamp"], bool: ["execute"] },
  apply: { flags: PLAN_FLAGS, bool: ["execute"] },
  rollback: { flags: PLAN_FLAGS, bool: ["execute"] },
};

function parseArgs(argv: readonly string[]): { cmd: string; flags: Flags } {
  const [cmd, ...rest] = argv;
  const spec = cmd !== undefined && Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : undefined;
  if (!cmd || !spec) throw new UsageError(`usage: backfill-shop-clock.ts <${Object.keys(COMMANDS).join("|")}> [flags]; see docs/runbooks/shop-clock-backfill.md`);
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    const eq = token.indexOf("=");
    const name = token.startsWith("--") ? token.slice(2, eq === -1 ? undefined : eq) : "";
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    if (spec.bool?.includes(name) && inline === undefined) {
      flags[name] = "true";
    } else if (spec.flags.includes(name)) {
      const value = inline ?? rest[++i];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      flags[name] = value;
    } else {
      throw new UsageError(`${cmd}: unknown argument ${token}`);
    }
  }
  return { cmd, flags };
}

const classifyArgs = (f: Flags) =>
  parseClassifyConfig({
    cutoff: f.cutoff,
    snapBugStart: f["snap-bug-start"],
    snapFixCutoff: f["snap-fix-cutoff"],
    tolMinutes: f["tol-minutes"],
    sources: f.sources,
    estimateSources: f["estimate-sources"],
  });

function preserveFlag(f: Flags): boolean {
  const v = f["preserve-updated-at"];
  if (v === undefined || v === "true") return true;
  if (v === "false") return false;
  throw new UsageError(`--preserve-updated-at must be true or false (got ${JSON.stringify(v)})`);
}

// ── connection ──────────────────────────────────────────────────────────

const asRows = (result: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(result)) throw new BackfillError("the driver did not return a row list");
  return result as Array<Record<string, unknown>>;
};

export function describeTarget(uri: string): { host: string; database: string } {
  try {
    const u = new URL(uri);
    if (!u.hostname) throw new Error("no host");
    return { host: u.hostname, database: decodeURIComponent(u.pathname.replace(/^\//, "")) };
  } catch {
    throw new BackfillError("DATABASE_URL is not a valid connection URL");
  }
}

async function pinUtc(conn: SqlConn, out: CliDeps["out"]): Promise<void> {
  const [tz] = asRows(await conn.query(TZ_REPORT_SQL));
  out(`time_zone before pin: global=${tz?.globalTz} session=${tz?.sessionTz} system=${tz?.systemTz}`);
  await conn.query(TZ_PIN_SQL);
  const [after] = asRows(await conn.query(TZ_CHECK_SQL));
  if (after?.sessionTz !== "+00:00") throw new BackfillError(`session time_zone is ${JSON.stringify(after?.sessionTz)} after ${TZ_PIN_SQL}; aborting before any data is read`);
  out("session time_zone pinned: +00:00");
}

type Mode = "read" | "write";

export async function withDb<T>(deps: CliDeps, mode: Mode, fn: (conn: SqlConn, target: { host: string; database: string }) => Promise<T>): Promise<T> {
  const uri = deps.env.DATABASE_URL;
  if (!uri) throw new BackfillError("DATABASE_URL is not set; run through `railway run -s MAINnicks-tire-auto --`");
  const target = describeTarget(uri);
  deps.out(`DB host: ${target.host}  database: ${target.database}`);
  const raw = await deps.connect({ uri });
  try {
    const conn = mode === "read" ? readOnlyConn(raw) : raw;
    await pinUtc(conn, deps.out);
    return await fn(conn, target);
  } finally {
    await raw.end().catch(() => undefined);
  }
}

async function checkColumns(conn: SqlConn, spec: TableSpec, out: CliDeps["out"]): Promise<void> {
  const { sql, params } = columnsSql(spec);
  const found = new Map(asRows(await conn.query(sql, params)).map((r) => [String(r.col), r]));
  const missing = params.slice(1).filter((c) => !found.has(c));
  if (missing.length) throw new BackfillError(`${spec.table}: missing column(s) ${missing.join(", ")}; the schema is not what this tool expects`);
  for (const c of [spec.dateCol, spec.createdCol, spec.updatedCol]) {
    const type = String(found.get(c)?.dataType).toLowerCase();
    if (type !== "timestamp" && type !== "datetime") throw new BackfillError(`${spec.table}.${c} is ${type}, expected timestamp`);
  }
  const onUpdate = /on update/i.test(String(found.get(spec.updatedCol)?.extra ?? ""));
  out(`schema ok: ${spec.table}.${spec.dateCol} is ${String(found.get(spec.dateCol)?.dataType).toLowerCase()}; ${spec.updatedCol} ON UPDATE: ${onUpdate ? "yes" : "no"}`);
}

async function scanTable(conn: SqlConn, spec: TableSpec): Promise<ScanRow[]> {
  const rows = asRows(await conn.query(scanSql(spec)));
  if (rows.length === 0) throw new BackfillError(`${spec.table}: scanned 0 rows; an empty read is not a clean result`);
  return rows.map((r) => {
    const id = Number(r.id);
    if (!Number.isSafeInteger(id) || typeof r.source !== "string") throw new BackfillError(`${spec.table}: unreadable row (id ${String(r.id)})`);
    return { id, stored: r.stored as string, created: r.created as string, source: r.source, isSnap: Number(r.isSnap) === 1 };
  });
}

interface TableRows {
  spec: TableSpec;
  rows: ClassifiedRow[];
}

async function readAndClassify(conn: SqlConn, cfg: ClassifyConfig, out: CliDeps["out"]): Promise<TableRows[]> {
  const result: TableRows[] = [];
  for (const spec of TABLES) {
    await checkColumns(conn, spec, out);
    const scanned = await scanTable(conn, spec);
    result.push({ spec, rows: scanned.map((r) => ({ ...r, ...classifyRow(spec.table, r, cfg) })) });
  }
  return result;
}

// ── read commands ───────────────────────────────────────────────────────

const classCounts = (s: TableSummary): string => CLASSES.map((c) => `${c}=${s.classes[c].count}`).join(" ");
const feedLine = (s: TableSummary): string => Object.entries(s.feedBySource).map(([k, v]) => `${k}=${v}`).join(" ");

function printProbe(out: CliDeps["out"], spec: TableSpec, s: TableSummary, tolMinutes: number): void {
  out(`== ${spec.table}: ${s.scanned} rows ==`);
  out(`stored - createdAt, tolerance ${tolMinutes}m: ${BUCKETS.map((b) => `${b}=${s.buckets[b]}`).join(" ")}`);
  out(`classes: ${classCounts(s)}`);
  for (const c of CLASSES) {
    const st = s.classes[c];
    if (!st.count) continue;
    out(`  ${c}: ${st.count}, createdAt ${st.minCreated} .. ${st.maxCreated}`);
    out(`    sample: ${st.sample.map((x) => `${x.id}[${x.source}] ${x.created} -> ${x.stored}`).join("; ")}`);
  }
  if (feedLine(s)) out(`feed_owned_utc by source: ${feedLine(s)}`);
  out(`post-cutoff rows: ${s.postCutoff.rows}, already_correct: ${s.postCutoff.alreadyCorrect}, post_cutoff_utc_match: ${s.classes.post_cutoff_utc_match.count}`);
  out("per month (createdAt):");
  for (const month of Object.keys(s.months).sort()) {
    const m = s.months[month];
    const parts = CLASSES.filter((c) => c !== "other" && m[c]).map((c) => `${c}=${m[c]}`);
    out(`  ${month} rows=${m.rows} ${parts.join(" ")}`.trimEnd());
  }
}

async function probe(flags: Flags, deps: CliDeps): Promise<number> {
  const { cfg, args } = classifyArgs(flags);
  await withDb(deps, "read", async (conn) => {
    for (const t of await readAndClassify(conn, cfg, deps.out)) printProbe(deps.out, t.spec, summarizeTable(t.rows, cfg), args.tolMinutes);
  });
  return 0;
}

async function plan(flags: Flags, deps: CliDeps): Promise<number> {
  const { cfg, args } = classifyArgs(flags);
  const file = flags.out;
  if (!file) throw new UsageError("--out <plan file> is required");
  const { tables, target } = await withDb(deps, "read", async (conn, t) => ({ tables: await readAndClassify(conn, cfg, deps.out), target: t }));

  const rows: PlanRow[] = [];
  const anomalies: string[] = [];
  let scanned = 0;
  for (const t of tables) {
    const s = summarizeTable(t.rows, cfg);
    scanned += s.scanned;
    deps.out(`${t.spec.table}: ${s.scanned} rows; ${classCounts(s)}`);
    if (feedLine(s)) deps.out(`  feed_owned_utc (never planned) by source: ${feedLine(s)}; sample ids ${s.classes.feed_owned_utc.sample.map((x) => x.id).join(", ")}`);
    for (const r of t.rows) {
      if (r.class === "post_cutoff_utc_match") anomalies.push(`${t.spec.table}#${r.id}`);
      if (r.to) rows.push({ table: t.spec.table, id: r.id, from: r.stored, to: r.to, class: r.class });
    }
  }
  if (anomalies.length) {
    deps.out(`FAILED: ${anomalies.length} app-written row(s) created after the cutoff still carry UTC digits: ${anomalies.join(", ")}`);
    deps.out("A writer is still on the UTC clock, or the cutoff is wrong. No plan file written.");
    return 1;
  }

  const built = buildPlan({ args, host: target.host, database: target.database, scannedRows: scanned, rows });
  deps.writeFile(file, `${JSON.stringify(built, null, 2)}\n`);
  deps.out(`planned rows: ${built.rows.length}`);
  for (const spec of TABLES) {
    const mine = built.rows.filter((r) => r.table === spec.table);
    const d = dayChanges(mine);
    deps.out(`  ${spec.table}: ${mine.length} planned; ${d.dayChange} change the shop date, ${d.timeOnly} change only the time of day`);
  }
  const total = dayChanges(built.rows);
  deps.out(`day_changes: ${total.dayChange} of ${built.rows.length} planned rows change the shop date; ${total.timeOnly} change only the time of day`);
  const detail = new Map(tables.flatMap((t) => t.rows.map((r) => [`${t.spec.table}#${r.id}`, r] as const)));
  deps.out("Show these rows to the operator and wait for an explicit go before snapshot or apply:");
  for (const r of built.rows) {
    const d = detail.get(`${r.table}#${r.id}`);
    deps.out(`  ${r.table}#${r.id} source=${d?.source} createdAt=${d?.created} ${r.from} -> ${r.to} ${r.class} day_change=${dayChanges([r]).dayChange ? "yes" : "no"}`);
  }
  deps.out(`plan file: ${file}  sha256: ${built.sha256}`);
  deps.out("A plan far larger than expected means stop and report.");
  return 0;
}

const NOT_CLEAN: readonly string[] = ["needs_correction", "snap_double_converted", "post_cutoff_utc_match"];

async function verify(flags: Flags, deps: CliDeps): Promise<number> {
  const { cfg, args } = classifyArgs(flags);
  const tables = await withDb(deps, "read", (conn) => readAndClassify(conn, cfg, deps.out));
  const left: string[] = [];
  for (const t of tables) {
    deps.out(`${t.spec.table}: ${t.rows.length} rows; ${classCounts(summarizeTable(t.rows, cfg))}`);
    for (const r of t.rows) {
      const label = NOT_CLEAN.includes(r.class) ? r.class : isOtherAnomaly(t.spec.table, r, cfg) ? "other_anomaly" : undefined;
      if (label) left.push(`  ${t.spec.table}#${r.id} ${label} createdAt=${r.created} stored=${r.stored}`);
    }
  }
  if (left.length) {
    deps.out(`FAILED: ${left.length} row(s) not clean:`);
    left.forEach((l) => deps.out(l));
    return 1;
  }
  const list = (v: readonly string[]) => (v.length ? v.join(",") : "none");
  deps.out(`verify ok (sources: ${list(args.sources)}; estimate-sources: ${list(args.estimateSources)}): zero needs_correction, zero snap_double_converted, zero post_cutoff_utc_match, zero other_anomaly`);
  return 0;
}

// ── write commands ──────────────────────────────────────────────────────

interface Group {
  spec: TableSpec;
  rows: PlanRow[];
}

function loadPlan(flags: Flags, deps: CliDeps): { plan: Plan; stamp: string; groups: Group[] } {
  const file = flags.plan;
  const stamp = flags.stamp;
  if (!file) throw new UsageError("--plan <plan file> is required");
  if (!stamp) throw new UsageError("--stamp <yyyymmdd> is required");
  backupTableName("invoices", stamp);
  const parsed = parsePlan(deps.readFile(file));
  const groups = TABLES.map((spec) => ({ spec, rows: parsed.rows.filter((r) => r.table === spec.table) })).filter((g) => g.rows.length > 0);
  if (groups.length === 0) throw new BackfillError("the plan has no rows; nothing to do");
  return { plan: parsed, stamp, groups };
}

/** A plan is only valid for the database it was read from. */
function assertSameTarget(plan: Plan, target: { host: string; database: string }): void {
  if (plan.host !== target.host || plan.database !== target.database) {
    throw new BackfillError(`the plan was read from ${plan.host}/${plan.database} but this run is connected to ${target.host}/${target.database}`);
  }
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const show = (sql: string): string => (sql.length > 400 ? `${sql.slice(0, 400)} ... (${sql.length} chars)` : sql);

function dryRunBanner(deps: CliDeps, cmd: string): void {
  deps.out(`DRY RUN: ${cmd} opened no connection. Add --execute to run the statements below.`);
}

async function requireBackup(conn: SqlConn, g: Group, stamp: string, verb: string): Promise<void> {
  const name = backupTableName(g.spec.table, stamp);
  if (asRows(await conn.query(TABLE_EXISTS_SQL, [name])).length === 0) throw new BackfillError(`backup table ${name} does not exist; run snapshot first`);
  const have = asRows(await conn.query(backupIdsSql(g.spec, stamp))).map((r) => Number(r.id));
  const want = g.rows.map((r) => r.id);
  if (have.length !== want.length) throw new BackfillError(`${name} has ${have.length} rows but the plan has ${want.length}; refusing to ${verb}`);
  if (have.some((id, i) => id !== want[i])) throw new BackfillError(`${name} holds different ids than the plan; refusing to ${verb}`);
}

async function snapshot(flags: Flags, deps: CliDeps): Promise<number> {
  const { plan, groups, stamp } = loadPlan(flags, deps);
  if (flags.execute !== "true") {
    dryRunBanner(deps, "snapshot");
    for (const g of groups) {
      deps.out(createBackupSql(g.spec, stamp));
      for (const ids of chunks(g.rows.map((r) => r.id), BACKUP_CHUNK)) deps.out(show(insertBackupSql(g.spec, stamp, ids)));
      deps.out(`-- then: ${show(backupIdsSql(g.spec, stamp))} and compare with ${g.rows.length} planned rows`);
    }
    return 0;
  }
  await withDb(deps, "write", async (conn, target) => {
    assertSameTarget(plan, target);
    for (const g of groups) await checkColumns(conn, g.spec, deps.out);
    for (const g of groups) {
      const name = backupTableName(g.spec.table, stamp);
      if (asRows(await conn.query(TABLE_EXISTS_SQL, [name])).length > 0) throw new BackfillError(`${name} already exists; refusing to overwrite a backup (pick another --stamp)`);
      await conn.query(createBackupSql(g.spec, stamp));
      for (const ids of chunks(g.rows.map((r) => r.id), BACKUP_CHUNK)) await conn.query(insertBackupSql(g.spec, stamp, ids));
      const have = asRows(await conn.query(backupIdsSql(g.spec, stamp))).length;
      if (have !== g.rows.length) throw new BackfillError(`${name} has ${have} rows, the plan has ${g.rows.length}; backup left in place, do not apply`);
      deps.out(`backup ${name}: ${have} rows (plan ${g.rows.length})`);
    }
  });
  return 0;
}

export interface MigrateItem {
  table: string;
  id: number;
  expected: string;
  next: string;
}

export interface MigrateResult {
  updated: number;
  skipped: number;
  batches: number;
  miss?: { table: string; id: number; expected: string; found: string };
}

/** Compare-and-swap every item in batches, one transaction each; stops at the first miss. */
export async function casMigrate(
  conn: SqlConn,
  items: readonly MigrateItem[],
  opts: { preserveUpdatedAt: boolean; batchSize?: number; out: CliDeps["out"] },
): Promise<MigrateResult> {
  const result: MigrateResult = { updated: 0, skipped: 0, batches: 0 };
  for (const spec of TABLES) {
    const batches = chunks(items.filter((i) => i.table === spec.table), opts.batchSize ?? BATCH_SIZE);
    for (const [n, batch] of batches.entries()) {
      await conn.query("START TRANSACTION");
      let updated = 0;
      let skipped = 0;
      try {
        for (const item of batch) {
          const res = (await conn.query(casUpdateSql(spec, opts.preserveUpdatedAt), [item.next, item.id, item.expected])) as { affectedRows?: number };
          if (res.affectedRows === 1) {
            updated++;
            continue;
          }
          const found = res.affectedRows === 0 ? asRows(await conn.query(currentValueSql(spec), [item.id]))[0]?.v : `affectedRows=${res.affectedRows}`;
          if (found === item.next) {
            skipped++;
            continue;
          }
          await conn.query("ROLLBACK");
          result.miss = { table: item.table, id: item.id, expected: item.expected, found: String(found ?? "row missing") };
          return result;
        }
        await conn.query("COMMIT");
      } catch (err) {
        await conn.query("ROLLBACK").catch(() => undefined);
        throw err;
      }
      result.updated += updated;
      result.skipped += skipped;
      result.batches++;
      opts.out(`${spec.table} batch ${n + 1}/${batches.length}: updated ${updated}, already at target ${skipped}`);
    }
  }
  return result;
}

function reportMigration(deps: CliDeps, verb: string, r: MigrateResult): number {
  if (r.miss) {
    deps.out(`STOPPED on ${r.miss.table}#${r.miss.id}: expected ${r.miss.expected}, found ${r.miss.found}. That batch was rolled back; later batches did not run.`);
    deps.out(`Before the stop: ${r.batches} batch(es) committed, ${r.updated} updated, ${r.skipped} already at target. Investigate, then re-run ${verb}; it resumes.`);
    return 1;
  }
  deps.out(`${verb} done: ${r.updated} updated, ${r.skipped} already at target, ${r.batches} batch(es)`);
  return 0;
}

async function applyOrRollback(cmd: "apply" | "rollback", flags: Flags, deps: CliDeps): Promise<number> {
  const { plan, groups, stamp } = loadPlan(flags, deps);
  const preserve = preserveFlag(flags);
  const items = groups.flatMap((g) =>
    g.rows.map((r) => ({ table: r.table, id: r.id, expected: cmd === "apply" ? r.from : r.to, next: cmd === "apply" ? r.to : r.from })),
  );
  if (flags.execute !== "true") {
    dryRunBanner(deps, cmd);
    deps.out(`Each batch of ${BATCH_SIZE} runs inside START TRANSACTION ... COMMIT; a compare-and-swap miss rolls the batch back and stops.`);
    for (const g of groups) {
      deps.out(`${casUpdateSql(g.spec, preserve)}   -- ${g.rows.length} rows`);
      deps.out(`  params are [new value, id, expected current value], first rows: ${JSON.stringify(items.filter((i) => i.table === g.spec.table).slice(0, 3).map((i) => [i.next, i.id, i.expected]))}`);
    }
    return 0;
  }
  const result = await withDb(deps, "write", async (conn, target) => {
    assertSameTarget(plan, target);
    for (const g of groups) await checkColumns(conn, g.spec, deps.out);
    for (const g of groups) {
      await requireBackup(conn, g, stamp, cmd);
      if (cmd === "rollback") {
        const saved = new Map(asRows(await conn.query(backupValuesSql(g.spec, stamp))).map((r) => [Number(r.id), r.v]));
        for (const row of g.rows) {
          if (saved.get(row.id) !== row.from) throw new BackfillError(`backup ${g.spec.table}#${row.id} holds ${String(saved.get(row.id))} but the plan expects ${row.from}; refusing to roll back`);
        }
      }
    }
    const migrated = await casMigrate(conn, items, { preserveUpdatedAt: preserve, out: deps.out });
    let moved = 0;
    try {
      for (const g of groups) moved += Number(asRows(await conn.query(updatedAtMovedSql(g.spec, stamp)))[0]?.moved);
      deps.out(`updatedAt moved on ${moved} of ${items.length} rows (expected ${preserve ? "0" : "any"})`);
    } catch (err) {
      deps.out(`updatedAt check could not run: ${err instanceof Error ? err.message : String(err)}`);
    }
    return migrated;
  });
  return reportMigration(deps, cmd, result);
}

// ── entry ───────────────────────────────────────────────────────────────

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  try {
    const { cmd, flags } = parseArgs(argv);
    if (cmd === "probe") return await probe(flags, deps);
    if (cmd === "plan") return await plan(flags, deps);
    if (cmd === "verify") return await verify(flags, deps);
    if (cmd === "snapshot") return await snapshot(flags, deps);
    return await applyOrRollback(cmd as "apply" | "rollback", flags, deps);
  } catch (err) {
    if (err instanceof BackfillError) {
      deps.out(`ERROR: ${err.message}`);
      return err instanceof UsageError ? 2 : 1;
    }
    deps.out(`ERROR (unexpected): ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

function realDeps(): CliDeps {
  return {
    env: process.env,
    async connect({ uri }) {
      const mysql = (await import("mysql2/promise")).default;
      const conn = await mysql.createConnection({ uri, dateStrings: true });
      return {
        async query(sql, params) {
          const [result] = await conn.query(sql, params as unknown[] | undefined);
          return result;
        },
        end: () => conn.end(),
      };
    },
    readFile: (file) => fs.readFileSync(file, "utf8"),
    writeFile: (file, data) => fs.writeFileSync(file, data, { encoding: "utf8", flag: "wx" }),
    out: (line) => console.log(line),
  };
}

// Only the real entry point runs; tests import runCli.
if (path.basename(process.argv[1] ?? "").startsWith("backfill-shop-clock")) {
  runCli(process.argv.slice(2), realDeps()).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.log(`ERROR (unexpected): ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
