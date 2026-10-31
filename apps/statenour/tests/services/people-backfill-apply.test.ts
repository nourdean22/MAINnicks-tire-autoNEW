/**
 * People W1 apply: the gate order (2026-10-30, manager ruling C).
 *
 * The plan lives in a LOCAL file the runner names; its token is a short
 * sha256 of that file, so nothing is written to production before Nour's
 * yes and nothing lands in the public repo. The apply is a production write,
 * so its order is the safety:
 *   1. a dry run unless --plan --out <path>, or --execute with BOTH
 *      --plan-file <path> and --token <t>; anything else exits before connecting;
 *   2. the file's own hash must equal --token, or nothing happens;
 *   3. the ledger is backed up and the backup count must equal the source
 *      count, or nothing is inserted;
 *   4. only then the file's rows, each through the once-per-window seam.
 */
import { describe, expect, it, vi } from "vitest";

import { backupInOneSnapshot, deserializePlan, fileToken, insertWithinWindow, parseApplyArgs, runApply, serializePlan } from "@/lib/services/people/backfill-apply";

const rows = [
  { personId: "p1", conversationId: "c1", start: new Date("2026-06-01T10:00:00Z"), at: new Date("2026-06-01T11:00:00Z"), interactionKind: "call", backfillKey: "bf:chat:c1:p1" },
  { personId: "p2", conversationId: "c2", start: new Date("2026-06-02T10:00:00Z"), at: new Date("2026-06-02T11:00:00Z"), interactionKind: null, backfillKey: "bf:chat:c2:p2" },
];
const planFile = serializePlan(rows);
const token = fileToken(planFile);

function deps() {
  return {
    backup: vi.fn(async () => ({ source: 42, backup: 42 })),
    insert: vi.fn(async (_r: { backfillKey: string }) => "inserted" as "inserted" | "skipped"),
  };
}

describe("parseApplyArgs", () => {
  it("defaults to a dry run with no model step (each model call writes a trace row)", () => {
    expect(parseApplyArgs([])).toMatchObject({ mode: "dry", withModel: false });
    expect(parseApplyArgs(["--with-model"])).toMatchObject({ mode: "dry", withModel: true });
    expect(parseApplyArgs(["--limit", "10"])).toMatchObject({ mode: "dry", limit: 10 });
  });

  it("--plan needs --out <path>", () => {
    expect(() => parseApplyArgs(["--plan"])).toThrow(/--out/);
    expect(parseApplyArgs(["--plan", "--out", "C:/tmp/plan.json"])).toMatchObject({ mode: "plan", out: "C:/tmp/plan.json" });
  });

  it("--execute needs BOTH --plan-file and --token, never silently a dry run", () => {
    expect(() => parseApplyArgs(["--execute"])).toThrow(/--plan-file/);
    expect(() => parseApplyArgs(["--execute", "--token", "0000-test-token"])).toThrow(/--plan-file/);
    expect(() => parseApplyArgs(["--execute", "--plan-file", "p.json"])).toThrow(/--token/);
    expect(() => parseApplyArgs(["--execute", "--plan-file", "--token", "abc"])).toThrow(/--plan-file/);
  });

  it("--execute with both is execute mode", () => {
    expect(parseApplyArgs(["--execute", "--plan-file", "p.json", "--token", "0000-test-token"])).toMatchObject({
      mode: "execute",
      planFile: "p.json",
      token: "0000-test-token",
    });
  });

  it("the old --apply flag is refused", () => {
    expect(() => parseApplyArgs(["--apply"])).toThrow(/--apply/);
  });
});

describe("fileToken", () => {
  it("is the file's short sha256: same bytes same token, one byte changed a different one", () => {
    expect(fileToken(planFile)).toMatch(/^[0-9a-f]{12}$/);
    expect(fileToken(serializePlan(rows))).toBe(token);
    expect(fileToken(planFile + " ")).not.toBe(token);
  });
});

