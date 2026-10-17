/**
 * Independent nightly TiDB backup (JOB 2026-10-17-tidb-independent-backup).
 *
 * Why: the free TiDB Cloud Starter tier keeps ONE day of backups, has no
 * point-in-time restore, and cannot restore a deleted instance. This job is
 * the only copy that survives either. Every proof here runs against an
 * in-memory source and an in-memory bucket; nothing connects to a database.
 * Everything is exercised through the module's production exports.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  backupTypeCast,
  createMysqlBackupSource,
  createS3BackupStore,
  runTidbBackup,
  type BackupSource,
  type BackupStore,
  type StoredObject,
  type TableSpec,
} from "./tidbBackup";

const PREFIX = "backups/tidb/";
// 03:40 ET on 2026-10-18 (EDT, UTC-4).
const NIGHT = new Date("2026-10-18T07:40:00Z");
const DAY = 86_400_000;
const noSleep = async () => {};

type FakeTable = { spec: TableSpec; rows: unknown[][] };

function makeTables(): Record<string, FakeTable> {
  const customers: unknown[][] = [];
  for (let i = 1; i <= 2500; i++) customers.push([String(i), `name-${i}`]);
  const plain = (ddl: string, cols: TableSpec["columns"], key: string[], rows: unknown[][]): FakeTable => ({
    spec: { ddl, columns: cols, keyColumns: key, hiddenRowId: key.length === 0, excludedColumns: [] },
    rows,
  });
  return {
    customers: plain("CREATE TABLE `customers` (`id` int NOT NULL, `name` varchar(64), PRIMARY KEY (`id`))",
      [{ name: "id", sqlType: "int", encoding: "text" }, { name: "name", sqlType: "varchar", encoding: "text" }], ["id"], customers),
    attachments: plain("CREATE TABLE `attachments` (`id` int NOT NULL, `data` blob, PRIMARY KEY (`id`))",
      [{ name: "id", sqlType: "int", encoding: "text" }, { name: "data", sqlType: "blob", encoding: "hex" }], ["id"], [["1", "00FF10"], ["2", null]]),
    // trailing value is _tidb_rowid
    scratch_nopk: plain("CREATE TABLE `scratch_nopk` (`note` varchar(10))",
      [{ name: "note", sqlType: "varchar", encoding: "text" }], [], [["a", "1"], ["b", "2"], ["c", "3"]]),
    search_performance: plain("CREATE TABLE `search_performance` (`id` int NOT NULL, PRIMARY KEY (`id`))",
      [{ name: "id", sqlType: "int", encoding: "text" }], ["id"], [["1"], ["2"]]),
    revenue_reconciliation_candidates: plain("CREATE TABLE `revenue_reconciliation_candidates` (`id` varchar(36) NOT NULL, PRIMARY KEY (`id`))",
      [{ name: "id", sqlType: "varchar", encoding: "text" }], ["id"], [["a"], ["b"]]),
  };
}

/** `failOn` fails every read of that table; `failTimes` limits it to the first N reads. */
function fakeSource(tables = makeTables(), opts: { failOn?: string; failTimes?: number } = {}) {
  const calls: Array<{ table: string; after: unknown[] | null; limit: number }> = [];
  let listed = 0;
  let failed = 0;
  const source: BackupSource = {
    database: "nickstire_fixture",
    async listTables() {
      listed++;
      return Object.keys(tables).sort();
    },
    async describeTable(t) {
      return tables[t].spec;
    },
    async readBatch(t, spec, after, limit) {
      calls.push({ table: t, after, limit });
      if (opts.failOn === t && (opts.failTimes === undefined || failed < opts.failTimes)) {
        failed++;
        throw new Error("Lost connection to MySQL server during query");
      }
      const keyIdx = spec.hiddenRowId ? [spec.columns.length] : spec.keyColumns.map((k) => spec.columns.findIndex((c) => c.name === k));
      const keyOf = (r: unknown[]) => keyIdx.map((i) => r[i]);
      const cmp = (a: unknown[], b: unknown[]) => {
        for (let i = 0; i < a.length; i++) {
          const nx = Number(a[i]), ny = Number(b[i]);
          const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : String(a[i]).localeCompare(String(b[i]));
          if (c !== 0) return c;
        }
        return 0;
      };
      return tables[t].rows.filter((r) => after === null || cmp(keyOf(r), after) > 0).sort((a, b) => cmp(keyOf(a), keyOf(b))).slice(0, limit);
    },
  };
  return { source, calls, listedCount: () => listed };
}

