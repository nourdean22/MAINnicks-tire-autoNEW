/**
 * scripts/tidb-restore-from-backup.mjs · the restore path for the nightly TiDB
 * backup. The refusal canary is the point: a restore aimed at production must be
 * refused in every spelling, and a fixture target must still get through to the
 * dry run (a guard that refuses everything also "passes" a refusal test).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { runTidbBackup, type BackupStore, type BackupSource } from "../server/services/tidbBackup";
import {
  refuseProductionTarget,
  decodeRow,
  verifySet,
  parseArgs,
  verifyReport,
  restoreFromManifest,
  // @ts-expect-error plain .mjs script, no type declarations
} from "./tidb-restore-from-backup.mjs";

const PROD = "mysql://3abc.root:secret@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/nickstire?ssl={}";
const SCRIPT = join(__dirname, "tidb-restore-from-backup.mjs");
const PREFIX = "backups/tidb/";

describe("refuseProductionTarget · the production-host refusal", () => {
  it("refuses the production host in every spelling", () => {
    for (const target of [
      PROD,
      "mysql://other:pw@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/scratch",
      "mysql://other:pw@GATEWAY01.US-EAST-1.PROD.AWS.TIDBCLOUD.COM:4000/scratch",
      "mysql://other:pw@gateway01.us-east-1.prod.aws.tidbcloud.com.:4000/scratch",
      "mysql://other:pw@gateway01.us-east-1.prod.aws.tidbcloud.com:3306/scratch",
      "mysql://other:pw@proxy.gateway01.us-east-1.prod.aws.tidbcloud.com:4000/scratch",
    ]) {
      expect(refuseProductionTarget(target, PROD), target).toMatch(/production/i);
    }
  });

  it("refuses a percent-escaped production host, which mysql2 decodes and connects to (fix 3)", () => {
    expect(refuseProductionTarget("mysql://u:p@gate%77ay01.us-east-1.prod.aws.tidbcloud.com:4000/db", PROD)).toMatch(/production/i);
    expect(refuseProductionTarget("mysql://u:p@GATEWAY01%2Eus-east-1.prod.aws.tidbcloud.com:4000/db", PROD)).toMatch(/production/i);
    expect(refuseProductionTarget("mysql://u:p@gate%zzway.example.com:4000/db", PROD)).toMatch(/escape|decod/i);
  });

  it("refuses IP-literal hosts, which a string compare against the gateway name cannot judge (fix 3)", () => {
    for (const target of [
      "mysql://u:p@3.210.17.4:4000/db",
      "mysql://u:p@127.0.0.1:3306/db",
      "mysql://u:p@[::1]:3306/db",
      "mysql://u:p@3328565508:4000/db",
      "mysql://u:p@0xc6d21104:4000/db",
      "mysql://u:p@%33.210.17.4:4000/db",
    ]) {
      expect(refuseProductionTarget(target, PROD), target).toMatch(/IP/);
    }
  });

  it("refuses when production is unknown or the target is unparsable", () => {
    expect(refuseProductionTarget("mysql://u:p@restore-fixture.invalid:3306/x", undefined)).toMatch(/DATABASE_URL/);
    expect(refuseProductionTarget("not a url", PROD)).toMatch(/target/i);
    expect(refuseProductionTarget(undefined, PROD)).toMatch(/--target-url/);
  });

  it("positive control: localhost, another region and a fixture host are allowed", () => {
    expect(refuseProductionTarget("mysql://u:p@restore-fixture.invalid:3306/restore_test", PROD)).toBeNull();
    expect(refuseProductionTarget("mysql://root@localhost:3306/restore_test", PROD)).toBeNull();
    expect(refuseProductionTarget("mysql://9xyz.root:pw@gateway01.us-west-2.prod.aws.tidbcloud.com:4000/scratch", PROD)).toBeNull();
  });
});

describe("CLI · dry run by default, refusal before anything connects", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 20_000,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", DATABASE_URL: PROD },
    });

  it("canary: a production target is REFUSED with a non-zero exit, plain or percent-escaped", () => {
    for (const target of [PROD, "mysql://u:p@gate%77ay01.us-east-1.prod.aws.tidbcloud.com:4000/db"]) {
      const r = run(["--date", "2026-10-18", "--target-url", target]);
      expect(r.status, target).toBe(2);
      expect(`${r.stdout}${r.stderr}`).toMatch(/REFUSED/);
      expect(`${r.stdout}${r.stderr}`).not.toMatch(/DRY RUN/);
    }
  });

  it("positive control: localhost and another region reach the dry run and exit 0 before connecting", () => {
    for (const target of [
      "mysql://u:p@localhost:3306/restore_test",
      "mysql://9xyz.root:pw@gateway01.us-west-2.prod.aws.tidbcloud.com:4000/scratch",
    ]) {
      const r = run(["--date", "2026-10-18", "--target-url", target, "--tables", "customers,invoices"]);
      expect(r.status, `${target}\n${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(/DRY RUN/);
      expect(r.stdout).toMatch(/customers, invoices/);
      expect(r.stdout).not.toMatch(/pw@|:p@/);
    }
  });

  it("parseArgs reads the documented flags", () => {
    expect(parseArgs(["--date", "2026-10-18", "--tables", "a,b", "--verify-only"])).toMatchObject({
      date: "2026-10-18", tables: ["a", "b"], verifyOnly: true, execute: false,
    });
  });
});

/** Two real sets from the backup job: a full one on 10-18 and a nightly-only one on 10-21. */
async function backupSets() {
  const tables: Record<string, { spec: Awaited<ReturnType<BackupSource["describeTable"]>>; rows: unknown[][] }> = {
    attachments: {
      spec: {
        ddl: "CREATE TABLE `attachments` (`id` int NOT NULL, `data` blob, PRIMARY KEY (`id`))",
        columns: [{ name: "id", sqlType: "int", encoding: "text" }, { name: "data", sqlType: "blob", encoding: "hex" }],
        keyColumns: ["id"],
        hiddenRowId: false,
        excludedColumns: [],
      },
      rows: [["1", "00FF10"], ["2", null]],
    },
    search_performance: {
      spec: {
        ddl: "CREATE TABLE `search_performance` (`id` int NOT NULL, PRIMARY KEY (`id`))",
        columns: [{ name: "id", sqlType: "int", encoding: "text" }],
        keyColumns: ["id"],
        hiddenRowId: false,
        excludedColumns: [],
      },
      rows: [["7"]],
    },
  };
  const source: BackupSource = {
    database: "fixture",
    listTables: async () => Object.keys(tables),
    describeTable: async (t) => tables[t].spec,
    readBatch: async (t, _s, after) => (after ? [] : tables[t].rows),
  };
  const objects = new Map<string, Buffer>();
  const store: BackupStore = {
    put: async (k, b) => { objects.set(k, Buffer.from(b)); },
    list: async (p) => [...objects].filter(([k]) => k.startsWith(p)).map(([key, b]) => ({ key, size: b.length })),
    remove: async (k) => { objects.delete(k); },
  };
  await runTidbBackup({ source, store, now: () => new Date("2026-10-18T07:40:00Z"), sleep: async () => {} });
  await runTidbBackup({ source, store, now: () => new Date("2026-10-21T07:40:00Z"), sleep: async () => {} });
  const manifest = (d: string) => JSON.parse(objects.get(`${PREFIX}${d}/manifest.json`)!.toString("utf8"));
  return { objects, manifest, fetchObject: async (k: string) => objects.get(k) };
}