describe("runApply gate order", () => {
  it("a token that does not match the file's hash touches nothing", async () => {
    const d = deps();
    const out = await runApply({ planFile, token: "000000000000", deps: d });
    expect(out.status).toBe("token_mismatch");
    expect(d.backup).not.toHaveBeenCalled();
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("an edited file (hash changed after review) is refused", async () => {
    const d = deps();
    const edited = serializePlan([...rows, { ...rows[0], conversationId: "c9", backfillKey: "bf:chat:c9:p1" }]);
    const out = await runApply({ planFile: edited, token, deps: d });
    expect(out.status).toBe("token_mismatch");
    expect(d.backup).not.toHaveBeenCalled();
  });

  it("a backup whose count differs from the source stops before any insert", async () => {
    const d = deps();
    d.backup.mockResolvedValue({ source: 42, backup: 41 });
    const out = await runApply({ planFile, token, deps: d });
    expect(out.status).toBe("backup_mismatch");
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("a failed backup stops before any insert", async () => {
    const d = deps();
    d.backup.mockRejectedValue(new Error("no space"));
    await expect(runApply({ planFile, token, deps: d })).rejects.toThrow("no space");
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("the right token backs up first, then inserts exactly the file's rows, and counts", async () => {
    const order: string[] = [];
    const d = deps();
    d.backup.mockImplementation(async () => {
      order.push("backup");
      return { source: 42, backup: 42 };
    });
    d.insert.mockImplementation(async (r: { backfillKey: string }) => {
      order.push(r.backfillKey);
      return r.backfillKey === "bf:chat:c2:p2" ? "skipped" : "inserted";
    });

    const out = await runApply({ planFile, token, deps: d });

    expect(order).toEqual(["backup", "bf:chat:c1:p1", "bf:chat:c2:p2"]);
    expect(out).toMatchObject({ status: "applied", inserted: 1, skipped: 1, failed: 0, backup: { source: 42, backup: 42 } });
  });

  it("a row that throws (person deleted since the plan) is counted as failed and the rest still run", async () => {
    const d = deps();
    d.insert.mockImplementation(async (r: { backfillKey: string }) => {
      if (r.backfillKey === "bf:chat:c1:p1") throw new Error("No person with id p1");
      return "inserted";
    });
    const out = await runApply({ planFile, token, deps: d });
    // Second reader on #3427: the reason is kept (ids only, no names), and a run with any
    // failure is never called plain "applied".
    expect(out).toMatchObject({
      status: "applied_with_failures",
      inserted: 1,
      skipped: 0,
      failed: 1,
      failures: [{ key: "bf:chat:c1:p1", error: "No person with id p1" }],
    });
  });

  it("an empty source table is refused like a count mismatch, before any insert (second reader on #3427)", async () => {
    const d = deps();
    d.backup.mockResolvedValue({ source: 0, backup: 0 });
    const out = await runApply({ planFile, token, deps: d });
    expect(out.status).toBe("backup_mismatch");
    expect(d.insert).not.toHaveBeenCalled();
  });
});

describe("insertWithinWindow (the apply's writer, Codex P1 on 3419)", () => {
  const row = rows[0]; // start 10:00, at 11:00

  it("writes when no contact sits inside [start, at], even if a LATER contact exists", async () => {
    const write = vi.fn(async () => undefined);
    const contactsBetween = vi.fn(async () => 0);
    expect(await insertWithinWindow(row, { personLive: async () => true, contactsBetween, write })).toBe("inserted");
    expect(contactsBetween).toHaveBeenCalledWith("p1", row.start, row.at);
    expect(write).toHaveBeenCalledWith(row);
  });

  it("skips without writing when a contact already sits inside the window", async () => {
    const write = vi.fn(async () => undefined);
    expect(await insertWithinWindow(row, { personLive: async () => true, contactsBetween: async () => 1, write })).toBe("skipped");
    expect(write).not.toHaveBeenCalled();
  });

  it("skips a person soft-deleted since the plan, before reading or writing anything (self-review on 3427)", async () => {
    const write = vi.fn(async () => undefined);
    const contactsBetween = vi.fn(async () => 0);
    const personLive = vi.fn(async () => false);
    expect(await insertWithinWindow(row, { personLive, contactsBetween, write })).toBe("skipped");
    expect(personLive).toHaveBeenCalledWith("p1");
    expect(contactsBetween).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe("backupInOneSnapshot (second reader on #3427)", () => {
  // A fake store: one transaction call, which commits when the callback returns and rolls back when it throws.
  function store(counts: { source: number; backup: number }, opts: { exists?: boolean } = {}) {
    const log: string[] = [];
    return {
      log,
      io: {
        inTransaction: async <T,>(fn: (q: { exec(sql: string): Promise<void>; count(t: string): Promise<number> }) => Promise<T>) => {
          log.push("begin");
          try {
            const out = await fn({
              exec: async (sql) => {
                if (opts.exists) throw Object.assign(new Error('relation "_bak" already exists'), { code: "42P07" });
                log.push(sql.startsWith("CREATE TABLE") ? "copy" : sql);
              },
              count: async (t) => (t === "relationship_ledger" ? counts.source : counts.backup),
            });
            log.push("commit");
            return out;
          } catch (err) {
            log.push("rollback");
            throw err;
          }
        },
      },
    };
  }

  it("copies and counts in ONE transaction and commits when the counts match", async () => {
    const s = store({ source: 42, backup: 42 });
    expect(await backupInOneSnapshot(s.io, "_bak")).toEqual({ source: 42, backup: 42 });
    expect(s.log).toEqual(["begin", "copy", "commit"]);
  });

  it("a count mismatch or an empty source rolls the copy back and returns the counts, so the next run is not blocked", async () => {
    for (const counts of [{ source: 42, backup: 41 }, { source: 0, backup: 0 }]) {
      const s = store(counts);
      expect(await backupInOneSnapshot(s.io, "_bak")).toEqual(counts);
      expect(s.log).toEqual(["begin", "copy", "rollback"]);
    }
  });

  it("a backup left by an earlier run is refused with the exact rerun step", async () => {
    const s = store({ source: 42, backup: 42 }, { exists: true });
    await expect(backupInOneSnapshot(s.io, "_bak")).rejects.toThrow(/already exists.*RENAME TO "_bak_run1"/s);
  });
});

describe("plan serialization", () => {
  it("round-trips ids, kind and times only", () => {
    expect(planFile).not.toMatch(/note|name/i);
    expect(deserializePlan(planFile)).toEqual(rows);
  });

  it("a malformed plan is refused", () => {
    expect(() => deserializePlan("{}")).toThrow();
    expect(() => deserializePlan(JSON.stringify([{ personId: "p1" }]))).toThrow();
  });
});
