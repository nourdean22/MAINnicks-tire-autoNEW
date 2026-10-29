/**
 * Estimate collector · the quote guard must gate the dollars, not only the text.
 *
 * 2026-10-29: the Decision Inbox showed a $33,474.10 quote at full value, urgency
 * "today", ranked first. The guard already called it outside the $20-$20,000 band
 * ("likely a data-entry slip") but only appended that to the reason; the amount
 * still drove expected_revenue_cents, urgency, the call line and the sort.
 * Fixture amounts are the stored prod values (3,347,410 and 455,031 cents),
 * names are invented.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

let estimateRows: Array<Record<string, unknown>> = [];
let inserts: string[] = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes("FROM alg_estimates")) return [estimateRows];
      if (text.includes("INSERT INTO revenue_opportunities")) {
        inserts.push(text);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  }),
}));

function estimate(id: number, amountCents: number): Record<string, unknown> {
  return {
    id,
    customerName: "Test Customer",
    customerPhone: "+12165550100",
    serviceDescription: null,
    estimatedAmount: amountCents,
    estimateDate: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    f7: 0,
    f30: 0,
    estimatedPartsCost: 0,
    statedConcern: null,
    matchCount: 0,
    anyCustomerId: null,
    anyOptOut: 0,
  };
}

beforeEach(() => {
  estimateRows = [];
  inserts = [];
});

// Serial mode shares one mock registry across files: drop this partial ./db
// mock so a later file cannot import it.
afterAll(() => {
  vi.doUnmock("./db");
  vi.resetModules();
});

describe("collectUnapprovedEstimates · quote guard", () => {
  it("an amount outside the sanity band carries no dollars, no 'today', and keeps the guard note", async () => {
    estimateRows = [estimate(9001, 3_347_410)];
    const { collectUnapprovedEstimates } = await import("./services/opportunityQueue");
    await collectUnapprovedEstimates();
    expect(inserts).toHaveLength(1);
    const insert = inserts[0];
    expect(insert).not.toContain("3347410");
    expect(insert).not.toContain("$33474");
    expect(insert).not.toContain('"today"');
    expect(insert).toContain("QUOTE GUARD");
  });

  it("an in-band amount still flows through as the value", async () => {
    estimateRows = [estimate(9002, 455_031)];
    const { collectUnapprovedEstimates } = await import("./services/opportunityQueue");
    await collectUnapprovedEstimates();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain("455031");
    expect(inserts[0]).toContain("$4550");
  });
});
