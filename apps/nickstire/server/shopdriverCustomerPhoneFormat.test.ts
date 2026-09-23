/**
 * ShopDriver customer import: a customer already stored with the phone in
 * another format is updated, counted once, and never logged in full
 * (post-merge audit 2026-09-23, item H).
 *
 * The import looks the customer up by the exact E.164 string. A row stored as
 * "2165551234" misses that SELECT, so the INSERT runs and hits
 * uniq_customer_phone10 (last 10 digits). Since #2589 made the duplicate-key
 * check see through drizzle's wrapper, that reaches the "race" branch. It
 * updated WHERE phone = '+12165551234', matched 0 rows, counted the row as
 * updated anyway, and logged the full phone number.
 *
 * The fake below holds the customers table in memory and evaluates each WHERE
 * by rendering it with drizzle's own MySQL dialect, so the test sees which key
 * the code actually used. The INSERT throws the shape a real one does: a
 * DrizzleQueryError wrapping the driver's ER_DUP_ENTRY.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleQueryError, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

type Row = { id: number; phone: string; firstName: string; email: string | null };

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: number; phone: string; firstName: string; email: string | null }>,
  importLogUpdates: [] as Array<Record<string, unknown>>,
  /** Rows the NEXT customers SELECT cannot see yet: a rival insert that lands after it. */
  hiddenFromNextSelect: [] as Array<{ id: number; phone: string; firstName: string; email: string | null }>,
}));

vi.mock("./db", () => ({ getDbTyped: async () => null, getDb: async () => null }));
vi.mock("./lib/db-helper", async () => {
  const schema = await import("../drizzle/schema");
  const dialect = new MySqlDialect();
  const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);
  /** Match a single `col = ?` condition against a row. */
  const matches = (cond: SQL, row: Row): boolean => {
    const q = dialect.sqlToQuery(cond);
    const col = /`(\w+)` = \?/.exec(q.sql)?.[1];
    const v = q.params[0];
    if (col === "phone10") return last10(row.phone) === v;
    if (col === "phone") return row.phone === v;
    if (col === "id") return row.id === v;
    throw new Error(`fake db: unsupported WHERE ${q.sql}`);
  };
  const fake = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: SQL) => ({
          limit: async () => {
            if (table !== schema.customers) return [];
            const found = h.rows.filter((r) => matches(cond, r)).map((r) => ({ id: r.id }));
            if (h.hiddenFromNextSelect.length) {
              h.rows.push(...h.hiddenFromNextSelect.splice(0));
              return [];
            }
            return found;
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (v: Record<string, unknown>) => {
        if (table === schema.customerImportLog) return [{ insertId: 1 }];
        const phone = String(v.phone);
        const clash = h.rows.find((r) => r.phone === phone || last10(r.phone) === last10(phone));
        if (clash) {
          const key = clash.phone === phone ? "uniq_customer_phone" : "uniq_customer_phone10";
          const driver = Object.assign(new Error(`Duplicate entry '${last10(phone)}' for key 'customers.${key}'`), {
            code: "ER_DUP_ENTRY",
            errno: 1062,
          });
          throw new DrizzleQueryError("insert into `customers` (`firstName`, `phone`) values (?, ?)", [v.firstName, phone], driver);
        }
        h.rows.push({ id: h.rows.length + 100, phone, firstName: String(v.firstName), email: (v.email as string) ?? null });
        return [{ insertId: h.rows.length + 99 }];
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (cond: SQL) => {
          if (table === schema.customerImportLog) {
            h.importLogUpdates.push(patch);
            return [{ affectedRows: 1 }];
          }
          const hit = h.rows.filter((r) => matches(cond, r));
          for (const r of hit) Object.assign(r, { firstName: patch.firstName ?? r.firstName, email: patch.email ?? r.email });
          return [{ affectedRows: hit.length }];
        },
      }),
    }),
  };
  return { db: async () => fake, dbTyped: async () => fake, requireDb: async () => fake };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx());

const csv = (phone: string) => `First Name,Last Name,Phone,Email\nJane,Doe,${phone},jane@new.example\n`;

let output: string[] = [];
beforeEach(() => {
  h.rows = [{ id: 7, phone: "2165551234", firstName: "Old", email: null }];
  h.importLogUpdates = [];
  h.hiddenFromNextSelect = [];
  output = [];
  const capture = (chunk: unknown) => {
    output.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capture as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(capture as typeof process.stderr.write);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ShopDriver CSV import: existing customer stored in another phone format", () => {
  it("updates the existing row found by phone10 and counts it as updated", async () => {
    const res = await admin().shopdriver.importCSV({ csvContent: csv("(216) 555-1234") });
    expect(res).toMatchObject({ success: true, newCustomers: 0, updatedCustomers: 1, skippedRows: 0 });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ id: 7, phone: "2165551234", firstName: "Jane", email: "jane@new.example" });
  });

  it("never logs the full phone number (last 4 at most)", async () => {
    await admin().shopdriver.importCSV({ csvContent: csv("(216) 555-1234") });
    const all = output.join("");
    expect(all).not.toContain("2165551234");
    expect(all).not.toContain("+12165551234");
  });

  it("an exact-format race (uniq_customer_phone) still updates the one row", async () => {
    h.rows = [];
    h.hiddenFromNextSelect = [{ id: 9, phone: "+12165559876", firstName: "Rival", email: null }];
    const res = await admin().shopdriver.importCSV({ csvContent: csv("2165559876") });
    expect(res).toMatchObject({ newCustomers: 0, updatedCustomers: 1, skippedRows: 0 });
    expect(h.rows).toEqual([{ id: 9, phone: "+12165559876", firstName: "Jane", email: "jane@new.example" }]);
  });

  it("a row that fails for another reason is skipped without logging the phone", async () => {
    h.rows = [];
    const res = await admin().shopdriver.importCSV({ csvContent: csv("2165557777") });
    expect(res).toMatchObject({ newCustomers: 1 });
    // Second import: the SELECT itself throws a wrapped error carrying the phone in its params.
    const boom = new DrizzleQueryError("select `id` from `customers` where `phone` = ?", ["+12165558888"], Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }));
    h.hiddenFromNextSelect = [];
    const orig = h.rows;
    h.rows = new Proxy(orig, { get: (t, k) => (k === "filter" ? () => { throw boom; } : Reflect.get(t, k)) });
    const res2 = await admin().shopdriver.importCSV({ csvContent: csv("2165558888") });
    h.rows = orig;
    expect(res2).toMatchObject({ skippedRows: 1 });
    const all = output.join("");
    expect(all).toContain("DrizzleQueryError > Error ETIMEDOUT");
    expect(all).not.toContain("2165558888");
  });

  it("a genuinely new customer is inserted", async () => {
    const res = await admin().shopdriver.importCSV({ csvContent: csv("2165550000") });
    expect(res).toMatchObject({ newCustomers: 1, updatedCustomers: 0, skippedRows: 0 });
    expect(h.rows).toHaveLength(2);
  });
});
