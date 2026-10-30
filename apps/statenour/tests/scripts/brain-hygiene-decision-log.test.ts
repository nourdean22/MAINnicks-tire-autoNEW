/**
 * scripts/brain-hygiene/backfill-decision-log.ts (brain backfill W6, 2026-10-30).
 * Measured on prod 2026-10-30 (read-only): 19 live decisions, 0 decision_log rows keyed decision_<n>.
 */
import { describe, expect, it } from "vitest";
import { classifyTrustTier } from "@/lib/brain/memory-trust";
import { RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
import {
  BACKFILL_TAG,
  CATEGORY,
  CONFIDENCE,
  INSERT_SQL,
  READ_SQL,
  SOURCE,
  TRUST_TIER,
  rollbackSql,
  spec,
} from "@/scripts/brain-hygiene/backfill-decision-log";
import { fakeDb, normalize, spawnScript } from "./_lib/brain-hygiene-harness";

describe("the row matches what journalDecision writes for a new decision (lib/ai/tools/tasks.ts)", () => {
  const tasks = () => require("node:fs").readFileSync(`${process.cwd()}/lib/ai/tools/tasks.ts`, "utf8") as string;

  it("same category, key shape, source and confidence as the live writer", () => {
    const src = tasks();
    expect(src).toMatch(/category: BRAIN_CATEGORIES\.DECISION_LOG,\s*key: `decision_\$\{decision\.id\}`/);
    expect(src).toMatch(/confidence: 0\.8,\s*source: "decision_journal"/);
    expect(CATEGORY).toBe("decision_log");
    expect(SOURCE).toBe("decision_journal");
    expect(CONFIDENCE).toBe(0.8);
    expect(normalize(INSERT_SQL)).toContain("'decision_' || d.id::text");
  });

  it("content follows the live writer's shape, and a missing field drops its clause instead of printing null", () => {
    expect(tasks()).toContain('`Decision: "${title}" — chose "${chosen}" (${stakes} stakes). Reasoning: ${reasoning}`');
    const sql = normalize(INSERT_SQL);
    expect(sql).toContain(`'Decision: "' || d.title || '"'`);
    expect(sql).toContain(`coalesce(' ' || chr(8212) || ' chose "' || nullif(trim(d.chosen), '') || '"', '')`);
    expect(sql).toContain(`coalesce(' (' || nullif(trim(d.stakes), '') || ' stakes)', '')`);
    expect(sql).toContain(`coalesce(' Reasoning: ' || nullif(trim(d.reasoning), ''), '')`);
  });

  it("no expiry (remember() would give 24h) and valid_from is the decision's own date", () => {
    const sql = normalize(INSERT_SQL);
    expect(sql).toMatch(/\$3, \$4, NULL,/); // confidence, source, expires_at NULL
    expect(sql).toContain("now(), d.created_at, $6");
  });

  it("the trust tier comes from the shared resolver for the live writer's provenance", () => {
    expect(TRUST_TIER).toBe(classifyTrustTier(SOURCE, "system", CATEGORY));
  });

  it("decision_log is not in the list recall excludes (contextual-recall.ts), so the rows reach recall", () => {
    const excluded = RECALL_EXCLUDE_CATEGORIES as readonly string[];
    expect(excluded).not.toContain(CATEGORY);
    expect(excluded).toContain("mastery_xp_event"); // POSITIVE CONTROL: the list is the real one
  });
});

describe("the claim is atomic and never revives or overwrites", () => {
  it("candidates exclude a key that exists in ANY state, soft-deleted included", () => {
    const sql = normalize(READ_SQL);
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM brain_memories bm WHERE bm.category = $1 AND bm.key = 'decision_' || d.id::text)");
    expect(sql).not.toMatch(/bm\.deleted_at/);
  });

  it("the insert is ON CONFLICT DO NOTHING on the (category, key) unique and returns only what it inserted", () => {
    const sql = normalize(INSERT_SQL);
    expect(sql).toContain("ON CONFLICT (category, key) DO NOTHING RETURNING id");
    expect(sql).not.toMatch(/\bDO UPDATE\b|\bUPDATE brain_memories\b|\bDELETE\b/i);
  });

  it("the rollback soft-deletes only the inserted ids, and only rows this script tagged", () => {
    const sql = rollbackSql(["a1", "b'2"]);
    expect(sql).toContain("SET deleted_at = now()");
    expect(sql).toContain("WHERE id IN ('a1', 'b''2')");
    expect(sql).toContain(`source = 'decision_journal' AND metadata->>'backfill' = '${BACKFILL_TAG}'`);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(rollbackSql([])).toContain("WHERE id IN (NULL)"); // an empty run rolls back nothing
  });
});

function world(opts: { ids?: number[]; inserted?: string[] } = {}) {
  const ids = opts.ids ?? [1, 2, 3];
  return fakeDb((sql) => {
    const s = normalize(sql);
    if (s.startsWith("SELECT d.id")) return ids.map((id) => ({ id }));
    if (s.startsWith("INSERT INTO brain_memories")) return (opts.inserted ?? ids.map((i) => `m${i}`)).map((id) => ({ id }));
    throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
  });
}

describe("execute", () => {
  it("inserts the read ids with the live writer's values and prints a rollback naming the inserted rows", async () => {
    const w = world();
    const log: string[] = [];
    expect(await spec.execute(w.db, { expect: 3, today: "20261030", log: (s) => log.push(s) })).toBe(0);
    const ins = w.calls.find((c) => normalize(c.sql).startsWith("INSERT"));
    expect(ins?.params).toEqual([[1, 2, 3], "decision_log", 0.8, "decision_journal", BACKFILL_TAG, TRUST_TIER]);
    expect(log.join("\n")).toContain("WHERE id IN ('m1', 'm2', 'm3')");
  });

  it("a count that moved since --read aborts before any write", async () => {
    const w = world();
    expect(await spec.execute(w.db, { expect: 5, today: "20261030", log: () => {} })).toBe(1);
    expect(w.calls.some((c) => normalize(c.sql).startsWith("INSERT"))).toBe(false);
  });

  it("a key another writer took between read and insert is skipped, reported, and exits non-zero", async () => {
    const w = world({ inserted: ["m1", "m3"] });
    const log: string[] = [];
    expect(await spec.execute(w.db, { expect: 3, today: "20261030", log: (s) => log.push(s) })).toBe(1);
    expect(log.join("\n")).toContain("inserted 2 of 3");
    expect(log.join("\n")).toContain("WHERE id IN ('m1', 'm3')");
  });

  it("nothing to do writes nothing", async () => {
    const w = world({ ids: [] });
    expect(await spec.execute(w.db, { expect: 0, today: "20261030", log: () => {} })).toBe(0);
    expect(w.calls.some((c) => normalize(c.sql).startsWith("INSERT"))).toBe(false);
  });
});

describe("the real script under a no-network preload", () => {
  const rel = "scripts/brain-hygiene/backfill-decision-log.ts";

  it("plan mode opens no connection", () => {
    const r = spawnScript(rel, []);
    expect(r.out).not.toContain("NETWORK_ATTEMPT");
    expect(r.out).toContain("PLAN ONLY");
    expect(r.out).not.toContain("secret-pw");
    expect(r.status).toBe(0);
  });

  it("--read does reach the network (so the plan-mode silence is not a dead instrument)", () => {
    const r = spawnScript(rel, ["--read"]);
    expect(r.out).toContain("NETWORK_ATTEMPT");
    expect(r.status).toBe(97);
  });
});
