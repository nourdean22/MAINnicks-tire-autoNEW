/**
 * Scrub customer names, phones and emails out of rows bdnick stored before wave 3 (2026-10-19).
 *
 * Wave 3 (lib/brain/customer-pii.ts) stops NEW rows from carrying customer identity. Rows written
 * before it still hold names and phones at rest, and AuditEvent has no retention. This rewrites
 * each in-scope row to what the wave 3 writer stores today for the same input, reusing its
 * allowlist functions; it never keeps a denylist of its own.
 *
 * SAFETY (prod-db-guard)
 *   - DRY RUN by default: reads and counts only. `run()` returns before any code path that writes
 *     (tests/scripts/scrub-bdnick-customer-pii.test.ts drives the real adapter with a client whose
 *     every write method throws).
 *   - The database is DATABASE_URL and nothing else: no .env file is loaded. The host is printed,
 *     never the password.
 *   - --execute needs --expect <n> (the dry run's "rows to change" total; a mismatch aborts before
 *     any write), --target <branch|prod> and --prod-host <production DB host>. Host check: a branch
 *     run refuses when DATABASE_URL's host equals --prod-host; a prod run refuses unless it equals it.
 *   - Before any update, one backup per table, inside a REPEATABLE READ transaction:
 *     CREATE TABLE "_bak_<table>_scrub_20261019" AS SELECT * FROM <table> WHERE <scope>, and the
 *     backup count must equal the scope count in the same snapshot or the transaction rolls back.
 *     An existing backup table is refused. Nothing is ever dropped or truncated.
 *   - Updates touch only rows whose id is in the backup, only rows whose value changes, in batches
 *     of 500 by id, each as a compare-and-swap on the value read (a row changed meanwhile is skipped
 *     and counted). Raw SQL, so updatedAt is not bumped (an old coach event must not resurface).
 *   - Resume after a crash: --resume uses the existing backup tables instead of creating them.
 *   - Output is counts and ids only, never a value from a row.
 *
 *   DATABASE_URL=<branch url> pnpm exec tsx scripts/scrub-bdnick-customer-pii.ts                 # dry run
 *   DATABASE_URL=<branch url> pnpm exec tsx scripts/scrub-bdnick-customer-pii.ts --execute \
 *     --expect <n> --target branch --prod-host <prod host>
 *
 * Restore one table: INSERT ... SELECT from its backup by id (operator). Drop a backup only after
 * the change is confirmed good (operator).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEE_ADMIN_CUSTOMERS, scrubBridgePayload, scrubText, stripSyncCustomerPii } from "../lib/brain/customer-pii";

export type Row = { id: string } & Record<string, unknown>;

export interface TableSpec {
  /** Physical name exactly as SQL needs it (quoted when mixed case). */
  name: string;
  /** information_schema.tables.table_name of the backup. */
  backupName: string;
  backup: string;
}

const bak = (bare: string): Pick<TableSpec, "backupName" | "backup"> => {
  const backupName = `_bak_${bare}_scrub_20261019`;
  return { backupName, backup: `"${backupName}"` };
};

/** Physical names via @@map: AuditEvent has none, BrainMemory is brain_memories, BrainBusEvent brain_bus_events. */
export const TABLES = {
  audit: { name: '"AuditEvent"', ...bak("AuditEvent") },
  memories: { name: "brain_memories", ...bak("brain_memories") },
  bus: { name: "brain_bus_events", ...bak("brain_bus_events") },
} satisfies Record<string, TableSpec>;

export interface Bucket {
  name: string;
  table: TableSpec;
  /** SQL predicate, constants only. Buckets on one table are disjoint. */
  where: string;
  /** Columns read besides id (also the CAS columns). */
  read: string[];
  write: Array<{ col: string; json: boolean }>;
  /** New values for the `write` columns. Pure. */
  transform(row: Row): Record<string, unknown>;
}

