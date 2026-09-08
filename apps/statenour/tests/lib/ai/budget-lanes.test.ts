/**
 * tests/lib/ai/budget-lanes.test.ts · 2026-09-08 (program U6)
 *
 * Per-lane budgets are deterministic stops: a lane with a cap that today's
 * spend has reached is `over`; a lane with no cap is never over; caps come
 * from the setting first, the env second; a failed read is honest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  groupBy: vi.fn(),
  getSetting: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { aiGeneration: { aggregate: mocks.aggregate, groupBy: mocks.groupBy } } }));
vi.mock("@/lib/services/settings", () => ({ getSetting: mocks.getSetting }));
vi.mock("@/lib/services/cost-slo", () => ({ resolveDailyAiBudgetCents: vi.fn(async () => 500) }));
vi.mock("server-only", () => ({}));

import { checkLaneBudget, listLaneStatus, parseLaneCaps, resetLaneBudgetCache } from "@/lib/ai/budget";

beforeEach(() => {
  vi.clearAllMocks();
  resetLaneBudgetCache();
  mocks.getSetting.mockImplementation(async (_k: string, d: unknown) => d);
  mocks.aggregate.mockResolvedValue({ _sum: { costCents: 0 } });
  mocks.groupBy.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("parseLaneCaps", () => {
  it("accepts a JSON map of positive integer cents and drops garbage", () => {
    expect(parseLaneCaps('{"chat": 500, "ai:reason": 250, "bad": -1, "worse": "x"}')).toEqual({ chat: 500, "ai:reason": 250 });
    expect(parseLaneCaps("not json")).toEqual({});
    expect(parseLaneCaps("")).toEqual({});
  });
});

describe("checkLaneBudget", () => {
  it("no cap → never over, cap null, spend still reported", async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { costCents: 120 } });
    expect(await checkLaneBudget("chat")).toEqual({ feature: "chat", spentCents: 120, capCents: null, over: false });
  });

  it("cap from the setting; spend at or past the cap → over (a deterministic stop)", async () => {
    mocks.getSetting.mockResolvedValue('{"chat": 100}');
    mocks.aggregate.mockResolvedValue({ _sum: { costCents: 100 } });
    expect(await checkLaneBudget("chat")).toMatchObject({ capCents: 100, spentCents: 100, over: true });
  });

  it("cap from env when the setting is unset", async () => {
    vi.stubEnv("AI_LANE_BUDGET_CENTS_JSON", '{"ai:reason": 50}');
    mocks.aggregate.mockResolvedValue({ _sum: { costCents: 10 } });
    expect(await checkLaneBudget("ai:reason")).toMatchObject({ capCents: 50, over: false });
  });

  it("scopes the spend query to the lane and to today", async () => {
    await checkLaneBudget("chat");
    const where = mocks.aggregate.mock.calls[0][0].where;
    expect(where.feature).toBe("chat");
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("a failed spend read throws — the caller decides, it is never a silent zero", async () => {
    mocks.getSetting.mockResolvedValue('{"chat": 100}');
    mocks.aggregate.mockRejectedValue(new Error("db down"));
    await expect(checkLaneBudget("chat")).rejects.toThrow(/db down/);
  });
});

describe("listLaneStatus", () => {
  it("lists every capped lane plus today's uncapped spenders, and names the cap source", async () => {
    mocks.getSetting.mockResolvedValue('{"chat": 500}');
    mocks.groupBy.mockResolvedValue([
      { feature: "chat", _sum: { costCents: 120 } },
      { feature: "ai:reason", _sum: { costCents: 30 } },
    ]);
    const s = await listLaneStatus();
    expect(s.source).toBe("setting");
    expect(s.lanes).toEqual([
      { feature: "chat", spentCents: 120, capCents: 500, over: false },
      { feature: "ai:reason", spentCents: 30, capCents: null, over: false },
    ]);
  });
});
