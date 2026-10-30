/**
 * scripts/brain-hygiene/_run.ts - the dry-run guard (2026-10-23).
 *
 * prod-db-guard: a flag is not a guard until a non-executing check proves the script returns before any
 * connection or write. Two layers: (1) the runner with an injected connect that must not be called,
 * (2) the REAL scripts spawned under a preload that exits 97 on any network attempt.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { backupExists, backupName, dbHost, findBackups, parseArgs, runHygiene, stamp, toCount, type Connection, type HygieneSpec } from "@/scripts/brain-hygiene/_run";
import { APP_ROOT, fakeDb, normalize, spawnScript } from "./_lib/brain-hygiene-harness";

const SCRIPTS = [
  "scripts/brain-hygiene/dedupe-blind-spots.ts",
  "scripts/brain-hygiene/close-overdue-replays.ts",
  "scripts/brain-hygiene/apply-decay.ts",
  "scripts/brain-hygiene/backfill-trust-tier.ts",
];
/** Additive backfills have no backup table, so they skip the backup-shaped scan; their own tests scan for removals. */
const SPAWNED = [...SCRIPTS, "scripts/brain-hygiene/backfill-chat-distills.ts"];

function harness(count = 7) {
  const connect = vi.fn(async (): Promise<Connection> => ({ db: { query: async () => [], exec: async () => 0 }, close: vi.fn(async () => {}) }));
  const executed = vi.fn(async () => 0);
  const spec: HygieneSpec = {
    name: "t",
    plan: () => ["PLAN-LINE"],
    read: async () => ({ count, lines: ["READ-LINE"] }),
    execute: executed,
  };
  const out: string[] = [];
  return { connect, executed, spec, out, log: (s: string) => out.push(s) };
}

describe("parseArgs - only the exact tokens write", () => {
  it("no flag is a plan; --read is a read; --execute needs --expect and takes it in either order", () => {
    expect(parseArgs([])).toEqual({ ok: true, mode: "plan", expect: null });
    expect(parseArgs(["--read"])).toEqual({ ok: true, mode: "read", expect: null });
    expect(parseArgs(["--execute", "--expect=183"])).toEqual({ ok: true, mode: "execute", expect: 183 });
    expect(parseArgs(["--expect=183", "--execute"])).toEqual({ ok: true, mode: "execute", expect: 183 });
  });

  it.each([
    [["--execute"], "no approved count"],
    [["--execute=false"], "execute=false"],
    [["--execute=true", "--expect=1"], "execute=true"],
    [["--EXECUTE", "--expect=1"], "upper case"],
    [["-x"], "short flag"],
    [["--exec", "--expect=1"], "prefix of the flag"],
    [["execute", "--expect=1"], "bare word"],
    [["--read", "--execute", "--expect=1"], "both modes"],
    [["--expect=1"], "expect without execute"],
    [["--execute", "--expect=-1"], "negative count"],
    [["--execute", "--expect=1.5"], "fractional count"],
    [["--execute", "--expect="], "empty count"],
    [["--execute", "--expect=1; DROP TABLE x"], "injected count"],
  ])("%j is refused (%s)", (argv) => {
    const p = parseArgs(argv as string[]);
    expect(p.ok).toBe(false);
  });
});

describe("runHygiene - the plan returns before any connection", () => {
  it("POSITIVE CONTROL: --read does call connect, so the 'not called' assertions below mean something", async () => {
    const h = harness();
    expect(await runHygiene(h.spec, ["--read"], {}, h.connect, h.log)).toBe(0);
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.executed).not.toHaveBeenCalled();
  });

  it("no flag: exit 0, connect never called, plan lines printed, host printed first", async () => {
    const h = harness();
    const code = await runHygiene(h.spec, [], { DATABASE_URL: "postgres://u:pw@db.example.test/x" }, h.connect, h.log);
    expect(code).toBe(0);
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.out[0]).toBe("database host : db.example.test");
    expect(h.out).toContain("PLAN-LINE");
  });

  it.each([["--execute=false"], ["--EXECUTE"], ["--execute"], ["--bogus"]])("%s never connects and never writes", async (flag) => {
    const h = harness();
    expect(await runHygiene(h.spec, [flag], {}, h.connect, h.log)).toBe(2);
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.executed).not.toHaveBeenCalled();
  });

  it("a credential in DATABASE_URL never reaches the log; an unparseable URL is not echoed", async () => {
    const h = harness();
    await runHygiene(h.spec, [], { DATABASE_URL: "postgres://user:hunter2@host.example.test/x" }, h.connect, h.log);
    expect(h.out.join("\n")).not.toContain("hunter2");
    expect(dbHost({ DATABASE_URL: "not a url hunter2" })).toBe("(unparseable)");
    expect(dbHost({})).toBe("(unset)");
  });
});

