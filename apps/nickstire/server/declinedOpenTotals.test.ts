/**
 * getOpenDeclinedWorkTotals(): the TRUE open declined-work count and dollar total (job
 * 2026-11-01-double-check-missed). statenourSync built `totalRecoverable`/`customerCount` from
 * getDeclinedWorkLedger(10), so bdnick.info could only ever show a subtotal of the 10 newest orders.
 *
 * The aggregate and the ledger must never disagree about what "declined" and "recovered" mean, so
 * both run here over the SAME fixture rows: the real drizzle builders render the real SQL, and a
 * fake mysql2 client answers by READING that SQL's predicates (a predicate the query does not
 * contain is a predicate the fake does not apply). SYNTHETIC rows only: no names, no per-customer
 * amounts, totals only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableColumns } from "drizzle-orm";
import { workOrders, workOrderItems } from "../drizzle/schema";

interface WoFix { id: string; hasDeclinedWork: boolean; updatedAt: string }
interface ItemFix { id: string; workOrderId: string; total: string | null; declined: boolean; recoveredAt: string | null }

const h = vi.hoisted(() => ({
  wos: [] as WoFix[],
  items: [] as ItemFix[],
  failQuery: false,
  db: null as unknown,
  noDb: false,
  /** SQL text of every statement the fake saw, so a test can read what was really asked. */
  sqls: [] as string[],
}));

vi.mock("./db", () => ({ getDb: async () => (h.noDb ? null : h.db) }));

function rowFor(table: typeof workOrders | typeof workOrderItems, values: Record<string, unknown>): unknown[] {
  return Object.keys(getTableColumns(table)).map((k) => (k in values ? values[k] : null));
}

/** The param bound to the first `col = ?` in the SQL: counts the `?` before it. */
function paramFor(sqlText: string, col: string, params: unknown[]): unknown {
  const m = new RegExp("`" + col + "` = \\?").exec(sqlText);
  if (!m) return undefined;
  return params[(sqlText.slice(0, m.index).match(/\?/g) ?? []).length];
}

const fakeClient = {
  query: vi.fn(async (q: { sql: string } | string, params: unknown[] = []) => {
    const sqlText = (typeof q === "string" ? q : q.sql).toLowerCase();
    h.sqls.push(sqlText);
    if (h.failQuery) throw new Error("connection reset");
    const isItems = sqlText.includes("from `work_order_items`");

    if (isItems && sqlText.includes("inner join")) {
      // The aggregate: join items to their work order, apply ONLY the predicates the SQL carries.
      let rows = h.items.map((it) => ({ it, wo: h.wos.find((w) => w.id === it.workOrderId)! }));
      const flag = paramFor(sqlText, "has_declined_work", params);
      if (flag !== undefined) rows = rows.filter((r) => Boolean(r.wo.hasDeclinedWork) === Boolean(flag));
      const declined = paramFor(sqlText, "declined", params);
      if (declined !== undefined) rows = rows.filter((r) => r.it.declined === Boolean(declined));
      if (sqlText.includes("`decline_recovered_at` is null")) rows = rows.filter((r) => r.it.recoveredAt === null);
      if (/limit \?/.test(sqlText)) rows = rows.slice(0, Number(params[params.length - 1]));
      const distinct = sqlText.includes("count(distinct");
      const n = distinct ? new Set(rows.map((r) => r.it.workOrderId)).size : rows.length;
      const sum = rows.reduce((s, r) => s + parseFloat(r.it.total ?? "0"), 0);
      // mysql2: COUNT arrives as a number, a DECIMAL SUM as a string.
      return [[[n, sum.toFixed(2)]], []];
    }
    if (isItems) {
      const woId = params[0];
      const rows = h.items.filter((it) => it.workOrderId === woId && it.declined === Boolean(params[1]));
      return [rows.map((it) => rowFor(workOrderItems, {
        id: it.id, workOrderId: it.workOrderId, description: "line", type: "labor",
        unitPrice: it.total, total: it.total, declined: it.declined ? 1 : 0,
        declineRecoveredAt: it.recoveredAt,
      })), []];
    }
    if (sqlText.includes("from `work_orders`")) {
      const flag = paramFor(sqlText, "has_declined_work", params);
      let rows = h.wos.filter((w) => flag === undefined || Boolean(w.hasDeclinedWork) === Boolean(flag));
      rows = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (/limit \?/.test(sqlText)) rows = rows.slice(0, Number(params[params.length - 1]));
      return [rows.map((w) => rowFor(workOrders, {
        id: w.id, orderNumber: `WO-${w.id}`, hasDeclinedWork: w.hasDeclinedWork ? 1 : 0, updatedAt: w.updatedAt,
      })), []];
    }
    throw new Error(`fake client: unexpected SQL ${sqlText}`);
  }),
};
h.db = drizzle(fakeClient as never);

import { getDeclinedWorkLedger, getOpenDeclinedWorkTotals } from "./services/declinedWorkRecovery";

