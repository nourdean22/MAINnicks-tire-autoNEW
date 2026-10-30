/**
 * scripts/brain-hygiene/backfill-trust-tier.ts (brain backfill W3, 2026-10-30).
 * The write path against a recording fake Db; the plan-mode network guard is spawned in brain-hygiene-run.test.ts.
 */
import { describe, expect, it } from "vitest";
import { resolveTrustTier } from "@/lib/brain/memory-trust";
import { CAS_SQL, READ_SQL, spec, tierFor } from "@/scripts/brain-hygiene/backfill-trust-tier";
import { fakeDb, normalize } from "./_lib/brain-hygiene-harness";

const ROWS = [
  { id: "r1", source: "cleantechnica", created_by: "system", category: "industry_intel", admission: null },
  { id: "r2", source: "manual", created_by: "system", category: "archive_document", admission: null },
  { id: "r3", source: "conversation_abc", created_by: "system", category: "conversation_summary", admission: null },
  { id: "r4", source: "pack:baltasar-gracian", created_by: "system", category: "wisdom", admission: null },
  { id: "r5", source: "session_distiller", created_by: "system", category: "chat_summary", admission: { memoryKind: "derived", extractionMethod: "llm_extract" } },
  { id: "r6", source: "manual", created_by: "user", category: "inbound_sms", admission: null }, // category outranks the user shortcut
  { id: "r7", source: null, created_by: "user", category: "insight", admission: null },
];

describe("the stored tier never loosens what readers resolve", () => {
  it.each(ROWS.map((r) => [r.id, r]))("%s: resolving with the stored tier equals resolving with NULL", (_id, r) => {
    const row = { source: r.source, createdBy: r.created_by, category: r.category, metadata: r.admission ? { admission: r.admission } : null };
    const stored = tierFor(r);
    expect(resolveTrustTier({ ...row, trustTier: stored })).toBe(resolveTrustTier({ ...row, trustTier: null }));
    expect(stored).toBe(resolveTrustTier({ ...row, trustTier: null }));
  });

  it("POSITIVE CONTROL: a looser stored value would be caught by the same comparison it never fires on", () => {
    const row = { source: "cleantechnica", createdBy: "system", category: "industry_intel", metadata: null };
    expect(resolveTrustTier({ ...row, trustTier: "OPERATOR" })).toBe("EXTERNAL_CONTENT"); // tighten-only
    expect(tierFor({ ...ROWS[0] })).toBe("EXTERNAL_CONTENT");
  });
});

describe("reads", () => {
  it("selects provenance fields only, never content, and only live NULL-tier rows", () => {
    const sql = normalize(READ_SQL);
    expect(sql).not.toMatch(/\bcontent\b/);
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).toContain("trust_tier IS NULL");
  });
});

describe("the compare-and-swap names every field the decision read", () => {
  const sql = normalize(CAS_SQL);
  it.each(["b.id = c.id", "b.trust_tier IS NULL", "b.deleted_at IS NULL", "b.source IS NOT DISTINCT FROM c.source", "b.category = c.category", "b.created_by IS NOT DISTINCT FROM c.created_by", "(b.metadata->'admission') IS NOT DISTINCT FROM c.admission::jsonb"])("pins %s", (frag) => {
    expect(sql).toContain(frag);
  });
  it("writes only trust_tier: no updated_at, no delete", () => {
    expect(sql).toMatch(/SET trust_tier = c\.tier/);
    expect(sql).not.toMatch(/updated_at|\bDELETE\b/i);
  });
});

function world(opts: { count?: number; backupRows?: number; backupExists?: boolean; cas?: number } = {}) {
  const rows = ROWS.slice(0, opts.count ?? ROWS.length);
  return fakeDb((sql, _params, _kind) => {
    const s = normalize(sql);
    if (s.includes("FROM brain_memories") && s.includes("trust_tier IS NULL") && s.startsWith("SELECT id")) return rows;
    if (s.includes("to_regclass")) return [{ present: opts.backupExists === true }];
    if (s.startsWith("CREATE TABLE")) return 0;
    if (s.startsWith("INSERT INTO _bak_")) return rows.length;
    if (s.includes("FROM _bak_")) return [{ n: opts.backupRows ?? rows.length }];
    if (s.startsWith("UPDATE brain_memories")) return opts.cas ?? rows.length;
    if (s.includes("still_null")) return [{ still_null: rows.length - (opts.cas ?? rows.length) }];
    throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
  });
}

describe("execute", () => {
  it("backs up ids + old tier first, swaps with the resolved tier per row, prints the rollback", async () => {
    const w = world();
    const log: string[] = [];
    expect(await spec.execute(w.db, { expect: ROWS.length, today: "20261030", log: (s) => log.push(s) })).toBe(0);
    const stmts = w.calls.map((c) => normalize(c.sql));
    const create = stmts.findIndex((s) => s.startsWith("CREATE TABLE _bak_brain_memories_trust_null_20261030"));
    const update = stmts.findIndex((s) => s.startsWith("UPDATE brain_memories"));
    expect(create).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(create);
    const p = w.calls[update].params;
    expect(p[0]).toEqual(ROWS.map((r) => r.id));
    expect(p[1]).toEqual(["EXTERNAL_CONTENT", "OPERATOR", "AGENT_INFERRED", "SYSTEM_DERIVED", "AGENT_INFERRED", "EXTERNAL_CONTENT", "OPERATOR"]);
    expect(log.join("\n")).toMatch(/ROLLBACK[\s\S]*SET trust_tier = NULL[\s\S]*FROM _bak_brain_memories_trust_null_20261030 k/);
  });

  it("a count that moved since --read aborts before the backup", async () => {
    const w = world({ count: 3 });
    expect(await spec.execute(w.db, { expect: ROWS.length, today: "20261030", log: () => {} })).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|UPDATE)/.test(normalize(c.sql)))).toBe(false);
  });

  it("an existing backup table aborts before anything is written", async () => {
    const w = world({ backupExists: true });
    expect(await spec.execute(w.db, { expect: ROWS.length, today: "20261030", log: () => {} })).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|UPDATE)/.test(normalize(c.sql)))).toBe(false);
  });

  it("a backup count that disagrees aborts before the swap", async () => {
    const w = world({ backupRows: 2 });
    expect(await spec.execute(w.db, { expect: ROWS.length, today: "20261030", log: () => {} })).toBe(1);
    expect(w.calls.some((c) => normalize(c.sql).startsWith("UPDATE"))).toBe(false);
  });

  it("a partial swap (rows that moved) exits non-zero and says how many", async () => {
    const w = world({ cas: 5 });
    const log: string[] = [];
    expect(await spec.execute(w.db, { expect: ROWS.length, today: "20261030", log: (s) => log.push(s) })).toBe(1);
    expect(log.join("\n")).toContain("set 5 of 7");
  });
});
