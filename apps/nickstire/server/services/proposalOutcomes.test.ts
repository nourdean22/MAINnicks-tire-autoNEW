/**
 * A decided proposal shows what happened to the customer afterwards. An unreadable
 * outcome is "unknown", never "nothing happened"; undecided rows get nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  proposals: [] as Array<Record<string, unknown>>,
  invoices: [] as Array<Record<string, unknown>>,
  bookings: [] as Array<Record<string, unknown>>,
  callbacks: [] as Array<Record<string, unknown>>,
  fail: false,
  queries: [] as string[],
}));

vi.mock("../lib/db-helper", () => ({
  db: vi.fn(async () => ({
    execute: async (q: unknown) => {
      const t = JSON.stringify(q);
      h.queries.push(t);
      if (h.fail) throw new Error("boom");
      if (t.includes("FROM admin_proposals")) return [h.proposals, []];
      if (t.includes("FROM invoices")) return [h.invoices, []];
      if (t.includes("FROM bookings")) return [h.bookings, []];
      if (t.includes("FROM callback_requests")) return [h.callbacks, []];
      throw new Error("unexpected query");
    },
  })),
}));

const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../lib/cache", () => ({
  cacheGet: vi.fn(async (k: string) => (cache.has(k) ? cache.get(k) : null)),
  cacheSet: vi.fn(async (k: string, v: unknown) => { cache.set(k, v); }),
}));

import { withDownstreamOutcomes } from "./proposalOutcomes";

afterEach(() => {
  cache.clear();
  h.proposals = [];
  h.invoices = [];
  h.bookings = [];
  h.callbacks = [];
  h.fail = false;
  h.queries = [];
});

const rows = [
  { id: "a", status: "rejected" },
  { id: "b", status: "executed" },
  { id: "c", status: "draft" },
  { id: "d", status: "rejected" },
];

describe("withDownstreamOutcomes", () => {
  it("attaches the SQL-dated outcomes to decided rows; drafts and phoneless rows get null", async () => {
    h.proposals = [
      { id: "a", phone: "2165550101", createdAt: "2026-09-27 15:00:00" },
      { id: "b", phone: "2165550102", createdAt: "2026-09-27 15:00:00" },
      { id: "d", phone: "", createdAt: "2026-09-27 15:00:00" },
    ];
    h.invoices = [
      { phone: "2165550101", at: "2026-09-20 12:00:00" }, // before the proposal day: not an outcome
      { phone: "2165550101", at: "2026-09-28 12:00:00" },
    ];
    h.bookings = [
      { phone: "2165550102", at: "2026-09-27 14:00:00" }, // earlier the same day: not after
      { phone: "2165550102", at: "2026-09-29 09:00:00" },
    ];
    h.callbacks = [{ phone: "2165550101", at: "2026-09-27 15:30:00" }];
    const out = await withDownstreamOutcomes(rows);
    expect(out[0].downstream).toEqual({ readable: true, invoicedOn: "2026-09-28", bookedOn: null, callbackOn: "2026-09-27" });
    expect(out[1].downstream).toEqual({ readable: true, invoicedOn: null, bookedOn: "2026-09-29", callbackOn: null });
    expect(out[2].downstream).toBeNull();
    expect(out[3].downstream).toBeNull();
    expect(h.queries.join("")).not.toMatch(/UPDATE|INSERT|DELETE/i);
  });

  it("set-based: one read per evidence table keyed by the phone IN-list, no correlated subquery", async () => {
    h.proposals = [
      { id: "a", phone: "2165550101", createdAt: "2026-09-27 15:00:00" },
      { id: "b", phone: "2165550102", createdAt: "2026-09-26 15:00:00" },
    ];
    await withDownstreamOutcomes(rows);
    for (const table of ["invoices", "bookings", "callback_requests"]) {
      const qs = h.queries.filter((q) => q.includes(`FROM ${table}`));
      expect(qs, table).toHaveLength(1);
      expect(qs[0]).toContain("2165550101");
      expect(qs[0]).toContain("2165550102");
      expect(qs[0]).not.toContain("p.created_at");
    }
    // bound is the earliest proposal time, passed as a SQL string
    expect(h.queries.find((q) => q.includes("FROM bookings"))).toContain("2026-09-26 15:00:00");
  });

  it("no usable phone on any decided row -> no evidence reads", async () => {
    h.proposals = [{ id: "a", phone: null, createdAt: "2026-09-27 15:00:00" }];
    await withDownstreamOutcomes(rows);
    expect(h.queries).toHaveLength(1);
  });

  it("a failed read marks decided rows unreadable, never 'nothing happened'", async () => {
    h.fail = true;
    const out = await withDownstreamOutcomes(rows);
    expect(out[0].downstream).toEqual({ readable: false });
    expect(out[2].downstream).toBeNull();
  });

  it("no decided rows -> no query", async () => {
    await withDownstreamOutcomes([{ id: "c", status: "draft" }]);
    expect(h.queries).toHaveLength(0);
  });
});

describe("withDownstreamOutcomes · cache", () => {
  it("the same id set is read once per TTL; a failed read is never cached", async () => {
    h.proposals = [{ id: "a", phone: "2165550101", createdAt: "2026-09-27 15:00:00" }];
    h.bookings = [{ phone: "2165550101", at: "2026-09-30 10:00:00" }];
    await withDownstreamOutcomes([{ id: "a", status: "rejected" }]);
    const n = h.queries.length;
    const second = await withDownstreamOutcomes([{ id: "a", status: "rejected" }]);
    expect(h.queries).toHaveLength(n);
    expect(second[0].downstream).toMatchObject({ readable: true, bookedOn: "2026-09-30" });

    cache.clear();
    h.queries = [];
    h.fail = true;
    await withDownstreamOutcomes([{ id: "b", status: "rejected" }]);
    h.fail = false;
    await withDownstreamOutcomes([{ id: "b", status: "rejected" }]);
    expect(h.queries.length).toBeGreaterThan(1); // the failure did not poison the cache: read again
  });
});
