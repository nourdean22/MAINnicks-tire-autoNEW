/**
 * Open callbacks whose customer was since invoiced/booked get a "likely served" hint on
 * Today. The hint never closes a callback, and an unreadable hint must not render as
 * "nobody was served".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>, // callbacks
  invoices: [] as Array<Record<string, unknown>>,
  bookings: [] as Array<Record<string, unknown>>,
  dbUp: true,
  throwOnExecute: false,
  queries: [] as string[],
  cache: new Map<string, unknown>(),
}));

vi.mock("../lib/db-helper", () => ({
  db: vi.fn(async () =>
    h.dbUp
      ? {
          execute: async (q: { queryChunks?: unknown[] }) => {
            h.queries.push(JSON.stringify(q));
            if (h.throwOnExecute) throw new Error("Unknown column 'invoiceDate'");
            const t = JSON.stringify(q);
            if (t.includes("FROM callback_requests c")) return [h.rows, []];
            if (t.includes("FROM invoices")) return [h.invoices, []];
            if (t.includes("FROM bookings")) return [h.bookings, []];
            return [[], []];
          },
        }
      : null,
  ),
}));

vi.mock("../lib/cache", () => ({
  cacheGet: vi.fn(async (k: string) => (h.cache.has(k) ? h.cache.get(k) : null)),
  cacheSet: vi.fn(async (k: string, v: unknown) => {
    h.cache.set(k, v);
  }),
}));

import { getCallbackServedEvidence } from "./callbackServedEvidence";

afterEach(() => {
  h.rows = [];
  h.invoices = [];
  h.bookings = [];
  h.dbUp = true;
  h.throwOnExecute = false;
  h.queries = [];
  h.cache.clear();
});

describe("getCallbackServedEvidence", () => {
  it("an invoice (same day or later) beats a booking; no evidence -> no entry", async () => {
    h.rows = [
      { id: 7, phone: "2165550107", day: "2026-09-20", at: "2026-09-20 14:00:00" },
      { id: 8, phone: "2165550108", day: "2026-09-25", at: "2026-09-25 09:00:00" },
      { id: 9, phone: "2165550109", day: "2026-09-25", at: "2026-09-25 09:00:00" },
    ];
    h.invoices = [
      { phone: "2165550107", day: "2026-09-19" }, // before the request: not evidence
      { phone: "2165550107", day: "2026-09-28" },
    ];
    h.bookings = [
      { phone: "2165550107", at: "2026-09-27 10:00:00" },
      { phone: "2165550108", at: "2026-09-25 08:00:00" }, // earlier the same morning: not after
      { phone: "2165550108", at: "2026-09-30 11:00:00" },
    ];
    const out = await getCallbackServedEvidence();
    expect(out[7]).toMatchObject({ kind: "invoice", on: "2026-09-28" });
    expect(out[7].label).toMatch(/^Invoiced 2026-09-28 .*likely served/);
    expect(out[8]).toMatchObject({ kind: "booking", on: "2026-09-30" });
    expect(out[9]).toBeUndefined();
  });

  it("evidence reads are set-based: one invoices and one bookings read, filtered to the callback phones", async () => {
    h.rows = [
      { id: 1, phone: "2165550101", day: "2026-09-20", at: "2026-09-20 14:00:00" },
      { id: 2, phone: "2165550102", day: "2026-09-21", at: "2026-09-21 14:00:00" },
    ];
    await getCallbackServedEvidence();
    expect(h.queries.filter((q) => q.includes("FROM invoices"))).toHaveLength(1);
    expect(h.queries.filter((q) => q.includes("FROM bookings"))).toHaveLength(1);
    const inv = h.queries.find((q) => q.includes("FROM invoices")) ?? "";
    expect(inv).toContain("2165550101");
    expect(inv).toContain("2165550102");
  });

  it("reads only open callbacks and never writes", async () => {
    await getCallbackServedEvidence();
    const q = h.queries.join("\n");
    expect(q).toContain("c.status = 'new'");
    expect(q).not.toMatch(/UPDATE|INSERT|DELETE/i);
  });

  it("is cached: a second call does not re-query", async () => {
    h.rows = [{ id: 1, phone: "2165550101", day: "2026-09-20", at: "2026-09-20 14:00:00" }];
    h.invoices = [{ phone: "2165550101", day: "2026-09-28" }];
    await getCallbackServedEvidence();
    const n = h.queries.length;
    await getCallbackServedEvidence();
    expect(h.queries).toHaveLength(n);
  });

  it("a malformed date is not evidence", async () => {
    h.rows = [{ id: 3, phone: "2165550103", day: "2026-09-20", at: "2026-09-20 14:00:00" }];
    h.invoices = [{ phone: "2165550103", day: "garbage" }];
    expect(await getCallbackServedEvidence()).toEqual({});
  });

  it("a failed read THROWS (slice unavailable), never returns an empty 'nobody served' map", async () => {
    h.throwOnExecute = true;
    await expect(getCallbackServedEvidence()).rejects.toThrow();
    h.throwOnExecute = false;
    h.dbUp = false;
    await expect(getCallbackServedEvidence()).rejects.toThrow(/database unavailable/);
  });
});