describe("runHygiene - --execute is bound to the approved count", () => {
  it("a different count aborts before execute() with exit 1; the matching count runs it once", async () => {
    const h = harness(7);
    expect(await runHygiene(h.spec, ["--execute", "--expect=8"], {}, h.connect, h.log)).toBe(1);
    expect(h.executed).not.toHaveBeenCalled();
    expect(h.out.join("\n")).toContain("ABORT: candidate count is 7, --expect=8");
    expect(await runHygiene(h.spec, ["--execute", "--expect=7"], {}, h.connect, h.log)).toBe(0);
    expect(h.executed).toHaveBeenCalledTimes(1);
  });

  it("the connection is closed even when execute() throws", async () => {
    const h = harness(1);
    const close = vi.fn(async () => {});
    const connect = vi.fn(async (): Promise<Connection> => ({ db: { query: async () => [], exec: async () => 0 }, close }));
    h.spec.execute = async () => {
      throw new Error("boom");
    };
    await expect(runHygiene(h.spec, ["--execute", "--expect=1"], {}, connect, h.log)).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("helpers", () => {
  it("backup names follow the house pattern and refuse junk", () => {
    expect(backupName("brain_memories", "blindspot_dedup", "20261023")).toBe("_bak_brain_memories_blindspot_dedup_20261023");
    expect(() => backupName("x; DROP TABLE y", "op", "20261023")).toThrow();
    expect(stamp(new Date("2026-10-23T03:00:00Z"))).toBe("20261023");
  });
  it("toCount fails closed instead of reading a bad value as zero", () => {
    expect(toCount("12")).toBe(12);
    expect(() => toCount(undefined)).toThrow();
    expect(() => toCount(-1)).toThrow();
    expect(() => toCount("x")).toThrow();
  });
});

describe("catalog queries select no bare `name` column (rehearsal 2026-10-23)", () => {
  // Prisma $queryRawUnsafe cannot deserialize Postgres type `name` (pg_tables.tablename is one). The fake Db cannot
  // see Prisma's deserializer, so the SQL text is pinned here; the real-binary proof is the Neon-branch re-run.
  it("findBackups casts tablename to text", async () => {
    const w = fakeDb(() => [{ tablename: "_bak_brain_memories_decay_20261022" }]);
    expect(await findBackups(w.db, "_bak_brain_memories_decay_")).toEqual(["_bak_brain_memories_decay_20261022"]);
    const sql = normalize(w.calls[0].sql);
    expect(sql).toContain("SELECT tablename::text AS tablename FROM pg_tables");
    expect(sql).not.toMatch(/SELECT tablename FROM/);
  });

  it("backupExists selects a boolean, never a regclass", async () => {
    const w = fakeDb(() => [{ present: false }]);
    await backupExists(w.db, "_bak_x_y_20261023");
    expect(normalize(w.calls[0].sql)).toBe("SELECT to_regclass($1) IS NOT NULL AS present");
  });

  it.each([...SCRIPTS, "scripts/brain-hygiene/_run.ts"])("%s: every catalog read casts what it selects", (rel) => {
    const lines = readFileSync(`${APP_ROOT}/${rel}`, "utf8")
      .split("\n")
      .filter((l) => /pg_tables|pg_class|information_schema|pg_namespace|pg_catalog/.test(l) && /SELECT/i.test(l));
    for (const l of lines) expect(l, "a catalog SELECT without ::text").toMatch(/::text|COUNT\(\*\)::int/);
    if (rel.endsWith("_run.ts")) expect(lines.length, "POSITIVE CONTROL: the scan found the pg_tables read").toBeGreaterThan(0);
  });
});

describe("no script can remove a row", () => {
  const code = (rel: string) =>
    readFileSync(`${APP_ROOT}/${rel}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  it.each(SCRIPTS)("%s has no DELETE, DROP or TRUNCATE statement, and is not a stub", (rel) => {
    const src = code(rel);
    expect(src, "POSITIVE CONTROL: the scan sees the script's real SQL").toMatch(/INSERT INTO \$\{bak\} SELECT/);
    expect(src).not.toMatch(/\bDELETE\s+FROM\b|\bDROP\s+(TABLE|INDEX|COLUMN)\b|\bTRUNCATE\b/i);
  });
  it("the planted positive is caught by the same scan", () => {
    expect("x = `DELETE FROM brain_memories`").toMatch(/\bDELETE\s+FROM\b/i);
  });
});

describe("the real scripts, spawned with a bogus DATABASE_URL and a network trap", () => {
  it("POSITIVE CONTROL: the trap fires on a TCP connect in the same invocation shape", () => {
    const r = spawnSync(
      process.execPath,
      ["--require", `${APP_ROOT}/tests/scripts/_lib/no-network.cjs`, "-e", "require('node:net').connect(5432, 'invalid.invalid')"],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(97);
    expect(`${r.stderr}`).toContain("NETWORK_ATTEMPT");
  });

  describe.each(SPAWNED)("%s", (rel) => {
    it("no flag: exit 0, host printed, plan only, no network attempt", () => {
      const r = spawnScript(rel, []);
      expect(r.out).not.toContain("NETWORK_ATTEMPT");
      expect(r.out).toContain("database host : invalid.invalid");
      expect(r.out).toContain("PLAN ONLY");
      expect(r.out).not.toContain("secret-pw");
      expect(r.status).toBe(0);
    });

    it.each([["--execute=false"], ["--EXECUTE"], ["--execute"], ["--expect=1"]])("%s is refused before any network", (flag) => {
      const r = spawnScript(rel, [flag]);
      expect(r.out).not.toContain("NETWORK_ATTEMPT");
      expect(r.out).toContain("REFUSED");
      expect(r.status).toBe(2);
    });

    it("flag order does not matter, and only the exact --execute --expect=N pair reaches the network", () => {
      const r = spawnScript(rel, ["--expect=1", "--execute"]);
      expect(r.out).toContain("mode          : EXECUTE");
      expect(r.out).toContain("NETWORK_ATTEMPT");
      expect(r.status).toBe(97);
    });

    it("--read reaches the network (so the plan-mode silence above is not a dead instrument)", () => {
      const r = spawnScript(rel, ["--read"]);
      expect(r.out).toContain("mode          : READ");
      expect(r.out).toContain("NETWORK_ATTEMPT");
      expect(r.status).toBe(97);
    });
  });
});
