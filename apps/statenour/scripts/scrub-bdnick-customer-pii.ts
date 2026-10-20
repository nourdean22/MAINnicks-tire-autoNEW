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
 *     any write), --target <branch|prod> and --db-host <host of the database you mean>. Production is
 *     PROD_ENDPOINT in this file, never a value from the command line: a branch run refuses on that
 *     endpoint (pooled or direct, any case, port or trailing dot), a prod run refuses on any other, and
 *     either refuses unless --db-host names the same endpoint as DATABASE_URL.
 *   - Before any update, one backup per table, all in ONE REPEATABLE READ transaction:
 *     CREATE TABLE "_bak_<table>_scrub_20261019" AS SELECT * FROM <table> WHERE <scope>, and each
 *     backup count must equal its scope count in that snapshot or every backup rolls back.
 *     An existing backup table is refused. No table is dropped or truncated; the only rows deleted
 *     are vector_embeddings rows the embed-backfill cron rebuilds (see vectorRow).
 *   - Updates touch only rows whose id is in the backup, only rows whose value changes, in batches
 *     of 500 by id, each as a compare-and-swap on the value read (a row changed meanwhile is skipped
 *     and counted). Raw SQL, so updatedAt is not bumped (an old coach event must not resurface).
 *   - Resume after a crash: --resume uses the existing backup tables instead of creating them.
 *   - Output is counts and ids only, never a value from a row.
 *
 *   DATABASE_URL=<branch url> pnpm exec tsx scripts/scrub-bdnick-customer-pii.ts                 # dry run
 *   DATABASE_URL=<branch url> pnpm exec tsx scripts/scrub-bdnick-customer-pii.ts --execute \
 *     --expect <n> --target branch --db-host <branch host>
 *
 * Restore one table: INSERT ... SELECT from its backup by id (operator). Drop a backup only after
 * the change is confirmed good (operator).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scrubBridgePayload, scrubText, stripSyncCustomerPii } from "../lib/brain/customer-pii";
import { hostFromDatabaseUrl } from "../prisma/seed-guard";

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
  vectors: { name: "vector_embeddings", ...bak("vector_embeddings") },
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
  /** For a row that changes: delete it instead of rewriting it (vector rows the backfill rebuilds). */
  deleteWhen?(row: Row): boolean;
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
 * business_metrics_sync: what POST /api/sync/business stores. ceo_business_context too: its writer
 * copies whole sub-objects (revenue, leads, intelligence, ...) out of the sync payload, and the
 * strip works per key at any depth, so stripping the old row equals building it from the stripped
 * payload (prioritizedActions come from counts the strip keeps). The strip is idempotent since
 * wave 3, so an already-stripped row comes back unchanged.
 */
const syncPayload = (row: Row) => ({ payload: stripSyncCustomerPii(row.payload) });

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

/** The same memory transforms, chosen by category and text alone (an orphan vector has no memory row). */
function scrubMemoryText(category: string, key: string, content: string): string {
  const row = { id: "", category, key, content };
  if (category === "business_event" && content.startsWith("Shop ")) return String(shopMemory(row).content);
  if (category === "anomaly" && content.startsWith("EMERGENCY: ")) return String(emergencyMemory(row).content);
  if (category === "business_event" || category === "insight") return String(leadCallMemory(row).content);
  return content;
}

/**
 * vector_embeddings rows of brain memories hold `[category] key: content` (memory-manager.ts remember()
 * and the embed-backfill cron both write that text) and a vector derived from it. The text is rescrubbed
 * from its own shape, so a vector whose text holds no customer shape is left alone, an orphan is handled
 * without its memory, and a run that crashed between the memory and the vector pass resumes correctly.
 *
 * Re-embed trigger: contentFingerprint is the tool_catalog cache key only. For brain_memory the
 * embed-backfill cron re-embeds (a) live memories (deleted_at IS NULL, confidence >= 0.2) with NO vector
 * row, and (b) rows whose vector text does not contain the memory's first 60 characters. Writing the
 * scrubbed text would satisfy (b) and storeGenericEmbedding's identical-content gate, so the old vector
 * would never be rebuilt. So a vector of a memory lane (a) covers is DELETED (the memory pass has already
 * scrubbed the memory, so the rebuild reads clean text); any other vector (orphan, soft-deleted, low
 * confidence: nothing would rebuild it) gets the scrubbed text and keeps its old vector.
 */
