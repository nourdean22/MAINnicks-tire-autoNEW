/**
 * Behavioral canaries for the 2026-08-27 pipeline tail caps (#1949 review
 * threads P1x2): the lexical statement_timeout and the rerank call-site
 * budget. Both were measured on the labelled corpus (10/28 GIN queries past
 * 900ms; 1,415ms rerank spike vs 7.5s backend bound) — these tests pin the
 * DEGRADE behavior with synthetic mocks and positive controls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  executeCalls: [] as string[],
  queryImpl: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRawUnsafe: vi.fn(async (sql: string) => {
          mocks.executeCalls.push(sql);
          return 0;
        }),
        $queryRawUnsafe: mocks.queryImpl,
      }),
    ),
  },
}));

import { getLexicalMatches, withRerankBudget } from "@/lib/brain/contextual-recall";

beforeEach(() => {
  mocks.executeCalls.length = 0;
  mocks.queryImpl.mockReset();
});

describe("getLexicalMatches · statement_timeout behavior", () => {
  it("positive control: rows flow through AND the timeout is set on the SAME transaction", async () => {
    const row = {
      id: "m1", content: "c", category: "health", key: "k1", confidence: 0.8,
      created_at: new Date(), source: null, seen_count: 1, updated_at: new Date(), rank: 0.5,
    };
    mocks.queryImpl.mockResolvedValue([row]);
    const rows = await getLexicalMatches(["sister", "visiting"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("k1");
    // The mechanism: SET LOCAL statement_timeout executed inside the tx that
    // runs the FTS query — not merely present in source.
    expect(mocks.executeCalls.some((s) => /SET LOCAL statement_timeout = \d+/.test(s))).toBe(true);
  });

  it("BREAKS: a 57014 statement-timeout degrades to [] instead of throwing", async () => {
    mocks.queryImpl.mockRejectedValue(
      new Error("Raw query failed. Code: `57014`. Message: `ERROR: canceling statement due to statement timeout`"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getLexicalMatches(["slow", "query"])).resolves.toEqual([]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("exceeded"))).toBe(true);
    warn.mockRestore();
  });

  it("any other DB failure also degrades to [] (the pre-existing contract)", async () => {
    mocks.queryImpl.mockRejectedValue(new Error("relation does not exist"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getLexicalMatches(["x-topic"])).resolves.toEqual([]);
    warn.mockRestore();
  });
});

describe("withRerankBudget · rerank call-site budget behavior", () => {
  it("BREAKS: a rerank that outlives the budget resolves null (hybrid ordering stands)", async () => {
    const hanging = new Promise<never>(() => {}); // never settles
    const t0 = Date.now();
    await expect(withRerankBudget(hanging, 25)).resolves.toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("positive control: a rerank inside the budget returns its result", async () => {
    const fast = Promise.resolve([{ item: "a", score: 0.9, originalIndex: 0 }]);
    await expect(withRerankBudget(fast, 1000)).resolves.toEqual([
      { item: "a", score: 0.9, originalIndex: 0 },
    ]);
  });

  it("a rejecting rerank resolves null, never throws into the pipeline", async () => {
    await expect(withRerankBudget(Promise.reject(new Error("cohere 500")), 1000)).resolves.toBeNull();
  });
});
