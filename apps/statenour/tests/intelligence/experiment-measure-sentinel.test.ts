/**
 * Audit 2026-10-10 06-F13 / 08-F5: an aiChat outage sentinel has no VERDICT
 * line, so the due experiment was written `inconclusive` and consumed
 * forever. On a sentinel the experiment stays `running` (claim released) and
 * nothing is measured.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));

const exp = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    experiment: exp,
    registeredSource: { findUnique: vi.fn(), update: vi.fn() },
    aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/brain/legacy-shims", () => ({ recentShopJobs: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { resolveDueExperiments } from "@/lib/intelligence/experiment-measure";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};

const DUE = {
  id: "exp-1",
  hypothesis: "Raising the alignment price lifts margin",
  expectedEffect: "+5% margin",
  startedAt: new Date("2026-09-20T00:00:00Z"),
  dueAt: new Date("2026-10-04T00:00:00Z"),
  sourceId: "src-1",
};

beforeEach(() => {
  mockChat.mockReset();
  exp.findMany.mockReset().mockResolvedValue([DUE]);
  exp.updateMany.mockReset().mockResolvedValue({ count: 1 });
  exp.update.mockReset().mockResolvedValue({});
});

describe("resolveDueExperiments - provider sentinel", () => {
  it("leaves the experiment running and writes no verdict", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    const res = await resolveDueExperiments();
    expect(res.resolved).toBe(0);
    expect(exp.update).not.toHaveBeenCalled();
    // claim (running -> measuring) then release (measuring -> running)
    expect(exp.updateMany).toHaveBeenLastCalledWith({
      where: { id: "exp-1", status: "measuring" },
      data: { status: "running" },
    });
  });

  it("control: a real verdict is written", async () => {
    mockChat.mockResolvedValue({
      content: "VERDICT: INCONCLUSIVE\nOUTCOME: Not enough jobs to tell.",
      provider: "ollama",
      model: "m",
    });
    const res = await resolveDueExperiments();
    expect(res.resolved).toBe(1);
    expect(exp.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "inconclusive" }) }),
    );
  });
});
