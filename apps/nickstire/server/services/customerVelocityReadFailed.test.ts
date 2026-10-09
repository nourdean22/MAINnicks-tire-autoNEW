/**
 * Q-23 · analyzeNewCustomerVelocity says when its read failed.
 *
 * Its catch returned the same zeros as a month with no new customers, and the
 * Business Health Score read them as data: "Customer growth -4 · 0 new
 * customers this month", on the morning brief and the StateNour scoreboard.
 * The failure now carries `unavailable: true` (the predictChurn /
 * analyzeLeadResponseTime marker), which masterIntelligence's readFailed()
 * turns into an absent component plus a named failure.
 *
 * The master-report half runs the REAL velocity engine against a mocked
 * driver, so it proves the marker reaches the scorer, not only that it exists.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../db", () => ({
  getDb: async () => ({ execute: h.execute }),
}));

/** Every other engine resolves to an empty object. */
function stubEngines(names: string[]) {
  return Object.fromEntries(names.map((name) => [name, async () => ({})]));
}

vi.mock("./intelligenceEngines", () =>
  stubEngines(["forecastRevenue", "predictChurn", "forecastSeasonalDemand"]),
);
vi.mock("./advancedEngines", async () => {
  const growth = await vi.importActual<typeof import("./engines/growth")>("./engines/growth");
  return {
    ...stubEngines([
      "predictRepeatVisits", "analyzeCustomerValueTrend", "computeCustomerRiskScores",
      "analyzeTechEfficiency", "analyzeBayUtilization", "analyzeTurnaroundTime",
      "analyzePartsCostRatio", "forecastCapacity", "analyzeChannelROI", "analyzeReviewVelocity",
      "analyzeSmsEngagement", "analyzeLeadResponseTime", "analyzeContentPerformance",
      "analyzeCompetitorGap", "detectRevenueAnomalies", "forecastCashFlow", "estimateMarketShare",
      "analyzeProfitMargins", "analyzeTicketTrend", "analyzeRevenueConcentration",
      "analyzeChatFunnel", "analyzeReviewSentiment", "analyzeReferralNetwork",
      "forecastPortfolioLTV",
    ]),
    analyzeNewCustomerVelocity: growth.analyzeNewCustomerVelocity,
  };
});

import { analyzeNewCustomerVelocity } from "./engines/growth";
import { generateMasterIntelligenceReport } from "./masterIntelligence";

afterEach(() => h.execute.mockReset());

const growthComponent = (report: Awaited<ReturnType<typeof generateMasterIntelligenceReport>>) =>
  report.summary.scoreBreakdown.find((c) => c.label === "Customer growth");

describe("analyzeNewCustomerVelocity · failure is not 0 new customers", () => {
  it("a failed read returns unavailable: true", async () => {
    h.execute.mockRejectedValueOnce(new Error("TiDB timeout"));
    const r = await analyzeNewCustomerVelocity();
    expect(r.unavailable).toBe(true);
    expect(r.thisMonth).toBe(0);
  });

  it("a successful read of a quiet month carries no marker (control)", async () => {
    h.execute.mockResolvedValueOnce([[{ thisMonth: 0, lastMonth: 0, lastYear: 0 }], []]);
    const r = await analyzeNewCustomerVelocity();
    expect(r.unavailable).toBeUndefined();
    expect(r.thisMonth).toBe(0);
  });

  it("a successful read reports its real numbers", async () => {
    h.execute.mockResolvedValueOnce([[{ thisMonth: 7, lastMonth: 5, lastYear: 60 }], []]);
    const r = await analyzeNewCustomerVelocity();
    expect(r.unavailable).toBeUndefined();
    expect(r).toMatchObject({ thisMonth: 7, lastMonth: 5, velocity: 40, trend: "accelerating" });
  });
});

describe("masterIntelligence · a failed velocity read does not score customer growth", () => {
  it("is absent from the score, named in failures, and null in the report", async () => {
    h.execute.mockRejectedValue(new Error("TiDB timeout"));
    const report = await generateMasterIntelligenceReport();

    expect(growthComponent(report)).toBeUndefined();
    expect(report.summary.enginesFailed).toBe(1);
    expect(report.summary.failures).toEqual([
      "new customer velocity: its read failed (it returned an empty result marked unavailable)",
    ]);
    expect(report.growth.newCustomerVelocity).toBeNull();
    expect(report.customers.velocity).toBeNull();
  });

  it("a measured quiet month still scores, as a real zero (control)", async () => {
    h.execute.mockResolvedValue([[{ thisMonth: 0, lastMonth: 0, lastYear: 0 }], []]);
    const report = await generateMasterIntelligenceReport();

    expect(growthComponent(report)).toMatchObject({ points: -4, reason: "0 new customers this month" });
    expect(report.summary.enginesFailed).toBe(0);
    expect(report.summary.failures).toEqual([]);
  });
});
