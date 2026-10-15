import { describe, expect, it } from "vitest";
import { casMigrate, describeTarget, runCli, withDb, type CliDeps } from "../../scripts/backfills/backfill-shop-clock";
import { TZ_CHECK_SQL, assertReadOnlySql, msToDigits, readOnlyConn, type SqlConn } from "../../scripts/backfills/shopClockBackfill";

// ── in-memory stand-in for the two tables, the backups and the session ───

interface FakeRow {
  id: number;
  stored: string;
  created: string;
  updated: string;
  source: string;
  isSnap: boolean;
}
type Tables = { invoices: FakeRow[]; alg_estimates: FakeRow[] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A result row keyed by the aliases in the SQL text, so a renamed alias breaks the reader as it would in production. */
function keyed(sql: string, values: unknown[]): Record<string, unknown> {
  const aliases = [...sql.matchAll(/ AS `([^`]+)`/g)].map((m) => m[1]);
  return Object.fromEntries(aliases.map((a, i) => [a, values[i]]));
}

class FakeDb {
  tables: Tables;
  backups = new Map<string, FakeRow[]>();
  log: string[] = [];
  sessionTz = "SYSTEM";
  pinWorks = true;
  dropColumns: string[] = [];
  ignoreSelfAssign = false;
  movedOverride?: unknown;
  now = "2026-10-16 09:00:00";
  connectCalls = 0;
  endCalls = 0;
  beforeStatement?: (sql: string, params: readonly unknown[]) => void;
  private saved?: Tables;

  /** Another session's committed write: it survives a rollback of an open transaction. */
  externalWrite(id: number, stored: string): void {
    for (const tables of [this.tables, this.saved]) {
      const r = tables?.invoices.find((x) => x.id === id);
      if (r) r.stored = stored;
    }
  }

  constructor(tables: Tables) {
    this.tables = tables;
  }

  conn(): SqlConn {
    return { query: async (sql, params = []) => this.exec(sql, params), end: async () => void this.endCalls++ };
  }

  updates(): string[] {
    return this.log.filter((s) => s.startsWith("UPDATE"));
  }

  private rows(name: string): FakeRow[] {
    const t = this.tables[name as keyof Tables];
    if (!t) throw new Error(`fake db: no table ${name}`);
    return t;
  }

  private exec(rawSql: string, params: readonly unknown[]): unknown {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    this.log.push(sql);
    this.beforeStatement?.(sql, params);
    let m: RegExpExecArray | null;
    if (sql.startsWith("SELECT @@global.time_zone")) return [keyed(sql, ["SYSTEM", this.sessionTz, "UTC"])];
    if (sql === "SET time_zone = '+00:00'") {
      if (this.pinWorks) this.sessionTz = "+00:00";
      return { affectedRows: 0 };
    }
    if (sql === TZ_CHECK_SQL) return [keyed(sql, [this.sessionTz])];
    if (sql.includes("FROM `INFORMATION_SCHEMA`.`COLUMNS`")) {
      const [, ...cols] = params as string[];
      return cols
        .filter((c) => !this.dropColumns.includes(c))
        .map((c) => keyed(sql, [c, "timestamp", c === "updatedAt" || c === "updated_at" ? "on update CURRENT_TIMESTAMP" : ""]));
    }
    if (sql.includes("FROM `INFORMATION_SCHEMA`.`TABLES`")) return this.backups.has(String(params[0])) ? [keyed(sql, [params[0]])] : [];
    if ((m = /^SELECT `id` AS `\w+`, `\w+` AS `\w+`, `\w+` AS `\w+`, `\w+` AS `\w+`, .* AS `\w+` FROM `(\w+)` ORDER BY `id`$/.exec(sql))) {
      return this.rows(m[1]).map((r) => keyed(sql, [r.id, r.stored, r.created, r.source, r.isSnap ? 1 : 0]));
    }
    if (sql === "START TRANSACTION") {
      this.saved = clone(this.tables);
      return {};
    }
    if (sql === "COMMIT") {
      this.saved = undefined;
      return {};
    }
    if (sql === "ROLLBACK") {
      if (this.saved) this.tables = this.saved;
      this.saved = undefined;
      return {};
    }
    if ((m = /^CREATE TABLE `(\w+)` LIKE `(\w+)`$/.exec(sql))) {
      this.backups.set(m[1], []);
      return {};
    }
    if ((m = /^INSERT INTO `(\w+)` SELECT \* FROM `(\w+)` WHERE `id` IN \(([\d, ]+)\)$/.exec(sql))) {
      const ids = m[3].split(",").map((s) => Number(s.trim()));
      const copied = this.rows(m[2]).filter((r) => ids.includes(r.id));
      this.backups.get(m[1])!.push(...clone(copied));
      return { affectedRows: copied.length };
    }
    if ((m = /^SELECT `id` AS `\w+` FROM `(\w+)` ORDER BY `id`$/.exec(sql))) {
      return this.backups.get(m[1])!.map((r) => keyed(sql, [r.id])).sort((a, b) => Number(a.id) - Number(b.id));
    }
    if ((m = /^SELECT `id` AS `\w+`, `\w+` AS `\w+` FROM `(\w+)` ORDER BY `id`$/.exec(sql))) {
      return this.backups.get(m[1])!.map((r) => keyed(sql, [r.id, r.stored])).sort((a, b) => Number(a.id) - Number(b.id));
    }
    if ((m = /^UPDATE `(\w+)` SET `\w+` = \?(, `(\w+)` = `\3`)? WHERE `id` = \? AND `\w+` = \?$/.exec(sql))) {
      const [next, id, expected] = params as [string, number, string];
      const row = this.rows(m[1]).find((r) => r.id === id);
      if (!row || row.stored !== expected) return { affectedRows: 0 };
      row.stored = next;
      if (!m[2] || this.ignoreSelfAssign) row.updated = this.now;
      return { affectedRows: 1 };
    }
    if ((m = /^SELECT `\w+` AS `\w+` FROM `(\w+)` WHERE `id` = \?$/.exec(sql))) {
      const row = this.rows(m[1]).find((r) => r.id === params[0]);
      return row ? [keyed(sql, [row.stored])] : [];
    }
    if ((m = /^SELECT COUNT\(\*\) AS `\w+` FROM `(\w+)` AS `l` JOIN `(\w+)` AS `b` ON `b`\.`id` = `l`\.`id` WHERE NOT \(`l`\.`(\w+)` <=> `b`\.`\3`\)$/.exec(sql))) {
      if (this.movedOverride !== undefined) return this.movedOverride;
      const bak = this.backups.get(m[2])!;
      const moved = this.rows(m[1]).filter((r) => {
        const b = bak.find((x) => x.id === r.id);
        return b !== undefined && b.updated !== r.updated;
      }).length;
      return [keyed(sql, [moved])];
    }
    throw new Error(`fake db: unrecognised statement: ${sql}`);
  }
}

const row = (id: number, created: string, stored: string, source = "manual", isSnap = false): FakeRow => ({ id, created, stored, updated: "2026-10-01 00:00:00", source, isSnap });

/** The shape production showed: a handful of app-written UTC rows among feed-owned ones. */
function seed(): FakeDb {
  return new FakeDb({
    invoices: [
      row(630001, "2026-09-10 23:41:07", "2026-09-10 23:41:07"), // time of day only
      row(2910001, "2026-10-13 00:05:30", "2026-10-13 00:05:30"), // evening: moves to the previous day
      row(2910002, "2026-10-12 14:10:11", "2026-10-12 14:10:11"), // time of day only
      row(3000001, "2026-09-12 15:20:33", "2026-09-12 15:20:33", "shopdriver"),
      row(3000002, "2026-09-12 16:21:34", "2026-09-12 16:21:34", "shopdriver"),
      row(3000003, "2026-10-16 15:00:10", "2026-10-16 15:00:10", "shopdriver"), // after the cutoff, still a feed row
      row(3000010, "2026-09-13 15:00:00", "2026-09-13 00:00:00", "shopdriver"),
      row(3000011, "2026-10-15 15:00:10", "2026-10-15 11:00:10"), // already on the wall clock
      row(3000012, "2026-10-12 14:10:30", "2026-10-12 14:10:00", "shopdriver"), // whole-minute digits on a feed row
    ],
    alg_estimates: [
      row(7001, "2026-08-01 16:00:01", "2026-08-01 16:00:01", "alg"),
      row(7002, "2026-08-02 16:00:02", "2026-08-02 16:00:02", "manual"),
      row(7003, "2026-08-03 16:00:03", "2026-07-01 09:00:00", "alg"),
    ],
  });
}

const URL_WITH_SECRETS = "mysql://svc_user:s3cretPass@gateway01.example.tidbcloud.com:4000/nickstire?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D";
const CLASSIFY = ["--cutoff", "2026-10-15T03:05:00Z", "--snap-bug-start", "2026-10-15T03:05:00Z", "--snap-fix-cutoff", "2026-10-15T16:00:00Z", "--tol-minutes", "15"];
const STAMP = ["--stamp", "20261015"];

interface Harness {
  db: FakeDb;
  files: Map<string, string>;
  lines: string[];
  deps: CliDeps;
  run(...args: string[]): Promise<number>;
  text(): string;
}

function harness(db: FakeDb = seed(), env: Record<string, string | undefined> = { DATABASE_URL: URL_WITH_SECRETS }): Harness {
  const files = new Map<string, string>();
  const lines: string[] = [];
  const deps: CliDeps = {
    env,
    connect: async () => {
      db.connectCalls++;
      return db.conn();
    },
    readFile: (f) => {
      const v = files.get(f);
      if (v === undefined) throw new Error(`ENOENT ${f}`);
      return v;
    },
    writeFile: (f, d) => {
      if (files.has(f)) throw new Error(`EEXIST ${f}`);
      files.set(f, d);
    },
    out: (l) => void lines.push(l),
  };
  return { db, files, lines, deps, run: (...args) => runCli(args, deps), text: () => lines.join("\n") };
}

async function planned(h: Harness, ...extra: string[]): Promise<void> {
  expect(await h.run("plan", ...CLASSIFY, "--out", "plan.json", ...extra)).toBe(0);
}

const stored = (db: FakeDb, id: number, table: keyof Tables = "invoices") => db.tables[table].find((r) => r.id === id)?.stored;

describe("probe", () => {
  it("prints host and database first, never the credentials, and reports before it pins", async () => {
    const h = harness();
    expect(await h.run("probe", ...CLASSIFY)).toBe(0);
    const text = h.text();
    expect(h.lines[0]).toBe("DB host: gateway01.example.tidbcloud.com  database: nickstire");
    expect(text).not.toContain("s3cretPass");
    expect(text).not.toContain("svc_user");
    expect(h.db.log[0]).toMatch(/^SELECT @@global.time_zone/);
    expect(text).toContain("time_zone before pin: global=SYSTEM session=SYSTEM system=UTC");
    expect(text).toContain("session time_zone pinned: +00:00");
    expect(text).toContain("schema ok: invoices.invoiceDate is timestamp; updatedAt ON UPDATE: yes");
    expect(text).toContain("schema ok: alg_estimates.estimate_date is timestamp; updated_at ON UPDATE: yes");
    expect(h.db.endCalls).toBe(1);
  });

  it("reports class counts, the feed-owned rows by source, and the post-cutoff anchor", async () => {
    const h = harness();
    await h.run("probe", ...CLASSIFY);
    const text = h.text();
    expect(text).toContain("== invoices: 9 rows ==");
    expect(text).toMatch(/classes: already_correct=1 needs_correction=3 snap_double_converted=0 post_cutoff_utc_match=0 feed_owned_utc=4 other=1/);
    expect(text).toContain("feed_owned_utc by source: shopdriver=4");
    expect(text).toContain("post-cutoff rows: 2, already_correct: 1, post_cutoff_utc_match: 0");
    expect(text).toContain("utc_match=");
    expect(text).toContain("2026-09 rows=");
    expect(text).toMatch(/== alg_estimates: 3 rows ==[\s\S]*feed_owned_utc=2/);
  });

  it("sends only statements the read-only guard allows", async () => {
    const h = harness();
    await h.run("probe", ...CLASSIFY);
    await h.run("plan", ...CLASSIFY, "--out", "p.json");
    await h.run("verify", ...CLASSIFY);
    expect(h.db.log.length).toBeGreaterThan(10);
    for (const sql of h.db.log) expect(() => assertReadOnlySql(sql)).not.toThrow();
    expect(h.db.log.filter((s) => /^(UPDATE|INSERT|CREATE|DELETE|START|COMMIT)/.test(s))).toEqual([]);
  });

  it("stops on schema drift instead of classifying", async () => {
    const db = seed();
    db.dropColumns = ["source"];
    const h = harness(db);
    expect(await h.run("probe", ...CLASSIFY)).toBe(1);
    expect(h.text()).toMatch(/invoices: missing column\(s\) source/);
    expect(h.db.log.some((s) => s.includes("ORDER BY `id`") && s.startsWith("SELECT `id` AS `id`, "))).toBe(false);
  });

  it("treats an empty table as an error, not a clean result", async () => {
    const db = seed();
    db.tables.alg_estimates = [];
    const h = harness(db);
    expect(await h.run("probe", ...CLASSIFY)).toBe(1);
    expect(h.text()).toContain("alg_estimates: scanned 0 rows");
  });
});

describe("session time zone guard", () => {
  it.each(["probe", "plan", "verify"])("%s aborts before reading any row when the session will not pin to UTC", async (cmd) => {
    const db = seed();
    db.pinWorks = false;
    const h = harness(db);
    const extra = cmd === "plan" ? ["--out", "p.json"] : [];
    expect(await h.run(cmd, ...CLASSIFY, ...extra)).toBe(1);
    expect(h.text()).toContain('session time_zone is "SYSTEM" after SET time_zone');
    expect(h.db.log.filter((s) => s.includes("FROM `invoices`") || s.includes("INFORMATION_SCHEMA"))).toEqual([]);
    expect(h.files.size).toBe(0);
    expect(h.db.endCalls).toBe(1);
  });

  it("aborts the write commands too, before any DDL or UPDATE", async () => {
    const ok = harness();
    await planned(ok);
    const db = seed();
    db.pinWorks = false;
    const h = harness(db);
    h.files.set("plan.json", ok.files.get("plan.json")!);
    expect(await h.run("snapshot", "--plan", "plan.json", ...STAMP, "--execute")).toBe(1);
    expect(await h.run("apply", "--plan", "plan.json", ...STAMP, "--execute")).toBe(1);
    expect(h.db.log.filter((s) => /^(CREATE|INSERT|UPDATE|START)/.test(s))).toEqual([]);
  });

  it("passes when the session pins (control for the cases above)", async () => {
    const h = harness();
    expect(await h.run("probe", ...CLASSIFY)).toBe(0);
    expect(h.db.sessionTz).toBe("+00:00");
  });
});

describe("read-only connection", () => {
  it("rejects writes before they reach the driver, and lets reads through", async () => {
    const db = seed();
    const guarded = readOnlyConn(db.conn());
    await expect(guarded.query("UPDATE `invoices` SET `invoiceDate` = ? WHERE `id` = ? AND `invoiceDate` = ?", ["a", 1, "b"])).rejects.toThrow(/read-only guard/);
    await expect(guarded.query("SELECT 1; DELETE FROM invoices")).rejects.toThrow(/read-only guard/);
    expect(db.log).toEqual([]);
    await expect(guarded.query(TZ_CHECK_SQL)).resolves.toBeDefined();
    expect(db.log).toHaveLength(1);
  });

  it("is what read mode hands to the command; write mode gets the raw connection", async () => {
    const h = harness();
    await expect(withDb(h.deps, "read", (conn) => conn.query("UPDATE `invoices` SET `invoiceDate` = ? WHERE `id` = ? AND `invoiceDate` = ?", ["a", 1, "b"]))).rejects.toThrow(/read-only guard/);
    expect(h.db.updates()).toEqual([]);
    await withDb(h.deps, "write", (conn) => conn.query("UPDATE `invoices` SET `invoiceDate` = ? WHERE `id` = ? AND `invoiceDate` = ?", ["a", 1, "b"]));
    expect(h.db.updates()).toHaveLength(1);
  });
});

describe("plan", () => {
  it("plans exactly the app-written rows and never a feed-owned one", async () => {
    const h = harness();
    await planned(h);
    const plan = JSON.parse(h.files.get("plan.json")!);
    expect(plan.rows).toEqual([
      { table: "invoices", id: 630001, from: "2026-09-10 23:41:07", to: "2026-09-10 19:41:07", class: "needs_correction" },
      { table: "invoices", id: 2910001, from: "2026-10-13 00:05:30", to: "2026-10-12 20:05:30", class: "needs_correction" },
      { table: "invoices", id: 2910002, from: "2026-10-12 14:10:11", to: "2026-10-12 10:10:11", class: "needs_correction" },
    ]);
    expect(plan).toMatchObject({ host: "gateway01.example.tidbcloud.com", database: "nickstire", generatedFromRowCount: 12 });
    expect(JSON.stringify(plan)).not.toContain("s3cretPass");
    const text = h.text();
    expect(text).toContain("day_changes: 1 of 3 planned rows change the shop date; 2 change only the time of day");
    expect(text).toContain("feed_owned_utc (never planned) by source: shopdriver=4; sample ids 3000001, 3000002, 3000003, 3000012");
  });

  it("plans an estimate only when its source is named", async () => {
    const h = harness();
    await planned(h, "--estimate-sources", "manual");
    const rows = JSON.parse(h.files.get("plan.json")!).rows;
    expect(rows.filter((r: { table: string }) => r.table === "alg_estimates")).toEqual([
      { table: "alg_estimates", id: 7002, from: "2026-08-02 16:00:02", to: "2026-08-02 12:00:02", class: "needs_correction" },
    ]);
  });

  it("prints one line per planned row for the operator to approve", async () => {
    const h = harness();
    await planned(h);
    const text = h.text();
    expect(text).toContain("Show these rows to the operator and wait for an explicit go before snapshot or apply:");
    expect(text).toContain("  invoices#630001 source=manual createdAt=2026-09-10 23:41:07 2026-09-10 23:41:07 -> 2026-09-10 19:41:07 needs_correction day_change=no");
    expect(text).toContain("  invoices#2910001 source=manual createdAt=2026-10-13 00:05:30 2026-10-13 00:05:30 -> 2026-10-12 20:05:30 needs_correction day_change=yes");
    expect(text).toContain("  invoices#2910002 source=manual createdAt=2026-10-12 14:10:11 2026-10-12 14:10:11 -> 2026-10-12 10:10:11 needs_correction day_change=no");
    expect(h.lines.filter((l) => /^  \w+#\d+ source=/.test(l))).toHaveLength(3);
  });

  it("targets the stored digits, so a row stored just before UTC midnight moves to the prior shop day", async () => {
    const db = seed();
    db.tables.invoices.push(row(3100002, "2026-10-14 04:05:30", "2026-10-14 03:55:30"));
    const h = harness(db);
    await planned(h);
    expect(JSON.parse(h.files.get("plan.json")!).rows).toContainEqual({ table: "invoices", id: 3100002, from: "2026-10-14 03:55:30", to: "2026-10-13 23:55:30", class: "needs_correction" });
    expect(h.text()).toContain("  invoices#3100002 source=manual createdAt=2026-10-14 04:05:30 2026-10-14 03:55:30 -> 2026-10-13 23:55:30 needs_correction day_change=yes");
    expect(h.text()).toContain("day_changes: 2 of 4 planned rows change the shop date; 2 change only the time of day");
  });

  it("names the source of an estimate row it was told to plan", async () => {
    const h = harness();
    await planned(h, "--estimate-sources", "manual");
    expect(h.text()).toContain("  alg_estimates#7002 source=manual createdAt=2026-08-02 16:00:02 2026-08-02 16:00:02 -> 2026-08-02 12:00:02 needs_correction day_change=no");
  });

  it("plans an app-written row whose seconds are 00", async () => {
    const db = seed();
    db.tables.invoices.push(row(3100001, "2026-10-12 23:41:00", "2026-10-12 23:41:00"));
    const h = harness(db);
    await planned(h);
    expect(JSON.parse(h.files.get("plan.json")!).rows).toContainEqual({ table: "invoices", id: 3100001, from: "2026-10-12 23:41:00", to: "2026-10-12 19:41:00", class: "needs_correction" });
  });

  it("will not plan a feed source even when asked", async () => {
    const h = harness();
    expect(await h.run("plan", ...CLASSIFY, "--sources", "manual,shopdriver", "--out", "plan.json")).toBe(2);
    expect(h.files.size).toBe(0);
    expect(h.db.connectCalls).toBe(0);
  });

  it("fails and writes no file when an app-written row after the cutoff still has UTC digits", async () => {
    const db = seed();
    db.tables.invoices.push(row(3100001, "2026-10-16 01:00:09", "2026-10-16 01:00:09"));
    const h = harness(db);
    expect(await h.run("plan", ...CLASSIFY, "--out", "plan.json")).toBe(1);
    expect(h.text()).toContain("FAILED: 1 app-written row(s) created after the cutoff still carry UTC digits: invoices#3100001");
    expect(h.files.has("plan.json")).toBe(false);
  });

  it.each([["8 hours", "2026-10-14 07:00:10"], ["10 hours", "2026-10-14 05:00:10"]])("fails and writes no file when an app-written row sits %s behind createdAt with no class to explain it", async (_why, stored) => {
    const db = seed();
    db.tables.invoices.push(row(3100003, "2026-10-14 15:00:10", stored));
    const h = harness(db);
    expect(await h.run("plan", ...CLASSIFY, "--out", "plan.json")).toBe(1);
    expect(h.text()).toContain("FAILED: 1 app-written row(s) sit a whole 8 or 10 hours behind createdAt and no class explains them: invoices#3100003");
    expect(h.text()).toContain("No plan file written.");
    expect(h.files.has("plan.json")).toBe(false);
  });

  it("reports both kinds of stop in one run", async () => {
    const db = seed();
    db.tables.invoices.push(row(3100001, "2026-10-16 01:00:09", "2026-10-16 01:00:09"));
    db.tables.invoices.push(row(3100003, "2026-10-14 15:00:10", "2026-10-14 07:00:10"));
    const h = harness(db);
    expect(await h.run("plan", ...CLASSIFY, "--out", "plan.json")).toBe(1);
    expect(h.text()).toContain("invoices#3100001");
    expect(h.text()).toContain("no class explains them: invoices#3100003");
    expect(h.files.size).toBe(0);
  });

  it("plans normally when the same digits sit on a feed row or an ordinary other row", async () => {
    const db = seed();
    db.tables.invoices.push(row(3100003, "2026-10-14 15:00:10", "2026-10-14 07:00:10", "shopdriver"));
    db.tables.invoices.push(row(3100004, "2026-10-14 15:00:10", "2026-10-14 12:00:10"));
    const h = harness(db);
    expect(await h.run("plan", ...CLASSIFY, "--out", "plan.json")).toBe(0);
  });

  it("does not fail for a feed row after the cutoff (control for the case above)", async () => {
    const h = harness();
    expect(await h.run("plan", ...CLASSIFY, "--out", "plan.json")).toBe(0);
  });

  it("requires --out and every classification argument, before it connects", async () => {
    const h = harness();
    expect(await h.run("plan", ...CLASSIFY)).toBe(2);
    expect(await h.run("plan", "--out", "p.json")).toBe(2);
    expect(h.db.connectCalls).toBe(0);
  });
});

describe("verify", () => {
  const clean = () => new FakeDb({ invoices: [row(1, "2026-10-10 14:00:11", "2026-10-10 10:00:11")], alg_estimates: [row(7003, "2026-08-03 16:00:03", "2026-07-01 09:00:00", "alg")] });

  it("echoes the source lists it checked, defaults and overrides alike", async () => {
    const a = harness(clean());
    expect(await a.run("verify", ...CLASSIFY)).toBe(0);
    expect(a.text()).toContain("verify ok (sources: manual,stripe; estimate-sources: none)");
    const b = harness(clean());
    expect(await b.run("verify", ...CLASSIFY, "--sources", "stripe", "--estimate-sources", "manual")).toBe(0);
    expect(b.text()).toContain("verify ok (sources: stripe; estimate-sources: manual)");
  });

  it("fails and lists the id of every row that still needs correction", async () => {
    const h = harness();
    expect(await h.run("verify", ...CLASSIFY)).toBe(1);
    expect(h.text()).toContain("  invoices#630001 needs_correction createdAt=2026-09-10 23:41:07 stored=2026-09-10 23:41:07");
    expect(h.text()).toContain("  invoices#2910001 needs_correction");
  });

  it("fails on an app-written row sitting 8 or 10 hours behind createdAt that no class explains", async () => {
    for (const [created, stored] of [["2026-10-14 15:00:10", "2026-10-14 07:00:10"], ["2026-10-14 15:00:10", "2026-10-14 05:00:10"]]) {
      const db = clean();
      db.tables.invoices.push(row(9, created, stored));
      const h = harness(db);
      expect(await h.run("verify", ...CLASSIFY)).toBe(1);
      expect(h.text()).toContain(`  invoices#9 other_anomaly createdAt=${created} stored=${stored}`);
    }
  });

  it("leaves a feed row with the same digits, and an ordinary other row, alone", async () => {
    const db = clean();
    db.tables.invoices.push(row(9, "2026-10-14 15:00:10", "2026-10-14 07:00:10", "shopdriver"));
    db.tables.invoices.push(row(10, "2026-10-14 15:00:10", "2026-10-14 12:00:10"));
    const h = harness(db);
    expect(await h.run("verify", ...CLASSIFY)).toBe(0);
  });

  it("does not clear a manual row with 00 seconds", async () => {
    const db = clean();
    db.tables.invoices.push(row(9, "2026-10-12 23:41:00", "2026-10-12 23:41:00"));
    const h = harness(db);
    expect(await h.run("verify", ...CLASSIFY)).toBe(1);
    expect(h.text()).toContain("  invoices#9 needs_correction");
  });
});

