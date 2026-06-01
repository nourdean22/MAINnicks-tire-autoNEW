/**
 * xpEventTotals SQL-aggregation + JS-fallback tests · 2026-06-01.
 *
 * The character-sheet hot read sums stat→XP DB-side (GROUP BY) instead of
 * streaming every event row into JS. These pin: (a) the SQL path builds the
 * Map from grouped rows, and (b) ANY SQL error falls back to the proven JS
 * scan — so a column rename / cast surprise can never break the sheet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  brainMemory: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.$queryRaw, brainMemory: mocks.brainMemory },
}));

import { xpEventTotals, xpEventTotalsSince } from "@/lib/mastery/credit";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("xpEventTotals · SQL aggregation path", () => {
  it("builds the stat→XP map from the grouped SQL rows", async () => {
    mocks.$queryRaw.mockResolvedValue([
      { stat: "physical", xp: 12.5 },
      { stat: "business_ops", xp: 7 },
    ]);
    const totals = await xpEventTotals();
    expect(totals.get("physical")).toBe(12.5);
    expect(totals.get("business_ops")).toBe(7);
    expect(mocks.brainMemory.findMany).not.toHaveBeenCalled(); // no fallback
  });

  it("coerces a stringy SUM (Prisma can return numeric as string) to a number", async () => {
    mocks.$queryRaw.mockResolvedValue([{ stat: "sales", xp: "3.5" as unknown as number }]);
    const totals = await xpEventTotals();
    expect(totals.get("sales")).toBe(3.5);
  });
});

describe("xpEventTotals · JS fallback when SQL throws", () => {
  it("falls back to the findMany + JS sum, matching the old behavior", async () => {
    mocks.$queryRaw.mockRejectedValue(new Error("relation does not exist"));
    mocks.brainMemory.findMany.mockResolvedValue([
      { metadata: { stat: "physical", xp: 2 } },
      { metadata: { stat: "physical", xp: 3 } },
      { metadata: { stat: "discipline", xp: 1 } },
      { metadata: { stat: "bad" } }, // missing xp → skipped (typeof guard)
      { metadata: null }, // null metadata → skipped
    ]);
    const totals = await xpEventTotals();
    expect(totals.get("physical")).toBe(5); // 2 + 3 summed in JS
    expect(totals.get("discipline")).toBe(1);
    expect(totals.has("bad")).toBe(false);
    expect(mocks.brainMemory.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("xpEventTotalsSince · passes the window to both paths", () => {
  it("uses the SQL path with a since bound", async () => {
    mocks.$queryRaw.mockResolvedValue([{ stat: "physical", xp: 4 }]);
    const totals = await xpEventTotalsSince(new Date("2026-06-01"));
    expect(totals.get("physical")).toBe(4);
  });

  it("falls back to a since-filtered findMany on SQL error", async () => {
    mocks.$queryRaw.mockRejectedValue(new Error("boom"));
    mocks.brainMemory.findMany.mockResolvedValue([{ metadata: { stat: "mental", xp: 9 } }]);
    const totals = await xpEventTotalsSince(new Date("2026-06-01"));
    expect(totals.get("mental")).toBe(9);
    // the fallback query must carry the createdAt window
    const whereArg = mocks.brainMemory.findMany.mock.calls[0][0].where;
    expect(whereArg.createdAt).toBeDefined();
  });
});