// ---- transforms ------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Stable stringify: Json columns come back with jsonb key order, so `!==` on objects lies. */
export function stable(v: unknown): string {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stable(x))).join(",")}]`;
  if (isObj(v)) {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * stripSyncCustomerPii appends "• AT-RISK: n at-risk customers, see Customers in the admin." on
 * every call, so a row the wave 3 writer already stripped would gain a second line. Removing that
 * generated line first makes the result equal stripSyncCustomerPii(raw) for an old row and leave a
 * stripped row unchanged. nickstire never writes that wording, so raw rows are untouched by it.
 */
const GENERATED_AT_RISK = new RegExp(`^• AT-RISK: \\d+ at-risk customers?, ${SEE_ADMIN_CUSTOMERS}\\.$`);
function dropGeneratedAtRisk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropGeneratedAtRisk);
  if (!isObj(node)) return node;
  const out: Obj = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = k === "actionPlan" && typeof v === "string" ? v.split("\n").filter((l) => !GENERATED_AT_RISK.test(l)).join("\n") : dropGeneratedAtRisk(v);
  }
  return out;
}

/**
 * business_metrics_sync: what POST /api/sync/business stores. ceo_business_context too: its writer
 * copies whole sub-objects (revenue, leads, intelligence, ...) out of the sync payload, and the
 * strip works per key at any depth, so stripping the old row equals building it from the stripped
 * payload (prioritizedActions come from counts the strip keeps).
 */
const syncPayload = (row: Row) => ({ payload: stripSyncCustomerPii(dropGeneratedAtRisk(row.payload)) });

/**
 * nickstire:* audit rows have two writers. /api/webhooks/nickstire (actor nickstire_webhook) now
 * stores only field names and four ids; /api/sync/events stores the scrubBridgePayload projection,
 * the same one its GET applies on read. Both details are fixed text; scrubText is belt and braces.
 */
function bridgeRow(row: Row) {
  const detail = typeof row.detail === "string" ? scrubText(row.detail) : row.detail;
  const eventType = String(row.eventType ?? "");
  if (row.actor === "nickstire_webhook") {
    const p = row.payload;
    if (isObj(p) && Object.keys(p).length === 2 && Array.isArray(p.keys) && isObj(p.ids)) return { payload: p, detail };
    const fields = isObj(p) ? p : {};
    const { leadId, bookingId, invoiceNumber, rating } = fields;
    return { payload: JSON.parse(JSON.stringify({ keys: Object.keys(fields), ids: { leadId, bookingId, invoiceNumber, rating } })), detail };
  }
  return { payload: scrubBridgePayload(row.payload, { keepText: eventType.includes("social_draft") }), detail };
}

/**
 * The stored JSON was cut at 300 (or 200) characters, so it often does not parse. Salvage the
 * complete leading pairs: cut back to each `,"` that starts a top-level key until it parses. Any
 * result still goes through the allowlist, so a mis-salvage can lose a field but never keep a name.
 */
export function parseCut(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    /* cut below */
  }
  for (let i = s.lastIndexOf(',"'); i > 0; i = s.lastIndexOf(',"', i - 1)) {
    try {
      return JSON.parse(`${s.slice(0, i)}}`);
    } catch {
      /* try an earlier cut */
    }
  }
  return {};
}

/** processShopEvent's safeData: the bridge projection without reviewText. */
function shopSafeData(json: string): string {
  const parsed = parseCut(json);
  const safe = (isObj(parsed) ? scrubBridgePayload(parsed) : {}) as Obj;
  delete safe.reviewText;
  return JSON.stringify(safe);
}

function shopMemory(row: Row) {
  const m = /^Shop ([^:]*): ([\s\S]*)$/.exec(String(row.content));
  return { content: m ? `Shop ${m[1]}: ${shopSafeData(m[2]).slice(0, 300)}` : row.content };
}

