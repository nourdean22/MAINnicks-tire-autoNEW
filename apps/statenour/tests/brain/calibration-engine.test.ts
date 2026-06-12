import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock prisma BEFORE importing anything else
vi.mock("@/lib/prisma", () => ({
  prisma: {
    calibrationReviewItem: {
      findMany: vi.fn(),
    },
    prediction: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
    brainMemory: {
      findMany: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  },
}));

// Mock getEmbedding
vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

// Mock queryNick
vi.mock("@/lib/nickstire/query", () => ({
  queryNick: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { queryNick } from "@/lib/nickstire/query";
import {
  proposeTaskRoi,
  proposePredictionOutcome,
  calculateScoreboardStats,
} from "@/lib/brain/calibration-engine";
import { Task, Prediction } from "@prisma/client";

describe("proposeTaskRoi heuristics", () => {
  const baseTask: Task = {
    id: "task-1",
    title: "Test Task",
    missionId: "mission-1",
    status: "DONE",
    nextPhysicalAction: "",
    effort: "M30", // expected 30m
    roiScore: 50,
    frictionScore: 5,
    energyRequired: "MEDIUM",
    context: "WORK",
    delegatable: false,
    waitingOn: null,
    dueDate: null,
    lastTouchedAt: null,
    driftRisk: 0,
    autoPriority: null,
    manualPriorityOverride: null,
    autoPriorityExplanation: null,
    finishCondition: "",
    createdBy: "system",
    updatedBy: "system",
    loopKind: "ONCE",
    promiseTo: null,
    personId: null,
    lastCompletedAt: null,
    streakCount: 0,
    goalId: "goal-1",
    statHints: [],
    pendingClassification: null,
    parentTaskId: null,
    phaseName: null,
    actualMinutes: 30, // matches estimate
    startedAt: null,
    snoozedUntil: null,
    recurringDays: [],
    deletedAt: null,
    completionNote: "Completed successfully",
    outcomeScore: null,
    proof: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("proposes accurate ROI when task is completed on time", async () => {
    const res = await proposeTaskRoi({
      ...baseTask,
      actualMinutes: 30,
      completionNote: "Balanced task note",
    });
    expect(res.outcomeScore).toBe(50);
    expect(res.classification).toBe("accurate");
  });

  it("penalizes ROI when task takes significantly longer", async () => {
    const res = await proposeTaskRoi({
      ...baseTask,
      actualMinutes: 75, // 2.5x expected 30m
    });
    expect(res.outcomeScore).toBeLessThan(50);
    expect(res.classification).toBe("overestimated"); // estimate was too high for what actually happened
  });

  it("boosts ROI when task finishes much quicker", async () => {
    const res = await proposeTaskRoi({
      ...baseTask,
      actualMinutes: 10, // 0.33x expected 30m
    });
    expect(res.outcomeScore).toBeGreaterThan(50);
    expect(res.classification).toBe("underestimated"); // estimate was too low
  });

  it("returns insufficient_evidence if actualMinutes, notes, and proof are missing", async () => {
    const res = await proposeTaskRoi({
      ...baseTask,
      actualMinutes: 0,
      completionNote: null,
      proof: null,
    });
    expect(res.classification).toBe("insufficient_evidence");
  });
});

describe("proposePredictionOutcome", () => {
  const basePrediction: Prediction = {
    id: "pred-1",
    date: "2026-06-10",
    targetDate: "2026-06-11",
    category: "business",
    prediction: "Revenue exceeds 5000",
    basis: "historical growth",
    confidence: 0.8,
    status: "pending",
    outcome: null,
    kind: "binary",
    brierScore: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves business prediction using queryNick revenue data (confirmed)", async () => {
    vi.mocked(queryNick).mockResolvedValue({
      data: { totalDollars: 5200 },
      query: "revenue_range",
      timestamp: new Date().toISOString(),
    });

    const res = await proposePredictionOutcome(basePrediction);
    expect(res.status).toBe("confirmed");
    expect(res.outcomeDescription).toContain("exceeded");
  });

  it("resolves business prediction using queryNick revenue data (disproven)", async () => {
    vi.mocked(queryNick).mockResolvedValue({
      data: { totalDollars: 4500 },
      query: "revenue_range",
      timestamp: new Date().toISOString(),
    });

    const res = await proposePredictionOutcome(basePrediction);
    expect(res.status).toBe("disproven");
    expect(res.outcomeDescription).toContain("not met");
  });

  it("resolves general prediction via semantic memory query matching", async () => {
    const { getEmbedding } = await import("@/lib/ai/provider");
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { content: "The launch was a huge success and we achieved our targets easily.", distance: 0.1 },
      { content: "Confirmed: achieved target milestone on time.", distance: 0.15 },
    ]);

    const nonBizPred = { ...basePrediction, category: "behavior", prediction: "Will finish launch" };
    const res = await proposePredictionOutcome(nonBizPred);
    expect(res.status).toBe("confirmed");
    expect(res.outcomeDescription).toContain("semantic memory");
  });
});

describe("calculateScoreboardStats aggregator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates rolling Brier scores and MAE correctly", async () => {
    vi.mocked(prisma.calibrationReviewItem.findMany).mockResolvedValue([
      {
        id: "r-1",
        type: "prediction",
        status: "approved",
        confidence: 0.8,
        accuracyScore: 0.04, // (0.8 - 1.0)^2 = 0.04
        updatedAt: new Date(),
      },
      {
        id: "r-2",
        type: "prediction",
        status: "corrected",
        confidence: 0.6,
        accuracyScore: 0.36, // (0.6 - 0.0)^2 = 0.36
        updatedAt: new Date(),
      },
      {
        id: "r-3",
        type: "task_roi",
        status: "approved",
        predictedOutcome: { roiScore: 70 },
        approvedActualOutcome: { outcomeScore: 60 }, // Error = -10
        updatedAt: new Date(),
      },
      {
        id: "r-4",
        type: "task_roi",
        status: "approved",
        predictedOutcome: { roiScore: 50 },
        approvedActualOutcome: { outcomeScore: 55 }, // Error = +5
        updatedAt: new Date(),
      },
    ] as any);

    const stats = await calculateScoreboardStats();

    // Predictions: count=2, average brier = (0.04 + 0.36) / 2 = 0.20
    expect(stats.predictionCount30d).toBe(2);
    expect(stats.rollingBrier30d).toBeCloseTo(0.20);
    // 1 - sqrt(0.2) = 1 - 0.447 = 0.553 -> 55%
    expect(stats.predictionAccuracyPct).toBe(55);

    // Tasks: count=2, MAE = (|60 - 70| + |55 - 50|) / 2 = (10 + 5) / 2 = 7.5
    expect(stats.taskRoiCount30d).toBe(2);
    expect(stats.taskRoiMae30d).toBe(7.5);
    // Bias: (-10 + 5) / 2 = -2.5
    expect(stats.taskRoiBias30d).toBe(-2.5);
    // Overestimates: 1 out of 2 (r-3) -> 50%
    expect(stats.taskOverestimateRate30d).toBe(50);
  });
});
