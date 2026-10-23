/**
 * scripts/brain-hygiene/dedupe-blind-spots.ts (2026-10-23).
 * Plan, cluster rules, and the write path against a recording fake Db. No test here opens a connection;
 * the spawn probes for the dry-run guard live in brain-hygiene-run.test.ts.
 */
import { describe, expect, it } from "vitest";
import { CAS_SQL, PAIRS_SQL, ROWS_SQL, planDedupe, spec, type Row } from "@/scripts/brain-hygiene/dedupe-blind-spots";
import { fakeDb, normalize } from "./_lib/brain-hygiene-harness";

const row = (id: string, createdMs: number, verdict: string | null = null): Row => ({
  id,
  createdMs,
  verdict,
  upd: `u-${id}`,
  seen: `s-${id}`,
  seenCount: 1,
});

describe("planDedupe - which twin survives", () => {
  it("keeps the oldest of a cluster and supersedes the rest to it", () => {
    const rows = [row("c", 3), row("a", 1), row("b", 2)];
    const plan = planDedupe([{ a: "a", b: "b" }, { a: "b", b: "c" }], rows);
    expect(plan.clusters).toBe(1);
    expect(plan.losers.map((l) => [l.id, l.keeperId]).sort()).toEqual([["b", "a"], ["c", "a"]]);
  });

  it("a connected chain is one cluster even when the ends are not direct twins", () => {
    const plan = planDedupe([{ a: "a", b: "b" }, { a: "b", b: "c" }], [row("a", 1), row("b", 2), row("c", 3)]);
    expect(plan.losers).toHaveLength(2);
  });

  it("two clusters keep one row each; a row with no twin is untouched", () => {
    const rows = [row("a", 1), row("b", 2), row("x", 3), row("y", 4), row("solo", 5)];
    const plan = planDedupe([{ a: "a", b: "b" }, { a: "x", b: "y" }], rows);
    expect(plan.clusters).toBe(2);
    expect(plan.losers.map((l) => l.id).sort()).toEqual(["b", "y"]);
  });

  it("a judged row is never superseded; the oldest judged row becomes the keeper", () => {
    const rows = [row("old", 1), row("judged-new", 5, "noise"), row("mid", 3)];
    const plan = planDedupe([{ a: "old", b: "judged-new" }, { a: "old", b: "mid" }], rows);
    expect(plan.losers.map((l) => l.id).sort()).toEqual(["mid", "old"]);
    expect(plan.losers.every((l) => l.keeperId === "judged-new")).toBe(true);
  });

  it("a pair naming a row that is no longer live is dropped, never guessed", () => {
    const plan = planDedupe([{ a: "a", b: "gone" }], [row("a", 1)]);
    expect(plan.losers).toEqual([]);
  });

  it("equal creation times break ties by id, so two runs pick the same keeper", () => {
    const plan = planDedupe([{ a: "b", b: "a" }], [row("b", 1), row("a", 1)]);
    expect(plan.losers).toEqual([expect.objectContaining({ id: "b", keeperId: "a" })]);
  });
});

describe("the compare-and-swap names every field the decision read", () => {
  const sql = normalize(CAS_SQL);
  it.each([
    "b.id = c.id",
    "b.category = 'blind_spot'",
    "b.deleted_at IS NULL",
    "b.superseded_by_id IS NULL",
    "(CASE WHEN jsonb_exists(b.metadata, 'discoveryVerdict') THEN b.metadata->>'discoveryVerdict' ELSE b.discovery_verdict END) IS NULL",
    "b.updated_at::text = c.upd",
    "b.last_seen::text = c.seen",
    "b.seen_count = c.seen_count",
    "k.id = c.keeper_id",
    "k.deleted_at IS NULL",
    "k.superseded_by_id IS NULL",
  ])("pins %s", (frag) => {
    expect(sql).toContain(frag);
  });
  it("soft-deletes and supersedes; there is no DELETE statement anywhere", () => {
    expect(sql).toContain("SET deleted_at = now(), superseded_by_id = c.keeper_id");
    expect(spec.plan().join("\n")).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });
});

function world(opts: { backupRows?: number; backupExists?: boolean; cas?: number; judged?: string; throwOnCas?: boolean } = {}) {
  const ids = ["a", "b", "c", "d"];
  return fakeDb((sql, params, kind) => {
    const s = normalize(sql);
    if (s.includes("<=>")) return [{ a: "a", b: "b" }, { a: "b", b: "c" }, { a: "c", b: "d" }];
    if (s.includes("FROM brain_memories") && s.includes("created_ms")) {
      return ids.map((id, i) => ({ id, created_ms: 1000 + i, verdict: id === opts.judged ? "noise" : null, upd: `u-${id}`, seen: `s-${id}`, seen_count: 1 }));
    }
    if (s.includes("to_regclass")) return [{ present: opts.backupExists === true }];
    if (s.startsWith("CREATE TABLE")) return 0;
    if (s.startsWith("INSERT INTO _bak_")) return 3;
    if (s.includes("FROM _bak_")) return [{ n: opts.backupRows ?? 3 }];
    if (s.startsWith("UPDATE brain_memories")) {
      if (opts.throwOnCas) throw new Error("connection reset");
      return opts.cas ?? 3;
    }
    if (s.includes("superseded_by_id IS NOT NULL")) return [{ n: opts.cas ?? 3 }];
    throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
  });
}