// The key ends at the first ": " (keys may hold a bare colon, e.g. coach:drift-recovery:x or a lead source).
const VECTOR_TEXT = /^\[([^\]]+)\] ([\s\S]*?): ([\s\S]*)$/;
function vectorRow(row: Row) {
  const m = VECTOR_TEXT.exec(String(row.content));
  if (!m) return { content: row.content };
  const next = scrubMemoryText(m[1], m[2], m[3]);
  return { content: next === m[3] ? row.content : `[${m[1]}] ${m[2]}: ${next}` };
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

const MEMORY_SCOPE = BUCKETS.filter((b) => b.table === TABLES.memories)
  .map((b) => `(${b.where})`)
  .join(" OR ");

// Last on purpose: the write pass scrubs the memories before it deletes their vectors, so the
// backfill can never re-embed the old text. Bucket categories are none of TELEMETRY_CATEGORIES, so
// the backfill's telemetry exclusion is left out of the eligibility test.
BUCKETS.push({
  name: "vectors_of_scrubbed_memories",
  table: TABLES.vectors,
  where:
    `"sourceType" = 'brain_memory' AND ("sourceId" IN (SELECT id FROM brain_memories WHERE ${MEMORY_SCOPE}) ` +
    `OR (NOT EXISTS (SELECT 1 FROM brain_memories bm WHERE bm.id = vector_embeddings."sourceId") ` +
    `AND (content LIKE '[business_event] %' OR content LIKE '[insight] %' OR content LIKE '[anomaly] %')))`,
  read: [
    "id",
    '"sourceId" AS "sourceId"',
    "content",
    `(SELECT bm.deleted_at IS NULL AND bm.confidence >= 0.2 FROM brain_memories bm WHERE bm.id = vector_embeddings."sourceId") AS "reembedEligible"`,
  ],
  write: [{ col: "content", json: false }],
  transform: vectorRow,
  deleteWhen: (row) => row.reembedEligible === true,
});

/** The write columns whose transformed value differs from the stored one. */
export function changedColumns(bucket: Bucket, row: Row): string[] {
  const next = bucket.transform(row);
  return bucket.write.filter((w) => stable(row[w.col]) !== stable(next[w.col])).map((w) => w.col);
}

// ---- database access -------------------------------------------------------------------------

export interface ScrubDb {
  readBatch(bucket: Bucket, afterId: string, limit: number, onlyBackedUp: boolean): Promise<Row[]>;
  backupExists(table: TableSpec): Promise<boolean>;
  /**
   * Creates every backup and counts both sides in ONE snapshot (one transaction); throws, rolling all of
   * them back, on any mismatch. Returns counts by table name.
   */
  createBackups(specs: Array<{ table: TableSpec; where: string }>): Promise<Record<string, { backedUp: number; inScope: number }>>;
  /** Compare-and-swap on the values read (update, or delete when `del`); false when the row changed meanwhile. */
  writeRow(bucket: Bucket, row: Row, next: Record<string, unknown>, del: boolean): Promise<boolean>;
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
    async createBackups(specs) {
      return db.$transaction(
        async (tx) => {
          const counts: Record<string, { backedUp: number; inScope: number }> = {};
          for (const { table: t, where } of specs) {
            await tx.$executeRawUnsafe(`CREATE TABLE ${t.backup} AS SELECT * FROM ${t.name} WHERE ${where}`);
            const [b] = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${t.backup}`);
            const [s] = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${t.name} WHERE ${where}`);
            counts[t.name] = { backedUp: Number(b?.n ?? -1), inScope: Number(s?.n ?? -2) };
            if (counts[t.name].backedUp !== counts[t.name].inScope) {
              throw new Error(`backup ${t.backupName} holds ${counts[t.name].backedUp} rows but scope has ${counts[t.name].inScope}; every backup rolled back`);
            }
          }
          return counts;
        },
        { isolationLevel: "RepeatableRead", timeout: 600_000, maxWait: 30_000 },
      );
    },
    async writeRow(b, row, next, del) {
      const params: unknown[] = [row.id];
      const guards = b.write.map((w) => {
        params.push(w.json ? jsonParam(row[w.col]) : row[w.col]);
        return `${w.col} IS NOT DISTINCT FROM $${params.length}${w.json ? "::jsonb" : ""}`;
      });
      if (del) {
        return (await db.$executeRawUnsafe(`DELETE FROM ${b.table.name} WHERE id = $1 AND ${guards.join(" AND ")}`, ...params)) === 1;
      }
      const sets = b.write.map((w) => {
        params.push(w.json ? jsonParam(next[w.col]) : next[w.col]);
        return `${w.col} = $${params.length}${w.json ? "::jsonb" : ""}`;
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
  buckets: Record<string, { inScope: number; toChange: number; toDelete: number; sampleIds: string[]; written: number; deleted: number; skippedChanged: number }>;
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
    const s = { inScope: 0, toChange: 0, toDelete: 0, sampleIds: [] as string[], written: 0, deleted: 0, skippedChanged: 0 };
    for await (const r of rows(db, b, onlyBackedUp)) {
      s.inScope++;
      if (changedColumns(b, r).length > 0) {
        s.toChange++;
        if (b.deleteWhen?.(r)) s.toDelete++;
        if (s.sampleIds.length < 5) s.sampleIds.push(r.id);
      }
    }
    summary.buckets[b.name] = s;
    summary.totalToChange += s.toChange;
    const dels = b.deleteWhen ? ` (of which ${s.toDelete} deleted for the embed-backfill to rebuild)` : "";
    log(`${b.name}: in scope ${s.inScope}, to change ${s.toChange}${dels}${s.sampleIds.length ? ` (e.g. ${s.sampleIds.join(", ")})` : ""}`);
  }
  log(`TOTAL rows to change: ${summary.totalToChange}`);

  if (!opts.execute) {
    log(`dry run: nothing written. To execute, pass --execute --expect ${summary.totalToChange} plus --target and --db-host.`);
    return summary;
  }

  // 2. Execute gates.
  if (opts.expect !== summary.totalToChange) {
    return abort(`--expect ${opts.expect} but this run counts ${summary.totalToChange} rows to change`);
  }

  // 3. Backups (or, on resume, the ones already there).
  if (!opts.resume) {
    for (const t of tables) if (await db.backupExists(t)) return abort(`backup table ${t.backupName} already exists (use --resume to continue a run)`);
    const specs = tables.map((t) => ({ table: t, where: BUCKETS.filter((b) => b.table === t).map((b) => `(${b.where})`).join(" OR ") }));
    let counts: Record<string, { backedUp: number; inScope: number }>;
    try {
      counts = await db.createBackups(specs);
    } catch (err) {
      return abort(err instanceof Error ? err.message : String(err));
    }
    for (const { table: t } of specs) {
      const c = counts[t.name];
      log(`backup ${t.backupName}: ${c?.backedUp} rows (scope ${c?.inScope})`);
      if (!c || c.backedUp !== c.inScope) return abort(`backup ${t.backupName} count ${c?.backedUp} != scope ${c?.inScope}`);
    }
  }

  // 4. Write pass: only backed-up rows, only changed values, compare-and-swap. Bucket order matters:
  // memories are scrubbed before their vectors are deleted.
  for (const b of BUCKETS) {
    const s = summary.buckets[b.name];
    for await (const r of rows(db, b, true)) {
      if (changedColumns(b, r).length === 0) continue;
      const del = b.deleteWhen?.(r) ?? false;
      if (await db.writeRow(b, r, b.transform(r), del)) {
        s.written++;
        if (del) s.deleted++;
      } else s.skippedChanged++;
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
  dbHost?: string;
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
  args.dbHost = val("--db-host");
  if (args.execute) {
    if (args.expect === undefined) throw new Error("--execute needs --expect <rows to change from the dry run>");
    if (!args.target) throw new Error("--execute needs --target branch|prod");
    if (!args.dbHost) throw new Error("--execute needs --db-host <the host of the database you mean to change>");
  }
  return args;
}

/**
 * The statenour production Neon compute, from the repo, never from the invocation (an operator-typed prod
 * host lets a typo pass a branch run on production). Already public on main: docs/CLOUD-ENVIRONMENT.md
 * and docs/audits/hour-frame-key-census-2026-08-27.md. If production moves, a prod run refuses until this
 * line is updated in a PR, which is the safe direction.
 */
export const PROD_ENDPOINT = "ep-quiet-wave-am320eo1";

/** Neon endpoint id: the first DNS label, lower case, pooler suffix dropped (pooled and direct reach one compute). */
export function endpointOf(host: string): string {
  return host.trim().toLowerCase().split(".")[0].replace(/-pooler$/, "");
}

/** null when DATABASE_URL may be written for this target, else the reason to refuse. */
export function checkTarget(target: "branch" | "prod", databaseUrl: string, dbHost: string): string | null {
  const host = hostFromDatabaseUrl(databaseUrl);
  if (!host) return "DATABASE_URL host cannot be read; refusing to write to an unnamed database";
  const ep = endpointOf(host);
  // The host parse is ambiguous when a query value holds "@"; a branch run refuses any URL naming production.
  if (target === "branch" && (ep === PROD_ENDPOINT || databaseUrl.toLowerCase().includes(PROD_ENDPOINT))) return `--target branch but DATABASE_URL is the production endpoint ${PROD_ENDPOINT}`;
  if (target === "prod" && ep !== PROD_ENDPOINT) return `--target prod but DATABASE_URL endpoint ${ep} is not the production endpoint ${PROD_ENDPOINT}`;
  // The operator names the database a second time; a stale or wrong DATABASE_URL disagrees with it.
  if (!dbHost || endpointOf(dbHost) !== ep) return `--db-host names endpoint ${endpointOf(dbHost ?? "") || "(none)"} but DATABASE_URL is endpoint ${ep}`;
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (this script reads no .env file)");
  console.log(`database host: ${hostFromDatabaseUrl(url) ?? "(unreadable)"}`);
  console.log(`mode: ${args.execute ? `EXECUTE (${args.resume ? "resume, " : ""}target ${args.target})` : "DRY RUN, counting only"}`);
  if (args.execute) {
    const refusal = checkTarget(args.target!, url, args.dbHost!);
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