describe("subcommand lookup", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])("%s is not a subcommand", async (cmd) => {
    const h = harness();
    expect(await h.run(cmd)).toBe(2);
    expect(h.text()).toContain("usage: backfill-shop-clock.ts");
    expect(await h.run(cmd, "--plan", "p.json")).toBe(2);
    expect(h.db.connectCalls).toBe(0);
  });
});

describe("write commands are dry runs unless --execute is given", () => {
  async function withPlan(): Promise<Harness> {
    const h = harness();
    await planned(h);
    h.lines.length = 0;
    h.db.log.length = 0;
    h.db.connectCalls = 0;
    return h;
  }

  it.each(["snapshot", "apply", "rollback"])("%s opens no connection and prints its SQL", async (cmd) => {
    const h = await withPlan();
    const never = { ...h.deps, connect: async () => { throw new Error("connection factory called without --execute"); } };
    expect(await runCli([cmd, "--plan", "plan.json", ...STAMP], never)).toBe(0);
    expect(h.lines.join("\n")).toContain(`DRY RUN: ${cmd} opened no connection`);
    expect(h.db.log).toEqual([]);
  });

  it("prints the exact snapshot, apply and rollback statements", async () => {
    const h = await withPlan();
    await h.run("snapshot", "--plan", "plan.json", ...STAMP);
    await h.run("apply", "--plan", "plan.json", ...STAMP);
    await h.run("rollback", "--plan", "plan.json", ...STAMP);
    const text = h.text();
    expect(text).toContain("CREATE TABLE `_bak_invoices_shopclock_20261015` LIKE `invoices`");
    expect(text).toContain("INSERT INTO `_bak_invoices_shopclock_20261015` SELECT * FROM `invoices` WHERE `id` IN (630001, 2910001, 2910002)");
    expect(text).not.toMatch(/CREATE TABLE .* AS SELECT/);
    expect(text).toContain("UPDATE `invoices` SET `invoiceDate` = ?, `updatedAt` = `updatedAt` WHERE `id` = ? AND `invoiceDate` = ?   -- 3 rows");
    expect(text).toContain('["2026-09-10 19:41:07",630001,"2026-09-10 23:41:07"]');
    expect(text).toContain('["2026-09-10 23:41:07",630001,"2026-09-10 19:41:07"]');
  });

  it.each(["snapshot", "apply", "rollback"])("%s does connect once --execute is given (so the dry-run test is not vacuous)", async (cmd) => {
    const h = await withPlan();
    await h.run(cmd, "--plan", "plan.json", ...STAMP, "--execute");
    expect(h.db.connectCalls).toBe(1);
  });

  it("treats a misspelled flag as an error, never as a silent dry run", async () => {
    const h = await withPlan();
    expect(await h.run("apply", "--plan", "plan.json", ...STAMP, "--exec")).toBe(2);
    expect(await h.run("apply", "--plan", "plan.json", ...STAMP, "--execute=true")).toBe(2);
    expect(await h.run("frobnicate")).toBe(2);
    expect(h.db.connectCalls).toBe(0);
  });

  it("refuses a plan file that was edited", async () => {
    const h = await withPlan();
    h.files.set("plan.json", h.files.get("plan.json")!.replace("2026-10-12 20:05:30", "2026-10-12 21:05:30"));
    expect(await h.run("apply", "--plan", "plan.json", ...STAMP, "--execute")).toBe(1);
    expect(h.text()).toContain("plan file hash does not match its content");
    expect(h.db.connectCalls).toBe(0);
  });
});

