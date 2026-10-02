/**
 * Financing clicks identified through ANY first-party record carrying the visitor session,
 * then matched to an invoice on/after the click. A failed read throws (never "unattributed").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  clicks: [] as Array<Record<string, unknown>>,
  identity: {} as Record<string, Array<Record<string, unknown>>>, // table -> rows (sessionId, id, phone)
  calls: [] as Array<Record<string, unknown>>,
  invoices: [] as Array<Record<string, unknown>>,
  queries: [] as string[],
  fail: false,
}));

vi.mock("../lib/db-helper", () => ({
  db: vi.fn(async () => ({
    execute: async (q: unknown) => {
      const t = JSON.stringify(q);
      h.queries.push(t);
      if (h.fail) throw new Error("boom");
      if (t.includes("FROM financing_clicks fc")) return [h.clicks, []];
      if (t.includes("FROM call_events")) return [h.calls, []];
      if (t.includes("FROM invoices")) return [h.invoices, []];
      for (const table of ["leads", "bookings", "callback_requests", "tire_orders"]) {
        if (t.includes(`FROM ${table} x`)) return [h.identity[table] ?? [], []];
      }
      throw new Error("unexpected query");
    },
  })),
}));

import { financingAttributionFor } from "./financingAttribution";

afterEach(() => {
  h.clicks = [];
  h.identity = {};
  h.calls = [];
  h.invoices = [];
  h.queries = [];
  h.fail = false;
});

const click = (id: number, sessionId: string, clickDay = "2026-09-20") => ({ id, sessionId, clickDay });

describe("financingAttributionFor", () => {
  it("a click with no lead is still identified through its booking, and its later invoice counts", async () => {
    h.clicks = [click(1, "s1")];
    h.identity.bookings = [{ sessionId: "s1", id: 55, phone: "(216) 555-0111" }];
    h.invoices = [
      { phone: "2165550111", invoiceDay: "2026-09-10" }, // before the click: not an outcome of it
      { phone: "2165550111", invoiceDay: "2026-09-24" },
    ];
    const a = (await financingAttributionFor([1])).get(1);
    expect(a).toEqual({ identifiedVia: "booking", identifiedId: 55, calledShop: false, invoicedOn: "2026-09-24" });
  });

  it("lead outranks booking for the identity label; the first usable phone is used; first row per session wins", async () => {
    h.clicks = [click(2, "s2")];
    h.identity.leads = [{ sessionId: "s2", id: 7, phone: null }, { sessionId: "s2", id: 9, phone: "2165550999" }];
    h.identity.bookings = [{ sessionId: "s2", id: 8, phone: "2165550222" }];
    h.invoices = [{ phone: "2165550222", invoiceDay: "2026-09-20" }];
    const a = (await financingAttributionFor([2])).get(2);
    expect(a?.identifiedVia).toBe("lead");
    expect(a?.identifiedId).toBe(7);
    expect(a?.invoicedOn).toBe("2026-09-20"); // same day counts
  });

  it("a click-to-call alone is intent, not identity, and never reaches 'invoiced'", async () => {
    h.clicks = [click(3, "s3")];
    h.calls = [{ sessionId: "s3" }];
    const a = (await financingAttributionFor([3])).get(3);
    expect(a).toEqual({ identifiedVia: null, identifiedId: null, calledShop: true, invoicedOn: null });
    expect(h.queries.some((q) => q.includes("FROM invoices"))).toBe(false);
  });

  it("set-based: one read per identity table keyed by the session IN-list, however many clicks", async () => {
    h.clicks = [click(10, "sa"), click(11, "sb"), click(12, "sc")];
    h.identity.callback_requests = [
      { sessionId: "sb", id: 90, phone: "2165550190" },
      { sessionId: "sa", id: 91, phone: "2165550191" },
    ];
    const out = await financingAttributionFor([10, 11, 12]);
    for (const table of ["leads", "bookings", "callback_requests", "tire_orders", "call_events"]) {
      const qs = h.queries.filter((q) => q.includes(`FROM ${table}`));
      expect(qs, table).toHaveLength(1);
      expect(qs[0]).toContain("IN (");
      expect(qs[0]).not.toContain("fc.sessionId"); // no correlated subquery
    }
    expect(out.get(10)?.identifiedId).toBe(91);
    expect(out.get(11)?.identifiedId).toBe(90);
    expect(out.get(12)?.identifiedVia).toBeNull();
  });

  it("read-only, and no ids -> no query; clicks without a session -> no identity reads", async () => {
    await financingAttributionFor([]);
    expect(h.queries).toHaveLength(0);
    await financingAttributionFor([4]); // financing_clicks returns nothing with a session
    expect(h.queries).toHaveLength(1);
    h.clicks = [click(4, "s4")];
    h.identity.callback_requests = [{ sessionId: "s4", id: 9, phone: "2165550444" }];
    await financingAttributionFor([4]);
    expect(h.queries.join("")).not.toMatch(/UPDATE|INSERT|DELETE/i);
  });

  it("a failed read throws — the panel shows unknown, never a page of 'unidentified'", async () => {
    h.fail = true;
    await expect(financingAttributionFor([1])).rejects.toThrow();
  });
});
