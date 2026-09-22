import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractClaimsFromText } from "@/lib/intelligence/extraction";
import { runIngestion } from "@/lib/intelligence/ingest";
import { evaluatePredictions } from "@/lib/brain/predictive-engine";
import { generateText } from "ai";
import { prisma } from "@/lib/prisma";
import { fetchFREDIndicators } from "@/lib/intelligence/connectors/fred";
import { fetchNHTSARecalls } from "@/lib/intelligence/connectors/nhtsa";
import { fetchGSCAndGBPMetrics } from "@/lib/intelligence/connectors/gsc";
import { fetchCompetitorAndSECData } from "@/lib/intelligence/connectors/sec";
import { fetchWeatherMetrics } from "@/lib/intelligence/connectors/weather";
import { fetchSupplyChainMetrics } from "@/lib/intelligence/connectors/supplychain";
import { fetchListedDeals } from "@/lib/intelligence/connectors/dealscouting";
import { fetchBioPerformanceMetrics } from "@/lib/intelligence/connectors/performance";

// Mock AI SDK
vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

// EVERY OUTBOUND CONNECTOR IS MOCKED, and this block is the fix for a real flake.
//
// THE BUG. `runIngestion` branches on `source.domain`, and the "macro" branch
// calls `fetchFREDIndicators()` — a LIVE network call. This file mocked `ai`,
// the provider, prisma and the calibration engine, but never the connectors, so
// the test made a real HTTP request to FRED on every run. The outer try/catch in
// runIngestion swallows any throw and returns `claimsCount: 0`, which surfaces
// as the maximally unhelpful "expected spy to be called 1 times, but got 0".
//
// It passed in isolation and failed in the 6,279-test suite, because that is
// where a slow or rate-limited request finally times out. Confirmed by forcing
// `fetchFREDIndicators` to reject: identical failure message.
//
// A unit test asserting "the claim payload carries narrativeStatus" has no
// business touching the network. All eight connectors are stubbed so the test
// is hermetic no matter which domain a future case picks — mocking only FRED
// would leave the same trap armed for the next `domain` someone tests.
// 2026-09-22 · THE BUG CAME BACK, ONE MODULE OVER. Since #1872 (2026-08-25)
// the "macro" branch no longer calls `fetchFREDIndicators` — it calls
// `fetchMacroIndicators` from connectors/macro (FRED + BLS + BEA + Census
// with attributed failover). Mocking connectors/fred therefore mocks a module
// the code never imports; the real multi-provider fetch ran, every provider
// failed offline, `macroFetchFailure` returned a message, and `runIngestion`
// exited before `intelligenceClaim.create` — "expected spy to be called 1
// times, but got 0". Deterministic, not flaky. It stayed invisible because the
// CI `node` job runs AFFECTED tests and nothing touching the chat persist
// path had merged since. Found by #2483, which did.
// The code is right: zero macro series IS a failure by design (the
// 2026-08-12 outage). `macroFetchFailure` returns null only when
// `indicators.length > 0`, so the mock serves one indicator.
vi.mock("@/lib/intelligence/connectors/macro", () => ({
  fetchMacroIndicators: vi.fn().mockResolvedValue({
    result: {
      indicators: [{ provider: "FRED", id: "FEDFUNDS", label: "Fed funds rate", value: 5.33, unit: "%" }],
      providers: [{ provider: "FRED", attempted: true, envVar: "FRED_API_KEY" }],
    },
    unresolved: [],
  }),
  macroFetchFailure: vi.fn().mockReturnValue(null),
  renderMacroReport: vi.fn().mockReturnValue("Macro report: Interest rates rose to 5.33%"),
}));
vi.mock("@/lib/intelligence/connectors/fred", () => ({
  fetchFREDIndicators: vi.fn().mockResolvedValue([
    { name: "Federal Funds Rate", seriesId: "FEDFUNDS", value: 5.33, unit: "%", date: "2026-08-01" },
  ]),
}));
vi.mock("@/lib/intelligence/connectors/nhtsa", () => ({
  fetchNHTSARecalls: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/intelligence/connectors/gsc", () => ({
  fetchGSCAndGBPMetrics: vi.fn().mockResolvedValue({ gsc: null, gbp: null }),
}));
vi.mock("@/lib/intelligence/connectors/sec", () => ({
  fetchCompetitorAndSECData: vi.fn().mockResolvedValue({ filings: [], prices: [] }),
}));
vi.mock("@/lib/intelligence/connectors/weather", () => ({
  fetchWeatherMetrics: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/intelligence/connectors/supplychain", () => ({
  fetchSupplyChainMetrics: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/intelligence/connectors/dealscouting", () => ({
  fetchListedDeals: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/intelligence/connectors/performance", () => ({
  fetchBioPerformanceMetrics: vi.fn().mockResolvedValue(null),
}));

