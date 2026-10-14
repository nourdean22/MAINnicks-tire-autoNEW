/**
 * The predictive prompt rendered "Quotes: 0 (0 booked, 0% conversion)" as fact,
 * but recentShopQuotes() is a stub that returns []. With no quote source the
 * honest line is "Quotes: not tracked": the model must never read a fabricated
 * zero as a measured one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));
const shop = vi.hoisted(() => ({ jobs: [] as Array<{ totalRevenue: number }> }));
vi.mock("@/lib/brain/legacy-shims", () => ({
  recentScoreSnapshots: async () => [],
  recentDailyHabits: async () => [],
  recentShopJobs: async () => shop.jobs,
  recentShopLeads: async () => [],
  recentShopQuotes: async () => [],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findMany: async () => [] },
    task: { findMany: async () => [] },
    commitment: { findMany: async () => [] },
    prediction: { findMany: async () => [] },
    reflection: { findMany: async () => [] },
    $transaction: async () => [],
  },
}));
vi.mock("@/lib/brain/calibration-engine", () => ({ proposePredictionOutcome: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { runPredictions } from "@/lib/brain/predictive-engine";

beforeEach(() => {
  mockChat.mockReset().mockResolvedValue({ content: "[]", provider: "ollama", model: "m" });
  shop.jobs = [{ totalRevenue: 250 }];
});

describe("runPredictions - quote context", () => {
  it("never states a zero quote count when no quote source exists", async () => {
    await runPredictions();
    const messages = mockChat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    const context = messages.find((m) => m.role === "user")!.content;
    // Guard: the Business Metrics block rendered, so the Quotes line was in play.
    expect(context).toContain("Jobs: 1");
    expect(context).not.toMatch(/Quotes: \d/);
    expect(context).toContain("Quotes: not tracked");
  });
});
