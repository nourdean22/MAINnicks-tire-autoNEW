/**
 * The schema guard's whole job is to convert a SILENT degradation into a loud one,
 * so its own failure modes matter more than its happy path:
 *
 *   - "we could not check" must never render as "nothing is missing" (ROS-059 hid
 *     inside exactly that ambiguity, and #953 drew the same distinction for the
 *     opt-out index: stale is valid, absent is not);
 *   - it must never throw, because it runs on the boot path and a false positive
 *     that crashes the server is worse than the degradation it reports;
 *   - every registry entry must carry an actionable consequence + migration, since
 *     "table missing" alone does not tell an operator what broke.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const h = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: h.getDb }));

import { auditCriticalTables, getLastSchemaAudit, CRITICAL_TABLES } from "./services/schemaGuard";

const readResult = (rows: unknown[]) => [rows, []];
const allPresent = () => readResult(CRITICAL_TABLES.map((t) => ({ name: t.table })));

afterEach(() => {
  // singleFork shares ONE process across files (apps/nickstire/AGENTS.md §3).
  h.getDb.mockReset();
});

describe("CRITICAL_TABLES registry — an entry an operator cannot act on is noise", () => {
  it("is non-empty and free of duplicates", () => {
    const names = CRITICAL_TABLES.map((t) => t.table);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every table a consequence and a migration path", () => {
    for (const t of CRITICAL_TABLES) {
      expect(t.table, "table name must be non-empty").toBeTruthy();
      // A vague consequence defeats the purpose — the operator reads this line to
      // decide whether to stop and apply a migration right now.
      expect(t.consequence.length, `${t.table} needs a real consequence`).toBeGreaterThan(40);
      expect(t.migration, `${t.table} needs a migration hint`).toMatch(/\.(sql|ts)/);
    }
  });

  it("still registers sms_response_jobs — the table whose absence proved this necessary", () => {
    expect(CRITICAL_TABLES.map((t) => t.table)).toContain("sms_response_jobs");
  });
});

describe("auditCriticalTables", () => {
  it("reports ok when every critical table is present", async () => {
    h.getDb.mockResolvedValue({ execute: vi.fn().mockResolvedValue(allPresent()) });
    const result = await auditCriticalTables();
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.checked).toBe(CRITICAL_TABLES.length);
  });

  it("names the missing table with its consequence and migration", async () => {
    const present = CRITICAL_TABLES.filter((t) => t.table !== "sms_response_jobs").map((t) => ({ name: t.table }));
    h.getDb.mockResolvedValue({ execute: vi.fn().mockResolvedValue(readResult(present)) });

    const result = await auditCriticalTables();
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].table).toBe("sms_response_jobs");
    expect(result.missing[0].migration).toContain("0092");
    expect(result.missing[0].consequence).toMatch(/restart/i);
  });

  it("reports ok:false with an error — NOT a clean pass — when it cannot check", async () => {
    // The ROS-059 ambiguity, pinned: an audit that did not run must never be
    // indistinguishable from an audit that found nothing wrong.
    h.getDb.mockResolvedValue(null);
    const result = await auditCriticalTables();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.missing).toEqual([]); // empty because unknown, and ok:false says so
  });

  it("never throws when the query itself fails — it runs on the boot path", async () => {
    h.getDb.mockResolvedValue({ execute: vi.fn().mockRejectedValue(new Error("ER_ACCESS_DENIED")) });
    const result = await auditCriticalTables();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ER_ACCESS_DENIED");
  });

  it("caches the last result so health can report it without re-querying", async () => {
    h.getDb.mockResolvedValue({ execute: vi.fn().mockResolvedValue(allPresent()) });
    const result = await auditCriticalTables();
    expect(getLastSchemaAudit()).toEqual(result);
  });
});