// Firecrawl is the other outbound path (non-macro domains scrape source.url).
vi.mock("@/lib/integrations/firecrawl", () => ({
  isFirecrawlConfigured: vi.fn().mockReturnValue(false),
  scrapeUrl: vi.fn().mockResolvedValue({ markdown: "", metadata: {} }),
}));

// Mock AI provider
vi.mock("@/lib/ai/provider", () => ({
  getModel: () => ({
    modelId: "mock-reason-model",
  }),
}));

// Mock prisma database functions
const mockClaimCreate = vi.fn().mockResolvedValue({});
const mockRegisteredSourceFindUnique = vi.fn().mockResolvedValue(null);
const mockRegisteredSourceUpdate = vi.fn().mockResolvedValue({});
const mockSourceDocumentCreate = vi.fn().mockResolvedValue({});
const mockPredictionFindMany = vi.fn().mockResolvedValue([]);
const mockPredictionCount = vi.fn().mockResolvedValue(0);
const mockPredictionGroupBy = vi.fn().mockResolvedValue([]);
const mockBrainMemoryUpsert = vi.fn().mockResolvedValue({});
const mockCalibrationReviewItemUpsert = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    intelligenceClaim: {
      create: (...args: any[]) => mockClaimCreate(...args),
    },
    registeredSource: {
      findUnique: (...args: any[]) => mockRegisteredSourceFindUnique(...args),
      update: (...args: any[]) => mockRegisteredSourceUpdate(...args),
    },
    sourceDocument: {
      create: (...args: any[]) => mockSourceDocumentCreate(...args),
    },
    prediction: {
      findMany: (...args: any[]) => mockPredictionFindMany(...args),
      count: (...args: any[]) => mockPredictionCount(...args),
      groupBy: (...args: any[]) => mockPredictionGroupBy(...args),
    },
    brainMemory: {
      upsert: (...args: any[]) => mockBrainMemoryUpsert(...args),
    },
    calibrationReviewItem: {
      upsert: (...args: any[]) => mockCalibrationReviewItemUpsert(...args),
    },
  },
}));

// Mock calibration engine functions
const mockProposePredictionOutcome = vi.fn();
vi.mock("@/lib/brain/calibration-engine", () => ({
  proposePredictionOutcome: (...args: any[]) => mockProposePredictionOutcome(...args),
  proposeTaskRoi: vi.fn(),
  calculateScoreboardStats: vi.fn(),
}));

// Mock grounding claim function
vi.mock("@/lib/intelligence/grounding", () => ({
  groundClaim: vi.fn((text, category, confidence) => Promise.resolve({
    text,
    category,
    confidence,
    verificationScore: 0.8,
    status: "source_supported",
    bestMatchChunk: "Matches",
  })),
}));