/** A target connection that records statements and answers COUNT(*) from what was inserted. */
function fakeTarget() {
  const inserted = new Map<string, number>();
  const statements: string[] = [];
  return {
    statements,
    inserted,
    conn: {
      async query(sql: string, values: unknown[] = []) {
        statements.push(sql);
        if (sql.includes("information_schema.TABLES")) return [[{ n: 0 }], []];
        const ins = /^INSERT INTO `([^`]+)`/.exec(sql);
        if (ins) {
          const width = (sql.match(/\(\?/g) ?? []).length;
          inserted.set(ins[1], (inserted.get(ins[1]) ?? 0) + values.length / Math.max(1, values.length / width));
          return [{}, []];
        }
        const cnt = /^SELECT COUNT\(\*\) AS n FROM `([^`]+)`/.exec(sql);
        if (cnt) return [[{ n: inserted.get(cnt[1]) ?? 0 }], []];
        return [{}, []];
      },
    },
  };
}

describe("format contract · what the backup writes, the restore reads", () => {
  it("decodes hex columns back to the original bytes", async () => {
    const { manifest } = await backupSets();
    const cols = manifest("2026-10-18").tables.find((t: { table: string }) => t.table === "attachments").columns;
    expect(decodeRow(cols, ["1", "00FF10"])).toEqual(["1", Buffer.from([0x00, 0xff, 0x10])]);
    expect(decodeRow(cols, ["2", null])).toEqual(["2", null]);
  });

  it("verify passes an intact set and names the table whose bytes changed or went missing", async () => {
    const { manifest, objects, fetchObject } = await backupSets();
    const m = manifest("2026-10-18");
    expect(await verifySet(m, fetchObject)).toEqual([]);
    const key = `${PREFIX}2026-10-18/attachments.jsonl.gz`;
    const bad = Buffer.from(objects.get(key)!);
    bad[bad.length - 5] ^= 0xff;
    objects.set(key, bad);
    expect((await verifySet(m, fetchObject)).join("\n")).toMatch(/attachments.*sha256/);
    objects.delete(key);
    expect((await verifySet(m, fetchObject)).join("\n")).toMatch(/attachments.*missing/);
  });
});

