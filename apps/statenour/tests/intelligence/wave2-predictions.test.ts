import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractClaimsFromText } from "@/lib/intelligence/extraction";
import { runIngestion } from "@/lib/intelligence/ingest";
import { evaluatePredictions } from "@/lib/brain/predictive-engine";
import { generateText } from "ai";
import { prisma } from "@/lib/prisma";

// Mock AI SDK
vi.mock("ai", () => ({
  generateText: vi.fn(),
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
