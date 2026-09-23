/**
 * decayMemories · every row, not an arbitrary 200 (2026-09-22)
 *
 * WHAT WAS WRONG. The cycle read `.limit(200)` with no ORDER BY over a store of
 * 721 rows. Which 200 came back was the storage engine's choice, the same choice
 * every cycle, so 500+ memories were never visited: measured 2026-09-22, 94 of
 * the first 200 had ever decayed while 199 rows untouched for 90+ days still
 * sat at an average confidence of 0.98. Decay was the only path that could ever
 * make room below the survivors; without it the 500-cap eviction was the store's
 * whole garbage collection, and it evicts the NEWEST low-confidence memory first.
 *
 * WHAT THIS PINS, against a db double that HONOURS the keyset (it serves rows
 * with id greater than the bound value, in id order, one page at a time — so a
 * walk that forgets the keyset is served the first page forever and trips the
 * double's page guard, and a walk that drops ORDER BY is refused outright):
 *   · a 521-row store is walked in three pages and every stale row is updated
 *   · each page's WHERE carries the previous page's last id
 *   · POSITIVE CONTROL: a store smaller than one page still works (one select)
 *
 * SYNTHETIC ONLY — no DB; rows are generated; the schema import is the real one
 * because the SQL templates need the column objects, and nothing executes them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: number; key: string; value: string };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const makeRows = (n: number, confidence = 1.0): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    key: `nick_memory_insight_${String(i + 1).padStart(6, "0")}`,
    // 200 days untouched at 1.0 → decays to 0.70; not prunable (>= 0.15).
    value: JSON.stringify({ type: "insight", content: `fact ${i + 1}`, source: "t", confidence, uses: 3, createdAt: daysAgo(400), lastReinforced: daysAgo(200) }),
  }));

/**
 * Numeric bind values inside a drizzle `sql` template, in order (e.g. the keyset
 * id). Walks the chunk tree: a `Param` carries `value` + `encoder`; a
 * `StringChunk` carries `value: string[]`; columns and tables are skipped (they
 * are circular, so JSON.stringify is not an option here).
 */
const boundNumbers = (node: unknown, out: number[] = []): number[] => {
  // drizzle keeps a primitive interpolation as a raw chunk until query build.
  if (typeof node === "number") {
    out.push(node);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const n = node as { queryChunks?: unknown[]; value?: unknown; encoder?: unknown };
  if (Array.isArray(n.queryChunks)) for (const c of n.queryChunks) boundNumbers(c, out);
  else if ("encoder" in n && typeof n.value === "number") out.push(n.value);
  return out;
};

function fakeDb(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const pagesServed: number[] = []; // the lastId each page was asked to start after
  const updates: number[] = [];
  const deletes: number[] = [];
  let selects = 0;
  const db = {
    select: () => {
      selects += 1;
      if (selects > 10) throw new Error("page walk is not advancing — the keyset is missing");
      let after = 0;
      let ordered = false;
      const chain = {
        from: () => chain,
        where: (w: unknown) => {
          const nums = boundNumbers(w);
          after = nums.length ? nums[nums.length - 1] : 0;
          return chain;
        },
        orderBy: () => {
          ordered = true;
          return chain;
        },
        limit: async (n: number) => {
          if (!ordered) throw new Error("a keyset page without ORDER BY is not a keyset");
          pagesServed.push(after);
          return sorted.filter((r) => r.id > after).slice(0, n);
        },
      };
      return chain;
    },
    update: () => ({ set: () => ({ where: async (w: unknown) => { updates.push(boundNumbers(w)[0]); return [{ affectedRows: 1 }]; } }) }),
    delete: () => ({ where: async (w: unknown) => { deletes.push(boundNumbers(w)[0]); return [{ affectedRows: 1 }]; } }),
  };
  return { db, pagesServed, updates, deletes, get selects() { return selects; } };
}

describe("decayMemories · walks the whole store", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../lib/db-helper"));

  it("a 521-row store: three keyset pages, every stale row updated, nothing deleted", async () => {
    const rig = fakeDb(makeRows(521));
    vi.doMock("../lib/db-helper", () => ({ db: async () => rig.db, dbTyped: async () => rig.db, requireDb: async () => rig.db }));
    const { decayMemories } = await import("../services/nickMemory");

    const decayed = await decayMemories();

    expect(decayed).toBe(521);
    expect(rig.updates.length).toBe(521);
    expect(new Set(rig.updates).size).toBe(521); // each row once
    expect(rig.deletes).toEqual([]);
    // Pages start after 0, then after the last id of each full page.
    expect(rig.pagesServed).toEqual([0, 200, 400]);
    expect(rig.selects).toBe(3);
  });

  it("POSITIVE CONTROL: a store smaller than a page is one select and still decays", async () => {
    const rig = fakeDb(makeRows(7));
    vi.doMock("../lib/db-helper", () => ({ db: async () => rig.db, dbTyped: async () => rig.db, requireDb: async () => rig.db }));
    const { decayMemories } = await import("../services/nickMemory");
    expect(await decayMemories()).toBe(7);
    expect(rig.pagesServed).toEqual([0]);
  });

  it("an exact multiple of the page size ends on an empty page, not a phantom fourth", async () => {
    const rig = fakeDb(makeRows(400));
    vi.doMock("../lib/db-helper", () => ({ db: async () => rig.db, dbTyped: async () => rig.db, requireDb: async () => rig.db }));
    const { decayMemories } = await import("../services/nickMemory");
    expect(await decayMemories()).toBe(400);
    expect(rig.pagesServed).toEqual([0, 200, 400]); // the third select returns nothing and ends the walk
  });
});
