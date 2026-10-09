/**
 * StateNour's revenue_range callers send the shop days they mean (2026-10-09).
 *
 * nickstire's revenue_range reads `from`/`to` as shop-local days, BOTH inclusive. Three callers
 * built their bounds wrong (Codex review of #2938):
 *   - getRevenueStats sent `to` as the UTC date of "now", which is tomorrow from 20:00 ET;
 *   - getProjections sent "30 days ago through today" as UTC dates: 31 days (one of them
 *     part-done), annualized as if it were 30;
 *   - weeklyReview's "7-day" revenue sent daysAgo(7)..today: eight days.
 *
 * Driven through the real tools, with the bridge client and Prisma mocked and the clock set to
 * 2026-10-09T01:30Z, which is 21:30 EDT on Thursday 2026-10-08.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryNick } = vi.hoisted(() => ({ queryNick: vi.fn() }));

vi.mock("@/lib/nickstire/query", () => ({ queryNick }));
vi.mock("@/lib/integrations/google-reviews", () => ({
  getReviewStats: vi.fn(async () => ({ average: 4.8, total: 120, unresponded: 2 })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { lifeGoal: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { businessTools } from "@/lib/ai/tools/business";
import { goalsTools } from "@/lib/ai/tools/goals";
import { habitsTools } from "@/lib/ai/tools/habits";

type Executable = { execute: (args: unknown, opts?: unknown) => Promise<unknown> };
const run = (t: unknown, args: unknown) => (t as Executable).execute(args, {});

/** Thursday 2026-10-08, 21:30 EDT: the UTC date is already Friday the 9th. */
const EVENING_ET = new Date("2026-10-09T01:30:00Z");

const rangeCall = () => queryNick.mock.calls.find((c) => c[0] === "revenue_range")?.[1];

beforeEach(() => {
  queryNick.mockReset();
  queryNick.mockResolvedValue({ data: { totalDollars: 30_000, invoiceCount: 90 }, query: "revenue_range", timestamp: "x" });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(EVENING_ET);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("revenue_range callers send New York days, both bounds inclusive", () => {
  it("getRevenueStats (month): the 1st through today in New York, not tomorrow's UTC date", async () => {
    await run(businessTools.getRevenueStats, { period: "month" });
    expect(rangeCall()).toEqual({ from: "2026-10-01", to: "2026-10-08" });
  });

  it("getProjections: the 30 complete shop days before today, annualized as 30", async () => {
    const out = (await run(goalsTools.getProjections, { domain: "business" })) as {
      projections: Array<{ current: number; projected: number }>;
    };
    expect(rangeCall()).toEqual({ from: "2026-09-08", to: "2026-10-07" }); // 23 + 7 = 30 days
    expect(out.projections[0]).toMatchObject({ current: 30_000, projected: 360_000 });
  });

  it("weeklyReview: seven shop days including today", async () => {
    // Its other reads hit the mocked Prisma and fail; the bridge call is made first.
    await run(habitsTools.weeklyReview, {}).catch(() => undefined);
    expect(rangeCall()).toEqual({ from: "2026-10-02", to: "2026-10-08" });
  });
});
