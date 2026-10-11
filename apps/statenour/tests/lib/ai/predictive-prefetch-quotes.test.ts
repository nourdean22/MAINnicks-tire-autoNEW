/**
 * predictive-prefetch reads quotes_pending as the counts nickstire answers (2026-10-10).
 *
 * The handler returns { sinceHours, count, bookedCount, bookedCountIsLowerBound }: every ALG
 * counter quote in the window, and how many are matched to an invoice. It never returns rows.
 * The prefetch wanted an array or d.rows, so a live answer rendered as "unknown" in Nick's
 * prompt. "Pending" is a quote with no matched invoice (the handler's own per-quote status), and
 * since the matcher can miss, booked is a lower bound and pending can over-read: the flag rides
 * into the block so Nick does not state either as exact.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ queryNickBatch: vi.fn() }));

vi.mock("@/lib/nickstire/query", async (orig) => ({
  readBridge: (await orig<typeof import("@/lib/nickstire/query")>()).readBridge,
  queryNickBatch: h.queryNickBatch,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { prefetchIntents } from "@/lib/ai/predictive-prefetch";

/** The QUOTES & REVENUE block's `pending` entry, with quotes_pending answering `answer`. */
async function pendingFor(answer: unknown): Promise<unknown> {
  h.queryNickBatch.mockImplementation(async (qs: Array<{ query: string }>) =>
    Object.fromEntries(qs.map((q) => [q.query, q.query === "quotes_pending" ? answer : { data: [] }])),
  );
  const results = await prefetchIntents("any pending quote");
  const block = results.find((r) => r.label === "QUOTES & REVENUE");
  expect(block, "the quotes branch did not run").toBeDefined();
  return (block!.data as { pending: unknown }).pending;
}

const ok = (data: unknown) => ({ query: "quotes_pending", timestamp: "t", data });

beforeEach(() => {
  h.queryNickBatch.mockReset();
});

describe("predictive prefetch: quotes_pending counts", () => {
  it("reads count and bookedCount: notMatchedToInvoice is the quotes with no matched invoice (an upper bound on open quotes)", async () => {
    const pending = await pendingFor(ok({ sinceHours: 720, count: 12, bookedCount: 3, bookedCountIsLowerBound: true }));
    expect(pending).toEqual({ sinceHours: 720, notMatchedToInvoice: 9, quotedInWindow: 12, bookedCount: 3, bookedCountIsLowerBound: true });
  });

  it("a measured empty window is a real zero", async () => {
    const pending = await pendingFor(ok({ sinceHours: 720, count: 0, bookedCount: 0, bookedCountIsLowerBound: true }));
    expect(pending).toEqual({ sinceHours: 720, notMatchedToInvoice: 0, quotedInWindow: 0, bookedCount: 0, bookedCountIsLowerBound: true });
  });

  it("an answer without the flag still never reads booked as exact", async () => {
    const pending = await pendingFor(ok({ sinceHours: 720, count: 4, bookedCount: 1 }));
    expect(pending).toMatchObject({ notMatchedToInvoice: 3, bookedCountIsLowerBound: true });
  });

  for (const [name, answer] of [
    ["a transport error", { error: "fetch failed" }],
    ["an unknown query", { error: 'HTTP 400: {"error":"Unknown query: quotes_pending"}', statusCode: 400 }],
    ["a 200 with an error body", ok({ error: "No DB" })],
    ["an answer missing bookedCount", ok({ sinceHours: 720, count: 5 })],
    ["a count that is not a number", ok({ sinceHours: 720, count: "5", bookedCount: 1 })],
    ["a row list instead of counts", ok([])],
  ] as Array<[string, unknown]>) {
    it(`${name} stays unknown, never a count`, async () => {
      const pending = await pendingFor(answer);
      expect(pending).toEqual({ status: "unknown", reason: expect.any(String) });
    });
  }
});
