/**
 * adminSecurity.queueFeedbackSummary v1 -- the sum of the Keep/Less verdicts the Today board records.
 *
 * WHY: W6 (the Stream) starts its two-week clock only once Keep/Less marks are stored AND
 * readable. The marks are `audit_log` rows (action `admin.queue_feedback`, written through
 * adminSecurity.recordAction). This read answers "how many, since when" and must never turn a
 * failed read into zeros: a real empty table is `readable: true, total: 0`; a dead database or a
 * throwing query is `readable: false` with a reason (empty-vs-error).
 *
 * The db handle is faked at the lib/db-helper seam. `execute` returns the mysql2 shape
 * `[rows, fields]`, which is what drizzle hands back for a raw `sql` query.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({ dbMock: vi.fn() }));

// Spread the real module: serial vitest shares one mock registry (apps/nickstire/AGENTS.md section 3),
// so dropping dbTyped/requireDb here would break a later file that imports them.
vi.mock("../lib/db-helper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/db-helper")>();
  return { ...actual, db: dbMock };
});

import { getQueueFeedbackSummary } from "../services/adminAudit";

type Row = Record<string, unknown>;
function fakeDb(rows: Row[]) {
  const execute = vi.fn().mockResolvedValue([rows, []]);
  dbMock.mockResolvedValue({ execute });
  return execute;
}

beforeEach(() => {
  dbMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("getQueueFeedbackSummary", () => {
  it("an empty table is a REAL zero: readable, total 0, since null", async () => {
    fakeDb([]);
    expect(await getQueueFeedbackSummary()).toEqual({ readable: true, total: 0, since: null, byType: [] });
  });

  it("a null database handle is unreadable, never zeros", async () => {
    dbMock.mockResolvedValue(null);
    const out = await getQueueFeedbackSummary();
    expect(out.readable).toBe(false);
    if (!out.readable) expect(out.reason).toMatch(/database/i);
  });

  it("a throwing query is unreadable with a reason, never zeros", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT"));
    dbMock.mockResolvedValue({ execute });
    const out = await getQueueFeedbackSummary();
    expect(out).toEqual({ readable: false, reason: expect.stringContaining("ER_LOCK_WAIT_TIMEOUT") });
  });

  it("a throwing db() handle lookup is unreadable too", async () => {
    dbMock.mockRejectedValue(new Error("pool exploded"));
    const out = await getQueueFeedbackSummary();
    expect(out.readable).toBe(false);
  });

  it("two keeps and one less across two types sum exactly, with total and since", async () => {
    // mysql2 returns SUM() as a decimal string; the epoch comes from UNIX_TIMESTAMP(MIN(created_at)).
    fakeDb([
      { itemType: "booking", keepN: "2", lessN: "0", firstAt: "1760000300" },
      { itemType: "lead", keepN: "0", lessN: "1", firstAt: "1760000100.000000" },
    ]);
    expect(await getQueueFeedbackSummary()).toEqual({
      readable: true,
      total: 3,
      since: new Date(1760000100 * 1000).toISOString(),
      byType: [
        { itemType: "booking", keep: 2, less: 0 },
        { itemType: "lead", keep: 0, less: 1 },
      ],
    });
  });

  it("a type whose rows carry no itemType is bucketed as 'unknown', not dropped", async () => {
    fakeDb([{ itemType: null, keepN: "1", lessN: "0", firstAt: "1760000000" }]);
    const out = await getQueueFeedbackSummary();
    expect(out).toMatchObject({ readable: true, total: 1, byType: [{ itemType: "unknown", keep: 1, less: 0 }] });
  });

  it("the SQL filters to the feedback action and to the two verdicts, so a junk verdict cannot count", async () => {
    const execute = fakeDb([]);
    await getQueueFeedbackSummary();
    const text = JSON.stringify(execute.mock.calls[0]?.[0]?.queryChunks ?? execute.mock.calls[0]);
    expect(text).toContain("admin.queue_feedback");
    expect(text).toContain("admin_action");
    expect(text).toMatch(/IN \('keep', ?'less'\)/);
  });

  it("a row with a junk verdict that the SQL let through still never inflates the total", async () => {
    // Belt and braces: the SQL excludes junk, and the reducer must not invent counts from NaN.
    fakeDb([{ itemType: "text", keepN: "x", lessN: null, firstAt: "oops" }]);
    const out = await getQueueFeedbackSummary();
    expect(out).toEqual({ readable: true, total: 0, since: null, byType: [] });
  });
});

describe("wiring: adminSecurity.queueFeedbackSummary reaches the service", () => {
  it("is a registered query on the router, and reads through getQueueFeedbackSummary", async () => {
    const { adminSecurityRouter } = await import("../routers/adminSecurity");
    const procs = (adminSecurityRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string } }> } })._def.procedures;
    expect(procs.queueFeedbackSummary?._def.type).toBe("query");
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../routers/adminSecurity.ts", import.meta.url), "utf8");
    expect(src).toMatch(/queueFeedbackSummary:\s*adminProcedure\.query\(\(\) => getQueueFeedbackSummary\(\)\)/);
  });
});
