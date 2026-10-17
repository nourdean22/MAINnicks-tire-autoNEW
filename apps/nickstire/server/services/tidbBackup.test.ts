/**
 * Independent nightly TiDB backup (JOB 2026-10-17-tidb-independent-backup).
 *
 * Why: the free TiDB Cloud Starter tier keeps ONE day of backups, has no
 * point-in-time restore, and cannot restore a deleted instance. This job is
 * the only copy that survives either. Every proof here runs against an
 * in-memory source and an in-memory bucket; nothing connects to a database.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  BACKUP_PREFIX,
  backupTypeCast,
  buildBatchQuery,
  createS3BackupStore,
  planRetention,
  runTidbBackup,
  type BackupSource,
  type BackupStore,
  type StoredObject,
  type TableSpec,
} from "./tidbBackup";

// 03:40 ET on 2026-10-18 (EDT, UTC-4).
const NIGHT = new Date("2026-10-18T07:40:00Z");
const DAY = 86_400_000;

type FakeTable = { spec: TableSpec; rows: unknown[][] };

function makeTables(): Record<string, FakeTable> {
  const customers: unknown[][] = [];
  for (let i = 1; i <= 2500; i++) customers.push([String(i), `name-${i}`]);
  return {
    customers: {
      spec: {
        ddl: "CREATE TABLE `customers` (`id` int NOT NULL, `name` varchar(64), PRIMARY KEY (`id`))",
        columns: [{ name: "id", sqlType: "int", encoding: "text" }, { name: "name", sqlType: "varchar", encoding: "text" }],
        keyColumns: ["id"],
        hiddenRowId: false,
      },
      rows: customers,
    },
    attachments: {
      spec: {
        ddl: "CREATE TABLE `attachments` (`id` int NOT NULL, `data` blob, PRIMARY KEY (`id`))",
        columns: [{ name: "id", sqlType: "int", encoding: "text" }, { name: "data", sqlType: "blob", encoding: "hex" }],
        keyColumns: ["id"],
        hiddenRowId: false,
      },
      rows: [["1", "00FF10"], ["2", null]],
    },
    scratch_nopk: {
      spec: {
        ddl: "CREATE TABLE `scratch_nopk` (`note` varchar(10))",
        columns: [{ name: "note", sqlType: "varchar", encoding: "text" }],
        keyColumns: [],
        hiddenRowId: true,
      },
      // trailing value is _tidb_rowid
      rows: [["a", "1"], ["b", "2"], ["c", "3"]],
    },
    search_performance: {
      spec: {
        ddl: "CREATE TABLE `search_performance` (`id` int NOT NULL, PRIMARY KEY (`id`))",
        columns: [{ name: "id", sqlType: "int", encoding: "text" }],
        keyColumns: ["id"],
        hiddenRowId: false,
      },
      rows: [["1"], ["2"]],
    },
    revenue_reconciliation_candidates: {
      spec: {
        ddl: "CREATE TABLE `revenue_reconciliation_candidates` (`id` varchar(36) NOT NULL, PRIMARY KEY (`id`))",
        columns: [{ name: "id", sqlType: "varchar", encoding: "text" }],
        keyColumns: ["id"],
        hiddenRowId: false,
      },
      rows: [["a"], ["b"]],
    },
  };
}

function fakeSource(tables = makeTables(), opts: { failOn?: string } = {}) {
  const calls: Array<{ table: string; after: unknown[] | null; limit: number }> = [];
  let listed = 0;
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
      if (opts.failOn === t) throw new Error("Lost connection to MySQL server during query");
      const keyIdx = spec.hiddenRowId
        ? [spec.columns.length]
        : spec.keyColumns.map((k) => spec.columns.findIndex((c) => c.name === k));
      const keyOf = (r: unknown[]) => keyIdx.map((i) => r[i]);
      const cmp = (a: unknown[], b: unknown[]) => {
        for (let i = 0; i < a.length; i++) {
          const x = a[i], y = b[i];
          const nx = Number(x), ny = Number(y);
          const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : String(x).localeCompare(String(y));
          if (c !== 0) return c;
        }
        return 0;
      };
      return tables[t].rows
        .filter((r) => after === null || cmp(keyOf(r), after) > 0)
        .sort((a, b) => cmp(keyOf(a), keyOf(b)))
        .slice(0, limit);
    },
  };
  return { source, calls, listedCount: () => listed };
}

function fakeStore(seed: Record<string, Buffer> = {}, opts: { lieAboutSize?: string } = {}) {
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
      removed.push(key);
      objects.delete(key);
    },
  };
  return { store, objects, removed };
}

const setPrefix = (date: string) => `${BACKUP_PREFIX}${date}/`;
const manifestOf = (objects: Map<string, Buffer>, date: string) =>
  JSON.parse(objects.get(`${setPrefix(date)}manifest.json`)!.toString("utf8"));
const dateKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

describe("runTidbBackup · one gzipped JSONL per table plus a manifest", () => {
  it("writes every table and the manifest under backups/tidb/<ET date>/", async () => {
    const { source } = fakeSource();
    const { store, objects } = fakeStore();
    const out = await runTidbBackup({ source, store, now: () => NIGHT, batchSize: 1000 });

    const p = setPrefix("2026-10-18");
    expect([...objects.keys()].sort()).toEqual(
      [
        "attachments", "customers", "revenue_reconciliation_candidates", "scratch_nopk", "search_performance",
      ].map((t) => `${p}${t}.jsonl.gz`).concat(`${p}manifest.json`).sort(),
    );
    const lines = gunzipSync(objects.get(`${p}customers.jsonl.gz`)!).toString("utf8").trim().split("\n");
    expect(lines).toHaveLength(2500);
    expect(JSON.parse(lines[0])).toEqual(["1", "name-1"]);
    expect(JSON.parse(lines[2499])).toEqual(["2500", "name-2500"]);

    const m = manifestOf(objects, "2026-10-18");
    expect(m.date).toBe("2026-10-18");
    expect(m.jobVersion).toBeGreaterThanOrEqual(1);
    expect(typeof m.startedAt).toBe("string");
    expect(typeof m.finishedAt).toBe("string");
    const c = m.tables.find((t: { table: string }) => t.table === "customers");
    const gz = objects.get(`${p}customers.jsonl.gz`)!;
    expect(c).toMatchObject({ rows: 2500, bytes: gz.length, key: `${p}customers.jsonl.gz`, class: "nightly" });
    expect(c.sha256).toBe(createHash("sha256").update(gz).digest("hex"));
    expect(c.ddl).toContain("CREATE TABLE `customers`");
    expect(c.columns.map((x: { name: string }) => x.name)).toEqual(["id", "name"]);
    expect(out.recordsProcessed).toBe(2500 + 2 + 3 + 2 + 2);
  });

  it("pages by key with a bounded LIMIT and reads each row once", async () => {
    const { source, calls } = fakeSource();
    const { store } = fakeStore();
    await runTidbBackup({ source, store, now: () => NIGHT, batchSize: 1000 });
    const cust = calls.filter((c) => c.table === "customers");
    expect(cust.map((c) => c.after)).toEqual([null, ["1000"], ["2000"]]);
    expect(calls.every((c) => c.limit === 1000)).toBe(true);
  });

  it("a table without a primary key pages on _tidb_rowid and the rowid is not written", async () => {
    const { source, calls } = fakeSource();
    const { store, objects } = fakeStore();
    await runTidbBackup({ source, store, now: () => NIGHT, batchSize: 2 });
    expect(calls.filter((c) => c.table === "scratch_nopk").map((c) => c.after)).toEqual([null, ["2"]]);
    const lines = gunzipSync(objects.get(`${setPrefix("2026-10-18")}scratch_nopk.jsonl.gz`)!).toString().trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("binary columns stay hex in the file and the manifest records the encoding", async () => {
    const { source } = fakeSource();
    const { store, objects } = fakeStore();
    await runTidbBackup({ source, store, now: () => NIGHT });
    const m = manifestOf(objects, "2026-10-18");
    const a = m.tables.find((t: { table: string }) => t.table === "attachments");
    expect(a.columns[1]).toEqual({ name: "data", sqlType: "blob", encoding: "hex" });
    const lines = gunzipSync(objects.get(`${setPrefix("2026-10-18")}attachments.jsonl.gz`)!).toString().trim().split("\n");
    expect(JSON.parse(lines[0])).toEqual(["1", "00FF10"]);
    expect(JSON.parse(lines[1])).toEqual(["2", null]);
  });
});

describe("table classes · derived large tables are weekly, with the reason in the manifest", () => {
  it("names exactly the two derived tables as weekly, everything else nightly", async () => {
    const { store, objects } = fakeStore();
    await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT });
    const m = manifestOf(objects, "2026-10-18");
    const weekly = m.tables.filter((t: { class: string }) => t.class === "weekly").map((t: { table: string }) => t.table).sort();
    expect(weekly).toEqual(["revenue_reconciliation_candidates", "search_performance"]);
    expect(m.tables.filter((t: { class: string }) => t.class === "nightly")).toHaveLength(3);
  });

  it("first run takes weekly tables; a run 3 days later skips them with a reason; 7 days later takes them again", async () => {
    const { store, objects } = fakeStore();
    await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT });
    const d3 = new Date(NIGHT.getTime() + 3 * DAY);
    await runTidbBackup({ source: fakeSource().source, store, now: () => d3 });
    const m3 = manifestOf(objects, dateKey(d3));
    expect(m3.tables.map((t: { table: string }) => t.table)).not.toContain("search_performance");
    expect(m3.skipped.map((s: { table: string }) => s.table).sort()).toEqual(["revenue_reconciliation_candidates", "search_performance"]);
    expect(m3.skipped[0].reason).toMatch(/2026-10-18/);
    for (const sk of m3.skipped) expect(sk.reason).toMatch(/derived|re-fetch/);
    expect(objects.has(`${setPrefix(dateKey(d3))}search_performance.jsonl.gz`)).toBe(false);

    const d7 = new Date(NIGHT.getTime() + 7 * DAY);
    await runTidbBackup({ source: fakeSource().source, store, now: () => d7 });
    const m7 = manifestOf(objects, dateKey(d7));
    expect(m7.tables.find((t: { table: string }) => t.table === "search_performance")).toMatchObject({ class: "weekly" });
    expect(m7.skipped).toEqual([]);
  });
});

describe("completion, not ran · success means every file is in the bucket at its recorded size", () => {
  it("a table that fails marks the run FAILED with the table named, and no manifest is written", async () => {
    const { source } = fakeSource(makeTables(), { failOn: "customers" });
    const { store, objects } = fakeStore();
    await expect(runTidbBackup({ source, store, now: () => NIGHT })).rejects.toThrow(/FAILED[\s\S]*customers/);
    expect(objects.has(`${setPrefix("2026-10-18")}manifest.json`)).toBe(false);
    // the other tables were still attempted
    expect(objects.has(`${setPrefix("2026-10-18")}attachments.jsonl.gz`)).toBe(true);
  });

  it("an upload the bucket listing does not confirm fails the run, naming the table", async () => {
    const { source } = fakeSource();
    const { store, objects } = fakeStore({}, { lieAboutSize: "attachments" });
    await expect(runTidbBackup({ source, store, now: () => NIGHT })).rejects.toThrow(/attachments/);
    expect(objects.has(`${setPrefix("2026-10-18")}manifest.json`)).toBe(false);
  });

  it("a night whose manifest already exists is a no-op (second replica or manual re-run)", async () => {
    const seeded = { [`${setPrefix("2026-10-18")}manifest.json`]: Buffer.from("{}") };
    const { source, listedCount } = fakeSource();
    const { store } = fakeStore(seeded);
    const out = await runTidbBackup({ source, store, now: () => NIGHT });
    expect(listedCount()).toBe(0);
    expect(out.recordsProcessed).toBe(0);
    expect(out.details).toMatch(/already complete/);
  });
});

describe("retention · 14 daily + 8 weekly sets, never anything outside backups/tidb/", () => {
  function bucketWithSets(days: number, today: string) {
    const keys: StoredObject[] = [];
    const base = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
    for (let i = 0; i < days; i++) {
      const d = new Date(base - i * DAY).toISOString().slice(0, 10);
      keys.push({ key: `${BACKUP_PREFIX}${d}/customers.jsonl.gz`, size: 10 });
      if (i % 7 === 0) keys.push({ key: `${BACKUP_PREFIX}${d}/search_performance.jsonl.gz`, size: 10 });
      keys.push({ key: `${BACKUP_PREFIX}${d}/manifest.json`, size: 10 });
    }
    return keys;
  }

  it("keeps the 14 newest sets plus the 8 newest weekly sets and deletes the rest", () => {
    const listing = bucketWithSets(90, "2026-10-18");
    const del = new Set(planRetention(listing, "2026-10-18"));
    const keptDates = [...new Set(listing.filter((o) => !del.has(o.key)).map((o) => o.key.split("/")[2]))].sort().reverse();
    const daily = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 9, 18) - i * DAY).toISOString().slice(0, 10));
    const weekly = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 9, 18) - i * 7 * DAY).toISOString().slice(0, 10));
    expect(keptDates).toEqual([...new Set([...daily, ...weekly])].sort().reverse());
  });

  it("never plans a delete outside backups/tidb/<date>/ even when the listing holds such keys", () => {
    const listing = [
      ...bucketWithSets(40, "2026-10-18"),
      { key: "generated/reel-1290001.mp4", size: 5 },
      { key: "backups/other/2020-01-01/x.gz", size: 5 },
      { key: `${BACKUP_PREFIX}README.txt`, size: 5 },
      { key: `${BACKUP_PREFIX}2020-01-01-notes/x`, size: 5 },
    ];
    const del = planRetention(listing, "2026-10-18");
    expect(del.length).toBeGreaterThan(0);
    for (const k of del) expect(k).toMatch(/^backups\/tidb\/\d{4}-\d{2}-\d{2}\//);
    expect(del).not.toContain("generated/reel-1290001.mp4");
    expect(del).not.toContain(`${BACKUP_PREFIX}README.txt`);
  });

  it("an incomplete set older than the newest complete one is deleted; a newer one is kept", () => {
    const listing: StoredObject[] = [
      { key: `${BACKUP_PREFIX}2026-10-16/customers.jsonl.gz`, size: 1 },
      { key: `${BACKUP_PREFIX}2026-10-17/customers.jsonl.gz`, size: 1 },
      { key: `${BACKUP_PREFIX}2026-10-17/manifest.json`, size: 1 },
      { key: `${BACKUP_PREFIX}2026-10-18/customers.jsonl.gz`, size: 1 },
    ];
    expect(planRetention(listing, "2026-10-19")).toEqual([`${BACKUP_PREFIX}2026-10-16/customers.jsonl.gz`]);
  });

  it("a real run deletes only planned keys and leaves foreign keys in the bucket alone", async () => {
    const seed: Record<string, Buffer> = { "generated/reel-1290001.mp4": Buffer.from("x") };
    for (const o of bucketWithSets(30, "2026-10-17")) seed[o.key] = Buffer.from("x");
    const { store, objects, removed } = fakeStore(seed);
    await runTidbBackup({ source: fakeSource().source, store, now: () => NIGHT });
    expect(objects.has("generated/reel-1290001.mp4")).toBe(true);
    expect(removed.length).toBeGreaterThan(0);
    for (const k of removed) expect(k.startsWith(BACKUP_PREFIX)).toBe(true);
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
    await createS3BackupStore(client, "bucket-x").put(`${BACKUP_PREFIX}2026-10-18/manifest.json`, Buffer.from("{}"), "application/json");
    expect(sent[0].name).toBe("PutObjectCommand");
    expect(sent[0].input).toMatchObject({ Bucket: "bucket-x", Key: `${BACKUP_PREFIX}2026-10-18/manifest.json`, ContentType: "application/json" });
    expect(sent[0].input).not.toHaveProperty("ACL");
  });

  it("list follows continuation tokens", async () => {
    const { client, sent } = fakeClient([
      { Contents: [{ Key: `${BACKUP_PREFIX}a`, Size: 1 }], NextContinuationToken: "t1" },
      { Contents: [{ Key: `${BACKUP_PREFIX}b`, Size: 2 }] },
    ]);
    const out = await createS3BackupStore(client, "bucket-x").list(BACKUP_PREFIX);
    expect(out).toEqual([{ key: `${BACKUP_PREFIX}a`, size: 1 }, { key: `${BACKUP_PREFIX}b`, size: 2 }]);
    expect(sent[1].input).toMatchObject({ ContinuationToken: "t1", Prefix: BACKUP_PREFIX });
  });

  it("remove refuses any key outside backups/tidb/<date>/ before sending anything", async () => {
    const { client, sent } = fakeClient();
    const s = createS3BackupStore(client, "bucket-x");
    for (const k of ["generated/reel-1.mp4", "backups/other/2026-10-01/x", `${BACKUP_PREFIX}README.txt`, `${BACKUP_PREFIX}../generated/x`]) {
      await expect(s.remove(k)).rejects.toThrow(/refus/i);
    }
    expect(sent).toHaveLength(0);
    await s.remove(`${BACKUP_PREFIX}2026-10-01/customers.jsonl.gz`);
    expect(sent).toEqual([{ name: "DeleteObjectCommand", input: { Bucket: "bucket-x", Key: `${BACKUP_PREFIX}2026-10-01/customers.jsonl.gz` } }]);
  });
});

describe("SQL shape · keyset pages, never SELECT * without a limit", () => {
  const spec: TableSpec = {
    ddl: "",
    columns: [
      { name: "id", sqlType: "int", encoding: "text" },
      { name: "payload", sqlType: "json", encoding: "text" },
      { name: "raw", sqlType: "varbinary", encoding: "hex" },
    ],
    keyColumns: ["id"],
    hiddenRowId: false,
  };

  it("first page has no WHERE, names columns, orders by key, and is LIMITed", () => {
    const q = buildBatchQuery("invoices", spec, null, 500);
    expect(q.sql).not.toMatch(/SELECT\s+\*/i);
    expect(q.sql).toMatch(/LIMIT 500$/);
    expect(q.sql).toContain("ORDER BY `id`");
    expect(q.sql).not.toMatch(/WHERE/);
    expect(q.sql).toContain("CAST(`payload` AS CHAR) AS `payload`");
    expect(q.sql).toContain("HEX(`raw`) AS `raw`");
    expect(q.values).toEqual([]);
  });

  it("later pages continue strictly after the last key", () => {
    expect(buildBatchQuery("invoices", spec, ["41"], 500)).toMatchObject({ values: ["41"] });
    expect(buildBatchQuery("invoices", spec, ["41"], 500).sql).toContain("WHERE `id` > ?");
    const composite: TableSpec = { ...spec, keyColumns: ["id", "raw"] };
    const q = buildBatchQuery("t", composite, ["1", "AB"], 10);
    expect(q.sql).toContain("WHERE (`id`, `raw`) > (?, UNHEX(?))");
    expect(q.values).toEqual(["1", "AB"]);
    const noPk: TableSpec = { ...spec, keyColumns: [], hiddenRowId: true };
    const r = buildBatchQuery("t", noPk, ["9"], 10);
    expect(r.sql).toContain("_tidb_rowid");
    expect(r.sql).toContain("WHERE _tidb_rowid > ?");
  });

  it("quotes identifiers, escaping backticks", () => {
    expect(buildBatchQuery("we`ird", spec, null, 1).sql).toContain("FROM `we``ird`");
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
