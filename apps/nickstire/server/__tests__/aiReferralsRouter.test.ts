/**
 * trpc.aiReferrals (server/routers/admin/aiReferrals.ts), 2026-10-21.
 *
 * Staff log "an AI assistant sent this customer" from the admin (one
 * customer_events row, eventName admin_ai_referral; no schema change), and the
 * summary counts those logs plus web rows whose utmSource/referrer name an
 * assistant. Pins:
 *   1. log is admin-only, writes exactly one row, and a failed write THROWS
 *      (the operator must see it), never a quiet { success: false };
 *   2. summary returns the contract shape, and each half is null when ITS read
 *      failed: a failed read is never a zero (skill empty-vs-error);
 *   3. every read is bounded (LIMIT 5000) and windowed to 30 days in UTC text.
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  dbAvailable: true,
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  insertError: null as Error | null,
  rowsByTable: new Map<unknown, Row[]>(),
  failTables: new Set<unknown>(),
  reads: [] as Array<{ table: unknown; where: unknown; limit: number }>,
  logLines: [] as string[],
}));

vi.mock("../lib/logger", () => ({
  createLogger: (module: string) => {
    const rec = (level: string) => (msg: string, ...args: unknown[]) => {
      h.logLines.push(`${level} ${module} ${msg} ${args.map((a) => String(a)).join(" ")}`);
    };
    return { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") };
  },
}));

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const fake = {
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (h.insertError) throw h.insertError;
        h.inserts.push({ table, values });
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: (where: unknown) => ({
          limit: async (limit: number) => {
            h.reads.push({ table, where, limit });
            if (h.failTables.has(table)) throw new Error("connection reset");
            return h.rowsByTable.get(table) ?? [];
          },
        }),
      }),
    }),
  };
  return { ...actual, getDb: async () => (h.dbAvailable ? fake : null), getDbTyped: async () => (h.dbAvailable ? fake : null) };
});

// With the db faked there is no admin_security row: the documented owner fallback.
vi.mock("../services/adminSecurity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/adminSecurity")>()),
  getAdminSecurityState: async () => null,
}));

import { appRouter } from "../routers";
import { bookings, callEvents, customerEvents, leads } from "../../drizzle/schema";

const user = (role: "admin" | "user") => ({
  id: 1, openId: `${role}-user`, email: `${role}@example.com`, name: role, loginMethod: "manus",
  role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
});
const ctx = (role: "admin" | "user" | null) =>
  ({ user: role ? user(role) : null, req: { headers: {}, ip: "127.0.0.1" }, res: {} }) as unknown as TrpcContext;
const caller = (role: "admin" | "user" | null = "admin") => appRouter.createCaller(ctx(role));

const render = (where: unknown) => new MySqlDialect().sqlToQuery(where as SQL);

beforeEach(() => {
  h.dbAvailable = true;
  h.inserts.length = 0;
  h.insertError = null;
  h.rowsByTable.clear();
  h.failTables.clear();
  h.reads.length = 0;
  h.logLines.length = 0;
});

describe("aiReferrals.log", () => {
  it("an admin's log writes ONE customer_events row with the assistant and topic", async () => {
    await expect(caller().aiReferrals.log({ assistant: "meta_ai", topic: "repair" })).resolves.toEqual({ ok: true });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].table).toBe(customerEvents);
    expect(h.inserts[0].values).toMatchObject({
      eventName: "admin_ai_referral",
      eventData: { assistant: "meta_ai", topic: "repair" },
      sourcePage: "/admin",
    });
  });

  it("topic is optional and stored as null", async () => {
    await caller().aiReferrals.log({ assistant: "chatgpt" });
    expect(h.inserts[0].values.eventData).toEqual({ assistant: "chatgpt", topic: null });
  });

  it("a non-admin and an anonymous caller are refused and nothing is written", async () => {
    await expect(caller("user").aiReferrals.log({ assistant: "chatgpt" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(null).aiReferrals.log({ assistant: "chatgpt" })).rejects.toThrow();
    expect(h.inserts).toHaveLength(0);
  });

  it("an unknown assistant id is rejected by input validation", async () => {
    await expect(
      caller().aiReferrals.log({ assistant: "bing" as unknown as "chatgpt" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.inserts).toHaveLength(0);
  });

  it("no database THROWS INTERNAL_SERVER_ERROR (the admin sees it), never a quiet success:false", async () => {
    h.dbAvailable = false;
    await expect(caller().aiReferrals.log({ assistant: "chatgpt" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("a failed insert THROWS INTERNAL_SERVER_ERROR and is logged", async () => {
    h.insertError = new Error("connection reset");
    await expect(caller().aiReferrals.log({ assistant: "chatgpt" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(h.logLines.some((l) => l.startsWith("error") && l.includes("connection reset"))).toBe(true);
  });
});

describe("aiReferrals.summary", () => {
  const seed = () => {
    h.rowsByTable.set(customerEvents, [
      { eventData: { assistant: "chatgpt", topic: "tires" } },
      { eventData: { assistant: "chatgpt", topic: null } },
      { eventData: JSON.stringify({ assistant: "meta_ai", topic: "repair" }) }, // a driver may hand back JSON text
      { eventData: { assistant: "bing" } }, // unknown id counts under other
    ]);
    h.rowsByTable.set(bookings, [
      { utmSource: "chatgpt.com", referrer: null },
      { utmSource: "google", referrer: "https://www.google.com/" }, // not an assistant
    ]);
    h.rowsByTable.set(leads, [{ utmSource: null, referrer: "https://www.meta.ai/" }]);
    h.rowsByTable.set(callEvents, [{ utmSource: null, referrer: "https://www.perplexity.ai/search?q=tires" }]);
  };

  it("returns the 30-day logged and web counts in the contract shape", async () => {
    seed();
    await expect(caller().aiReferrals.summary()).resolves.toEqual({
      windowDays: 30,
      logged: { total: 4, byAssistant: { chatgpt: 2, meta_ai: 1, other: 1 } },
      web: {
        total: 3,
        byAssistant: { chatgpt: 1, meta_ai: 1, perplexity: 1 },
        bySurface: { bookings: 1, leads: 1, calls: 1 },
      },
    });
  });

  it("a measured empty window is a real zero, not null", async () => {
    await expect(caller().aiReferrals.summary()).resolves.toEqual({
      windowDays: 30,
      logged: { total: 0, byAssistant: {} },
      web: { total: 0, byAssistant: {}, bySurface: { bookings: 0, leads: 0, calls: 0 } },
    });
  });

  it("a failed customer_events read makes logged null; web is still answered", async () => {
    seed();
    h.failTables.add(customerEvents);
    const res = await caller().aiReferrals.summary();
    expect(res.logged).toBeNull();
    expect(res.web?.total).toBe(3);
    expect(h.logLines.some((l) => l.startsWith("error") && l.includes("connection reset"))).toBe(true);
  });

  it.each([["bookings", bookings], ["leads", leads], ["call_events", callEvents]] as const)(
    "a failed %s read makes web null; logged is still answered",
    async (_name, table) => {
      seed();
      h.failTables.add(table);
      const res = await caller().aiReferrals.summary();
      expect(res.web).toBeNull();
      expect(res.logged?.total).toBe(4);
    },
  );

  it("no database: both halves are null, never zero", async () => {
    h.dbAvailable = false;
    await expect(caller().aiReferrals.summary()).resolves.toEqual({ windowDays: 30, logged: null, web: null });
  });

  it("every read is bounded at 5000 rows and windowed to 30 days in UTC datetime text", async () => {
    await caller().aiReferrals.summary();
    expect(new Set(h.reads.map((r) => r.table))).toEqual(new Set([customerEvents, bookings, leads, callEvents]));
    const expectedStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const r of h.reads) {
      expect(r.limit).toBe(5000);
      const q = render(r.where);
      const stamp = q.params.find((p) => typeof p === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(p));
      expect(stamp, q.sql).toBeDefined();
      expect(Math.abs(Date.parse(`${String(stamp).replace(" ", "T")}Z`) - expectedStart)).toBeLessThan(60_000);
    }
    const logged = render(h.reads.find((r) => r.table === customerEvents)!.where);
    expect(logged.params).toContain("admin_ai_referral");
  });

  it("is admin-only", async () => {
    await expect(caller("user").aiReferrals.summary()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.reads).toHaveLength(0);
  });
});