describe("weekly tables in a nightly set · never report success while they are missing (fix 5)", () => {
  it("--verify-only on the newest set says INCOMPLETE and names the exact follow-up", async () => {
    const { manifest, fetchObject } = await backupSets();
    const r = await verifyReport("2026-10-21", manifest("2026-10-21"), fetchObject);
    expect(r.code).toBe(3);
    expect(r.text).toMatch(/INCOMPLETE/);
    expect(r.text).toContain("--verify-only --date 2026-10-18 --tables search_performance");
    expect(r.text).not.toMatch(/^VERIFIED/m);
  });

  it("control: --verify-only on the full set is VERIFIED with exit 0", async () => {
    const { manifest, fetchObject } = await backupSets();
    const r = await verifyReport("2026-10-18", manifest("2026-10-18"), fetchObject);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/^VERIFIED 2026-10-18/);
  });

  it("restoring the newest set restores what it holds, then ends INCOMPLETE with the follow-up command", async () => {
    const { manifest, fetchObject } = await backupSets();
    const t = fakeTarget();
    const r = await restoreFromManifest({ date: "2026-10-21", manifest: manifest("2026-10-21"), fetchObject, conn: t.conn, where: "localhost:3306/scratch" });
    expect(r.code).toBe(3);
    expect(t.inserted.get("attachments")).toBe(2);
    expect(t.inserted.has("search_performance")).toBe(false);
    expect(r.text).toMatch(/INCOMPLETE/);
    expect(r.text).toContain("--date 2026-10-18 --tables search_performance --target-url <same target> --execute");
    expect(r.text).not.toMatch(/^RESTORED/m);
  });

  it("asking for a weekly table by name on the newest set restores nothing silently and points at its set", async () => {
    const { manifest, fetchObject } = await backupSets();
    const t = fakeTarget();
    const r = await restoreFromManifest({ date: "2026-10-21", manifest: manifest("2026-10-21"), tables: ["search_performance"], fetchObject, conn: t.conn, where: "x" });
    expect(r.code).toBe(3);
    expect(t.statements.some((s) => s.startsWith("CREATE TABLE"))).toBe(false);
    expect(r.text).toContain("--date 2026-10-18 --tables search_performance");
  });

  it("control: restoring the full set is RESTORED with exit 0 and every table counted", async () => {
    const { manifest, fetchObject } = await backupSets();
    const t = fakeTarget();
    const r = await restoreFromManifest({ date: "2026-10-18", manifest: manifest("2026-10-18"), fetchObject, conn: t.conn, where: "x" });
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/^RESTORED 2 table/m);
    expect(t.inserted.get("search_performance")).toBe(1);
  });
});
