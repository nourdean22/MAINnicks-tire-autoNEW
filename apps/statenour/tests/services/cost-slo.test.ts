/**
 * cost-slo · service tests · v10.0.526 · Arc A · Feature 2
 *
 * Unit-level. Prisma is mocked so the math + env handling can be
 * verified without touching Neon. Integration coverage comes from
 * the route handler hitting real data in prod.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  aiGeneration: {
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiGeneration: mocks.aiGeneration,
  },
}));

import {
  computeBurnRateForecast,
  computeTodayBurn,
  costByProvider,
  dailyBudgetCents,
  isOverBudget,
  providerOf,
  topConversationsByCost,
} from "@/lib/services/cost-slo";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mocks.aiGeneration.aggregate.mockReset();
  mocks.aiGeneration.groupBy.mockReset();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("dailyBudgetCents · env handling", () => {
  it("returns the env value when valid", () => {
    process.env.DAILY_AI_BUDGET_CENTS = "750";
    expect(dailyBudgetCents()).toBe(750);
  });

  it("falls back to 500 when env is missing, blank, NaN, or non-positive", () => {
    delete process.env.DAILY_AI_BUDGET_CENTS;
    expect(dailyBudgetCents()).toBe(500);
    process.env.DAILY_AI_BUDGET_CENTS = "";
    expect(dailyBudgetCents()).toBe(500);
    process.env.DAILY_AI_BUDGET_CENTS = "abc";
    expect(dailyBudgetCents()).toBe(500);
    process.env.DAILY_AI_BUDGET_CENTS = "-100";
    expect(dailyBudgetCents()).toBe(500);
    process.env.DAILY_AI_BUDGET_CENTS = "0";
    expect(dailyBudgetCents()).toBe(500);
  });
});

describe("computeTodayBurn · burn calc", () => {
  it("sums costCents from AiGeneration since today-ET-midnight", async () => {
    mocks.aiGeneration.aggregate.mockResolvedValueOnce({
      _sum: { costCents: 123 },
    });
    const burn = await computeTodayBurn();
    expect(burn).toBe(123);
    expect(mocks.aiGeneration.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
        _sum: { costCents: true },
      }),
    );
  });

  it("returns 0 on no-data edge case (empty aggregate + DB error)", async () => {
    mocks.aiGeneration.aggregate.mockResolvedValueOnce({ _sum: { costCents: null } });
    expect(await computeTodayBurn()).toBe(0);
    mocks.aiGeneration.aggregate.mockRejectedValueOnce(new Error("conn refused"));
    expect(await computeTodayBurn()).toBe(0);
  });
});

describe("computeBurnRateForecast · linear extrapolation math", () => {
  it("extrapolates burn linearly to 24h based on hours-elapsed", async () => {
    // Pin "now" to 12:00 ET — exactly 12h elapsed since midnight, so
    // the forecast should be 2x the current burn.
    const noonEt = new Date("2026-05-12T16:00:00.000Z"); // 12:00 EDT
    mocks.aiGeneration.aggregate.mockResolvedValueOnce({
      _sum: { costCents: 250 },
    });
    const result = await computeBurnRateForecast(noonEt);
    expect(result.burnCents).toBe(250);
    expect(result.hoursElapsed).toBeGreaterThanOrEqual(11);
    expect(result.hoursElapsed).toBeLessThanOrEqual(13);
    // 250 · 24 / 12 = 500 · accept ±1 for hoursElapsed rounding.
    expect(result.forecastCents).toBeGreaterThanOrEqual(460);
    expect(result.forecastCents).toBeLessThanOrEqual(540);
  });

  it("floors hoursElapsed at 0.5 to prevent divide-by-near-zero amplification", async () => {
    // Pin "now" to 00:05 ET — only 5min in. Without flooring, a 100¢
    // burn would forecast to 100 · 24 / (5/60) = 28800¢. With the
    // 0.5h floor, max amplification is 48x.
    const fiveMinPastMidnightEt = new Date("2026-05-12T04:05:00.000Z"); // 00:05 EDT
    mocks.aiGeneration.aggregate.mockResolvedValueOnce({
      _sum: { costCents: 100 },
    });
    const result = await computeBurnRateForecast(fiveMinPastMidnightEt);
    // 100 · 24 / 0.5 = 4800 (not 28800).
    expect(result.forecastCents).toBeLessThanOrEqual(4800);
    expect(result.forecastCents).toBeGreaterThanOrEqual(4700);
  });
});

describe("isOverBudget · threshold trip", () => {
  it("trips when forecast > budget · 1.2", async () => {
    process.env.DAILY_AI_BUDGET_CENTS = "500";
    // At noon ET (12h elapsed) a 350¢ burn → forecast = 700¢ → over (>600 threshold).
    const noonEt = new Date("2026-05-12T16:00:00.000Z");
    mocks.aiGeneration.aggregate.mockResolvedValueOnce({
      _sum: { costCents: 350 },
    });
    const result = await isOverBudget(noonEt);
    expect(result.over).toBe(true);
    expect(result.budgetCents).toBe(500);
    expect(result.thresholdCents).toBe(600);
  });

  it("does NOT trip when forecast is within the 1.2x absorption band", async () => {
    process.env.DAILY_AI_BUDGET_CENTS = "500";
    // At noon (12h) a 200¢ burn → forecast = 400¢ → under threshold.
    const noonEt = new Date("2026-05-12T16:00:00.000Z");
    mocks.aiGeneration.aggregate.mockResolvedValueOnce({
      _sum: { costCents: 200 },
    });
    const result = await isOverBudget(noonEt);
    expect(result.over).toBe(false);
  });
});

describe("currency conversion · cents discipline", () => {
  it("returns integer cents · never floats", async () => {
    mocks.aiGeneration.aggregate.mockResolvedValueOnce({
      _sum: { costCents: 337 },
    });
    const at = new Date("2026-05-12T16:00:00.000Z");
    const result = await computeBurnRateForecast(at);
    expect(Number.isInteger(result.burnCents)).toBe(true);
    expect(Number.isInteger(result.forecastCents)).toBe(true);
  });

  it("dailyBudgetCents floors fractional env values to integers", () => {
    process.env.DAILY_AI_BUDGET_CENTS = "612.99";
    expect(dailyBudgetCents()).toBe(612);
  });
});

describe("topConversationsByCost · conversationId + feature grouping", () => {
  it("v10.0.529.106 W59 · groups conversation+feature separately + merges sorted", async () => {
    // 1st call: groupBy conversationId (chat writes with convId)
    mocks.aiGeneration.groupBy.mockResolvedValueOnce([
      { conversationId: "conv-abc", _sum: { costCents: 700 }, _count: { _all: 8 } },
      { conversationId: "conv-xyz", _sum: { costCents: 100 }, _count: { _all: 4 } },
    ]);
    // 2nd call: groupBy feature (non-chat writes without convId)
    mocks.aiGeneration.groupBy.mockResolvedValueOnce([
      { feature: "image-gen", _sum: { costCents: 1200 }, _count: { _all: 3 } },
      { feature: "agent-eval", _sum: { costCents: 50 }, _count: { _all: 35 } },
    ]);
    const top = await topConversationsByCost(7, 10);
    // sorted desc by costCents: image-gen 1200 · conv-abc 700 · conv-xyz 100 · agent-eval 50
    expect(top[0].key).toBe("image-gen");
    expect(top[0].costCents).toBe(1200);
    expect(top[0].conversationId).toBeNull();
    expect(top[1].key).toBe("conv-abc");
    expect(top[1].conversationId).toBe("conv-abc");
    expect(top[3].key).toBe("agent-eval");

    // Failure path · both grouping calls fail → return []
    mocks.aiGeneration.groupBy.mockRejectedValueOnce(new Error("conn refused"));
    mocks.aiGeneration.groupBy.mockRejectedValueOnce(new Error("conn refused"));
    expect(await topConversationsByCost(7, 10)).toEqual([]);
  });
});

describe("providerOf · classification", () => {
  it("classifies known model names", () => {
    expect(providerOf("claude-sonnet-4-6")).toBe("anthropic");
    expect(providerOf("gpt-4o-mini")).toBe("openai");
    expect(providerOf("qwen3-vl")).toBe("ollama");
    expect(providerOf("venice-uncensored")).toBe("openrouter");
    expect(providerOf("flux-2-pro")).toBe("openrouter");
    expect(providerOf("rerank-multilingual-v3")).toBe("cohere");
    expect(providerOf("some-unknown-model")).toBe("other");
  });
});

describe("costByProvider · provider rollup", () => {
  it("rolls up cents + calls by provider with feature breakdown", async () => {
    mocks.aiGeneration.groupBy.mockResolvedValueOnce([
      { model: "claude-sonnet-4-6", feature: "chat", _sum: { costCents: 500 }, _count: { _all: 5 } },
      { model: "venice-uncensored", feature: "chat", _sum: { costCents: 100 }, _count: { _all: 10 } },
      { model: "flux-2-pro", feature: "image-gen", _sum: { costCents: 400 }, _count: { _all: 4 } },
    ]);
    const rolled = await costByProvider(7);
    const anthropic = rolled.find((p) => p.provider === "anthropic");
    const openrouter = rolled.find((p) => p.provider === "openrouter");
    expect(anthropic?.costCents).toBe(500);
    expect(openrouter?.costCents).toBe(500); // 100 chat + 400 image
    expect(openrouter?.byFeature).toHaveLength(2);
  });
});
