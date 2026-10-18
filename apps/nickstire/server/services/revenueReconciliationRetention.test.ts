/**
 * Retention for revenue_reconciliation_candidates (JOB 2026-10-18-recon-candidates-retention).
 *
 * The 2-hour reconciliation run re-inserts one row per call in its 21-day window,
 * and both readers keep only the newest row per call_id. These tests pin the
 * delete rule against an in-memory table that applies the statements the way the
 * engine would, so "never deletes the newest row" is proved on data, not on text.
 * Nothing here opens a database; rows are invented fixtures.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  MAX_DELETE_MS_PER_RUN,
  MAX_DELETE_STATEMENTS_PER_RUN,
  RECON_CANDIDATES_TABLE,
  buildDeleteSupersededSql,
  buildReportSql,
  reconCandidatesRetention,
  reconRetentionDetails,
  toDrizzleSql,
  type SqlStatement,
} from "./revenueReconciliationRetention";

type Row = { id: string; callId: number; createdAt: number };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** In-memory table: answers the report read and applies the per-call DELETE like the engine. */
function fakeTable(initial: Row[]) {
  let rows = [...initial];
  const statements: SqlStatement[] = [];
  const query = vi.fn(async (stmt: SqlStatement) => {
    statements.push(stmt);
    const text = norm(stmt.text);
    if (/^SELECT/i.test(text)) {
      const byCall = new Map<number, { n: number; latest: number }>();
      for (const r of rows) {
        const g = byCall.get(r.callId) ?? { n: 0, latest: 0 };
        g.n += 1;
        g.latest = Math.max(g.latest, r.createdAt);
        byCall.set(r.callId, g);
      }
      return [[...byCall].map(([call_id, g]) => ({ call_id, n: String(g.n), latest: g.latest })), []];
    }
    if (/^DELETE/i.test(text)) {
      // The fake reads the statement TEXT, so a DELETE that loses its bound (or widens it to <=) deletes the newest row here too.
      const [callId, bound] = stmt.params as [number, number | undefined];
      const op = text.match(/ AND UNIX_TIMESTAMP\(created_at\) (<=?) \?$/)?.[1] ?? null;
      const before = rows.length;
      rows = rows.filter((r) => !(r.callId === callId && (op === null || (op === "<" ? r.createdAt < bound! : r.createdAt <= bound!))));
      return [{ affectedRows: before - rows.length }, undefined];
    }
    throw new Error(`unexpected statement: ${text}`);
  });
  return { query, statements, rows: () => rows };
}

const deletes = (s: SqlStatement[]) => s.filter((x) => /^DELETE/i.test(norm(x.text)));
const flag = (on: boolean) => async () => on;

/** call 1: three copies (2 superseded); call 2: one row; call 3: two copies, tied at the max (nothing superseded). */
const FIXTURE: Row[] = [
  { id: "a1", callId: 1, createdAt: 100 },
  { id: "a2", callId: 1, createdAt: 200 },
  { id: "a3", callId: 1, createdAt: 300 },
  { id: "b1", callId: 2, createdAt: 150 },
  { id: "c1", callId: 3, createdAt: 400 },
  { id: "c2", callId: 3, createdAt: 400 },
];

beforeEach(() => vi.clearAllMocks());

