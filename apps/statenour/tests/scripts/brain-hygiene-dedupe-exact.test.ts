/**
 * scripts/brain-hygiene/dedupe-exact.ts (brain backfill W4, 2026-10-30).
 * Measured on prod 2026-10-30 (read-only): 1,049 recall-visible exact-duplicate rows in 591 groups
 * (archive_document 845, journal_brain_take 89, telemetry_temporal_warn 43, emotional_state 31, insight 23).
 * The plan-mode network guard is spawned in brain-hygiene-run.test.ts.
 */
import { describe, expect, it } from "vitest";
import { isVisibleAsOf } from "@/lib/brain/contextual-recall";
import { TELEMETRY_CATEGORIES } from "@/lib/brain/embedding-policy";
import { CAS_SQL, DEDUPE_CATEGORIES, GROUPS_SQL, planExactDedupe, spec, type Row } from "@/scripts/brain-hygiene/dedupe-exact";
import { fakeDb, normalize } from "./_lib/brain-hygiene-harness";

const r = (id: string, category: string, h: string, createdMs: number): Row => ({ id, category, h, createdMs, upd: `u${id}`, seen: `s${id}`, seenCount: 1 });

describe("what recall does with a superseded row (the consumer, before anything is marked)", () => {
  const t0 = new Date("2026-10-30T18:00:00Z");
  const base = { createdAt: new Date("2026-06-01T00:00:00Z") };

  it("live recall drops a row whose superseded_by_id is set", () => {
    expect(isVisibleAsOf({ ...base, supersededById: "keeper" })).toBe(false);
    expect(isVisibleAsOf({ ...base, supersededById: null })).toBe(true); // POSITIVE CONTROL
  });

  it("as-of recall ignores superseded_by_id, so the dedupe also sets valid_until: then the row is history, not belief", () => {
    const after = new Date("2026-10-31T00:00:00Z");
    const before = new Date("2026-10-01T00:00:00Z");
    expect(isVisibleAsOf({ ...base, supersededById: "keeper" }, after)).toBe(true); // the gap this script closes
    expect(isVisibleAsOf({ ...base, supersededById: "keeper", validUntil: t0 }, after)).toBe(false);
    expect(isVisibleAsOf({ ...base, supersededById: "keeper", validUntil: t0 }, before)).toBe(true); // history stays readable as-of
  });
});

describe("telemetry_temporal_warn is telemetry", () => {
  it("is excluded from recall and embedding with the other telemetry categories (68 recall-visible rows, 43 duplicates)", () => {
    expect((TELEMETRY_CATEGORIES as readonly string[]).includes("telemetry_temporal_warn")).toBe(true);
  });
});

describe("only categories nobody reads by key", () => {
  // A row read by (category, key) cannot lose to an older copy: the reader would find the tombstone. Census
  // 2026-10-30 (git grep of findUnique/findFirst/category_key in lib + app): these five have 0 key reads.
  it("the allowlist is exactly the five key-free categories from the census", () => {
    expect([...DEDUPE_CATEGORIES].sort()).toEqual(["archive_document", "emotional_state", "industry_intel", "insight", "nick_advice"]);
  });

  it.each(["journal_brain_take", "anticipated_question", "scoreboard_pinned", "blind_spot", "identity_snapshot", "qualitative_identity", "chat_summary", "conversation_summary", "task_lesson"])(
    "%s (read by key) is never deduped",
    (c) => {
      expect(DEDUPE_CATEGORIES).not.toContain(c);
    },
  );

  it("the grouping SQL is bound to the allowlist", () => {
    expect(normalize(GROUPS_SQL)).toContain("bm.category = ANY($2::text[])");
  });
});

describe("planExactDedupe", () => {
  it("keeps the oldest row of each (category, content hash) group and supersedes the rest onto it", () => {
    const { groups, losers } = planExactDedupe([r("b", "insight", "h1", 2), r("a", "insight", "h1", 1), r("c", "insight", "h1", 3), r("d", "insight", "h2", 1)]);
    expect(groups).toBe(1);
    expect(losers.map((l) => [l.id, l.keeperId])).toEqual([["b", "a"], ["c", "a"]]);
  });

  it("never merges across categories, even with the same content", () => {
    const { losers } = planExactDedupe([r("a", "insight", "h1", 1), r("b", "concern", "h1", 2)]);
    expect(losers).toEqual([]);
  });

  it("breaks a created_at tie by id, so two runs pick the same keeper", () => {
    const { losers } = planExactDedupe([r("z", "insight", "h1", 5), r("m", "insight", "h1", 5)]);
    expect(losers.map((l) => [l.id, l.keeperId])).toEqual([["z", "m"]]);
  });
});