/**
 * 14 flagged work orders (more than the sync's 10), shaped to hit every edge of the definition:
 *  - wo-01..wo-09: one open declined line each (100.25 apiece)
 *  - wo-10: two open lines (50.00 + 75.50), one order
 *  - wo-11: a declined line that carries a recovery stamp (recovered, so NOT open)
 *  - wo-12: one open line AND one recovered line (only the open one counts)
 *  - wo-13: flagged but holds no declined line (the ledger skips it)
 *  - wo-14: one open line with a NULL total (counts as an order, adds 0)
 *  - wo-99: NOT flagged, but holds a declined open line (outside the ledger, so outside the aggregate)
 * Older orders get older updatedAt, so a 10-row cap drops the oldest.
 */
function seed(): void {
  h.wos = [];
  h.items = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let n = 1; n <= 14; n++) {
    h.wos.push({ id: `wo-${pad(n)}`, hasDeclinedWork: true, updatedAt: `2026-10-${pad(30 - n)} 12:00:00` });
  }
  h.wos.push({ id: "wo-99", hasDeclinedWork: false, updatedAt: "2026-10-31 12:00:00" });
  const item = (id: string, wo: string, total: string | null, declined: boolean, recoveredAt: string | null = null) =>
    h.items.push({ id, workOrderId: wo, total, declined, recoveredAt });
  for (let n = 1; n <= 9; n++) item(`i-${n}`, `wo-${pad(n)}`, "100.25", true);
  item("i-10a", "wo-10", "50.00", true);
  item("i-10b", "wo-10", "75.50", true);
  item("i-11", "wo-11", "300.00", true, "2026-10-29 09:00:00");
  item("i-12a", "wo-12", "40.00", true);
  item("i-12b", "wo-12", "999.00", true, "2026-10-29 09:00:00");
  item("i-14", "wo-14", null, true);
  item("i-99", "wo-99", "5000.00", true);
}

/** What the ledger itself says is open, with no cap: the definition the aggregate must match. */
async function uncappedLedgerOpen() {
  const ledger = await getDeclinedWorkLedger(1000);
  const open = ledger.filter((e) => e.declinedItems.some((i) => !i.recovered));
  const total = open.reduce(
    (s, e) => s + e.declinedItems.filter((i) => !i.recovered).reduce((t, i) => t + parseFloat(i.total), 0),
    0,
  );
  return { count: open.length, total: Math.round(total * 100) / 100 };
}

afterEach(() => {
  h.failQuery = false;
  h.noDb = false;
  h.sqls = [];
  fakeClient.query.mockClear();
});

describe("getOpenDeclinedWorkTotals agrees with the ledger's own definition", () => {
  it("equals the uncapped ledger's open count and open dollar total over the same rows", async () => {
    seed();
    const expected = await uncappedLedgerOpen();
    // Control: the fixture really has more than 10 open orders, and a real, nonzero total.
    expect(expected.count).toBe(12);
    expect(expected.total).toBe(9 * 100.25 + 125.5 + 40 + 0);
    expect(await getOpenDeclinedWorkTotals()).toEqual({ openCount: expected.count, openTotal: expected.total });
  });

  it("is not the 10-row subtotal the sync used to publish", async () => {
    seed();
    const capped = (await getDeclinedWorkLedger(10)).filter((e) => e.declinedItems.some((i) => !i.recovered));
    const totals = await getOpenDeclinedWorkTotals();
    expect(capped).toHaveLength(10);
    expect(totals.openCount).toBeGreaterThan(capped.length);
  });

  it("a recovered line leaves the total, and an order with only recovered lines leaves the count", async () => {
    seed();
    const before = await getOpenDeclinedWorkTotals();
    h.items.find((i) => i.id === "i-1")!.recoveredAt = "2026-10-31 08:00:00";
    const after = await getOpenDeclinedWorkTotals();
    expect(after.openCount).toBe(before.openCount - 1);
    expect(after.openTotal).toBe(Math.round((before.openTotal - 100.25) * 100) / 100);
    expect(after).toEqual(await uncappedLedgerOpen().then((l) => ({ openCount: l.count, openTotal: l.total })));
  });

  it("returns numbers although the driver hands the SUM back as a string", async () => {
    seed();
    const totals = await getOpenDeclinedWorkTotals();
    expect(typeof totals.openCount).toBe("number");
    expect(typeof totals.openTotal).toBe("number");
  });

  it("asks the database ONE aggregate statement with no row cap", async () => {
    seed();
    await getOpenDeclinedWorkTotals();
    expect(h.sqls).toHaveLength(1);
    expect(h.sqls[0]).toMatch(/count\(distinct/);
    expect(h.sqls[0]).not.toMatch(/\blimit\b/);
  });

  it("a genuine zero is a number 0, not an error", async () => {
    seed();
    h.items = [];
    expect(await getOpenDeclinedWorkTotals()).toEqual({ openCount: 0, openTotal: 0 });
  });
});

describe("a failed read is UNKNOWN, never 0", () => {
  it("throws when the query fails", async () => {
    seed();
    h.failQuery = true;
    await expect(getOpenDeclinedWorkTotals()).rejects.toThrow();
  });

  it("throws when there is no database", async () => {
    seed();
    h.noDb = true;
    await expect(getOpenDeclinedWorkTotals()).rejects.toThrow(/Database not available/);
  });

  it("throws on a non-numeric driver value rather than publishing NaN or 0", async () => {
    seed();
    fakeClient.query.mockImplementationOnce(async () => [[[null, null]], []]);
    await expect(getOpenDeclinedWorkTotals()).rejects.toThrow();
  });
});
