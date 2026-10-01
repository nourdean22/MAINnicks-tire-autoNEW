/**
 * Q-23 phase 7 · an engine that says its read failed is a failed engine.
 *
 * Phases 5 and 6 taught three engines to stop returning a quiet empty result
 * when their read throws: predictChurn, predictRepeatVisits and
 * analyzeLeadResponseTime now resolve to an empty shape marked
 * `unavailable: true`. The admin cards read that marker. The Business Health
 * Score did not: it only counted REJECTED promises as failures, so a failed
 * churn read scored "Churn risk +8 · 0 high-risk customers detected" (the
 * maximum) and a failed lead-response read scored as an instant reply.
 *
 * A read-failed engine is now absent from the score, counted in
 * `enginesFailed`, named in `failures`, and passes the same 1/3 reliability
 * threshold as a rejected one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  overrides: new Map<string, () => Promise<unknown>>(),
}));

/** Every engine resolves to an empty object unless a test overrides it. */
function engineModule(names: string[]) {
  return Object.fromEntries(
    names.map((name) => [name, () => (h.overrides.get(name) ?? (async () => ({})))()]),
  );
}

vi.mock("./intelligenceEngines", () =>
  engineModule(["forecastRevenue", "predictChurn", "forecastSeasonalDemand"]),
);
vi.mock("./advancedEngines", () =>
  engineModule([
    "predictRepeatVisits", "analyzeCustomerValueTrend", "computeCustomerRiskScores",
    "analyzeTechEfficiency", "analyzeBayUtilization", "analyzeTurnaroundTime",
    "analyzePartsCostRatio", "forecastCapacity", "analyzeChannelROI", "analyzeReviewVelocity",
    "analyzeSmsEngagement", "analyzeLeadResponseTime", "analyzeContentPerformance",
    "analyzeCompetitorGap", "detectRevenueAnomalies", "forecastCashFlow", "estimateMarketShare",
    "analyzeProfitMargins", "analyzeTicketTrend", "analyzeRevenueConcentration",
    "analyzeChatFunnel", "analyzeReviewSentiment", "analyzeNewCustomerVelocity",
    "analyzeReferralNetwork", "forecastPortfolioLTV",
  ]),
);

import { generateMasterIntelligenceReport } from "./masterIntelligence";

afterEach(() => h.overrides.clear());

const component = (
  report: Awaited<ReturnType<typeof generateMasterIntelligenceReport>>,
  label: string,
) => report.summary.scoreBreakdown.find((c) => c.label === label);

describe("masterIntelligence · a read-failed engine is not a perfect score", () => {
  it("names a read-failed engine by its own label, first to last", async () => {
    // The labels are a list parallel to the engine list; a shifted entry would
    // blame the wrong engine. Pin the first, a middle and the last.
    const failed = async () => ({ unavailable: true });
    h.overrides.set("forecastRevenue", failed);
    h.overrides.set("analyzeLeadResponseTime", failed);
    h.overrides.set("forecastPortfolioLTV", failed);
    const report = await generateMasterIntelligenceReport();

    expect(report.summary.enginesTotal).toBe(28);
    expect(report.summary.failures.map((f) => f.split(":")[0])).toEqual([
      "revenue forecast",
      "lead response time",
      "portfolio LTV",
    ]);
  });

  it("a churn read that failed scores nothing and is counted as a failure", async () => {
    h.overrides.set("predictChurn", async () => ({ highRisk: [], unavailable: true }));
    const report = await generateMasterIntelligenceReport();

    expect(component(report, "Churn risk")).toBeUndefined();
    expect(report.summary.enginesFailed).toBe(1);
    expect(report.summary.failures).toEqual([
      "churn prediction: its read failed (it returned an empty result marked unavailable)",
    ]);
  });

  it("a successful empty churn read still scores (control)", async () => {
    h.overrides.set("predictChurn", async () => ({ highRisk: [] }));
    const report = await generateMasterIntelligenceReport();

    expect(component(report, "Churn risk")?.points).toBe(8);
    expect(report.summary.enginesFailed).toBe(0);
    expect(report.summary.failures).toEqual([]);
  });

  it("read-failed and rejected engines share the 1/3 reliability threshold", async () => {
    // 28 engines: 10 failures is >= 1/3, so the score is UNKNOWN.
    const failed = { highRisk: [], dueSoon: [], unavailable: true };
    h.overrides.set("predictChurn", async () => failed);
    h.overrides.set("predictRepeatVisits", async () => failed);
    h.overrides.set("analyzeLeadResponseTime", async () => ({ avgMinutes: 0, unavailable: true }));
    for (const name of [
      "forecastRevenue",
      "detectRevenueAnomalies",
      "forecastCashFlow",
      "analyzeProfitMargins",
      "analyzeTicketTrend",
      "computeCustomerRiskScores",
      "analyzeCustomerValueTrend",
    ]) {
      h.overrides.set(name, async () => {
        throw new Error("TiDB timeout");
      });
    }
    const report = await generateMasterIntelligenceReport();

    expect(report.summary.enginesFailed).toBe(10);
    expect(report.summary.scoreReliable).toBe(false);
    expect(report.summary.failures.filter((f) => f === "TiDB timeout")).toHaveLength(7);
    expect(report.summary.failures).toContain(
      "lead response time: its read failed (it returned an empty result marked unavailable)",
    );
  });

  it("the report section reads null, like a rejected engine's", async () => {
    // The admin cards (customerSignals.ts, leadSla.ts) map null and the
    // marker to the same UNMEASURED state, so null loses them nothing.
    h.overrides.set("predictRepeatVisits", async () => ({ dueSoon: [], unavailable: true }));
    const report = await generateMasterIntelligenceReport();

    expect(report.customers.repeatPrediction).toBeNull();
  });
});
