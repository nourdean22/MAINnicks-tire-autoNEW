import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
  },
}));

import {
  extractPredictions,
  persistPrediction,
  resolvePrediction,
  getCalibrationStats,
  buildCalibrationPromptBlock,
} from "@/lib/ai/outcome-calibration";

describe("outcome-calibration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractPredictions", () => {
    it("extracts engagement metrics correctly", () => {
      const text = "I think this hits 350+ engagement. Confidence 80%.";
      const preds = extractPredictions(text);
      expect(preds).toContainEqual({
        metric: "engagement",
        value: 350,
        rawMatch: "hits 350+ engagement",
      });
      expect(preds).toContainEqual({
        metric: "confidence_pct",
        value: 80,
        rawMatch: "Confidence 80%",
      });
    });

    it("returns empty array for text with no matches", () => {
      expect(extractPredictions("Just text with no predictions.")).toEqual([]);
    });
  });

  describe("persistPrediction", () => {
    it("creates a brain memory prediction row when predictions found", async () => {
      mocks.brainMemory.create.mockResolvedValueOnce({ id: "bm-pred-1" });
      await persistPrediction({
        predictions: [{ metric: "engagement", value: 400, rawMatch: "hits 400 engagement" }],
        captionText: "Test tire promo caption",
        conversationId: "conv-1",
        messageId: "msg-1",
      });

      expect(mocks.brainMemory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: "prediction",
            source: "chat_assistant",
            metadata: expect.objectContaining({
              captionHash: "b88b6182", // fnv1a of "Test tire promo caption"
              resolved: false,
            }),
          }),
        }),
      );
    });
  });

  describe("resolvePrediction", () => {
    it("resolves pending predictions and computes error percentage", async () => {
      const mockMeta = {
        predictions: [{ metric: "engagement", value: 100 }],
        captionHash: "b88b6182",
        resolved: false,
      };

      mocks.brainMemory.findMany.mockResolvedValueOnce([
        { id: "bm-pred-1", metadata: mockMeta, content: "predicted 100" },
      ]);
      mocks.brainMemory.update.mockResolvedValueOnce({ id: "bm-pred-1" });

      const result = await resolvePrediction({
        captionText: "Test tire promo caption",
        actualScore: 120,
      });

      expect(result.resolved).toBe(true);
      expect(result.predictionId).toBe("bm-pred-1");
      expect(mocks.brainMemory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "bm-pred-1" },
          data: expect.objectContaining({
            content: expect.stringContaining("predicted 100 → actual 120 (20% error)"),
            confidence: 0.7,
            metadata: expect.objectContaining({
              actualScore: 120,
              errorPct: 0.2,
              resolved: true,
            }),
          }),
        }),
      );
    });

    it("returns resolved: false when no match is found", async () => {
      mocks.brainMemory.findMany.mockResolvedValueOnce([]);
      const result = await resolvePrediction({
        captionText: "Unmatched caption",
        actualScore: 120,
      });
      expect(result.resolved).toBe(false);
      expect(mocks.brainMemory.update).not.toHaveBeenCalled();
    });
  });

  describe("getCalibrationStats", () => {
    it("computes stats correctly from resolved prediction rows", async () => {
      const now = new Date();
      const mockRows = [
        {
          metadata: {
            resolved: true,
            predictions: [{ metric: "engagement", value: 100 }],
            actualScore: 110,
            errorPct: 0.1,
          },
        },
        {
          metadata: {
            resolved: true,
            predictions: [{ metric: "engagement", value: 100 }],
            actualScore: 130,
            errorPct: 0.3,
          },
        },
        {
          metadata: {
            resolved: false, // pending
          },
        },
      ];

      mocks.brainMemory.findMany.mockResolvedValueOnce(mockRows);
      const stats = await getCalibrationStats(30);

      expect(stats.totalPredictions).toBe(3);
      expect(stats.resolvedCount).toBe(2);
      expect(stats.pendingCount).toBe(1);
      expect(stats.meanErrorPct).toBeCloseTo(0.2, 5);
      expect(stats.within20PctRate).toBe(0.5); // 1 out of 2 is < 0.2
      expect(stats.within40PctRate).toBe(1.0); // both are < 0.4
    });
  });

  describe("buildCalibrationPromptBlock", () => {
    it("returns insufficient data warning when resolved count is less than 5", () => {
      const stats = {
        totalPredictions: 2,
        resolvedCount: 2,
        pendingCount: 0,
        meanErrorPct: 0.1,
        within20PctRate: 1.0,
        within40PctRate: 1.0,
        meanBiasPct: 0.0,
      };
      const block = buildCalibrationPromptBlock(stats);
      expect(block).toContain("insufficient data");
    });

    it("returns formatted stats when resolved count is 5 or more", () => {
      const stats = {
        totalPredictions: 6,
        resolvedCount: 6,
        pendingCount: 0,
        meanErrorPct: 0.15,
        within20PctRate: 0.8,
        within40PctRate: 0.9,
        meanBiasPct: -0.05,
      };
      const block = buildCalibrationPromptBlock(stats);
      expect(block).toContain("PREDICTION CALIBRATION");
      expect(block).toContain("80% of predictions within ±20%");
      expect(block).toContain("90% within ±40%");
      expect(block).toContain("Mean error: 15%");
    });
  });
});

describe("getCalibrationStats · expired rows cannot fabricate calibration (2026-08-06)", () => {
  it("expired_unverifiable rows count neither as resolved nor pending", async () => {
    const expired = Array.from({ length: 5 }, (_, i) => ({
      metadata: { resolved: true, resolvedOutcome: "expired_unverifiable" },
      id: `exp-${i}`,
    }));
    const genuine = [
      { id: "ok-1", metadata: { resolved: true, errorPct: 0.1, actualScore: 110, predictions: [{ metric: "engagement", value: 100 }] } },
      { id: "ok-2", metadata: { resolved: true, errorPct: 0.3, actualScore: 130, predictions: [{ metric: "engagement", value: 100 }] } },
    ];
    const pending = [{ id: "p-1", metadata: { resolved: false } }];
    mocks.brainMemory.findMany.mockResolvedValueOnce([...expired, ...genuine, ...pending]);

    const stats = await getCalibrationStats();
    // Before the fix, resolvedCount was 7 (5 expired + 2 real), crossing the
    // >=5 threshold and rendering a calibration block fabricated from rows
    // nobody ever verified. It must be 2: the hedge stays honest.
    expect(stats.resolvedCount).toBe(2);
    expect(stats.pendingCount).toBe(1);
    expect(buildCalibrationPromptBlock(stats)).toContain("insufficient data");
  });
});