describe("a plan only runs against the database it was read from", () => {
  it.each(["snapshot", "apply", "rollback"])("%s refuses another host and writes nothing", async (cmd) => {
    const source = harness();
    await planned(source);
    const other = harness(seed(), { DATABASE_URL: "mysql://u:p@other-host.example:4000/nickstire" });
    other.files.set("plan.json", source.files.get("plan.json")!);
    expect(await other.run(cmd, "--plan", "plan.json", ...STAMP, "--execute")).toBe(1);
    expect(other.text()).toContain("the plan was read from gateway01.example.tidbcloud.com/nickstire but this run is connected to other-host.example/nickstire");
    expect(other.db.log.filter((s) => /^(CREATE|INSERT|UPDATE|START)/.test(s))).toEqual([]);
  });

  it("refuses another database name on the same host", async () => {
    const source = harness();
    await planned(source);
    const other = harness(seed(), { DATABASE_URL: "mysql://u:p@gateway01.example.tidbcloud.com:4000/staging" });
    other.files.set("plan.json", source.files.get("plan.json")!);
    expect(await other.run("apply", "--plan", "plan.json", ...STAMP, "--execute")).toBe(1);
    expect(other.text()).toContain("/nickstire but this run is connected to gateway01.example.tidbcloud.com/staging");
  });
});