describe("execute - backup, swap, count, rollback, in that order", () => {
  it("happy path: 3 losers of one cluster of 4", async () => {
    const w = world();
    const log: string[] = [];
    const code = await spec.execute(w.db, { expect: 3, today: "20261023", log: (s) => log.push(s) });
    expect(code).toBe(0);
    const order = w.calls.map((c) => normalize(c.sql).split(" ").slice(0, 3).join(" "));
    const create = order.findIndex((o) => o.startsWith("CREATE TABLE"));
    const count = w.calls.findIndex((c) => normalize(c.sql).includes("FROM _bak_"));
    const update = order.findIndex((o) => o.startsWith("UPDATE brain_memories"));
    expect(create).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(create);
    expect(update).toBeGreaterThan(count);
    expect(normalize(w.calls[create].sql)).toBe("CREATE TABLE _bak_brain_memories_blindspot_dedup_20261023 (LIKE brain_memories)");
    const insert = w.calls.find((c) => normalize(c.sql).startsWith("INSERT INTO _bak_brain_memories_blindspot_dedup_20261023 SELECT * FROM brain_memories WHERE id = ANY($1::text[])"));
    expect(insert?.params[0]).toEqual(["b", "c", "d"]);
    expect(w.calls.indexOf(insert!)).toBeLessThan(count);
    // rollback is printed BEFORE the swap, then repeated at the end
    const text = log.join("\n");
    expect(text).toContain("FROM _bak_brain_memories_blindspot_dedup_20261023 k");
    expect(text.indexOf("ROLLBACK")).toBeLessThan(text.indexOf("swapped"));
    // the swap carries the exact rows read: 3 ids, 3 keepers, the read versions
    const upd = w.calls[update];
    expect(upd.params[0]).toEqual(["b", "c", "d"]);
    expect(upd.params[1]).toEqual(["a", "a", "a"]);
    expect(upd.params[2]).toEqual(["u-b", "u-c", "u-d"]);
  });

  it("a backup that disagrees with the read aborts BEFORE the swap", async () => {
    const w = world({ backupRows: 2 });
    const code = await spec.execute(w.db, { expect: 3, today: "20261023", log: () => {} });
    expect(code).toBe(1);
    expect(w.calls.some((c) => normalize(c.sql).startsWith("UPDATE brain_memories"))).toBe(false);
  });

  it("an existing backup table is refused, not appended to", async () => {
    const w = world({ backupExists: true });
    const code = await spec.execute(w.db, { expect: 3, today: "20261023", log: () => {} });
    expect(code).toBe(1);
    expect(w.calls.some((c) => normalize(c.sql).startsWith("CREATE TABLE"))).toBe(false);
  });

  it("a candidate set that moved since --read aborts before anything is created", async () => {
    const w = world();
    const code = await spec.execute(w.db, { expect: 99, today: "20261023", log: () => {} });
    expect(code).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|UPDATE)/.test(normalize(c.sql)))).toBe(false);
  });

  it("a swap that lost rows to a concurrent change reports it and exits non-zero", async () => {
    const w = world({ cas: 2 });
    const code = await spec.execute(w.db, { expect: 3, today: "20261023", log: () => {} });
    expect(code).toBe(1);
  });
});

describe("read lines carry counts and ids only", () => {
  it("prints the removable count and ids, and no row text field is ever selected", async () => {
    const w = world();
    const r = await spec.read(w.db);
    expect(r.count).toBe(3);
    expect(r.lines.join("\n")).toContain("removable");
    // metadata appears only inside the verdict expression, which yields the verdict string and never the JSON
    for (const c of w.calls) expect(normalize(c.sql).replace(/CASE WHEN jsonb_exists\(metadata.*?END AS verdict/, "")).not.toMatch(/\bcontent\b|\bmetadata\b/);
  });
});

describe("a verdict kept only in metadata counts as a verdict (readVerdict: metadata is the source, the column a mirror)", () => {
  it("the read returns the verdict the app would read: the metadata key when present, else the column", () => {
    const sql = normalize(ROWS_SQL);
    expect(sql).toContain("CASE WHEN jsonb_exists(metadata, 'discoveryVerdict') THEN metadata->>'discoveryVerdict' ELSE discovery_verdict END AS verdict");
  });

  it("a row judged only in metadata is never swapped and is keeper-eligible", async () => {
    // b reads as judged (the SQL above yields its metadata verdict); a, c, d are unjudged twins in one chain and all point at b.
    const w = world({ judged: "b" });
    const code = await spec.execute(w.db, { expect: 3, today: "20261023", log: () => {} });
    expect(code).toBe(0);
    const upd = w.calls.find((c) => normalize(c.sql).startsWith("UPDATE brain_memories"))!;
    expect(upd.params[0]).toEqual(["a", "c", "d"]);
    expect(upd.params[1]).toEqual(["b", "b", "b"]);
  });
});

describe("the pair read is deterministic", () => {
  it("a memory with two embedding rows always contributes the newest one", () => {
    expect(normalize(PAIRS_SQL)).toContain('ORDER BY "sourceId", "createdAt" DESC');
  });
});

describe("rollback and failure reporting", () => {
  it("the printed rollback only touches rows this script superseded", async () => {
    const w = world();
    const log: string[] = [];
    await spec.execute(w.db, { expect: 3, today: "20261023", log: (s) => log.push(s) });
    expect(log.join("\n")).toContain("AND b.superseded_by_id IS NOT NULL AND b.deleted_at IS NOT NULL");
  });

  it("a throw in the swap names the backup and the rows already swapped, then rethrows", async () => {
    const w = world({ throwOnCas: true });
    const log: string[] = [];
    await expect(spec.execute(w.db, { expect: 3, today: "20261023", log: (s) => log.push(s) })).rejects.toThrow("connection reset");
    expect(log.join("\n")).toContain("backup _bak_brain_memories_blindspot_dedup_20261023: 0 of 3 rows already swapped; rollback SQL above");
  });
});
