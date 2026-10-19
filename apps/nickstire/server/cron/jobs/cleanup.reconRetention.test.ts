/**
 * JOB 2026-10-18-recon-candidates-retention · the cleanup cron reports the
 * superseded-row counts of revenue_reconciliation_candidates every night
 * (counts only, in `details` so cron_log carries them) and deletes only while
 * the revenue_recon_retention flag is ON.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  isEnabled: vi.fn<(key: string) => Promise<boolean>>(),
  info: vi.fn(),
  warn: vi.fn(),
  dbAvailable: true,
}));

vi.mock("../../db", () => ({
  getDb: async () => (h.dbAvailable ? { execute: h.execute, delete: () => ({ where: async () => [{ affectedRows: 0 }] }) } : null),
}));
vi.mock("../../lib/jobQueue", () => ({ jobQueue: { cleanup: () => 0 } }));
vi.mock("../../lib/cache", () => ({ cleanupMemCache: () => 0 }));
vi.mock("../../lib/logger", () => ({
  createLogger: () => ({ info: h.info, warn: h.warn, error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../services/featureFlags", () => ({ isEnabled: h.isEnabled }));
vi.mock("../../services/bridgeOutboxCompleteness", () => ({ bridgeOutboxCompleteness: vi.fn() }));

import { cleanupOldData } from "./cleanup";

function sqlText(q: unknown): string {
  return (q as { queryChunks: unknown[] }).queryChunks
    .map((c) => (c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value) ? (c as { value: string[] }).value.join("") : "?"))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

const reconCalls = () => h.execute.mock.calls.map((c) => sqlText(c[0])).filter((t) => /revenue_reconciliation_candidates/.test(t));

// call 1 has 3 copies (2 superseded), call 2 has 1.
const GROUPS = [
  { call_id: 1, n: "3", latest: 300 },
  { call_id: 2, n: "1", latest: 150 },
];

// What the fresh feature_flags read answers: a row value, no row at all, or a rejection.
type FlagRead = { row: number } | "missing" | "reject";
let flagRead: FlagRead = { row: 0 };
const flagReads = () => h.execute.mock.calls.map((c) => sqlText(c[0])).filter((t) => /FROM feature_flags/.test(t));

beforeEach(() => {
  vi.clearAllMocks();
  h.dbAvailable = true;
  flagRead = { row: 0 };
  h.execute.mockImplementation(async (q: unknown) => {
    const t = sqlText(q);
    if (/FROM feature_flags/.test(t)) {
      if (flagRead === "reject") throw new Error("Lost connection to MySQL server");
      return [flagRead === "missing" ? [] : [{ value: flagRead.row }], []];
    }
    if (/^SELECT .*revenue_reconciliation_candidates/.test(t)) return [GROUPS, []];
    if (/^DELETE FROM `revenue_reconciliation_candidates`/.test(t)) return [{ affectedRows: 2 }, []];
    return [{ affectedRows: 0 }, []];
  });
  // The cached isEnabled (production swallows a failed refresh and returns the stale value) says ON in
  // EVERY test here, as a trap: the retention delete must decide from the fresh row read, never from this.
  h.isEnabled.mockResolvedValue(true);
});

describe("cleanupOldData · revenue_reconciliation_candidates retention", () => {
  it("flag row false: appends the counts to details, logs them, and issues no DELETE on the table", async () => {
    const out = await cleanupOldData();
    expect(out.details).toContain("recon candidates: rows 4, calls 2, superseded 2, deleted 0 (flag off)");
    expect(reconCalls().some((t) => /^DELETE/.test(t))).toBe(false);
    expect(flagReads()).toHaveLength(1);
    const logged = h.info.mock.calls.find((c) => c[0] === "recon candidates retention");
    expect(logged?.[1]).toMatchObject({ rows: 4, calls: 2, superseded: 2, deleted: 0, flag: "off" });
  });

  it("stale cached ON, fresh row false (the operator just turned it OFF): no DELETE", async () => {
    flagRead = { row: 0 };
    h.isEnabled.mockResolvedValue(true);
    const out = await cleanupOldData();
    expect(reconCalls().some((t) => /^DELETE/.test(t))).toBe(false);
    expect(out.details).toContain("(flag off)");
    expect(h.isEnabled).not.toHaveBeenCalledWith("revenue_recon_retention");
  });

  it("no feature_flags row at all reads OFF: no DELETE", async () => {
    flagRead = "missing";
    const out = await cleanupOldData();
    expect(reconCalls().some((t) => /^DELETE/.test(t))).toBe(false);
    expect(out.details).toContain("(flag off)");
  });

  it("the fresh flag read rejects: no DELETE, and details say 'flag unreadable', not a silent off", async () => {
    flagRead = "reject";
    const out = await cleanupOldData();
    expect(reconCalls().some((t) => /^DELETE/.test(t))).toBe(false);
    expect(out.details).toContain("recon candidates: rows 4, calls 2, superseded 2, deleted 0 (flag unreadable)");
    expect(out.details).not.toContain("(flag off)");
  });

  it("flag row true: deletes the superseded rows of the duplicate call only, and counts them in recordsProcessed", async () => {
    flagRead = { row: 1 };
    h.isEnabled.mockResolvedValue(false); // the cached flag is irrelevant: the row decides
    const out = await cleanupOldData();
    const del = reconCalls().filter((t) => /^DELETE/.test(t));
    expect(del).toEqual(["DELETE FROM `revenue_reconciliation_candidates` WHERE call_id = ? AND UNIX_TIMESTAMP(created_at) < ?"]);
    expect(out.details).toContain("recon candidates: rows 4, calls 2, superseded 2, deleted 2 (flag on)");
    expect(out.recordsProcessed).toBe(2);
  });

  it("a missing table: details say unavailable, the job still succeeds and does not warn about a failure", async () => {
    h.execute.mockImplementation(async (q: unknown) => {
      if (/revenue_reconciliation_candidates/.test(sqlText(q))) {
        throw Object.assign(new Error("Table 'nick.revenue_reconciliation_candidates' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
      }
      return [{ affectedRows: 0 }, []];
    });
    const out = await cleanupOldData();
    expect(out.details).toContain("recon candidates: unavailable");
    expect(out.details).toMatch(/^Cleaned 0 stale entries/);
  });

  it("no database connection: details say unavailable instead of omitting the section", async () => {
    h.dbAvailable = false;
    const out = await cleanupOldData();
    expect(out.details).toContain("recon candidates: unavailable");
  });
});