describe("snapshot", () => {
  it("copies exactly the planned rows into a backup table and verifies the count", async () => {
    const h = harness();
    await planned(h);
    expect(await h.run("snapshot", "--plan", "plan.json", ...STAMP, "--execute")).toBe(0);
    expect(h.db.backups.get("_bak_invoices_shopclock_20261015")?.map((r) => r.id)).toEqual([630001, 2910001, 2910002]);
    expect(h.db.backups.has("_bak_alg_estimates_shopclock_20261015")).toBe(false);
    expect(h.text()).toContain("backup _bak_invoices_shopclock_20261015: 3 rows (plan 3)");
  });

  it("refuses to run over an existing backup", async () => {
    const h = harness();
    await planned(h);
    await h.run("snapshot", "--plan", "plan.json", ...STAMP, "--execute");
    expect(await h.run("snapshot", "--plan", "plan.json", ...STAMP, "--execute")).toBe(1);
    expect(h.text()).toContain("already exists; refusing to overwrite a backup");
  });

  it("aborts when the copied row count does not match the plan", async () => {
    const h = harness();
    await planned(h);
    h.db.beforeStatement = (sql) => {
      if (sql.startsWith("INSERT INTO")) h.db.backups.get("_bak_invoices_shopclock_20261015")!.push(row(1, "x", "y"));
    };
    expect(await h.run("snapshot", "--plan", "plan.json", ...STAMP, "--execute")).toBe(1);
    expect(h.text()).toMatch(/has 4 rows, the plan has 3; backup left in place, do not apply/);
  });
});

