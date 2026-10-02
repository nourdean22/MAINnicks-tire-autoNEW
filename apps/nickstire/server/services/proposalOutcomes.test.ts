/**
 * A decided proposal shows what happened to the customer afterwards. An unreadable
 * outcome is "unknown", never "nothing happened"; undecided rows get nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, fail: false, queries: [] as string[] }));

vi.mock("../lib/db-helper", () => ({
  db: vi.fn(async () => ({
    execute: async (q: unknown) => {
      h.queries.push(JSON.stringify(q));
      if (h.fail) throw new Error("boom");
      return [h.rows, []];
    },
  })),
}));

import { withDownstreamOutcomes } from "./proposalOutcomes";

afterEach(() => {
  h.rows = [];
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
    h.rows = [
      { id: "a", phoneLen: 10, invoicedOn: "2026-09-28", bookedOn: null, callbackOn: null },
      { id: "b", phoneLen: 10, invoicedOn: null, bookedOn: null, callbackOn: null },
      { id: "d", phoneLen: 0, invoicedOn: null, bookedOn: null, callbackOn: null },
    ];
    const out = await withDownstreamOutcomes(rows);
    expect(out[0].downstream).toEqual({ readable: true, invoicedOn: "2026-09-28", bookedOn: null, callbackOn: null });
    expect(out[1].downstream).toEqual({ readable: true, invoicedOn: null, bookedOn: null, callbackOn: null });
    expect(out[2].downstream).toBeNull();
    expect(out[3].downstream).toBeNull();
    expect(h.queries.join("")).not.toMatch(/UPDATE|INSERT|DELETE/i);
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
