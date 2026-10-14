/**
 * Verdict parsing in scorePendingPredictions.
 *
 * THE DEFECT: the reply was matched with startsWith("ACCURATE") on raw lines, so
 * "**ACCURATE:** true" never matched and a readable reply was written DISPROVEN
 * with a Brier penalty. The verdict was read with includes("true"), so
 * "not true" counted as accurate. A reply with no readable verdict must be
 * UNVERIFIABLE: never confirmed, never disproven, no Brier score.
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
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { scorePendingPredictions } from "@/lib/brain/outcome-tracker";

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

function reply(content: string) {
  mockChat.mockResolvedValue({ content, provider: "ollama", model: "m" });
}

beforeEach(() => {
  mockChat.mockReset();
  remember.mockReset().mockResolvedValue({});
  db.findMany.mockReset().mockResolvedValue([PRED]);
  db.update.mockReset().mockResolvedValue({});
});

describe("scorePendingPredictions - verdict parsing", () => {
  it("a markdown-bolded 'ACCURATE:** true' reply is confirmed, not disproven", async () => {
    reply("**ACCURATE:** true\nOUTCOME: Revenue rose 12%.\nLESSON: Trend held.");
    await scorePendingPredictions();
    expect(db.update.mock.calls[0][0].data.status).toBe("confirmed");
  });

  it("a 'maybe' verdict is unverifiable with no Brier score, never disproven", async () => {
    reply("ACCURATE: maybe\nOUTCOME: Unclear from the data.\nLESSON: Need more data.");
    const scored = await scorePendingPredictions();
    const data = db.update.mock.calls[0][0].data;
    expect(data.status).toBe("unverifiable");
    expect(data.brierScore).toBeNull();
    expect(scored).toEqual([]);
    expect(remember).not.toHaveBeenCalled();
  });

  it("'not true' is unverifiable, not confirmed", async () => {
    reply("ACCURATE: not true\nOUTCOME: Partly right.\nLESSON: Mixed.");
    await scorePendingPredictions();
    expect(db.update.mock.calls[0][0].data.status).toBe("unverifiable");
  });

  it("a reply with no ACCURATE line is unverifiable, not disproven", async () => {
    reply("OUTCOME: Revenue rose 12%.\nLESSON: Trend held.");
    await scorePendingPredictions();
    expect(db.update.mock.calls[0][0].data.status).toBe("unverifiable");
  });

  it("control: a plain 'ACCURATE: false' is still disproven with its Brier score", async () => {
    reply("ACCURATE: false\nOUTCOME: Revenue fell.\nLESSON: Overconfident.");
    await scorePendingPredictions();
    const data = db.update.mock.calls[0][0].data;
    expect(data.status).toBe("disproven");
    expect(data.brierScore).toBeCloseTo(0.49, 5);
  });

  it("reads the oldest due predictions first, keeping take 3", async () => {
    reply("ACCURATE: true\nOUTCOME: x\nLESSON: y");
    await scorePendingPredictions();
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { targetDate: "asc" }, take: 3 }),
    );
  });
});