function fakeStore(seed: Record<string, Buffer> = {}, opts: { lieAboutSize?: string; removeThrows?: boolean } = {}) {
  const objects = new Map<string, Buffer>(Object.entries(seed));
  const removed: string[] = [];
  const store: BackupStore = {
    async put(key, body) {
      objects.set(key, Buffer.from(body));
    },
    async list(prefix) {
      return [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, b]): StoredObject => ({ key, size: opts.lieAboutSize && key.endsWith(`/${opts.lieAboutSize}.jsonl.gz`) ? b.length - 1 : b.length }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },
    async remove(key) {
      if (opts.removeThrows) throw new Error("AccessDenied: delete not permitted");
      removed.push(key);
      objects.delete(key);
    },
  };
  return { store, objects, removed };
}

const setPrefix = (date: string) => `${PREFIX}${date}/`;
const manifestOf = (objects: Map<string, Buffer>, date: string) => JSON.parse(objects.get(`${setPrefix(date)}manifest.json`)!.toString("utf8"));
const dateKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `days` complete sets ending at `today`; every 7th also holds a weekly table. */
function seedSets(days: number, today: string): Record<string, Buffer> {
  const seed: Record<string, Buffer> = {};
  const base = Date.parse(`${today}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const d = isoDay(base - i * DAY);
    seed[`${PREFIX}${d}/customers.jsonl.gz`] = Buffer.from("x");
    if (i % 7 === 0) seed[`${PREFIX}${d}/search_performance.jsonl.gz`] = Buffer.from("x");
    seed[`${PREFIX}${d}/manifest.json`] = Buffer.from("{}");
  }
  return seed;
}
const datesIn = (objects: Map<string, Buffer>) =>
  [...new Set([...objects.keys()].filter((k) => /^backups\/tidb\/\d{4}-\d{2}-\d{2}\//.test(k)).map((k) => k.split("/")[2]))].sort().reverse();

describe("runTidbBackup · one gzipped JSONL per table plus a manifest", () => {
  it("writes every table and the manifest under backups/tidb/<ET date>/", async () => {
    const { store, objects } = fakeStore();
    const out = await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT, batchSize: 1000, sleep: noSleep });
    const p = setPrefix("2026-10-18");
    expect([...objects.keys()].sort()).toEqual(
      ["attachments", "customers", "revenue_reconciliation_candidates", "scratch_nopk", "search_performance"]
        .map((t) => `${p}${t}.jsonl.gz`).concat(`${p}manifest.json`).sort(),
    );
    const lines = gunzipSync(objects.get(`${p}customers.jsonl.gz`)!).toString("utf8").trim().split("\n");
    expect(lines).toHaveLength(2500);
    expect(JSON.parse(lines[0])).toEqual(["1", "name-1"]);
    const m = manifestOf(objects, "2026-10-18");
    expect(m.date).toBe("2026-10-18");
    expect(typeof m.startedAt).toBe("string");
    expect(typeof m.finishedAt).toBe("string");
    const c = m.tables.find((t: { table: string }) => t.table === "customers");
    const gz = objects.get(`${p}customers.jsonl.gz`)!;
    expect(c).toMatchObject({ rows: 2500, bytes: gz.length, key: `${p}customers.jsonl.gz`, class: "nightly", excludedColumns: [] });
    expect(c.sha256).toBe(createHash("sha256").update(gz).digest("hex"));
    expect(c.ddl).toContain("CREATE TABLE `customers`");
    expect(out.recordsProcessed).toBe(2500 + 2 + 3 + 2 + 2);
  });

  it("pages by key with a bounded LIMIT and reads each row once", async () => {
    const { source, calls } = fakeSource();
    await runTidbBackup({ source, store: fakeStore().store, now: () => NIGHT, batchSize: 1000, sleep: noSleep });
    expect(calls.filter((c) => c.table === "customers").map((c) => c.after)).toEqual([null, ["1000"], ["2000"]]);
    expect(calls.every((c) => c.limit === 1000)).toBe(true);
  });

  it("a table without a primary key pages on _tidb_rowid and the rowid is not written", async () => {
    const { source, calls } = fakeSource();
    const { store, objects } = fakeStore();
    await runTidbBackup({ source, store, now: () => NIGHT, batchSize: 2, sleep: noSleep });
    expect(calls.filter((c) => c.table === "scratch_nopk").map((c) => c.after)).toEqual([null, ["2"]]);
    const lines = gunzipSync(objects.get(`${setPrefix("2026-10-18")}scratch_nopk.jsonl.gz`)!).toString().trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("binary columns stay hex in the file and the manifest records the encoding", async () => {
    const { store, objects } = fakeStore();
    await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT, sleep: noSleep });
    const a = manifestOf(objects, "2026-10-18").tables.find((t: { table: string }) => t.table === "attachments");
    expect(a.columns[1]).toEqual({ name: "data", sqlType: "blob", encoding: "hex" });
    const lines = gunzipSync(objects.get(`${setPrefix("2026-10-18")}attachments.jsonl.gz`)!).toString().trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([["1", "00FF10"], ["2", null]]);
  });
});

describe("table classes · derived large tables are weekly, with the reason and the set that holds them", () => {
  it("names exactly the two derived tables as weekly, everything else nightly", async () => {
    const { store, objects } = fakeStore();
    await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT, sleep: noSleep });
    const m = manifestOf(objects, "2026-10-18");
    expect(m.tables.filter((t: { class: string }) => t.class === "weekly").map((t: { table: string }) => t.table).sort())
      .toEqual(["revenue_reconciliation_candidates", "search_performance"]);
    expect(m.tables.filter((t: { class: string }) => t.class === "nightly")).toHaveLength(3);
  });

  it("first run takes weekly tables; 3 days later they are skipped with the set that holds them; 7 days later taken again", async () => {
    const { store, objects } = fakeStore();
    await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT, sleep: noSleep });
    const d3 = new Date(NIGHT.getTime() + 3 * DAY);
    await runTidbBackup({ source: fakeSource().source, store, now: () => d3, sleep: noSleep });
    const m3 = manifestOf(objects, dateKey(d3));
    expect(m3.tables.map((t: { table: string }) => t.table)).not.toContain("search_performance");
    expect(m3.skipped.map((s: { table: string; lastSet: string }) => [s.table, s.lastSet]).sort()).toEqual([
      ["revenue_reconciliation_candidates", "2026-10-18"],
      ["search_performance", "2026-10-18"],
    ]);
    for (const sk of m3.skipped) expect(sk.reason).toMatch(/derived|re-fetch/);
    const d7 = new Date(NIGHT.getTime() + 7 * DAY);
    await runTidbBackup({ source: fakeSource().source, store, now: () => d7, sleep: noSleep });
    const m7 = manifestOf(objects, dateKey(d7));
    expect(m7.tables.find((t: { table: string }) => t.table === "search_performance")).toMatchObject({ class: "weekly" });
    expect(m7.skipped).toEqual([]);
  });
});

describe("completion, not ran · success means every file is in the bucket at its recorded size", () => {
  it("a table that keeps failing marks the run FAILED with the table named after 2 retries, and no manifest is written", async () => {
    const sleeps: number[] = [];
    const { source, calls } = fakeSource(makeTables(), { failOn: "customers" });
    const { store, objects } = fakeStore();
    await expect(runTidbBackup({ source, store, now: () => NIGHT, sleep: async (ms) => { sleeps.push(ms); } })).rejects.toThrow(/FAILED[\s\S]*customers/);
    expect(calls.filter((c) => c.table === "customers")).toHaveLength(3);
    expect(sleeps).toEqual([10_000, 30_000]);
    expect(objects.has(`${setPrefix("2026-10-18")}manifest.json`)).toBe(false);
    expect(objects.has(`${setPrefix("2026-10-18")}attachments.jsonl.gz`)).toBe(true);
  });

  it("a transient table error is retried and the night completes (fix 2)", async () => {
    const sleeps: number[] = [];
    const { source } = fakeSource(makeTables(), { failOn: "customers", failTimes: 1 });
    const { store, objects } = fakeStore();
    const out = await runTidbBackup({ source, store, now: () => NIGHT, sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([10_000]);
    expect(out.recordsProcessed).toBe(2509);
    const c = manifestOf(objects, "2026-10-18").tables.find((t: { table: string }) => t.table === "customers");
    expect(c.rows).toBe(2500);
  });

  it("a dead connection stops the run after 3 tables in a row fail, instead of retrying every table past the budget", async () => {
    const sleeps: number[] = [];
    const { source, calls } = fakeSource();
    source.readBatch = async (t) => { calls.push({ table: t, after: null, limit: 0 }); throw new Error("Connection lost: The server closed the connection."); };
    const { store, objects } = fakeStore();
    await expect(runTidbBackup({ source, store, now: () => NIGHT, sleep: async (ms) => { sleeps.push(ms); } })).rejects.toThrow(/stopped after 3 consecutive/);
    expect(new Set(calls.map((c) => c.table)).size).toBe(3);
    expect(calls).toHaveLength(9);
    expect(objects.has(`${setPrefix("2026-10-18")}manifest.json`)).toBe(false);
  });

  it("an upload the bucket listing does not confirm fails the run, naming the table", async () => {
    const { store, objects } = fakeStore({}, { lieAboutSize: "attachments" });
    await expect(runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT, sleep: noSleep })).rejects.toThrow(/attachments/);
    expect(objects.has(`${setPrefix("2026-10-18")}manifest.json`)).toBe(false);
  });

  it("a night whose manifest already exists is a no-op (second replica, retry or manual re-run)", async () => {
    const { source, listedCount } = fakeSource();
    const { store } = fakeStore({ [`${setPrefix("2026-10-18")}manifest.json`]: Buffer.from("{}") });
    const out = await runTidbBackup({ source, store, now: () => NIGHT, sleep: noSleep });
    expect(listedCount()).toBe(0);
    expect(out).toMatchObject({ recordsProcessed: 0 });
    expect(out.details).toMatch(/already complete/);
  });
});

describe("retention · 14 daily + 8 weekly sets, never anything outside backups/tidb/<date>/", () => {
  it("keeps the 14 newest sets plus the 8 newest weekly sets and deletes the rest", async () => {
    const { store, objects } = fakeStore(seedSets(90, "2026-10-17"));
    await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT, sleep: noSleep });
    const daily = Array.from({ length: 14 }, (_, i) => isoDay(Date.UTC(2026, 9, 18) - i * DAY));
    // Tonight's set is weekly too: no seeded set holds revenue_reconciliation_candidates, so it is due.
    const weekly = ["2026-10-18", ...Array.from({ length: 7 }, (_, i) => isoDay(Date.UTC(2026, 9, 17) - i * 7 * DAY))];
    expect(datesIn(objects)).toEqual([...new Set([...daily, ...weekly])].sort().reverse());
  });

  it("never deletes keys outside backups/tidb/<date>/, and drops an older incomplete set", async () => {
    const seed = {
      ...seedSets(30, "2026-10-17"),
      "generated/reel-1290001.mp4": Buffer.from("x"),
      "backups/other/2020-01-01/x.gz": Buffer.from("x"),
      [`${PREFIX}README.txt`]: Buffer.from("x"),
      [`${PREFIX}2020-01-01-notes/x`]: Buffer.from("x"),
      [`${PREFIX}2026-10-16/orphan.jsonl.gz`]: Buffer.from("x"),
    };
    delete seed[`${PREFIX}2026-10-16/manifest.json`];
    const { store, objects, removed } = fakeStore(seed);
    await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT, sleep: noSleep });
    expect(removed.length).toBeGreaterThan(0);
    for (const k of removed) expect(k).toMatch(/^backups\/tidb\/\d{4}-\d{2}-\d{2}\//);
    for (const k of ["generated/reel-1290001.mp4", "backups/other/2020-01-01/x.gz", `${PREFIX}README.txt`, `${PREFIX}2020-01-01-notes/x`]) {
      expect(objects.has(k), k).toBe(true);
    }
    expect(objects.has(`${PREFIX}2026-10-16/orphan.jsonl.gz`)).toBe(false);
  });

  it("a retention delete error after a verified set completes the run with a warning (fix 4)", async () => {
    const { store, objects } = fakeStore(seedSets(30, "2026-10-17"), { removeThrows: true });
    const out = await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT, sleep: noSleep });
    expect(objects.has(`${setPrefix("2026-10-18")}manifest.json`)).toBe(true);
    expect(out.details).toMatch(/WARNING: retention failed/);
    expect(out.details).toMatch(/AccessDenied/);
  });

  it("control: a real table failure still fails the run even when retention would also fail", async () => {
    const { store } = fakeStore(seedSets(30, "2026-10-17"), { removeThrows: true });
    const { source } = fakeSource(makeTables(), { failOn: "customers" });
    await expect(runTidbBackup({ source, store, now: () => NIGHT, sleep: noSleep })).rejects.toThrow(/FAILED[\s\S]*customers/);
  });
});

describe("S3 store adapter · private objects, prefix-guarded deletes", () => {
  function fakeClient(pages: Array<{ Contents: Array<{ Key: string; Size: number }>; NextContinuationToken?: string }> = []) {
    const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
    let page = 0;
    return {
      sent,
      client: {
        async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
          sent.push({ name: cmd.constructor.name, input: cmd.input });
          if (cmd.constructor.name === "ListObjectsV2Command") {
            const p = pages[page++] ?? { Contents: [] };
            return { Contents: p.Contents, IsTruncated: !!p.NextContinuationToken, NextContinuationToken: p.NextContinuationToken };
          }
          return {};
        },
      },
    };
  }

  it("put sends a private PutObject (no ACL) to the configured bucket", async () => {
    const { client, sent } = fakeClient();
    await createS3BackupStore(client, "bucket-x").put(`${PREFIX}2026-10-18/manifest.json`, Buffer.from("{}"), "application/json");
    expect(sent[0].name).toBe("PutObjectCommand");
    expect(sent[0].input).toMatchObject({ Bucket: "bucket-x", Key: `${PREFIX}2026-10-18/manifest.json`, ContentType: "application/json" });
    expect(sent[0].input).not.toHaveProperty("ACL");
  });

  it("list follows continuation tokens", async () => {
    const { client, sent } = fakeClient([
      { Contents: [{ Key: `${PREFIX}a`, Size: 1 }], NextContinuationToken: "t1" },
      { Contents: [{ Key: `${PREFIX}b`, Size: 2 }] },
    ]);
    expect(await createS3BackupStore(client, "bucket-x").list(PREFIX)).toEqual([{ key: `${PREFIX}a`, size: 1 }, { key: `${PREFIX}b`, size: 2 }]);
    expect(sent[1].input).toMatchObject({ ContinuationToken: "t1", Prefix: PREFIX });
  });

  it("remove refuses any key outside backups/tidb/<date>/ before sending anything", async () => {
    const { client, sent } = fakeClient();
    const s = createS3BackupStore(client, "bucket-x");
    for (const k of ["generated/reel-1.mp4", "backups/other/2026-10-01/x", `${PREFIX}README.txt`, `${PREFIX}../generated/x`]) {
      await expect(s.remove(k)).rejects.toThrow(/refus/i);
    }
    expect(sent).toHaveLength(0);
    await s.remove(`${PREFIX}2026-10-01/customers.jsonl.gz`);
    expect(sent).toEqual([{ name: "DeleteObjectCommand", input: { Bucket: "bucket-x", Key: `${PREFIX}2026-10-01/customers.jsonl.gz` } }]);
  });
});

describe("mysql source · column selection and SQL shape (fake connection, no database)", () => {
  type Col = { name: string; sqlType: string; extra: string };
  function fakeConn(columns: Col[], pk: string[]) {
    const calls: Array<{ sql: string; values?: unknown[]; rowsAsArray?: boolean }> = [];
    const conn = {
      async query(opts: { sql: string; values?: unknown[]; rowsAsArray?: boolean }) {
        calls.push(opts);
        if (opts.sql.startsWith("SHOW CREATE TABLE")) return [[{ "Create Table": "CREATE TABLE `t` (`id` int)" }], []];
        if (opts.sql.includes("information_schema.COLUMNS")) return [columns, []];
        if (opts.sql.includes("information_schema.STATISTICS")) return [pk.map((name) => ({ name })), []];
        return [[], []];
      },
    };
    return { conn, calls };
  }

  it("keeps DEFAULT_GENERATED columns: timestamps with DEFAULT now() and expression-default keys (fix 1)", async () => {
    const { conn } = fakeConn(
      [
        { name: "id", sqlType: "varchar", extra: "DEFAULT_GENERATED" },
        { name: "createdAt", sqlType: "timestamp", extra: "DEFAULT_GENERATED" },
        { name: "updatedAt", sqlType: "timestamp", extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP" },
        { name: "note", sqlType: "text", extra: "" },
      ],
      ["id"],
    );
    const spec = await createMysqlBackupSource(conn, "db").describeTable("orders");
    expect(spec.columns.map((c) => c.name)).toEqual(["id", "createdAt", "updatedAt", "note"]);
    expect(spec.keyColumns).toEqual(["id"]);
    expect(spec.excludedColumns).toEqual([]);
  });

  it("control: true VIRTUAL and STORED generated columns are excluded, and the manifest says which and why", async () => {
    const { conn } = fakeConn(
      [
        { name: "id", sqlType: "int", extra: "auto_increment" },
        { name: "phone_norm", sqlType: "varchar", extra: "VIRTUAL GENERATED" },
        { name: "total_cents", sqlType: "int", extra: "STORED GENERATED" },
      ],
      ["id"],
    );
    const spec = await createMysqlBackupSource(conn, "db").describeTable("orders");
    expect(spec.columns.map((c) => c.name)).toEqual(["id"]);
    expect(spec.excludedColumns.map((c) => c.name)).toEqual(["phone_norm", "total_cents"]);
    expect(spec.excludedColumns[0].reason).toMatch(/VIRTUAL GENERATED/);
  });

  it("reads keyset pages: named columns, no SELECT *, bounded LIMIT, strictly after the last key", async () => {
    const { conn, calls } = fakeConn([], []);
    const src = createMysqlBackupSource(conn, "db");
    const spec: TableSpec = {
      ddl: "",
      columns: [{ name: "id", sqlType: "int", encoding: "text" }, { name: "payload", sqlType: "json", encoding: "text" }, { name: "raw", sqlType: "varbinary", encoding: "hex" }],
      keyColumns: ["id"],
      hiddenRowId: false,
      excludedColumns: [],
    };
    await src.readBatch("invoices", spec, null, 500);
    await src.readBatch("invoices", spec, ["41"], 500);
    await src.readBatch("t", { ...spec, keyColumns: ["id", "raw"] }, ["1", "AB"], 10);
    await src.readBatch("t", { ...spec, keyColumns: [], hiddenRowId: true }, ["9"], 10);
    await src.readBatch("we`ird", spec, null, 1);
    const [first, second, composite, noPk, weird] = calls;
    expect(first.sql).not.toMatch(/SELECT\s+\*/i);
    expect(first.sql).toMatch(/LIMIT 500$/);
    expect(first.sql).toContain("ORDER BY `id`");
    expect(first.sql).not.toMatch(/WHERE/);
    expect(first.sql).toContain("CAST(`payload` AS CHAR) AS `payload`");
    expect(first.sql).toContain("HEX(`raw`) AS `raw`");
    expect(first.rowsAsArray).toBe(true);
    expect(second.sql).toContain("WHERE `id` > ?");
    expect(second.values).toEqual(["41"]);
    expect(composite.sql).toContain("WHERE (`id`, `raw`) > (?, UNHEX(?))");
    expect(noPk.sql).toContain("WHERE _tidb_rowid > ?");
    expect(weird.sql).toContain("FROM `we``ird`");
  });
});

describe("backupTypeCast · every value arrives as text, JSON as utf8", () => {
  it("reads JSON fields as utf8 and everything else with its own encoding", () => {
    const seen: unknown[] = [];
    const field = (type: string) => ({ type, string: (enc?: string) => { seen.push([type, enc]); return "v"; }, buffer: () => Buffer.from("") });
    expect(backupTypeCast(field("JSON") as never, () => null)).toBe("v");
    expect(backupTypeCast(field("DATETIME") as never, () => null)).toBe("v");
    expect(seen).toEqual([["JSON", "utf8"], ["DATETIME", undefined]]);
  });
});
