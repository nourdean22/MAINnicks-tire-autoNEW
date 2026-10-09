/**
 * The growth engines say when their read failed, and the master report reads the keys they send.
 *
 * Six engines in engines/growth.ts answered a failed database read with their empty shape, the
 * same object as a genuinely quiet period: chat funnel, review sentiment, website journeys, call
 * patterns, referral network and portfolio LTV. Four of them feed the master intelligence report,
 * which read the empty shape as data. They now carry `unavailable: true` (the convention
 * masterIntelligence's readFailed() consumes; see customerVelocityReadFailed.test.ts).
 *
 * The same report read two of them by keys they never sent: the "Chat funnel" score asked for
 * conversionRate / chatToBookingRate / totalSessions (the engine sends opened ... booked), so it
 * said "0% chat→booking conversion (0 sessions)" on every run; the referral opportunity asked for
 * totalReferrals / count (the engine sends networkSize), so it could never fire.
 *
 * The master-report half runs the REAL engines against a mocked driver that answers by table.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../db", () => ({
  getDb: async () => ({ execute: h.execute }),
}));

/** Every engine this file does not exercise resolves to an empty object. */
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
      "analyzeNewCustomerVelocity",
    ]),
    analyzeChatFunnel: growth.analyzeChatFunnel,
    analyzeReviewSentiment: growth.analyzeReviewSentiment,
    analyzeReferralNetwork: growth.analyzeReferralNetwork,
    forecastPortfolioLTV: growth.forecastPortfolioLTV,
  };
});

import {
  analyzeCallPatterns,
  analyzeChatFunnel,
  analyzeReferralNetwork,
  analyzeReviewSentiment,
  analyzeWebsiteJourneys,
  forecastPortfolioLTV,
} from "./engines/growth";
import { generateMasterIntelligenceReport } from "./masterIntelligence";

afterEach(() => h.execute.mockReset());

/** The SQL text of a drizzle query, enough to tell which table it reads. */
function sqlText(q: unknown): string {
  const out: string[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in c) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in c && Array.isArray((c as { value: unknown }).value)) {
        out.push((c as { value: string[] }).value.join(""));
      }
    }
  };
  walk((q as { queryChunks?: unknown[] })?.queryChunks ?? []);
  return out.join(" ");
}

/** A driver answer: [rows, fields]. */
const rows = (r: unknown[]) => [r, []];

const ENGINES = [
  ["analyzeChatFunnel", analyzeChatFunnel],
  ["analyzeReviewSentiment", analyzeReviewSentiment],
  ["analyzeWebsiteJourneys", analyzeWebsiteJourneys],
  ["analyzeCallPatterns", analyzeCallPatterns],
  ["analyzeReferralNetwork", analyzeReferralNetwork],
  ["forecastPortfolioLTV", forecastPortfolioLTV],
] as const;

describe("each growth engine marks a failed read, and only a failed read", () => {
  for (const [name, engine] of ENGINES) {
    it(`${name}: a failed read returns unavailable: true`, async () => {
      h.execute.mockRejectedValue(new Error("TiDB timeout"));
      const r = (await engine()) as { unavailable?: true };
      expect(r.unavailable).toBe(true);
    });

    it(`${name}: a successful read of an empty period carries no marker (control)`, async () => {
      h.execute.mockResolvedValue(rows([]));
      const r = (await engine()) as { unavailable?: true };
      expect(r.unavailable).toBeUndefined();
    });
  }
});

type Report = Awaited<ReturnType<typeof generateMasterIntelligenceReport>>;
const component = (report: Report, label: string) => report.summary.scoreBreakdown.find((c) => c.label === label);

/** 20 chat sessions over 90 days, 7 of them with a booked lead. */
const CHAT_SESSIONS = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  messagesJson: "[]",
  converted: i < 9 ? 1 : 0,
  leadId: i < 9 ? i + 100 : null,
  leadStatus: i < 7 ? "booked" : i < 9 ? "new" : null,
}));
/** Three referrers, 8 referrals in all. */
const REFERRERS = [
  { name: "A", phone: "2165550101", referralCount: 4, convertedCount: 2, totalRev: 90_000 },
  { name: "B", phone: "2165550102", referralCount: 3, convertedCount: 1, totalRev: 40_000 },
  { name: "C", phone: "2165550103", referralCount: 1, convertedCount: 0, totalRev: 0 },
];

function shopDriver(q: unknown) {
  const text = sqlText(q);
  if (text.includes("chat_sessions")) return rows(CHAT_SESSIONS);
  if (text.includes("FROM referrals")) return rows(REFERRERS);
  return rows([]);
}

describe("masterIntelligence · failed growth reads are failures, not quiet weeks", () => {
  it("names the four failed engines and scores nothing from them", async () => {
    h.execute.mockRejectedValue(new Error("TiDB timeout"));
    const report = await generateMasterIntelligenceReport();

    expect(report.summary.enginesFailed).toBe(4);
    expect(report.summary.failures).toEqual([
      "chat funnel: its read failed (it returned an empty result marked unavailable)",
      "review sentiment: its read failed (it returned an empty result marked unavailable)",
      "referral network: its read failed (it returned an empty result marked unavailable)",
      "portfolio LTV: its read failed (it returned an empty result marked unavailable)",
    ]);
    expect(component(report, "Chat funnel")).toBeUndefined();
    expect(report.competitive.chatFunnel).toBeNull();
    expect(report.competitive.reviewSentiment).toBeNull();
    expect(report.growth.referralNetwork).toBeNull();
    expect(report.growth.portfolioLTV).toBeNull();
  });

  it("an empty but readable period is not a failure (control)", async () => {
    h.execute.mockResolvedValue(rows([]));
    const report = await generateMasterIntelligenceReport();

    expect(report.summary.enginesFailed).toBe(0);
    expect(component(report, "Chat funnel")).toMatchObject({ points: 0, hasData: false, reason: "No chat sessions in 90 days (skipped)" });
  });
});

describe("masterIntelligence reads the keys the growth engines send", () => {
  it("scores the chat funnel from its sessions and bookings", async () => {
    h.execute.mockImplementation(async (q: unknown) => shopDriver(q));
    const report = await generateMasterIntelligenceReport();

    // 7 booked of 20 sessions = 35%: above the 30% line.
    expect(component(report, "Chat funnel")).toMatchObject({
      points: 3,
      hasData: true,
      reason: "35% chat→booking conversion (7 booked of 20 sessions, 90 days)",
    });
  });

  it("raises the referral opportunity from the referrals the engine counted", async () => {
    h.execute.mockImplementation(async (q: unknown) => shopDriver(q));
    const report = await generateMasterIntelligenceReport();

    expect(report.summary.topOpportunity).toBe("Referral network active: 8 referrals tracked — amplify with a bonus offer");
  });
});
