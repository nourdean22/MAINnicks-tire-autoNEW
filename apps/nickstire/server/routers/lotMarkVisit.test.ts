/**
 * lot.markVisit -- the operator's tap reaches the table through the SQL glue, with the three
 * refusals the floor board relies on (migration 0145; camera audit N1; review fixes 2026-10-08).
 * The pure derivation is pinned in server/lib/visitMarks.test.ts; this file pins the procedure:
 * the departed-car refusal, the missing-table refusal BY NAME, the read-back by insert id, and
 * that a driver error never carries the admin's openId to the browser.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../lib/db-helper", () => ({
  db: async () => ({ execute }),
  dbTyped: async () => ({ execute }),
  requireDb: async () => ({ execute }),
}));

import { lotRouter } from "./lot";
import type { TrpcContext } from "../_core/context";

const OPEN_ID = "openid-7f3a-admin";

function caller() {
  return lotRouter.createCaller({
    user: { id: 1, openId: OPEN_ID, email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);
}

/** Flatten a drizzle sql object to its text and params, so the INSERT can be read as written. */
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lot.markVisit", () => {
  it("appends the mark with the admin's openId and reads THIS row back by its insert id", async () => {
    execute
      .mockResolvedValueOnce([[{ visitId: "v-1", departedAt: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 42 }])
      .mockResolvedValueOnce([[{ markedEpoch: 1_791_460_000 }]]);
    const r = await caller().markVisit({ visitId: "v-1", mark: "CUSTOMER_WAITING", note: "  lobby  " });
    expect(r).toEqual({ ok: true, mark: "CUSTOMER_WAITING", markedAtMs: 1_791_460_000_000 });
    expect(execute).toHaveBeenCalledTimes(3);
    const insert = flat(execute.mock.calls[1][0]);
    expect(insert.text).toContain("INSERT INTO vehicle_visit_marks (visitId, mark, markedBy, note)");
    expect(insert.params).toEqual(["v-1", "CUSTOMER_WAITING", OPEN_ID, "lobby"]);
    const readBack = flat(execute.mock.calls[2][0]);
    expect(readBack.text).toContain("WHERE id = ? LIMIT 1");
    expect(readBack.params).toEqual([42]);
  });

  it("CLEARED is a mark like the others (the undo rides the same append-only path)", async () => {
    execute
      .mockResolvedValueOnce([[{ visitId: "v-1", departedAt: null }]])
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 43 }])
      .mockResolvedValueOnce([[{ markedEpoch: 1_791_460_060 }]]);
    const r = await caller().markVisit({ visitId: "v-1", mark: "CLEARED" });
    expect(r).toMatchObject({ ok: true, mark: "CLEARED" });
    expect(flat(execute.mock.calls[1][0]).params).toEqual(["v-1", "CLEARED", OPEN_ID, null]);
  });

  it("refuses a car that has already left, before any write", async () => {
    execute.mockResolvedValueOnce([[{ visitId: "v-1", departedAt: "2026-10-08 13:00:00" }]]);
    const r = await caller().markVisit({ visitId: "v-1", mark: "SERVICE_DONE" });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("has left") });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuses a visit that does not exist", async () => {
    execute.mockResolvedValueOnce([[]]);
    const r = await caller().markVisit({ visitId: "nope", mark: "SERVICE_DONE" });
    expect(r).toMatchObject({ ok: false, reason: "no visit nope" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("names migration 0145 when the table is missing, instead of a generic failure", async () => {
    execute.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE", errno: 1146, sqlMessage: "Table 'x.vehicle_visit_marks' doesn't exist" });
    const r = await caller().markVisit({ visitId: "v-1", mark: "SERVICE_DONE" });
    expect(r).toMatchObject({ ok: false, reason: "visit marks need migration 0145 (vehicle_visit_marks) applied first" });
  });

  it("a driver error reaches the browser as a safe message: never the query params, so never the admin's openId", async () => {
    execute
      .mockResolvedValueOnce([[{ visitId: "v-1", departedAt: null }]])
      .mockRejectedValueOnce({
        // drizzle's wrapper shape: the message and params carry everything that was bound.
        message: `Failed query: insert into vehicle_visit_marks ... params: v-1,NOT_A_JOB,${OPEN_ID},`,
        query: "insert into vehicle_visit_marks (visitId, mark, markedBy, note) values (?, ?, ?, ?)",
        params: ["v-1", "NOT_A_JOB", OPEN_ID, null],
        cause: { code: "ER_DATA_TOO_LONG", errno: 1406, sqlMessage: "Data too long for column 'mark' at row 1" },
      });
    const r = await caller().markVisit({ visitId: "v-1", mark: "NOT_A_JOB" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toContain("could not record the mark");
    expect(r.reason).not.toContain(OPEN_ID);
    expect(r.reason).not.toContain("params:");
  });
});