describe("report (always runs, read only)", () => {
  it("T1 flag OFF: counts are reported, zero DELETE statements are issued, deleted is 0", async () => {
    const t = fakeTable(FIXTURE);
    const r = await reconCandidatesRetention({ query: t.query, isEnabled: flag(false) });
    expect(r).toMatchObject({ state: "measured", rows: 6, calls: 3, superseded: 3, deleted: 0, flag: "off" });
    expect(deletes(t.statements)).toHaveLength(0);
    expect(t.rows()).toHaveLength(6);
    expect(reconRetentionDetails(r)).toBe("recon candidates: rows 6, calls 3, superseded 3, deleted 0 (flag off)");
  });

  it("T7 the report SQL names no text column (counts only, no PII)", () => {
    const text = norm(buildReportSql().text);
    expect(text).not.toMatch(/evidence_json/i);
    expect(text).not.toMatch(/SELECT\s+\*|\w\.\*/i); // COUNT(*) is fine; a star projection would pull every column
    // every selected column is one of the three numeric aliases
    expect(text.replace(/^SELECT /i, "").split(/ FROM /i)[0]).toBe("call_id, COUNT(*) AS n, UNIX_TIMESTAMP(MAX(created_at)) AS latest");
    expect(text).toMatch(/GROUP BY call_id/i);
  });

  it("T6 a missing table reads as unavailable and does not throw", async () => {
    const missing = Object.assign(new Error("Table 'nick.revenue_reconciliation_candidates' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
    const query = vi.fn(async () => { throw missing; });
    const r = await reconCandidatesRetention({ query, isEnabled: flag(true) });
    expect(r).toEqual({ state: "unavailable" });
    expect(reconRetentionDetails(r)).toBe("recon candidates: unavailable");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("a failed read of any other kind is unavailable too, never zero rows, and nothing is deleted", async () => {
    const query = vi.fn(async () => { throw new Error("Lost connection to MySQL server"); });
    const r = await reconCandidatesRetention({ query, isEnabled: flag(true) });
    expect(r).toEqual({ state: "unavailable" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("a read that returns malformed rows is unavailable, never a confident zero", async () => {
    for (const bad of [[[{ affectedRows: 3 }, []], []], [[{ call_id: "x", n: "2", latest: 5 }], []], [[{ call_id: 1, n: "2", latest: null }], []], "nope", undefined]) {
      const query = vi.fn(async () => bad);
      const r = await reconCandidatesRetention({ query, isEnabled: flag(true) });
      expect(r).toEqual({ state: "unavailable" });
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it("an empty table is a measured zero, not unavailable", async () => {
    const t = fakeTable([]);
    const r = await reconCandidatesRetention({ query: t.query, isEnabled: flag(true) });
    expect(r).toMatchObject({ state: "measured", rows: 0, calls: 0, superseded: 0, deleted: 0 });
  });
});

describe("delete (flag ON only)", () => {
  it("T2 exactly one DELETE per duplicate call, bound to that call's newest time, none for a single-row call", async () => {
    const t = fakeTable(FIXTURE);
    const r = await reconCandidatesRetention({ query: t.query, isEnabled: flag(true) });
    const d = deletes(t.statements);
    // call 1 has 3 copies; call 3 has 2 copies tied at the max (still a "duplicate call": its DELETE removes nothing).
    expect(d.map((x) => x.params).sort()).toEqual([[1, 300], [3, 400]]);
    expect(d.some((x) => x.params[0] === 2)).toBe(false);
    expect(r).toMatchObject({ state: "measured", flag: "on", deleted: 2 });
    expect(reconRetentionDetails(r)).toBe("recon candidates: rows 6, calls 3, superseded 3, deleted 2 (flag on)");
  });

  it("the newest row of every call survives, and ties at the maximum are all kept", async () => {
    const t = fakeTable(FIXTURE);
    await reconCandidatesRetention({ query: t.query, isEnabled: flag(true) });
    expect(t.rows().map((r) => r.id).sort()).toEqual(["a3", "b1", "c1", "c2"]);
  });

  it("T3 the DELETE text always carries the created_at bound and the call_id filter", async () => {
    const stmt = buildDeleteSupersededSql(7, 1_700_000_000);
    const text = norm(stmt.text);
    expect(text).toMatch(/^DELETE FROM `revenue_reconciliation_candidates` WHERE call_id = \? AND UNIX_TIMESTAMP\(created_at\) < \?$/);
    expect(stmt.params).toEqual([7, 1_700_000_000]);
    const t = fakeTable(FIXTURE);
    await reconCandidatesRetention({ query: t.query, isEnabled: flag(true) });
    for (const d of deletes(t.statements)) {
      expect(norm(d.text)).toMatch(/call_id = \? AND UNIX_TIMESTAMP\(created_at\) < \?/);
      expect(d.params).toHaveLength(2);
    }
  });

  it("the builders refuse a non-integer call id, a non-positive bound, and an unsafe table name", () => {
    expect(() => buildDeleteSupersededSql(Number.NaN, 5)).toThrow();
    expect(() => buildDeleteSupersededSql(1.5, 5)).toThrow();
    expect(() => buildDeleteSupersededSql(1, Number.NaN)).toThrow();
    expect(() => buildDeleteSupersededSql(1, 0)).toThrow();
    expect(() => buildDeleteSupersededSql(1, 5, "t; DROP TABLE x")).toThrow();
    expect(() => buildReportSql("a b")).toThrow();
    expect(norm(buildReportSql("tmp_probe").text)).toContain("`tmp_probe`");
    expect(norm(buildDeleteSupersededSql(1, 5, "tmp_probe").text)).toContain("`tmp_probe`");
  });

  it("T4 the per-run statement cap: 250 duplicate calls issue exactly the cap, largest groups first", async () => {
    const rows: Row[] = [];
    for (let call = 1; call <= 250; call++) {
      // call N has (N % 5) + 2 copies, so group sizes vary from 2 to 6.
      for (let k = 0; k < (call % 5) + 2; k++) rows.push({ id: `r${call}-${k}`, callId: call, createdAt: 1000 + k });
    }
    const t = fakeTable(rows);
    const r = await reconCandidatesRetention({ query: t.query, isEnabled: flag(true) });
    expect(MAX_DELETE_STATEMENTS_PER_RUN).toBe(200);
    const d = deletes(t.statements);
    expect(d).toHaveLength(MAX_DELETE_STATEMENTS_PER_RUN);
    // The 50 left over are the smallest groups (2 copies), and the next run picks them up.
    const leftover = new Set(rows.map((x) => x.callId));
    for (const x of d) leftover.delete(x.params[0] as number);
    expect(leftover.size).toBe(50);
    for (const call of leftover) expect((call % 5) + 2).toBe(2);
    expect(r).toMatchObject({ state: "measured", flag: "on", truncated: true });
  });

  it("the per-run time cap: stops issuing DELETEs once the budget is spent", async () => {
    const rows: Row[] = [];
    for (let call = 1; call <= 20; call++) rows.push({ id: `x${call}`, callId: call, createdAt: 10 }, { id: `y${call}`, callId: call, createdAt: 20 });
    const t = fakeTable(rows);
    let clock = 0;
    const query = vi.fn(async (s: SqlStatement) => {
      if (/^DELETE/i.test(norm(s.text))) clock += MAX_DELETE_MS_PER_RUN / 4; // each delete "takes" a quarter of the budget
      return t.query(s);
    });
    const r = await reconCandidatesRetention({ query, isEnabled: flag(true), now: () => clock });
    expect(MAX_DELETE_MS_PER_RUN).toBe(60_000);
    expect(deletes(t.statements)).toHaveLength(4);
    expect(r).toMatchObject({ state: "measured", deleted: 4, truncated: true });
  });

  it("T5 a flag read that throws behaves as OFF: report only, no DELETE", async () => {
    const t = fakeTable(FIXTURE);
    const r = await reconCandidatesRetention({ query: t.query, isEnabled: async () => { throw new Error("flag store down"); } });
    expect(r).toMatchObject({ state: "measured", flag: "off", deleted: 0 });
    expect(deletes(t.statements)).toHaveLength(0);
  });

  it("a failing DELETE stops the batch, keeps the count so far, and does not throw", async () => {
    const t = fakeTable(FIXTURE);
    let n = 0;
    const query = vi.fn(async (s: SqlStatement) => {
      if (/^DELETE/i.test(norm(s.text)) && ++n === 2) throw new Error("Lost connection to MySQL server");
      return t.query(s);
    });
    const r = await reconCandidatesRetention({ query, isEnabled: flag(true) });
    expect(r).toMatchObject({ state: "measured", deleted: 2, deleteFailed: true });
    expect(reconRetentionDetails(r)).toMatch(/delete stopped on an error/);
  });

  it("a driver that reports no affected-row count is not counted as zero deleted: it reads as unknown", async () => {
    const t = fakeTable(FIXTURE);
    const query = vi.fn(async (s: SqlStatement) => (/^DELETE/i.test(norm(s.text)) ? [{}, undefined] : t.query(s)));
    const r = await reconCandidatesRetention({ query, isEnabled: flag(true) });
    expect(r).toMatchObject({ state: "measured", deleted: null });
    expect(reconRetentionDetails(r)).toBe("recon candidates: rows 6, calls 3, superseded 3, deleted unknown (flag on)");
  });
});

describe("drizzle adapter", () => {
  it("renders the exact text and params the builders produced", async () => {
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    const dialect = new MySqlDialect();
    for (const stmt of [buildReportSql(), buildDeleteSupersededSql(9, 1_700_000_123)]) {
      const q = dialect.sqlToQuery(toDrizzleSql(stmt));
      expect(norm(q.sql)).toBe(norm(stmt.text));
      expect(q.params).toEqual(stmt.params);
    }
  });

  it("uses the real table name by default", () => {
    expect(RECON_CANDIDATES_TABLE).toBe("revenue_reconciliation_candidates");
    expect(buildReportSql().text).toContain("`revenue_reconciliation_candidates`");
  });
});
