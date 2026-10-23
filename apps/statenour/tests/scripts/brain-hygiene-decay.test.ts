/**
 * scripts/brain-hygiene/apply-decay.ts (2026-10-23).
 * The exemption list, the candidate query, batching and the write path against a recording fake Db.
 */
import { describe, expect, it } from "vitest";
import { TELEMETRY_CATEGORIES } from "@/lib/brain/embedding-policy";
import { BATCH, CAS_SQL, EXTRA_EXEMPT, candidateSql, spec } from "@/scripts/brain-hygiene/apply-decay";
import { fakeDb, normalize } from "./_lib/brain-hygiene-harness";

const BASE = "last_seen < $1 AND confidence > 0.1 AND expires_at IS NULL AND deleted_at IS NULL AND category <> ALL($2::text[])";
const NEVER = ["wisdom", "pinned_user"];
const deps = { base: { where: BASE, params: [new Date(0), NEVER] as [Date, string[]] } };

describe("the exemption list", () => {
  it("tool_embedding is exempt here BECAUSE the telemetry denylist does not cover it", () => {
    expect(EXTRA_EXEMPT).toContain("tool_embedding");
    expect((TELEMETRY_CATEGORIES as readonly string[]).includes("tool_embedding")).toBe(false);
  });

  it("the exemption reaches the candidate query as a bound array, not as prose", () => {
    expect(normalize(candidateSql(BASE))).toContain("category <> ALL($3::text[])");
  });

  it("the swap re-asserts the same exemption in its SQL", () => {
    expect(normalize(CAS_SQL)).toContain("category <> ALL($4::text[])");
  });
});

describe("the compare-and-swap names every field the decision read", () => {
  const sql = normalize(CAS_SQL);
  it.each(["b.id = c.id", "b.confidence::text = c.conf", "b.last_seen::text = c.seen", "SET confidence = GREATEST(b.confidence - 0.05, 0.1)"])("pins %s", (frag) => {
    expect(sql).toContain(frag);
  });
  it("does not stamp updated_at (the GC's low-confidence arm keys on it) and never deletes", () => {
    expect(sql).not.toMatch(/updated_at\s*=/);
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });
});

function world(n: number, opts: { backupRows?: number; changed?: number; shortBatch?: number; throwOnBatch?: number; existing?: string[] } = {}) {
  const batchesApplied: number[] = [];
  const w = fakeDb((sql, params) => {
    const s = normalize(sql);
    if (s.includes("pg_tables")) return (opts.existing ?? []).map((tablename) => ({ tablename }));
    if (s.startsWith("SELECT id, confidence::text")) {
      return Array.from({ length: n }, (_v, i) => ({ id: `m${i}`, conf: "0.5", seen: `s${i}` }));
    }
    if (s.startsWith("CREATE TABLE")) return 0;
    if (s.startsWith("INSERT INTO _bak_")) return n;
    if (s.includes("FROM _bak_") && s.includes("b.confidence < k.confidence")) return [{ n: opts.changed ?? n }];
    if (s.includes("FROM _bak_")) return [{ n: opts.backupRows ?? n }];
    if (s.startsWith("UPDATE brain_memories")) {
      batchesApplied.push((params[0] as string[]).length);
      if (opts.throwOnBatch === batchesApplied.length) throw new Error("connection reset");
      const size = (params[0] as string[]).length;
      return opts.shortBatch === batchesApplied.length ? size - 1 : size;
    }
    throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
  });
  return { ...w, batchesApplied };
}

