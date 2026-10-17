/**
 * The follow-up sender's writers are compare-and-swaps too (review P3-2).
 *
 * markNotificationSent / markNotificationFailed wrote `WHERE id = ?` only, so a
 * send that finished after the operator tapped Cancel overwrote 'skipped'. Both
 * now carry `AND status = 'pending'` and report whether the row changed.
 * Both directions: a pending row moves; a skipped row stays skipped.
 *
 * No real database: mysql2 and drizzle are mocked, and the fake evaluates the
 * UPDATE's real WHERE clause rendered by drizzle's MySqlDialect.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

type Row = { id: number; status: string };
const store: { row: Row } = { row: { id: 7, status: "pending" } };
const dialect = new MySqlDialect();

const fakeDb = {
  update: () => ({
    set: (values: Partial<Row>) => ({
      where: async (cond: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const q = dialect.sqlToQuery(cond);
        const idOk = q.params.includes(store.row.id);
        const statusOk = !/`status` = \?/.test(q.sql) || q.params.includes(store.row.status);
        if (!idOk || !statusOk) return [{ affectedRows: 0 }];
        Object.assign(store.row, values);
        return [{ affectedRows: 1 }];
      },
    }),
  }),
};

vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({ end: async () => {} }) } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => fakeDb }));

// stubEnv, not a bare assignment: process.env is shared with every other test file in this worker.
vi.stubEnv("DATABASE_URL", "mysql://test:test@127.0.0.1:1/never");
const { markNotificationSent, markNotificationFailed, resetDbConnection, getDb } = await import("./db");
// Build the (mocked) singleton now: the config unstubs env before each test, and getDb is lazy.
await getDb();

afterAll(() => {
  resetDbConnection();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  store.row = { id: 7, status: "pending" };
});

describe("markNotificationSent is a compare-and-swap", () => {
  it("pending -> sent", async () => {
    await expect(markNotificationSent(7)).resolves.toMatchObject({ success: true, changed: true });
    expect(store.row.status).toBe("sent");
  });
  it("an operator's 'skipped' is never overwritten by a late send", async () => {
    store.row.status = "skipped";
    await expect(markNotificationSent(7)).resolves.toMatchObject({ changed: false });
    expect(store.row.status).toBe("skipped");
  });
});

describe("markNotificationFailed is a compare-and-swap", () => {
  it("pending -> failed", async () => {
    await expect(markNotificationFailed(7)).resolves.toMatchObject({ success: true, changed: true });
    expect(store.row.status).toBe("failed");
  });
  it("an operator's 'skipped' is never overwritten by a late failure", async () => {
    store.row.status = "skipped";
    await expect(markNotificationFailed(7)).resolves.toMatchObject({ changed: false });
    expect(store.row.status).toBe("skipped");
  });
});
