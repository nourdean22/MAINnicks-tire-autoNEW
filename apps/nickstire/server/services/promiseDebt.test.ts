/**
 * Q-23 phase 3 · obligation debt for the "Today, for real" card.
 *
 * `promiseDebt()` is the one read behind the card's promises tile. Three things
 * it must never do:
 *   - report zeros when it could not look (a failed read or an un-applied table);
 *   - count a different row set from PromisesPanel (the mirror's rows stay in
 *     shadow, ADR-0020 §8, exactly as listOpenPromises leaves them out);
 *   - throw, because the card's other three tiles share the same procedure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn(), getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: h.getDb }));

import { promiseDebt } from "./promiseLedger";

function flat(q: { queryChunks: unknown[] }): { text: string; params: unknown[] } {
  const text: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else { params.push(c); text.push("?"); }
    }
  };
  walk(q.queryChunks);
  return { text: text.join("").replace(/\s+/g, " ").trim(), params };
}

describe("promiseDebt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getDb.mockResolvedValue({ execute: h.execute });
  });

  it("returns the counts it read, as numbers", async () => {
    // TiDB can hand SUM() back as a string; the card must still get numbers.
    h.execute.mockResolvedValueOnce([[{ open: 5, overdue: "3", overdue4h: "1" }]]);
    await expect(promiseDebt()).resolves.toEqual({ available: true, open: 5, overdue: 3, overdue4h: 1 });
  });

  it("reads open rows only, past due against NOW(), and 4h past due", async () => {
    h.execute.mockResolvedValueOnce([[{ open: 0, overdue: 0, overdue4h: 0 }]]);
    await promiseDebt();
    const q = flat(h.execute.mock.calls[0][0]);
    expect(q.text).toContain("FROM customer_promises");
    expect(q.text).toContain("status = 'open'");
    expect(q.text).toContain("due_at < NOW()");
    expect(q.text).toContain("due_at < DATE_SUB(NOW(), INTERVAL 4 HOUR)");
  });

  it("leaves the obligation mirror's rows out, like PromisesPanel's list", async () => {
    h.execute.mockResolvedValueOnce([[{ open: 0, overdue: 0, overdue4h: 0 }]]);
    await promiseDebt();
    const q = flat(h.execute.mock.calls[0][0]);
    expect(q.text).toContain("source_kind NOT IN (?, ?, ?)");
    expect(q.params).toEqual(expect.arrayContaining(["callback_request", "owed_reply", "emergency"]));
  });

  // Positive control for the three tests below: a genuine zero IS available.
  it("a genuine empty ledger is a measured zero", async () => {
    h.execute.mockResolvedValueOnce([[{ open: 0, overdue: null, overdue4h: null }]]);
    await expect(promiseDebt()).resolves.toEqual({ available: true, open: 0, overdue: 0, overdue4h: 0 });
  });

  it("a failed read is unavailable, never zeros, and does not throw", async () => {
    h.execute.mockRejectedValueOnce(new Error("connection reset"));
    const r = await promiseDebt();
    expect(r.available).toBe(false);
    expect(r).not.toHaveProperty("open");
  });

  it("an un-applied table is unavailable, never zeros", async () => {
    h.execute.mockRejectedValueOnce(Object.assign(new Error("Table 'x.customer_promises' doesn't exist"), { errno: 1146, code: "ER_NO_SUCH_TABLE" }));
    const r = await promiseDebt();
    expect(r).toEqual({ available: false, reason: "table not applied (migration 0102)" });
  });

  it("no database handle is unavailable", async () => {
    h.getDb.mockResolvedValueOnce(null);
    await expect(promiseDebt()).resolves.toEqual({ available: false, reason: "DB unavailable" });
    expect(h.execute).not.toHaveBeenCalled();
  });
});
