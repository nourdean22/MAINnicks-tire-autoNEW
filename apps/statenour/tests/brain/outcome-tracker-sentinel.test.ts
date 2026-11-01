/**
 * Audit 2026-10-10 sentinel sweep (Task 2b): the outage apology has no
 * "ACCURATE: true" line, so every due prediction scored during an outage was
 * marked DISPROVEN with a Brier penalty — a fabricated calibration record.
 * A sentinel must leave the prediction pending for the next run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));
const db = vi.hoisted(() => ({ findMany: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { prediction: { findMany: db.findMany, update: db.update } },
}));
const remember = vi.fn();
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: (...a: unknown[]) => remember(...a) },
}));
vi.mock("@/lib/brain/legacy-shims", () => ({
  recentScoreSnapshots: async () => [],
  recentShopJobs: async () => [],
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/error-log", () => ({ logError }));

import { scorePendingPredictions } from "@/lib/brain/outcome-tracker";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};
const PRED = {
  id: "pred_123456",
  date: "2026-10-01",
  targetDate: "2026-10-08",
  category: "revenue",
  prediction: "Revenue up 10%",
  basis: "trend",
  confidence: 0.7,
  metadata: {},
};

beforeEach(() => {
  mockChat.mockReset();
  remember.mockReset().mockResolvedValue({});
  db.findMany.mockReset().mockResolvedValue([PRED]);
  db.update.mockReset().mockResolvedValue({});
});

describe("scorePendingPredictions - provider sentinel", () => {
  it("leaves the prediction pending (no disproven verdict, no lesson)", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    const scored = await scorePendingPredictions();
    expect(scored).toEqual([]);
    expect(db.update).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  });

  it("control: a real verdict is recorded", async () => {
    mockChat.mockResolvedValue({
      content: "ACCURATE: true\nOUTCOME: Revenue rose 12%.\nLESSON: Trend held.",
      provider: "ollama",
      model: "m",
    });
    const scored = await scorePendingPredictions();
    expect(scored).toHaveLength(1);
    expect(db.update.mock.calls[0][0].data.status).toBe("confirmed");
  });
});

describe("scorePendingPredictions - a throw names its cause (2026-11-01)", () => {
  it("logs the first failure's prediction id and message, not just a count", async () => {
    // Prod: "[brain.outcome-tracker] 1 predictions failed to score" on 5 of 7 nights, no cause recorded.
    logError.mockReset();
    mockChat.mockRejectedValue(new Error("provider timeout after 45000ms"));
    await scorePendingPredictions();
    expect(logError).toHaveBeenCalledWith(
      "brain.outcome-tracker",
      expect.any(Error),
      expect.objectContaining({ firstFailure: "pred_123456: provider timeout after 45000ms" }),
    );
  });
});