describe("the SQL", () => {
  it("groups recall-visible rows only and reads hashes and ids, never content", () => {
    const sql = normalize(GROUPS_SQL);
    expect(sql).toContain("md5(bm.content)");
    expect(sql).not.toMatch(/SELECT[^(]*\bbm\.content\b(?!\))/);
    expect(sql).toContain("bm.deleted_at IS NULL");
    expect(sql).toContain("bm.superseded_by_id IS NULL");
    expect(sql).toContain("NOT (bm.category = ANY($1::text[]))");
  });

  it.each([
    "b.id = c.id",
    "b.deleted_at IS NULL",
    "b.superseded_by_id IS NULL",
    "b.category = c.category",
    "md5(b.content) = c.h",
    "b.updated_at::text = c.upd",
    "b.last_seen::text = c.seen",
    "b.seen_count = c.seen_count",
    "k.deleted_at IS NULL AND k.superseded_by_id IS NULL AND md5(k.content) = c.h",
  ])("the swap pins %s", (frag) => {
    expect(normalize(CAS_SQL)).toContain(frag);
  });

  it("supersedes softly: deleted_at, superseded_by_id and valid_until, never a DELETE", () => {
    const sql = normalize(CAS_SQL);
    expect(sql).toContain("SET deleted_at = now(), superseded_by_id = c.keeper_id, valid_until = now(), updated_at = now()");
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });
});

function world(opts: { rows?: Row[]; backupRows?: number; backupExists?: boolean; cas?: number; recount?: number } = {}) {
  const rows = opts.rows ?? [r("a", "insight", "h1", 1), r("b", "insight", "h1", 2), r("c", "insight", "h1", 3)];
  const losers = planExactDedupe(rows).losers.length;
  return fakeDb((sql) => {
    const s = normalize(sql);
    if (s.includes("GROUP BY") && s.includes("md5")) return rows.map((x) => ({ id: x.id, category: x.category, h: x.h, created_ms: x.createdMs, upd: x.upd, seen: x.seen, seen_count: x.seenCount }));
    if (s.includes("to_regclass")) return [{ present: opts.backupExists === true }];
    if (s.startsWith("CREATE TABLE")) return 0;
    if (s.startsWith("INSERT INTO _bak_")) return losers;
    if (s.includes("FROM _bak_")) return [{ n: opts.backupRows ?? losers }];
    if (s.startsWith("UPDATE brain_memories")) return opts.cas ?? losers;
    if (s.includes("superseded_by_id IS NOT NULL")) return [{ n: opts.recount ?? opts.cas ?? losers }];
    throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
  });
}

describe("execute", () => {
  it("backs up the losers first, swaps them onto the keeper, prints a rollback for the four columns it wrote", async () => {
    const w = world();
    const log: string[] = [];
    expect(await spec.execute(w.db, { expect: 2, today: "20261030", log: (s) => log.push(s) })).toBe(0);
    const stmts = w.calls.map((c) => normalize(c.sql));
    const create = stmts.findIndex((s) => s.startsWith("CREATE TABLE _bak_brain_memories_exact_dedup_20261030 (LIKE brain_memories)"));
    const update = stmts.findIndex((s) => s.startsWith("UPDATE brain_memories"));
    expect(create).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(create);
    expect(w.calls[update].params[0]).toEqual(["b", "c"]);
    expect(w.calls[update].params[1]).toEqual(["a", "a"]);
    expect(log.join("\n")).toMatch(/ROLLBACK[\s\S]*deleted_at = k\.deleted_at, superseded_by_id = k\.superseded_by_id, valid_until = k\.valid_until, updated_at = k\.updated_at/);
  });

  it("a count that moved since --read aborts before the backup", async () => {
    const w = world();
    expect(await spec.execute(w.db, { expect: 5, today: "20261030", log: () => {} })).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|UPDATE)/.test(normalize(c.sql)))).toBe(false);
  });

  it("an existing backup table aborts before anything is written", async () => {
    const w = world({ backupExists: true });
    expect(await spec.execute(w.db, { expect: 2, today: "20261030", log: () => {} })).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|UPDATE)/.test(normalize(c.sql)))).toBe(false);
  });

  it("a backup count that disagrees aborts before the swap", async () => {
    const w = world({ backupRows: 1 });
    expect(await spec.execute(w.db, { expect: 2, today: "20261030", log: () => {} })).toBe(1);
    expect(w.calls.some((c) => normalize(c.sql).startsWith("UPDATE"))).toBe(false);
  });

  it("a partial swap exits non-zero", async () => {
    const w = world({ cas: 1, recount: 1 });
    expect(await spec.execute(w.db, { expect: 2, today: "20261030", log: () => {} })).toBe(1);
  });
});