function emergencyMemory(row: Row) {
  const m = /^EMERGENCY: ([\s\S]*)$/.exec(String(row.content));
  return { content: m ? `EMERGENCY: ${shopSafeData(m[1]).slice(0, 200)}` : row.content };
}

/**
 * Old: "New lead from <source>: <name> — <service>" and "Phone call from <phone> ended. Duration: ...".
 * Today: "New lead from <source> — <service>" and "Phone call ended. Duration: ..." with scrubText on
 * each kept field. The service is taken after the LAST " — ", so a name containing one cannot leak.
 */
function leadCallMemory(row: Row) {
  const content = String(row.content);
  if (content.startsWith("Phone call from ")) {
    const m = /^Phone call from [\s\S]*? ended\. (Duration: [\s\S]*)$/.exec(content);
    return { content: `Phone call ended. ${m ? scrubText(m[1]) : "Duration: 0s. Reason: unknown. Mentioned: none."}` };
  }
  if (!content.startsWith("New lead from ")) return { content };
  const keySource = /^lead_source_([\s\S]*)_\d{4}-\d{2}-\d{2}$/.exec(String(row.key))?.[1];
  const rest = content.slice("New lead from ".length);
  const source = keySource !== undefined && rest.startsWith(keySource) ? keySource : rest.split(/: | — /)[0];
  const tail = rest.slice(source.length);
  const cut = tail.lastIndexOf(" — ");
  const service = cut >= 0 ? tail.slice(cut + 3) : "inquiry";
  return { content: `New lead from ${scrubText(source)} — ${scrubText(service)}` };
}

/** The texts /api/sync/events stores today (tests pin them to the route's literals). */
const CALLBACK_TEXT = "Callback requested: see Customers in Nick's Admin";
const reviewText = (old: unknown) => `${/^([^★]*)★/.exec(String(old ?? ""))?.[1] ?? "undefined"}★ review received: see Reviews in Nick's Admin`;

function coachMemory(row: Row) {
  const meta = row.metadata;
  if (!isObj(meta)) return { metadata: meta };
  if (row.key === "coach:drift-recovery:callback_requested") return { metadata: { ...meta, body: CALLBACK_TEXT } };
  if (row.key === "coach:drift-recovery:negative_review") return { metadata: { ...meta, body: reviewText(meta.body) } };
  return { metadata: meta };
}

function busDrift(row: Row) {
  const p = row.payload;
  if (!isObj(p)) return { payload: p };
  if (p.ruleId === "callback_requested") return { payload: { ...p, message: CALLBACK_TEXT } };
  if (p.ruleId === "negative_review") return { payload: { ...p, message: reviewText(p.message) } };
  return { payload: p };
}

// ---- buckets ---------------------------------------------------------------------------------

const AUDIT_READ = ["id", '"eventType" AS "eventType"', "actor", "detail", "payload"];

