/**
 * Open callbacks whose customer was since invoiced/booked get a "likely served" hint on
 * Today. The hint never closes a callback, and an unreadable hint must not render as
 * "nobody was served".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
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
            return [h.rows, []];
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
  h.dbUp = true;
  h.throwOnExecute = false;
  h.queries = [];
  h.cache.clear();
});

describe("getCallbackServedEvidence", () => {
  it("an invoice beats a booking; no evidence -> no entry", async () => {
    h.rows = [
      { id: 7, invoicedOn: "2026-09-28", bookedOn: "2026-09-27" },
      { id: 8, invoicedOn: null, bookedOn: "2026-09-30" },
      { id: 9, invoicedOn: null, bookedOn: null },
    ];
    const out = await getCallbackServedEvidence();
    expect(out[7]).toMatchObject({ kind: "invoice", on: "2026-09-28" });
    expect(out[7].label).toMatch(/^Invoiced 2026-09-28 .*likely served/);
    expect(out[8]).toMatchObject({ kind: "booking", on: "2026-09-30" });
    expect(out[9]).toBeUndefined();
  });

  it("reads only open callbacks and never writes", async () => {
    await getCallbackServedEvidence();
    const q = h.queries.join("\n");
    expect(q).toContain("c.status = 'new'");
    expect(q).not.toMatch(/UPDATE|INSERT|DELETE/i);
  });

  it("is cached: a second call does not re-query", async () => {
    h.rows = [{ id: 1, invoicedOn: "2026-09-28", bookedOn: null }];
    await getCallbackServedEvidence();
    await getCallbackServedEvidence();
    expect(h.queries).toHaveLength(1);
  });

  it("a malformed date is not evidence", async () => {
    h.rows = [{ id: 3, invoicedOn: "garbage", bookedOn: null }];
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
