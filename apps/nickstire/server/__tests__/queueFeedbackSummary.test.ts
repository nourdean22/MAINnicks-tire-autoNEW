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

/** The SQL text the service sent, whitespace collapsed (drizzle keeps literal text in StringChunks). */
async function sqlOf(): Promise<string> {
  const execute = fakeDb([]);
  await getQueueFeedbackSummary();
  const chunks = (execute.mock.calls[0]?.[0] as { queryChunks: Array<{ value?: string[] }> }).queryChunks;
  return chunks.map((c) => (c.value ? c.value.join("") : "")).join(" ").replace(/\s+/g, " ");
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
    const text = await sqlOf();
    expect(text).toContain("admin.queue_feedback");
    expect(text).toContain("admin_action");
    expect(text).toMatch(/IN \('keep', ?'less'\)/);
  });

  it("the SQL maps verdict 'keep' to keepN and 'less' to lessN, exactly (a swap would invert every count)", async () => {
    const text = await sqlOf();
    expect(text).toContain(
      "SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(changes, '$.verdict')) = 'keep' THEN 1 ELSE 0 END) AS keepN",
    );
    expect(text).toContain(
      "SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(changes, '$.verdict')) = 'less' THEN 1 ELSE 0 END) AS lessN",
    );
  });

  it("the SQL maps SQL NULL and the JSON null string 'null' itemType to 'unknown'", async () => {
    // JSON_UNQUOTE of a JSON null yields the 4-character string "null", which COALESCE alone keeps.
    const text = await sqlOf();
    expect(text).toContain("COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(changes, '$.itemType')), 'null'), 'unknown') AS itemType");
  });

  it("a row whose itemType is null buckets as 'unknown' and merges nothing into a 'null' type", async () => {
    fakeDb([{ itemType: "unknown", keepN: "1", lessN: "1", firstAt: "1760000000" }]);
    const out = await getQueueFeedbackSummary();
    expect(out).toMatchObject({ readable: true, total: 2, byType: [{ itemType: "unknown", keep: 1, less: 1 }] });
  });

  it("since is the EARLIEST first verdict, not the first or the last row's (earliest sits in the middle)", async () => {
    // first row 300, middle 100 (the minimum), last 500: first-wins, last-wins and max all give a wrong answer.
    fakeDb([
      { itemType: "booking", keepN: "1", lessN: "0", firstAt: "1760000300" },
      { itemType: "lead", keepN: "0", lessN: "1", firstAt: "1760000100" },
      { itemType: "text", keepN: "1", lessN: "0", firstAt: "1760000500" },
    ]);
    const out = await getQueueFeedbackSummary();
    expect(out).toMatchObject({ readable: true, total: 3, since: new Date(1760000100 * 1000).toISOString() });
  });

  it("a row with a junk verdict that the SQL let through still never inflates the total", async () => {
    // Belt and braces: the SQL excludes junk, and the reducer must not invent counts from NaN.
    fakeDb([{ itemType: "text", keepN: "x", lessN: null, firstAt: "oops" }]);
    const out = await getQueueFeedbackSummary();
    expect(out).toEqual({ readable: true, total: 0, since: null, byType: [] });
  });
});

describe("writer to reader: the row recordAction stores is the row the SQL reads", () => {
  it("recordAdminAction, called as adminSecurity.recordAction calls it, stores verdict and itemType at the JSON paths the SQL reads", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    dbMock.mockResolvedValue({ insert: vi.fn(() => ({ values })) });
    const { recordAdminAction } = await import("../services/adminAudit");
    // The client payload { action, entityType: "booking", entityId: 7, changes: { verdict, itemType, source } }
    // goes through the router as: entityType forced to "admin_action", entityType kept as sourceEntityType.
    await recordAdminAction({
      actor: "owner@example.test",
      action: "admin.queue_feedback",
      entityType: "admin_action",
      entityId: 7,
      changes: { sourceEntityType: "booking", verdict: "less", itemType: "booking", source: "today" },
    });
    const row = values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.entityType).toBe("admin_action");
    expect(row.action).toBe("admin.queue_feedback");
    const changes = row.changes as Record<string, unknown>;
    // '$.verdict' and '$.itemType' are top-level keys of the stored JSON object.
    expect(changes.verdict).toBe("less");
    expect(changes.itemType).toBe("booking");
    // ...and those are exactly the paths and columns the read uses.
    const text = await sqlOf();
    expect(text).toContain("JSON_EXTRACT(changes, '$.verdict')");
    expect(text).toContain("JSON_EXTRACT(changes, '$.itemType')");
    expect(text).toContain("entity_type = 'admin_action'");
    expect(text).toContain("action = 'admin.queue_feedback'");
  });

  it("the router's recordAction really maps the payload that way (the shape above is not invented)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../routers/adminSecurity.ts", import.meta.url), "utf8");
    expect(src).toMatch(/entityType: "admin_action",\s*entityId: input\.entityId,\s*changes: \{ sourceEntityType: input\.entityType \?\? null, \.\.\.\(input\.changes \?\? \{\}\) \}/);
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