export const BUCKETS: Bucket[] = [
  {
    name: "audit_business_metrics_sync",
    table: TABLES.audit,
    where: `"eventType" = 'business_metrics_sync'`,
    read: AUDIT_READ,
    write: [{ col: "payload", json: true }],
    transform: syncPayload,
  },
  {
    name: "audit_ceo_business_context",
    table: TABLES.audit,
    where: `"eventType" = 'ceo_business_context'`,
    read: AUDIT_READ,
    write: [{ col: "payload", json: true }],
    transform: syncPayload,
  },
  {
    name: "audit_nickstire_events",
    table: TABLES.audit,
    where: `"eventType" LIKE 'nickstire:%'`,
    read: AUDIT_READ,
    write: [
      { col: "payload", json: true },
      { col: "detail", json: false },
    ],
    transform: bridgeRow,
  },
  {
    name: "memories_shop_events",
    table: TABLES.memories,
    where: `category = 'business_event' AND source = 'bridge_pipeline' AND content LIKE 'Shop %'`,
    read: ["id", "category", "key", "content", "metadata"],
    write: [{ col: "content", json: false }],
    transform: shopMemory,
  },
  {
    name: "memories_emergency",
    table: TABLES.memories,
    where: `category = 'anomaly' AND source = 'pipeline_analysis' AND content LIKE 'EMERGENCY: %'`,
    read: ["id", "category", "key", "content", "metadata"],
    write: [{ col: "content", json: false }],
    transform: emergencyMemory,
  },
  {
    name: "memories_lead_call",
    table: TABLES.memories,
    where:
      `category IN ('business_event', 'insight') AND content NOT LIKE 'Shop %' AND (content LIKE 'New lead from %' ` +
      `OR content LIKE 'Phone call from %' OR key LIKE 'lead\\_source\\_%' OR key LIKE 'call\\_completed\\_%')`,
    read: ["id", "category", "key", "content", "metadata"],
    write: [{ col: "content", json: false }],
    transform: leadCallMemory,
  },
  {
    name: "memories_coach_events",
    table: TABLES.memories,
    where: `category = 'coach_event' AND key IN ('coach:drift-recovery:callback_requested', 'coach:drift-recovery:negative_review')`,
    read: ["id", "category", "key", "content", "metadata"],
    write: [{ col: "metadata", json: true }],
    transform: coachMemory,
  },
  {
    name: "bus_drift_customer_alerts",
    table: TABLES.bus,
    where: `topic = 'drift.fired' AND payload->>'ruleId' IN ('callback_requested', 'negative_review')`,
    read: ["id", "payload"],
    write: [{ col: "payload", json: true }],
    transform: busDrift,
  },
];

/** The write columns whose transformed value differs from the stored one. */
export function changedColumns(bucket: Bucket, row: Row): string[] {
  const next = bucket.transform(row);
  return bucket.write.filter((w) => stable(row[w.col]) !== stable(next[w.col])).map((w) => w.col);
}

// ---- database access -------------------------------------------------------------------------

export interface ScrubDb {
  readBatch(bucket: Bucket, afterId: string, limit: number, onlyBackedUp: boolean): Promise<Row[]>;
  backupExists(table: TableSpec): Promise<boolean>;
  /** Creates the backup and counts both sides in one snapshot; throws (rolling back) on a mismatch. */
  createBackup(table: TableSpec, where: string): Promise<{ backedUp: number; inScope: number }>;
  /** Compare-and-swap on the values read; false when the row changed meanwhile. */
  writeRow(bucket: Bucket, row: Row, next: Record<string, unknown>): Promise<boolean>;
}

type RawClient = {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
  $transaction<T>(fn: (tx: RawClient) => Promise<T>, opts?: { isolationLevel?: string; timeout?: number; maxWait?: number }): Promise<T>;
};

const jsonParam = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

