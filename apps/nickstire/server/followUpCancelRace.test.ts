/**
 * followUps.cancel is a compare-and-swap (skill claim-before-act).
 *
 * The cancel read `status = 'pending'` and then wrote `UPDATE ... WHERE id = ?`.
 * A send that lands between the read and the write was overwritten to
 * 'skipped': the customer got the text, the record says it was never sent, and
 * the operator was told the cancel worked. The write must carry the status it
 * read, and losing the race must surface as the same precondition error.
 *
 * The fake DB evaluates the UPDATE's real WHERE clause (rendered by drizzle's
 * MySqlDialect), so dropping the status clause from the router changes the
 * outcome here, not just a string.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

type Row = { id: number; status: string };
const store: { row: Row | null; beforeUpdate: (() => void) | null; updates: number } = { row: null, beforeUpdate: null, updates: 0 };
const dialect = new MySqlDialect();

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (store.row ? [{ ...store.row }] : []) }),
      }),
    }),
    update: () => ({
      set: (values: Partial<Row>) => ({
        where: async (cond: Parameters<typeof dialect.sqlToQuery>[0]) => {
          store.beforeUpdate?.();
          const q = dialect.sqlToQuery(cond);
          const row = store.row;
          const idOk = row !== null && q.params.includes(row.id);
          const statusClause = /`status` = \?/.test(q.sql);
          const statusOk = !statusClause || (row !== null && q.params.includes(row.status));
          if (!idOk || !statusOk) return [{ affectedRows: 0 }];
          store.updates += 1;
          Object.assign(row!, values);
          return [{ affectedRows: 1 }];
        },
      }),
    }),
  };
}

vi.mock("./lib/db-helper", () => ({
  db: async () => null,
  dbTyped: async () => fakeDb(),
  requireDb: async () => fakeDb(),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin",
      loginMethod: "manus", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx());

beforeEach(() => {
  store.row = { id: 42, status: "pending" };
  store.beforeUpdate = null;
  store.updates = 0;
});

describe("followUps.cancel is a compare-and-swap", () => {
  it("cancels a pending follow-up", async () => {
    await expect(admin().followUps.cancel({ id: 42 })).resolves.toEqual({ ok: true, id: 42 });
    expect(store.row?.status).toBe("skipped");
  });

  it("a send landing between the read and the write leaves the row 'sent' and the operator gets the precondition error", async () => {
    store.beforeUpdate = () => {
      store.row!.status = "sent"; // the follow-up sender wins the race
    };
    await expect(admin().followUps.cancel({ id: 42 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: 'Can only cancel pending follow-ups (this one is "sent")',
    });
    expect(store.row?.status).toBe("sent");
    expect(store.updates).toBe(0);
  });

  it("a non-pending row is refused before any write", async () => {
    store.row = { id: 42, status: "failed" };
    await expect(admin().followUps.cancel({ id: 42 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(store.updates).toBe(0);
  });
});