describe("Statenour OS V2 Wave 2 - Predictions & Narrative Status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimCreate.mockReset().mockResolvedValue({});
    mockRegisteredSourceFindUnique.mockReset().mockResolvedValue(null);
    mockRegisteredSourceUpdate.mockReset().mockResolvedValue({});
    mockSourceDocumentCreate.mockReset().mockResolvedValue({});
    mockPredictionFindMany.mockReset().mockResolvedValue([]);
    mockPredictionCount.mockReset().mockResolvedValue(0);
    mockPredictionGroupBy.mockReset().mockResolvedValue([]);
    mockBrainMemoryUpsert.mockReset().mockResolvedValue({});
    mockCalibrationReviewItemUpsert.mockReset().mockResolvedValue({});
  });

  describe("HERMETIC · this file must not touch the network", () => {
    it("the macro connector is stubbed, not live", () => {
      // The guard for the flake this file shipped with. `runIngestion`'s "macro"
      // branch calls fetchFREDIndicators(), and without a mock that is a real
      // HTTP request — which passed alone and failed in the full suite, where a
      // slow or rate-limited call finally times out. runIngestion's outer catch
      // turns any throw into claimsCount:0, so it surfaced as "expected spy to
      // be called 1 times, but got 0" with nothing pointing at the network.
      //
      // Asserting the FIXTURE VALUE, not just that a function exists: a live
      // call would return real FRED data (or throw), and either way this fails.
      const fred = vi.mocked(fetchFREDIndicators);
      expect(fred.getMockImplementation() ?? fred.mock).toBeDefined();
      return expect(fetchFREDIndicators()).resolves.toEqual([
        { name: "Federal Funds Rate", seriesId: "FEDFUNDS", value: 5.33, unit: "%", date: "2026-08-01" },
      ]);
    });

    it("every outbound connector runIngestion can reach is stubbed", async () => {
      // Mocking only the one the current tests happen to hit would leave the
      // trap armed for the next `domain` someone writes a case for.
      const [nhtsa, gsc, sec, weather, supply, deals, perf] = await Promise.all([
        fetchNHTSARecalls([] as never),
        fetchGSCAndGBPMetrics(),
        fetchCompetitorAndSECData(),
        fetchWeatherMetrics(),
        fetchSupplyChainMetrics(),
        fetchListedDeals(),
        fetchBioPerformanceMetrics(),
      ]);
      // Each resolves instantly to its stub. A live connector would be slow,
      // shaped differently, or throw.
      expect(nhtsa).toEqual([]);
      expect(gsc).toEqual({ gsc: null, gbp: null });
      expect(sec).toEqual({ filings: [], prices: [] });
      expect([weather, supply, perf]).toEqual([null, null, null]);
      expect(deals).toEqual([]);
    });
  });

  describe("Step 2 & 3: Claims Narrative Extraction & Ingestion", () => {
    it("extractClaimsFromText should successfully extract claims with narrativeStatus", async () => {
      const mockResultText = JSON.stringify([
        {
          text: "Interest rates rose to 5.33%",
          category: "research_claim",
          confidence: 0.95,
          narrativeStatus: "emerging"
        },
        {
          text: "Mobile repair leads spiked 45%",
          category: "research_claim",
          confidence: 0.85,
          narrativeStatus: "peak"
        }
      ]);

      vi.mocked(generateText).mockResolvedValue({
        text: mockResultText,
      } as any);

      const claims = await extractClaimsFromText("Sample content");
      expect(claims).toHaveLength(2);
      expect(claims[0].narrativeStatus).toBe("emerging");
      expect(claims[1].narrativeStatus).toBe("peak");
    });

    it("runIngestion should persist narrativeStatus into database", async () => {
      mockRegisteredSourceFindUnique.mockResolvedValue({
        id: "src-1",
        name: "Test Source",
        domain: "macro",
        url: "http://test.com",
      });

      mockSourceDocumentCreate.mockResolvedValue({
        id: "doc-1",
      });

      const mockResultText = JSON.stringify([
        {
          text: "Interest rates rose to 5.33%",
          category: "research_claim",
          confidence: 0.95,
          narrativeStatus: "emerging"
        }
      ]);
      vi.mocked(generateText).mockResolvedValue({
        text: mockResultText,
      } as any);

      await runIngestion("src-1");

      expect(mockClaimCreate).toHaveBeenCalledTimes(1);
      const dataPayload = mockClaimCreate.mock.calls[0][0].data;
      expect(dataPayload.narrativeStatus).toBe("emerging");
    });
  });

  describe("Step 4: Refactored Prediction Evaluation via CalibrationReviewItem", () => {
    it("evaluatePredictions should upsert CalibrationReviewItem records and calculate accuracy current", async () => {
      const mockPredictions = [
        {
          id: "pred-1",
          date: "2026-06-10",
          targetDate: "2026-06-20",
          prediction: "Revenue exceeds 5000",
          confidence: 0.8,
          category: "business",
          status: "pending",
        },
      ];

      mockPredictionFindMany.mockResolvedValue(mockPredictions);
      mockProposePredictionOutcome.mockResolvedValue({
        status: "confirmed",
        outcomeDescription: "Auto-graded confirmed: target revenue 5000 exceeded with actual 5200",
        evidence: { totalDollars: 5200 },
      });

      // Total resolved counts for overall calibration stats
      mockPredictionCount.mockImplementation((args) => {
        if (args.where?.status === "confirmed") return Promise.resolve(5);
        if (args.where?.status === "disproven") return Promise.resolve(2);
        return Promise.resolve(0);
      });

      mockPredictionGroupBy.mockImplementation((args) => {
        if (args.where?.status === "confirmed") {
          return Promise.resolve([{ category: "business", _count: 5 }]);
        }
        if (args.where?.status === "disproven") {
          return Promise.resolve([{ category: "business", _count: 2 }]);
        }
        return Promise.resolve([]);
      });

      const result = await evaluatePredictions();

      // Check return status
      expect(result.checked).toBe(1);
      expect(result.confirmed).toBe(1);
      expect(result.disproven).toBe(0);

      // Verify that CalibrationReviewItem upsert was called with pending status and proposed outcome
      expect(mockCalibrationReviewItemUpsert).toHaveBeenCalledTimes(1);
      const upsertArgs = mockCalibrationReviewItemUpsert.mock.calls[0][0];
      expect(upsertArgs.where.sourceId_sourceType).toEqual({
        sourceId: "pred-1",
        sourceType: "Prediction",
      });
      expect(upsertArgs.create.status).toBe("pending");
      expect(upsertArgs.create.proposedActualOutcome.status).toBe("confirmed");
      expect(upsertArgs.create.evidence.totalDollars).toBe(5200);

      // Verify overall calibration BrainMemory was upserted
      expect(mockBrainMemoryUpsert).toHaveBeenCalledTimes(1);
      const upsertMemoryArgs = mockBrainMemoryUpsert.mock.calls[0][0];
      expect(upsertMemoryArgs.where.category_key.key).toBe("accuracy_current");
      expect(upsertMemoryArgs.create.content).toContain("Overall prediction accuracy");
    });
  });
});