export function prismaScrubDb(client: unknown): ScrubDb {
  const db = client as RawClient;
  return {
    async readBatch(b, afterId, limit, onlyBackedUp) {
      const only = onlyBackedUp ? ` AND id IN (SELECT id FROM ${b.table.backup})` : "";
      const rows = await db.$queryRawUnsafe<Row[]>(
        `SELECT ${b.read.join(", ")} FROM ${b.table.name} WHERE (${b.where})${only} AND id > $1 ORDER BY id LIMIT $2`,
        afterId,
        limit,
      );
      // A jsonb column read back as text would make every transform a no-op: a silent "0 to change".
      for (const r of rows) {
        for (const w of b.write) {
          if (w.json && typeof r[w.col] === "string") throw new Error(`${b.name}: ${w.col} came back as text, not JSON (row ${r.id}); refusing to count`);
        }
      }
      return rows;
    },
    async backupExists(t) {
      const rows = await db.$queryRawUnsafe<Array<{ n: bigint | number }>>(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`,
        t.backupName,
      );
      return Number(rows[0]?.n ?? 0) > 0;
    },
    async createBackup(t, where) {
      return db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`CREATE TABLE ${t.backup} AS SELECT * FROM ${t.name} WHERE ${where}`);
          const [b] = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${t.backup}`);
          const [s] = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${t.name} WHERE ${where}`);
          const counts = { backedUp: Number(b?.n ?? -1), inScope: Number(s?.n ?? -2) };
          if (counts.backedUp !== counts.inScope) {
            throw new Error(`backup ${t.backupName} holds ${counts.backedUp} rows but scope has ${counts.inScope}; rolled back`);
          }
          return counts;
        },
        { isolationLevel: "RepeatableRead", timeout: 600_000, maxWait: 30_000 },
      );
    },
    async writeRow(b, row, next) {
      const params: unknown[] = [row.id];
      const sets = b.write.map((w) => {
        params.push(w.json ? jsonParam(next[w.col]) : next[w.col]);
        return `${w.col} = $${params.length}${w.json ? "::jsonb" : ""}`;
      });
      const guards = b.write.map((w) => {
        params.push(w.json ? jsonParam(row[w.col]) : row[w.col]);
        return `${w.col} IS NOT DISTINCT FROM $${params.length}${w.json ? "::jsonb" : ""}`;
      });
      const n = await db.$executeRawUnsafe(`UPDATE ${b.table.name} SET ${sets.join(", ")} WHERE id = $1 AND ${guards.join(" AND ")}`, ...params);
      return n === 1;
    },
  };
}

// ---- the run ---------------------------------------------------------------------------------

export const BATCH = 500;

export interface RunOptions {
  execute: boolean;
  expect?: number;
  resume: boolean;
  log: (line: string) => void;
}

export interface Summary {
  buckets: Record<string, { inScope: number; toChange: number; sampleIds: string[]; written: number; skippedChanged: number }>;
  totalToChange: number;
  written: number;
  aborted?: string;
}

async function* rows(db: ScrubDb, b: Bucket, onlyBackedUp: boolean): AsyncGenerator<Row> {
  let after = "";
  for (;;) {
    const batch = await db.readBatch(b, after, BATCH, onlyBackedUp);
    if (batch.length === 0) return;
    for (const r of batch) yield r;
    after = batch[batch.length - 1].id;
  }
}

export async function run(db: ScrubDb, opts: RunOptions): Promise<Summary> {
  const { log } = opts;
  const summary: Summary = { buckets: {}, totalToChange: 0, written: 0 };
  const abort = (why: string): Summary => {
    log(`ABORTED, no row updated: ${why}`);
    return { ...summary, aborted: why };
  };
  // A resume counts only rows that have a backup, which is all it will write.
  const onlyBackedUp = opts.execute && opts.resume;
  const tables = [...new Set(BUCKETS.map((b) => b.table))];

  if (onlyBackedUp) {
    for (const t of tables) if (!(await db.backupExists(t))) return abort(`--resume but no backup table ${t.backupName}`);
  }

  // 1. Count pass: reads only.
  for (const b of BUCKETS) {
    const s = { inScope: 0, toChange: 0, sampleIds: [] as string[], written: 0, skippedChanged: 0 };
    for await (const r of rows(db, b, onlyBackedUp)) {
      s.inScope++;
      if (changedColumns(b, r).length > 0) {
        s.toChange++;
        if (s.sampleIds.length < 5) s.sampleIds.push(r.id);
      }
    }
    summary.buckets[b.name] = s;
    summary.totalToChange += s.toChange;
    log(`${b.name}: in scope ${s.inScope}, to change ${s.toChange}${s.sampleIds.length ? ` (e.g. ${s.sampleIds.join(", ")})` : ""}`);
  }
  log(`TOTAL rows to change: ${summary.totalToChange}`);

  if (!opts.execute) {
    log(`dry run: nothing written. To execute, pass --execute --expect ${summary.totalToChange} plus --target and --prod-host.`);
    return summary;
  }

  // 2. Execute gates.
  if (opts.expect !== summary.totalToChange) {
    return abort(`--expect ${opts.expect} but this run counts ${summary.totalToChange} rows to change`);
  }

  // 3. Backups (or, on resume, the ones already there).
  if (!opts.resume) {
    for (const t of tables) if (await db.backupExists(t)) return abort(`backup table ${t.backupName} already exists (use --resume to continue a run)`);
    const created: string[] = [];
    // A later table failing leaves the earlier backups in place; the operator decides what to do with them.
    const kept = () => (created.length ? `; backups already created and kept: ${created.join(", ")}` : "");
    for (const t of tables) {
      const where = BUCKETS.filter((b) => b.table === t).map((b) => `(${b.where})`).join(" OR ");
      let counts: { backedUp: number; inScope: number };
      try {
        counts = await db.createBackup(t, where);
      } catch (err) {
        return abort(`${err instanceof Error ? err.message : String(err)}${kept()}`);
      }
      log(`backup ${t.backupName}: ${counts.backedUp} rows (scope ${counts.inScope})`);
      if (counts.backedUp !== counts.inScope) return abort(`backup ${t.backupName} count ${counts.backedUp} != scope ${counts.inScope}${kept()}`);
      created.push(t.backupName);
    }
  }

  // 4. Write pass: only backed-up rows, only changed values, compare-and-swap.
  for (const b of BUCKETS) {
    const s = summary.buckets[b.name];
    for await (const r of rows(db, b, true)) {
      if (changedColumns(b, r).length === 0) continue;
      if (await db.writeRow(b, r, b.transform(r))) s.written++;
      else s.skippedChanged++;
    }
    summary.written += s.written;
    log(`${b.name}: written ${s.written}, skipped (changed since read) ${s.skippedChanged}`);
  }
  log(`TOTAL written: ${summary.written} of ${summary.totalToChange} counted. Re-run the dry run: it must report 0 to change.`);
  return summary;
}

// ---- command line ----------------------------------------------------------------------------

export interface Args {
  execute: boolean;
  resume: boolean;
  expect?: number;
  target?: "branch" | "prod";
  prodHost?: string;
}

export function parseArgs(argv: string[]): Args {
  const val = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const args: Args = { execute: argv.includes("--execute"), resume: argv.includes("--resume") };
  const expect = val("--expect");
  if (expect !== undefined) {
    if (!/^\d+$/.test(expect)) throw new Error("--expect takes the dry run's whole-number total");
    args.expect = Number(expect);
  }
  const target = val("--target");
  if (target !== undefined && target !== "branch" && target !== "prod") throw new Error("--target is branch or prod");
  args.target = target as Args["target"];
  args.prodHost = val("--prod-host");
  if (args.execute) {
    if (args.expect === undefined) throw new Error("--execute needs --expect <rows to change from the dry run>");
    if (!args.target) throw new Error("--execute needs --target branch|prod");
    if (!args.prodHost) throw new Error("--execute needs --prod-host <the production database host>");
  }
  return args;
}

/** null when the host matches the target, else the reason to refuse. */
export function checkTarget(target: "branch" | "prod", host: string, prodHost: string): string | null {
  if (target === "branch" && host === prodHost) return `--target branch but DATABASE_URL is the production host ${host}`;
  if (target === "prod" && host !== prodHost) return `--target prod but DATABASE_URL host ${host} is not the production host ${prodHost}`;
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (this script reads no .env file)");
  const host = new URL(url).host;
  console.log(`database host: ${host}`);
  console.log(`mode: ${args.execute ? `EXECUTE (${args.resume ? "resume, " : ""}target ${args.target})` : "DRY RUN, counting only"}`);
  if (args.execute) {
    const refusal = checkTarget(args.target!, host, args.prodHost!);
    if (refusal) throw new Error(refusal);
  }
  // Lazy: importing this module (tests) must not load Prisma.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const s = await run(prismaScrubDb(prisma), { execute: args.execute, expect: args.expect, resume: args.resume, log: (l) => console.log(l) });
    if (s.aborted) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("scrub failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