describe("execute", () => {
  const ctx = (n: number, log: string[] = []) => ({ expect: n, today: "20261023", log: (s: string) => log.push(s) });

  it("applies in batches of 1,000: 2,500 candidates are 3 statements of 1000, 1000, 500", async () => {
    expect(BATCH).toBe(1000);
    const w = world(2500);
    const log: string[] = [];
    expect(await spec.execute(w.db, ctx(2500, log), deps)).toBe(0);
    expect(w.batchesApplied).toEqual([1000, 1000, 500]);
    expect(log.join("\n")).toContain("ROLLBACK");
  });

  it("the candidate read AND the swap are sent the exempt list including tool_embedding", async () => {
    const w = world(3);
    await spec.execute(w.db, ctx(3), deps);
    const read = w.calls.find((c) => normalize(c.sql).startsWith("SELECT id, confidence::text"));
    expect(read!.params).toContainEqual(expect.arrayContaining(["tool_embedding"]));
    const swap = w.calls.find((c) => normalize(c.sql).startsWith("UPDATE brain_memories"));
    expect(swap!.params[3]).toEqual(expect.arrayContaining(["tool_embedding", ...NEVER]));
  });

  it("backs up before the first batch, and a backup count mismatch aborts with no UPDATE sent", async () => {
    const ok = world(5);
    await spec.execute(ok.db, ctx(5), deps);
    const stmts = ok.calls.map((c) => normalize(c.sql));
    expect(stmts.findIndex((s) => s.startsWith("CREATE TABLE _bak_brain_memories_decay_20261023"))).toBeLessThan(stmts.findIndex((s) => s.startsWith("UPDATE")));

    const bad = world(5, { backupRows: 4 });
    expect(await spec.execute(bad.db, ctx(5), deps)).toBe(1);
    expect(bad.calls.some((c) => normalize(c.sql).startsWith("UPDATE"))).toBe(false);
  });

  it("a moved candidate count aborts before the backup", async () => {
    const w = world(5);
    expect(await spec.execute(w.db, ctx(9), deps)).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|UPDATE)/.test(normalize(c.sql)))).toBe(false);
  });

  it("a recount that finds fewer decayed rows than were swapped exits non-zero", async () => {
    const w = world(5, { changed: 3 });
    expect(await spec.execute(w.db, ctx(5), deps)).toBe(1);
  });

  it("a swap that skipped rows (compare-and-swap lost a race) reports MISMATCH and exits 1", async () => {
    const w = world(5, { shortBatch: 1, changed: 4 }); // the recount agrees with the short swap, so only the swapped-vs-read check can catch it
    const log: string[] = [];
    expect(await spec.execute(w.db, ctx(5, log), deps)).toBe(1);
    expect(log.join("\n")).toContain("MISMATCH");
  });

  it("the printed rollback only touches rows this script lowered", async () => {
    const w = world(3);
    const log: string[] = [];
    await spec.execute(w.db, ctx(3, log), deps);
    expect(log.join("\n")).toContain("AND b.confidence < k.confidence");
  });
});

describe("the single-pass guard spans days, not just today's backup name", () => {
  const ctx = (n: number, log: string[] = []) => ({ expect: n, today: "20261023", log: (s: string) => log.push(s) });

  it("yesterday's backup table present: abort before any write, and say what to do", async () => {
    const w = world(5, { existing: ["_bak_brain_memories_decay_20261022"] });
    const log: string[] = [];
    expect(await spec.execute(w.db, ctx(5, log), deps)).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|INSERT|UPDATE)/.test(normalize(c.sql)))).toBe(false);
    expect(log.join("\n")).toContain("drop or rename it by hand after confirming");
    expect(log.join("\n")).toContain("_bak_brain_memories_decay_20261022");
  });

  it("today's backup table present: same refusal", async () => {
    const w = world(5, { existing: ["_bak_brain_memories_decay_20261023"] });
    expect(await spec.execute(w.db, ctx(5), deps)).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|INSERT|UPDATE)/.test(normalize(c.sql)))).toBe(false);
  });

  it("the lookup is a LIKE on the decay prefix with the underscores escaped", async () => {
    const w = world(2);
    await spec.execute(w.db, ctx(2), deps);
    const q = w.calls.find((c) => normalize(c.sql).includes("pg_tables"))!;
    expect(q.params[0]).toBe("\\_bak\\_brain\\_memories\\_decay\\_%");
  });
});

describe("a throw mid-run says where it stopped", () => {
  it("exec throws on batch 2: the log names the backup and how many rows were already swapped, then rethrows", async () => {
    const w = world(2500, { throwOnBatch: 2 });
    const log: string[] = [];
    await expect(spec.execute(w.db, { expect: 2500, today: "20261023", log: (s) => log.push(s) }, deps)).rejects.toThrow("connection reset");
    expect(log.join("\n")).toContain("backup _bak_brain_memories_decay_20261023: 1000 of 2500 rows already swapped; rollback SQL above");
  });
});