describe("apply", () => {
  async function snapshotted(db: FakeDb = seed()): Promise<Harness> {
    const h = harness(db);
    await planned(h);
    expect(await h.run("snapshot", "--plan", "plan.json", ...STAMP, "--execute")).toBe(0);
    h.lines.length = 0;
    return h;
  }
  const apply = (h: Harness, ...extra: string[]) => h.run("apply", "--plan", "plan.json", ...STAMP, "--execute", ...extra);

  it("corrects the planned rows by compare-and-swap, keeps updatedAt, and leaves everything else", async () => {
    const h = await snapshotted();
    expect(await apply(h)).toBe(0);
    expect(stored(h.db, 630001)).toBe("2026-09-10 19:41:07");
    expect(stored(h.db, 2910001)).toBe("2026-10-12 20:05:30");
    expect(stored(h.db, 2910002)).toBe("2026-10-12 10:10:11");
    for (const id of [3000001, 3000002, 3000003, 3000010, 3000011, 3000012]) expect(stored(h.db, id)).toBe(seed().tables.invoices.find((r) => r.id === id)!.stored);
    expect(h.db.tables.alg_estimates).toEqual(seed().tables.alg_estimates);
    expect(h.db.tables.invoices.every((r) => r.updated === "2026-10-01 00:00:00")).toBe(true);
    expect(h.text()).toContain("updatedAt moved on 0 of 3 rows (expected 0)");
    expect(h.text()).not.toContain("updatedAt preserved");
    expect(h.text()).toContain("apply done: 3 updated, 0 already at target, 1 batch(es)");
    expect(h.db.updates().every((s) => s.includes("WHERE `id` = ? AND `invoiceDate` = ?"))).toBe(true);
  });

  it("lets updatedAt move only when asked", async () => {
    const h = await snapshotted();
    expect(await apply(h, "--preserve-updated-at", "false")).toBe(0);
    expect(h.db.tables.invoices.find((r) => r.id === 630001)!.updated).toBe("2026-10-16 09:00:00");
    expect(h.text()).toContain("updatedAt moved on 3 of 3 rows (expected any)");
    expect(await apply(h, "--preserve-updated-at", "maybe")).toBe(2);
  });

  it("resumes: a second run skips rows already at their target", async () => {
    const h = await snapshotted();
    await apply(h);
    h.lines.length = 0;
    expect(await apply(h)).toBe(0);
    expect(h.text()).toContain("apply done: 0 updated, 3 already at target, 1 batch(es)");
  });

  it("measures from the backup whether updatedAt moved, after the last batch", async () => {
    const h = await snapshotted();
    await apply(h);
    const text = h.text();
    expect(text).toContain("updatedAt moved on 0 of 3 rows (expected 0)");
    expect(text.indexOf("invoices batch 1/1")).toBeLessThan(text.indexOf("updatedAt moved on"));
    expect(text.indexOf("updatedAt moved on")).toBeLessThan(text.indexOf("apply done"));
  });

  const ROLLBACK_CMD = "railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/backfills/backfill-shop-clock.ts rollback --plan plan.json --stamp 20261015 --execute";

  it("fails with exit 3 when updatedAt moved although it was to be preserved, and says how to roll back", async () => {
    const db = seed();
    db.ignoreSelfAssign = true;
    const h = await snapshotted(db);
    expect(await apply(h)).toBe(3);
    const text = h.text();
    expect(text).toContain("updatedAt moved on 3 of 3 rows (expected 0)");
    expect(text).toContain("FAILED: updatedAt moved on 3 of 3 rows although --preserve-updated-at is true");
    expect(text).toContain(ROLLBACK_CMD);
    expect(text).toContain("Backups kept: _bak_invoices_shopclock_20261015");
    expect(h.db.backups.has("_bak_invoices_shopclock_20261015")).toBe(true);
    expect(h.db.log.filter((s) => /^DROP/.test(s))).toEqual([]);
  });

  it("does not fail when updatedAt moved and the flag said it could (informational)", async () => {
    const h = await snapshotted();
    expect(await apply(h, "--preserve-updated-at", "false")).toBe(0);
    expect(h.text()).toContain("updatedAt moved on 3 of 3 rows (expected any)");
    expect(h.text()).not.toContain("FAILED: updatedAt");
  });

  it("fails as UNVERIFIED when the measurement query throws, and the dates stay corrected", async () => {
    const h = await snapshotted();
    h.db.beforeStatement = (sql) => {
      if (sql.startsWith("SELECT COUNT(*) AS `moved`")) throw new Error("connection reset");
    };
    expect(await apply(h)).toBe(3);
    expect(h.text()).toContain("updatedAt preservation UNVERIFIED: connection reset");
    expect(h.text()).toContain(ROLLBACK_CMD);
    expect(h.text()).toContain("Backups kept: _bak_invoices_shopclock_20261015");
    expect(stored(h.db, 630001)).toBe("2026-09-10 19:41:07");
  });

  it.each([["a null count", [{ moved: null }]], ["no row", []], ["text", [{ moved: "many" }]], ["a negative number", [{ moved: -1 }]], ["no row list", { moved: 0 }]])("fails as UNVERIFIED when the measurement returns %s", async (_why, override) => {
    const h = await snapshotted();
    h.db.movedOverride = override;
    expect(await apply(h)).toBe(3);
    expect(h.text()).toContain("updatedAt preservation UNVERIFIED:");
  });

  it("accepts a count the driver returns as numeric text", async () => {
    const h = await snapshotted();
    h.db.movedOverride = [{ moved: "0" }];
    expect(await apply(h)).toBe(0);
  });

  it("keeps an unreadable measurement informational when preserving was not asked for", async () => {
    const h = await snapshotted();
    h.db.beforeStatement = (sql) => {
      if (sql.startsWith("SELECT COUNT(*) AS `moved`")) throw new Error("connection reset");
    };
    expect(await apply(h, "--preserve-updated-at", "false")).toBe(0);
    expect(h.text()).toContain("updatedAt check could not run: connection reset");
  });

  it("is followed by a verify that is clean even though feed rows keep their UTC digits", async () => {
    const h = await snapshotted();
    expect(await h.run("verify", ...CLASSIFY)).toBe(1);
    await apply(h);
    h.lines.length = 0;
    expect(await h.run("verify", ...CLASSIFY)).toBe(0);
    expect(h.text()).toContain("verify ok (sources: manual,stripe; estimate-sources: none): zero needs_correction, zero snap_double_converted, zero post_cutoff_utc_match, zero other_anomaly");
    expect(h.text()).toMatch(/invoices: 9 rows; already_correct=4 needs_correction=0 snap_double_converted=0 post_cutoff_utc_match=0 feed_owned_utc=4 other=1/);
  });

  it("refuses when the backup row count differs from the plan", async () => {
    const h = await snapshotted();
    h.db.backups.get("_bak_invoices_shopclock_20261015")!.pop();
    expect(await apply(h)).toBe(1);
    expect(h.text()).toContain("has 2 rows but the plan has 3; refusing to apply");
    expect(h.db.updates()).toEqual([]);
    expect(stored(h.db, 630001)).toBe("2026-09-10 23:41:07");
  });

  it("refuses when the backup holds different ids than the plan", async () => {
    const h = await snapshotted();
    h.db.backups.get("_bak_invoices_shopclock_20261015")![0].id = 999;
    expect(await apply(h)).toBe(1);
    expect(h.text()).toContain("holds different ids than the plan");
    expect(h.db.updates()).toEqual([]);
  });

  it("refuses when a backup row's saved date was altered after the snapshot", async () => {
    const h = await snapshotted();
    h.db.backups.get("_bak_invoices_shopclock_20261015")![1].stored = "2026-10-13 00:05:31";
    expect(await apply(h)).toBe(1);
    expect(h.text()).toContain("backup invoices#2910001 holds 2026-10-13 00:05:31 but the plan expects 2026-10-13 00:05:30; refusing to apply");
    expect(h.db.updates()).toEqual([]);
    expect(h.db.log).not.toContain("START TRANSACTION");
    expect(stored(h.db, 2910001)).toBe("2026-10-13 00:05:30");
  });

  it("refuses a backup copy that has the right ids but the wrong values", async () => {
    const h = await snapshotted();
    for (const r of h.db.backups.get("_bak_invoices_shopclock_20261015")!) r.stored = "2026-01-01 00:00:00";
    expect(await apply(h)).toBe(1);
    expect(h.text()).toContain("backup invoices#630001 holds 2026-01-01 00:00:00 but the plan expects 2026-09-10 23:41:07; refusing to apply");
    expect(h.db.updates()).toEqual([]);
  });

  it("refuses when there is no backup at all", async () => {
    const h = harness();
    await planned(h);
    expect(await apply(h)).toBe(1);
    expect(h.text()).toContain("does not exist; run snapshot first");
    expect(h.db.updates()).toEqual([]);
  });

  it("rolls the batch back and reports when the driver throws mid-batch", async () => {
    const h = await snapshotted();
    h.db.beforeStatement = (sql, params) => {
      if (sql.startsWith("UPDATE") && params[1] === 2910002) throw new Error("connection reset");
    };
    expect(await apply(h)).toBe(1);
    expect(h.text()).toContain("ERROR (unexpected): connection reset");
    expect(h.db.log.at(-1)).toBe("ROLLBACK");
    expect(stored(h.db, 630001)).toBe("2026-09-10 23:41:07");
  });
});

