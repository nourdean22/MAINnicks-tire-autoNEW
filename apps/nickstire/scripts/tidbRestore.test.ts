/**
 * scripts/tidb-restore-from-backup.mjs · the restore path for the nightly TiDB
 * backup. The refusal canary is the point: a restore aimed at production must be
 * refused in every spelling, and a fixture target must still get through to the
 * dry run (a guard that refuses everything also "passes" a refusal test).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { runTidbBackup, BACKUP_PREFIX, type BackupStore, type BackupSource } from "../server/services/tidbBackup";
// @ts-expect-error plain .mjs script, no type declarations
import { refuseProductionTarget, decodeRow, verifySet, parseArgs } from "./tidb-restore-from-backup.mjs";

const PROD = "mysql://3abc.root:secret@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/nickstire?ssl={}";
const SCRIPT = join(__dirname, "tidb-restore-from-backup.mjs");

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

  it("refuses when production is unknown or the target is unparsable", () => {
    expect(refuseProductionTarget("mysql://u:p@restore-fixture.invalid:3306/x", undefined)).toMatch(/DATABASE_URL/);
    expect(refuseProductionTarget("not a url", PROD)).toMatch(/target/i);
    expect(refuseProductionTarget(undefined, PROD)).toMatch(/--target-url/);
  });

  it("positive control: a fixture target is allowed", () => {
    expect(refuseProductionTarget("mysql://u:p@restore-fixture.invalid:3306/restore_test", PROD)).toBeNull();
    expect(refuseProductionTarget("mysql://root@127.0.0.1:3306/restore_test", PROD)).toBeNull();
  });
});

describe("CLI · dry run by default, refusal before anything connects", () => {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 20_000,
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", DATABASE_URL: PROD },
    });

  it("canary: a production target is REFUSED with a non-zero exit", () => {
    const r = run(["--date", "2026-10-18", "--target-url", PROD]);
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/REFUSED/);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/DRY RUN/);
  });

  it("positive control: a fixture target proceeds to the dry run and exits before connecting", () => {
    const r = run(["--date", "2026-10-18", "--target-url", "mysql://u:p@restore-fixture.invalid:3306/restore_test", "--tables", "customers,invoices"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/DRY RUN/);
    expect(r.stdout).toMatch(/restore-fixture\.invalid/);
    expect(r.stdout).toMatch(/customers, invoices/);
    expect(r.stdout).not.toContain("secret");
  });

  it("parseArgs reads the documented flags", () => {
    expect(parseArgs(["--date", "2026-10-18", "--tables", "a,b", "--verify-only"])).toMatchObject({
      date: "2026-10-18", tables: ["a", "b"], verifyOnly: true, execute: false,
    });
  });
});

describe("format contract · what the backup writes, the restore reads", () => {
  async function backupSet() {
    const source: BackupSource = {
      database: "fixture",
      listTables: async () => ["attachments"],
      describeTable: async () => ({
        ddl: "CREATE TABLE `attachments` (`id` int NOT NULL, `data` blob, PRIMARY KEY (`id`))",
        columns: [{ name: "id", sqlType: "int", encoding: "text" }, { name: "data", sqlType: "blob", encoding: "hex" }],
        keyColumns: ["id"],
        hiddenRowId: false,
      }),
      readBatch: async (_t, _s, after) => (after ? [] : [["1", "00FF10"], ["2", null]]),
    };
    const objects = new Map<string, Buffer>();
    const store: BackupStore = {
      put: async (k, b) => { objects.set(k, Buffer.from(b)); },
      list: async (p) => [...objects].filter(([k]) => k.startsWith(p)).map(([key, b]) => ({ key, size: b.length })),
      remove: async (k) => { objects.delete(k); },
    };
    await runTidbBackup({ source, store, now: () => new Date("2026-10-18T07:40:00Z") });
    const manifest = JSON.parse(objects.get(`${BACKUP_PREFIX}2026-10-18/manifest.json`)!.toString("utf8"));
    return { manifest, objects };
  }

  it("decodes hex columns back to the original bytes", async () => {
    const { manifest } = await backupSet();
    const cols = manifest.tables[0].columns;
    expect(decodeRow(cols, ["1", "00FF10"])).toEqual(["1", Buffer.from([0x00, 0xff, 0x10])]);
    expect(decodeRow(cols, ["2", null])).toEqual(["2", null]);
  });

  it("verify-only passes an intact set and names the table whose bytes changed", async () => {
    const { manifest, objects } = await backupSet();
    const fetch = async (k: string) => objects.get(k);
    expect(await verifySet(manifest, fetch)).toEqual([]);
    const key = `${BACKUP_PREFIX}2026-10-18/attachments.jsonl.gz`;
    const bad = Buffer.from(objects.get(key)!);
    bad[bad.length - 5] ^= 0xff;
    objects.set(key, bad);
    const problems = await verifySet(manifest, fetch);
    expect(problems.join("\n")).toMatch(/attachments.*sha256/);
    objects.delete(key);
    expect((await verifySet(manifest, fetch)).join("\n")).toMatch(/attachments.*missing/);
  });
});
