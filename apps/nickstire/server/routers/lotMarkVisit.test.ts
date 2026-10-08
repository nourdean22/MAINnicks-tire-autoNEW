/**
 * lot.markVisit -- the operator's tap reaches the table through the SQL glue, with the three
 * refusals the floor board relies on (migration 0145; camera audit N1; review fixes 2026-10-08).
 * The pure derivation is pinned in server/lib/visitMarks.test.ts; this file pins the procedure:
 * the open-visit predicate INSIDE the write (Codex on #2927: a SELECT-then-INSERT window let a
 * departure slip between them), the departed-car and missing-visit refusals, the missing-table
 * refusal BY NAME, the read-back by insert id that cannot turn a committed mark into a failure,
 * and that a driver error never carries the admin's openId to the browser.
 */
import fs from "node:fs";
import path from "node:path";
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

/** The write carries its own refusal: nothing is inserted for a missing or a departed visit. */
const INSERT_SHAPE =
  "INSERT INTO vehicle_visit_marks (visitId, mark, markedBy, note) SELECT v.visitId, ?, ?, ? FROM vehicle_visits v WHERE v.visitId = ? AND v.departedAt IS NULL";

describe("lot.markVisit", () => {
  it("appends the mark with the admin's openId THROUGH the open-visit predicate, and reads THIS row back by its insert id", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 42 }])
      .mockResolvedValueOnce([[{ markedEpoch: 1_791_460_000 }]]);
    const r = await caller().markVisit({ visitId: "v-1", mark: "CUSTOMER_WAITING", note: "  lobby  " });
    expect(r).toEqual({ ok: true, mark: "CUSTOMER_WAITING", markedAtMs: 1_791_460_000_000 });
    expect(execute).toHaveBeenCalledTimes(2);
    const insert = flat(execute.mock.calls[0][0]);
    expect(insert.text).toContain(INSERT_SHAPE);
    expect(insert.params).toEqual(["CUSTOMER_WAITING", OPEN_ID, "lobby", "v-1"]);
    const readBack = flat(execute.mock.calls[1][0]);
    expect(readBack.text).toContain("WHERE id = ? LIMIT 1");
    expect(readBack.params).toEqual([42]);
  });

  it("CLEARED is a mark like the others (the undo rides the same append-only path)", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 43 }])
      .mockResolvedValueOnce([[{ markedEpoch: 1_791_460_060 }]]);
    const r = await caller().markVisit({ visitId: "v-1", mark: "CLEARED" });
    expect(r).toMatchObject({ ok: true, mark: "CLEARED" });
    expect(flat(execute.mock.calls[0][0]).params).toEqual(["CLEARED", OPEN_ID, null, "v-1"]);
  });

  it("refuses a car that has already left: the write's own predicate inserts nothing, then one read says why (no SELECT-then-INSERT window for a departure to slip through)", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 0, insertId: 0 }])
      .mockResolvedValueOnce([[{ visitId: "v-1", departedAt: "2026-10-08 13:00:00" }]]);
    const r = await caller().markVisit({ visitId: "v-1", mark: "SERVICE_DONE" });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("has left") });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(flat(execute.mock.calls[0][0]).text).toContain("AND v.departedAt IS NULL");
  });

  it("refuses a visit that does not exist", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 0, insertId: 0 }])
      .mockResolvedValueOnce([[]]);
    const r = await caller().markVisit({ visitId: "nope", mark: "SERVICE_DONE" });
    expect(r).toMatchObject({ ok: false, reason: "no visit nope" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("names migration 0145 when the table is missing, instead of a generic failure", async () => {
    execute.mockRejectedValueOnce({ code: "ER_NO_SUCH_TABLE", errno: 1146, sqlMessage: "Table 'x.vehicle_visit_marks' doesn't exist" });
    const r = await caller().markVisit({ visitId: "v-1", mark: "SERVICE_DONE" });
    expect(r).toMatchObject({ ok: false, reason: "visit marks need migration 0145 (vehicle_visit_marks) applied first" });
  });

  it("a committed mark whose timestamp read-back fails is still a recorded mark, with the server clock (a false failure invites a duplicate tap)", async () => {
    execute
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 44 }])
      .mockRejectedValueOnce(new Error("read timeout"));
    const before = Date.now();
    const r = await caller().markVisit({ visitId: "v-1", mark: "SERVICE_STARTED" });
    expect(r).toMatchObject({ ok: true, mark: "SERVICE_STARTED" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.markedAtMs).toBeGreaterThanOrEqual(before);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("a driver error reaches the browser as a safe message: never the query params, so never the admin's openId", async () => {
    execute.mockRejectedValueOnce({
      // drizzle's wrapper shape: the message and params carry everything that was bound.
      message: `Failed query: insert into vehicle_visit_marks ... params: NOT_A_JOB,${OPEN_ID},,v-1`,
      query: "insert into vehicle_visit_marks (visitId, mark, markedBy, note) select v.visitId, ?, ?, ? from vehicle_visits v where v.visitId = ? and v.departedAt is null",
      params: ["NOT_A_JOB", OPEN_ID, null, "v-1"],
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

/**
 * lot.now's mark counters read the same boundary deriveVisitMarkState applies to the history:
 * a mark counts only until a CLEARED (the undo) follows it for the same visit. Counting the
 * whole history said "not a job" of a car whose mis-tap had been cleared while its own card
 * said the marks were cleared (Codex on #2927).
 */
describe("lot.now marks aggregation counts only the marks in force", () => {
  const source = fs.readFileSync(path.join(__dirname, "lot.ts"), "utf8");

  it("both counts exclude CLEARED rows and any mark a later CLEARED undid, in (markedAt, id) order like deriveVisitMarkState", () => {
    const start = source.indexOf("OPERATOR MARKS on the cars currently on the property");
    const end = source.indexOf("marks.available = true;", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain("m.mark <> 'CLEARED'");
    expect(block).toContain("c.visitId = m.visitId AND c.mark = 'CLEARED'");
    expect(block).toContain("(c.markedAt > m.markedAt OR (c.markedAt = m.markedAt AND c.id > m.id))");
    // The by-mark counts and the marked-visit count apply the same predicate.
    expect(block.split("${inForce}").length - 1).toBe(2);
  });
});
