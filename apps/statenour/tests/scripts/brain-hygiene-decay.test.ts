/**
 * scripts/brain-hygiene/apply-decay.ts (2026-10-23).
 * The exemption list, the candidate query, batching and the write path against a recording fake Db.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BATCH, CAS_SQL, EXTRA_EXEMPT, candidateSql, spec } from "@/scripts/brain-hygiene/apply-decay";
import { APP_ROOT, fakeDb, normalize } from "./_lib/brain-hygiene-harness";

const BASE = "last_seen < $1 AND confidence > 0.1 AND expires_at IS NULL AND deleted_at IS NULL AND category <> ALL($2::text[])";

describe("the exemption list", () => {
  it("POSITIVE CONTROL: tool_embedding is exempt, and embedding-policy.ts still says tool search reads those rows", () => {
    expect(EXTRA_EXEMPT).toContain("tool_embedding");
    const policy = readFileSync(`${APP_ROOT}/lib/brain/embedding-policy.ts`, "utf8");
    expect(policy).toMatch(/`tool_embedding` is deliberately NOT here/);
  });

  it("the exemption reaches the candidate query as a bound array, not as prose", () => {
    const sql = normalize(candidateSql(BASE));
    expect(sql).toContain("category <> ALL($3::text[])");
  });

  it("the swap re-asserts the same exemption, so a row recategorized between read and write is skipped", () => {
    expect(normalize(CAS_SQL)).toContain("category <> ALL($");
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

function world(n: number, opts: { backupRows?: number; changed?: number } = {}) {
  const batchesApplied: number[] = [];
  const w = fakeDb((sql, params) => {
    const s = normalize(sql);
    if (s.includes("buildDecayWhere")) throw new Error("should not be sent as SQL");
    if (s.startsWith("SELECT id, confidence::text")) {
      return Array.from({ length: n }, (_v, i) => ({ id: `m${i}`, conf: "0.5", seen: `s${i}` }));
    }
    if (s.includes("to_regclass")) return [{ present: false }];
    if (s.startsWith("CREATE TABLE")) return 0;
    if (s.includes("FROM _bak_") && s.includes("b.confidence < k.confidence")) return [{ n: opts.changed ?? n }];
    if (s.includes("FROM _bak_")) return [{ n: opts.backupRows ?? n }];
    if (s.startsWith("UPDATE brain_memories")) {
      const size = (params[2] as string[]).length;
      batchesApplied.push(size);
      return size;
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
    expect(await spec.execute(w.db, ctx(2500, log), { base: { where: BASE, params: [new Date(0), ["wisdom"]] } })).toBe(0);
    expect(w.batchesApplied).toEqual([1000, 1000, 500]);
    expect(log.join("\n")).toContain("ROLLBACK");
  });

  it("the candidate read is sent the exempt list including tool_embedding", async () => {
    const w = world(3);
    await spec.execute(w.db, ctx(3), { base: { where: BASE, params: [new Date(0), ["wisdom"]] } });
    const read = w.calls.find((c) => normalize(c.sql).startsWith("SELECT id, confidence::text"));
    expect(read).toBeDefined();
    expect(read!.params).toContainEqual(expect.arrayContaining(["tool_embedding"]));
  });

  it("backs up before the first batch, and a backup count mismatch aborts with no UPDATE sent", async () => {
    const ok = world(5);
    await spec.execute(ok.db, ctx(5), { base: { where: BASE, params: [new Date(0), []] } });
    const stmts = ok.calls.map((c) => normalize(c.sql));
    expect(stmts.findIndex((s) => s.startsWith("CREATE TABLE _bak_brain_memories_decay_20261023"))).toBeLessThan(stmts.findIndex((s) => s.startsWith("UPDATE")));

    const bad = world(5, { backupRows: 4 });
    expect(await spec.execute(bad.db, ctx(5), { base: { where: BASE, params: [new Date(0), []] } })).toBe(1);
    expect(bad.calls.some((c) => normalize(c.sql).startsWith("UPDATE"))).toBe(false);
  });

  it("a moved candidate count aborts before the backup", async () => {
    const w = world(5);
    expect(await spec.execute(w.db, ctx(9), { base: { where: BASE, params: [new Date(0), []] } })).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|UPDATE)/.test(normalize(c.sql)))).toBe(false);
  });

  it("a recount that finds fewer decayed rows than were swapped exits non-zero", async () => {
    const w = world(5, { changed: 3 });
    expect(await spec.execute(w.db, ctx(5), { base: { where: BASE, params: [new Date(0), []] } })).toBe(1);
  });
});
