import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockReadRequestJson } = vi.hoisted(() => ({
  mockPrisma: {
    calibrationReviewItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    prediction: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    brainMemory: {
      findMany: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
    },
    $queryRawUnsafe: vi.fn(),
  },
  mockReadRequestJson: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: any) => h,
  apiHandler: (h: any) => h,
  readRequestJson: mockReadRequestJson,
}));

// Mock calibration-engine core functions
vi.mock("@/lib/brain/calibration-engine", () => ({
  proposeTaskRoi: vi.fn().mockResolvedValue({
    outcomeScore: 60,
    classification: "overestimated",
    rationale: "Took longer than expected",
  }),
  proposePredictionOutcome: vi.fn().mockResolvedValue({
    status: "confirmed",
    outcomeDescription: "Auto-graded confirmed",
    evidence: {},
  }),
  calculateScoreboardStats: vi.fn().mockResolvedValue({
    predictionCount30d: 5,
    rollingBrier30d: 0.12,
    predictionAccuracyPct: 65,
    taskRoiCount30d: 8,
    taskRoiMae30d: 5.5,
    taskRoiBias30d: -2.1,
    taskOverestimateRate30d: 35,
    calibrationVerdict: "well-calibrated",
    biasVerdict: "calibrated",
    colorHsl: "hsl(142, 76%, 36%)",
  }),
}));

import { GET as cronGet } from "@/app/api/cron/calibration-generator/route";
import { GET as reviewsGet } from "@/app/api/system/calibration/reviews/route";
import { POST as resolvePost } from "@/app/api/system/calibration/reviews/[id]/resolve/route";

describe("API /api/cron/calibration-generator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scans pending predictions and high-impact tasks and upserts them as reviews", async () => {
    mockPrisma.prediction.findMany.mockResolvedValue([
      { id: "pred-1", prediction: "Test prediction", confidence: 0.7, targetDate: "2026-06-11" },
    ]);
    mockPrisma.task.findMany.mockResolvedValue([
      { id: "task-1", title: "Strategic task", roiScore: 80, effort: "M15", goalId: "g-1", actualMinutes: 20 },
    ]);

    const req = new Request("http://localhost/api/cron/calibration-generator");
    const res = await (cronGet as any)(req);

    expect(mockPrisma.prediction.findMany).toHaveBeenCalled();
    expect(mockPrisma.task.findMany).toHaveBeenCalled();
    expect(mockPrisma.calibrationReviewItem.upsert).toHaveBeenCalledTimes(2);
    expect(res.predictions.created).toBe(1);
    expect(res.tasks.created).toBe(1);
  });
});

describe("API /api/system/calibration/reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pending reviews, past history, lessons feed, and scoreboard", async () => {
    mockPrisma.calibrationReviewItem.findMany
      .mockResolvedValueOnce([{ id: "rev-pending" }]) // pending query
      .mockResolvedValueOnce([{ id: "rev-history" }]); // history query
    mockPrisma.brainMemory.findMany.mockResolvedValue([{ id: "mem-lesson", content: "A lesson" }]);

    const req = new Request("http://localhost/api/system/calibration/reviews");
    const res = await (reviewsGet as any)(req);

    expect(res.pending).toHaveLength(1);
    expect(res.history).toHaveLength(1);
    expect(res.lessons).toHaveLength(1);
    expect(res.scoreboard).toBeDefined();
    expect(res.scoreboard.calibrationVerdict).toBe("well-calibrated");
  });
});

describe("API /api/system/calibration/reviews/[id]/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a task ROI review item by updating the task and logging a lesson", async () => {
    const reviewItem = {
      id: "rev-1",
      type: "task_roi",
      sourceId: "task-1",
      sourceType: "Task",
      status: "pending",
      predictedOutcome: { roiScore: 80 },
      proposedActualOutcome: { outcomeScore: 60, classification: "overestimated", rationale: "Took longer" },
      confidence: 0.5,
    };

    mockPrisma.calibrationReviewItem.findUnique.mockResolvedValue(reviewItem);
    mockPrisma.task.update.mockResolvedValue({ id: "task-1", title: "Strategic task" });
    mockPrisma.calibrationReviewItem.update.mockResolvedValue({ ...reviewItem, status: "approved" });
    mockReadRequestJson.mockResolvedValue({ action: "approve" });

    const req = new Request("http://localhost/api/system/calibration/reviews/rev-1/resolve", {
      method: "POST",
    });
    const res = await (resolvePost as any)(req, { params: Promise.resolve({ id: "rev-1" }) });

    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { outcomeScore: 60 },
    });
    expect(mockPrisma.calibrationReviewItem.update).toHaveBeenCalledWith({
      where: { id: "rev-1" },
      data: expect.objectContaining({
        status: "approved",
        accuracyScore: 20, // |60 - 80| = 20
        reviewedBy: "owner",
      }),
    });
    expect(res.success).toBe(true);
  });
});