describe("apply: compare-and-swap miss stops the run", () => {
  function bulk(n: number): FakeDb {
    const invoices: FakeRow[] = [];
    for (let i = 1; i <= n; i++) {
      const d = msToDigits(Date.UTC(2026, 8, 1, 12, 0, 7) + i * 3_600_000);
      invoices.push(row(i, d, d));
    }
    return new FakeDb({ invoices, alg_estimates: [row(7003, "2026-08-03 16:00:03", "2026-07-01 09:00:00", "alg")] });
  }
  async function ready(n: number): Promise<Harness> {
    const h = harness(bulk(n));
    await planned(h);
    expect(await h.run("snapshot", "--plan", "plan.json", ...STAMP, "--execute")).toBe(0);
    h.lines.length = 0;
    h.db.log.length = 0;
    return h;
  }
  const apply = (h: Harness) => h.run("apply", "--plan", "plan.json", ...STAMP, "--execute");
  const clobber = (h: Harness, id: number) => {
    h.db.beforeStatement = (sql, params) => {
      if (sql.startsWith("UPDATE") && params[1] === id) h.db.externalWrite(id, "2026-01-01 00:00:00");
    };
  };

  it("with a miss in the first batch: nothing is kept and no later row is touched", async () => {
    const h = await ready(205);
    const originals = clone(h.db.tables.invoices);
    clobber(h, 150);
    expect(await apply(h)).toBe(1);
    expect(h.text()).toContain("STOPPED on invoices#150: expected");
    expect(h.text()).toContain("found 2026-01-01 00:00:00");
    expect(h.text()).toContain("0 batch(es) committed");
    expect(h.db.updates()).toHaveLength(150);
    expect(h.db.log).toContain("ROLLBACK");
    expect(h.db.log).not.toContain("COMMIT");
    expect(h.db.tables.invoices.filter((r) => r.stored !== originals.find((o) => o.id === r.id)!.stored).map((r) => r.id)).toEqual([150]);
  });

  it("with a miss in the second batch: the first batch stays, the second is rolled back, the rest never run", async () => {
    const h = await ready(205);
    const originals = clone(h.db.tables.invoices);
    clobber(h, 203);
    expect(await apply(h)).toBe(1);
    expect(h.text()).toContain("STOPPED on invoices#203");
    expect(h.text()).toContain("1 batch(es) committed, 200 updated, 0 already at target");
    expect(h.db.updates()).toHaveLength(203);
    const changed = h.db.tables.invoices.filter((r) => r.stored !== originals.find((o) => o.id === r.id)!.stored).map((r) => r.id);
    expect(changed).toEqual([...Array(200).keys()].map((i) => i + 1).concat(203));
    expect(stored(h.db, 201)).toBe(originals[200].stored);
    expect(stored(h.db, 205)).toBe(originals[204].stored);
  });

  it("resumes after the cause is fixed: the committed batch is skipped, the rest is applied", async () => {
    const h = await ready(205);
    const original203 = h.db.tables.invoices.find((r) => r.id === 203)!.stored;
    clobber(h, 203);
    await apply(h);
    h.db.beforeStatement = undefined;
    h.db.tables.invoices.find((r) => r.id === 203)!.stored = original203;
    h.lines.length = 0;
    expect(await apply(h)).toBe(0);
    expect(h.text()).toContain("invoices batch 1/2: updated 0, already at target 200");
    expect(h.text()).toContain("invoices batch 2/2: updated 5, already at target 0");
  });

  it("exits 3, not 1, when a miss stops the run after updatedAt already moved", async () => {
    const h = await ready(205);
    h.db.ignoreSelfAssign = true;
    clobber(h, 203);
    expect(await apply(h)).toBe(3);
    expect(h.text()).toContain("STOPPED on invoices#203");
    expect(h.text()).toContain("FAILED: updatedAt moved on 200 of 205 rows although --preserve-updated-at is true");
  });

  it("applies everything when nothing interferes (control)", async () => {
    const h = await ready(205);
    expect(await apply(h)).toBe(0);
    expect(h.text()).toContain("apply done: 205 updated, 0 already at target, 2 batch(es)");
  });

  it("casMigrate honours a small batch size and stops at the first miss", async () => {
    const db = bulk(7);
    const items = db.tables.invoices.map((r) => ({ table: "invoices", id: r.id, expected: r.stored, next: "2030-01-01 00:00:00" }));
    db.tables.invoices[4].stored = "2026-01-01 00:00:00";
    const lines: string[] = [];
    const result = await casMigrate(db.conn(), items, { preserveUpdatedAt: true, batchSize: 2, out: (l) => void lines.push(l) });
    expect(result.miss).toMatchObject({ table: "invoices", id: 5, found: "2026-01-01 00:00:00" });
    expect(result).toMatchObject({ updated: 4, batches: 2 });
    expect(db.updates()).toHaveLength(5);
  });
});

