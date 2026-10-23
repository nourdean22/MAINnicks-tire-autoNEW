/**
 * scripts/brain-hygiene/close-overdue-replays.ts (2026-10-23).
 * The write path against a recording fake Db; the dry-run guard spawn probes are in brain-hygiene-run.test.ts.
 */
import { describe, expect, it } from "vitest";
import { CAS_SQL, OUTCOME, spec } from "@/scripts/brain-hygiene/close-overdue-replays";
import { fakeDb, normalize } from "./_lib/brain-hygiene-harness";

describe("the compare-and-swap names every field the decision read", () => {
  const sql = normalize(CAS_SQL);
  it.each([
    "r.id = c.id",
    "r.reviewed = false",
    `r."reviewAt" <= now()`,
    `r."reviewAt"::text = c.review_at`,
    "r.outcome IS NULL",
    `r."reviewedAt" IS NULL`,
  ])("pins %s", (frag) => {
    expect(sql).toContain(frag);
  });

  it("closes without inventing a score, and never deletes", () => {
    expect(sql).toContain("SET reviewed = true");
    expect(sql).toContain(`"reviewedAt" = now()`);
    expect(sql).not.toMatch(/outcomeScore/);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(OUTCOME).toBe("not reviewed, expired");
  });
});

function world(opts: { backupRows?: number; cas?: number; count?: number } = {}) {
  const n = opts.count ?? 3;
  return fakeDb((sql, _params, _kind) => {
    const s = normalize(sql);
    if (s.includes("FROM decision_replays") && s.includes("review_at")) {
      return Array.from({ length: n }, (_v, i) => ({ id: `r${i}`, review_at: `t${i}` }));
    }
    if (s.includes("to_regclass")) return [{ present: false }];
    if (s.startsWith("CREATE TABLE")) return 0;
    if (s.startsWith("INSERT INTO _bak_")) return n;
    if (s.includes("FROM _bak_")) return [{ n: opts.backupRows ?? n }];
    if (s.startsWith("UPDATE decision_replays")) return opts.cas ?? n;
    if (s.includes("reviewed = true")) return [{ n: opts.cas ?? n }];
    throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
  });
}

describe("execute", () => {
  it("backs up first, swaps the exact rows read, prints the rollback", async () => {
    const w = world();
    const log: string[] = [];
    expect(await spec.execute(w.db, { expect: 3, today: "20261023", log: (s) => log.push(s) })).toBe(0);
    const stmts = w.calls.map((c) => normalize(c.sql));
    const create = stmts.findIndex((s) => s.startsWith("CREATE TABLE _bak_decision_replays_overdue_close_20261023 (LIKE decision_replays)"));
    const update = stmts.findIndex((s) => s.startsWith("UPDATE decision_replays"));
    expect(create).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(create);
    expect(w.calls[update].params[0]).toEqual(["r0", "r1", "r2"]);
    expect(w.calls[update].params[1]).toEqual(["t0", "t1", "t2"]);
    expect(w.calls[update].params).toContain(OUTCOME);
    expect(log.join("\n")).toContain("ROLLBACK");
    expect(log.join("\n")).toContain("FROM _bak_decision_replays_overdue_close_20261023 k");
  });

  it("a backup count that disagrees aborts before the swap", async () => {
    const w = world({ backupRows: 1 });
    expect(await spec.execute(w.db, { expect: 3, today: "20261023", log: () => {} })).toBe(1);
    expect(w.calls.some((c) => normalize(c.sql).startsWith("UPDATE"))).toBe(false);
  });

  it("a count that moved since --read aborts before the backup", async () => {
    const w = world({ count: 5 });
    expect(await spec.execute(w.db, { expect: 3, today: "20261023", log: () => {} })).toBe(1);
    expect(w.calls.some((c) => /^(CREATE|UPDATE)/.test(normalize(c.sql)))).toBe(false);
  });

  it("a partial swap exits non-zero", async () => {
    const w = world({ cas: 2 });
    expect(await spec.execute(w.db, { expect: 3, today: "20261023", log: () => {} })).toBe(1);
  });
});

describe("read", () => {
  it("selects ids and dates only, never title, choice or reasoning text", async () => {
    const w = world();
    const r = await spec.read(w.db);
    expect(r.count).toBe(3);
    for (const c of w.calls) expect(normalize(c.sql)).not.toMatch(/title|choiceMade|reasoning|context/);
  });
});
