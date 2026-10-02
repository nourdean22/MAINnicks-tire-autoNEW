/**
 * Financing clicks identified through ANY first-party record carrying the visitor session,
 * then matched to an invoice on/after the click. A failed read throws (never "unattributed").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  clicks: [] as Array<Record<string, unknown>>,
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
      if (t.includes("FROM invoices")) return [h.invoices, []];
      throw new Error("unexpected query");
    },
  })),
}));

import { financingAttributionFor } from "./financingAttribution";

afterEach(() => {
  h.clicks = [];
  h.invoices = [];
  h.queries = [];
  h.fail = false;
});

const click = (over: Record<string, unknown>) => ({
  id: 1, clickDay: "2026-09-20",
  leadId: null, leadPhone: null, bookingId: null, bookingPhone: null,
  callbackId: null, callbackPhone: null, tireOrderId: null, tireOrderPhone: null, calledShop: 0,
  ...over,
});

describe("financingAttributionFor", () => {
  it("a click with no lead is still identified through its booking, and its later invoice counts", async () => {
    h.clicks = [click({ id: 1, bookingId: 55, bookingPhone: "(216) 555-0111" })];
    h.invoices = [
      { phone: "2165550111", invoiceDay: "2026-09-10" }, // before the click: not an outcome of it
      { phone: "2165550111", invoiceDay: "2026-09-24" },
    ];
    const a = (await financingAttributionFor([1])).get(1);
    expect(a).toEqual({ identifiedVia: "booking", identifiedId: 55, calledShop: false, invoicedOn: "2026-09-24" });
  });

  it("lead outranks booking for the identity label; the first usable phone is used", async () => {
    h.clicks = [click({ id: 2, leadId: 7, leadPhone: null, bookingId: 8, bookingPhone: "2165550222" })];
    h.invoices = [{ phone: "2165550222", invoiceDay: "2026-09-20" }];
    const a = (await financingAttributionFor([2])).get(2);
    expect(a?.identifiedVia).toBe("lead");
    expect(a?.invoicedOn).toBe("2026-09-20"); // same day counts
  });

  it("a click-to-call alone is intent, not identity, and never reaches 'invoiced'", async () => {
    h.clicks = [click({ id: 3, calledShop: 1 })];
    const a = (await financingAttributionFor([3])).get(3);
    expect(a).toEqual({ identifiedVia: null, identifiedId: null, calledShop: true, invoicedOn: null });
    expect(h.queries.some((q) => q.includes("FROM invoices"))).toBe(false);
  });

  it("read-only, and no ids -> no query", async () => {
    await financingAttributionFor([]);
    expect(h.queries).toHaveLength(0);
    h.clicks = [click({ id: 4, callbackId: 9, callbackPhone: "2165550444" })];
    await financingAttributionFor([4]);
    expect(h.queries.join("")).not.toMatch(/UPDATE|INSERT|DELETE/i);
  });

  it("a failed read throws — the panel shows unknown, never a page of 'unidentified'", async () => {
    h.fail = true;
    await expect(financingAttributionFor([1])).rejects.toThrow();
  });
});