describe("rollback", () => {
  async function applied(): Promise<Harness> {
    const h = harness();
    await planned(h);
    await h.run("snapshot", "--plan", "plan.json", ...STAMP, "--execute");
    await h.run("apply", "--plan", "plan.json", ...STAMP, "--execute");
    h.lines.length = 0;
    h.db.log.length = 0;
    return h;
  }
  const rollback = (h: Harness) => h.run("rollback", "--plan", "plan.json", ...STAMP, "--execute");

  it("restores the original digits and leaves verify with work to do again", async () => {
    const h = await applied();
    expect(await rollback(h)).toBe(0);
    expect(h.db.tables.invoices).toEqual(seed().tables.invoices);
    expect(h.text()).toContain("rollback done: 3 updated");
    expect(await h.run("verify", ...CLASSIFY)).toBe(1);
  });

  it("fails with exit 3 when updatedAt moved during the rollback, keeping the backups", async () => {
    const h = await applied();
    h.db.ignoreSelfAssign = true;
    expect(await rollback(h)).toBe(3);
    expect(h.text()).toContain("FAILED: updatedAt moved on 3 of 3 rows although --preserve-updated-at is true");
    expect(h.text()).toContain("Backups kept: _bak_invoices_shopclock_20261015");
    expect(h.db.tables.invoices.find((r) => r.id === 630001)!.stored).toBe("2026-09-10 23:41:07");
  });

  it("reports an unreadable updatedAt measurement as UNVERIFIED too", async () => {
    const h = await applied();
    h.db.movedOverride = [{ moved: null }];
    expect(await rollback(h)).toBe(3);
    expect(h.text()).toContain("updatedAt preservation UNVERIFIED:");
  });

  it("is repeatable: a second rollback finds every row already restored", async () => {
    const h = await applied();
    await rollback(h);
    h.lines.length = 0;
    expect(await rollback(h)).toBe(0);
    expect(h.text()).toContain("rollback done: 0 updated, 3 already at target");
  });

  it("stops on a row someone changed after the apply", async () => {
    const h = await applied();
    h.db.tables.invoices.find((r) => r.id === 2910001)!.stored = "2026-10-12 21:00:00";
    expect(await rollback(h)).toBe(1);
    expect(h.text()).toContain("STOPPED on invoices#2910001");
    expect(stored(h.db, 630001)).toBe("2026-09-10 19:41:07");
  });

  it("refuses when the backup no longer holds the plan's original value", async () => {
    const h = await applied();
    h.db.backups.get("_bak_invoices_shopclock_20261015")![0].stored = "2026-09-10 23:41:08";
    expect(await rollback(h)).toBe(1);
    expect(h.text()).toContain("refusing to roll back");
    expect(h.db.updates()).toEqual([]);
  });
});

describe("environment", () => {
  it("needs DATABASE_URL and never connects without it", async () => {
    const h = harness(seed(), {});
    expect(await h.run("probe", ...CLASSIFY)).toBe(1);
    expect(h.text()).toContain("DATABASE_URL is not set");
    expect(h.db.connectCalls).toBe(0);
  });

  it("parses the host and database name without the credentials", () => {
    expect(describeTarget(URL_WITH_SECRETS)).toEqual({ host: "gateway01.example.tidbcloud.com", database: "nickstire" });
    expect(() => describeTarget("not a url")).toThrow(/not a valid connection URL/);
  });

  it("does not echo a malformed DATABASE_URL", async () => {
    const h = harness(seed(), { DATABASE_URL: "svc_user:s3cretPass@nowhere" });
    expect(await h.run("probe", ...CLASSIFY)).toBe(1);
    expect(h.text()).not.toContain("s3cretPass");
  });
});
