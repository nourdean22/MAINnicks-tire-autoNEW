/**
 * Verdict parsing in scorePendingPredictions.
 *
 * THE DEFECT: the reply was matched with startsWith("ACCURATE") on raw lines, so
 * "**ACCURATE:** true" never matched and a readable reply was written DISPROVEN
 * with a Brier penalty. The verdict was read with includes("true"), so
 * "not true" and "true-ish" counted as accurate. An unreadable reply must never
 * be confirmed or disproven: it stays pending for a retry, and after three
 * unreadable attempts it is parked as unverifiable.
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

  it("a 'maybe' verdict stays pending on its first attempt, with no Brier score and no lesson", async () => {
    reply("ACCURATE: maybe\nOUTCOME: Unclear from the data.\nLESSON: Need more data.");
    const scored = await scorePendingPredictions();
    const data = db.update.mock.calls[0][0].data;
    expect(data.status).toBe("pending");
    expect(data.brierScore).toBeUndefined();
    expect(data.metadata.verdictAttempts).toBe(1);
    expect(scored).toEqual([]);
    expect(remember).not.toHaveBeenCalled();
  });

  it("the third unreadable verdict parks the prediction as terminal 'unverifiable'", async () => {
    db.findMany.mockResolvedValue([{ ...PRED, metadata: { verdictAttempts: 2 } }]);
    reply("ACCURATE: maybe\nOUTCOME: Unclear.\nLESSON: Need data.");
    await scorePendingPredictions();
    const data = db.update.mock.calls[0][0].data;
    expect(data.status).toBe("unverifiable");
    expect(data.metadata.verdictAttempts).toBe(3);
  });

  it("'not true' stays pending, not confirmed", async () => {
    reply("ACCURATE: not true\nOUTCOME: Partly right.\nLESSON: Mixed.");
    await scorePendingPredictions();
    expect(db.update.mock.calls[0][0].data.status).toBe("pending");
  });

  it("an echoed placeholder 'true or false' stays pending, not confirmed", async () => {
    reply("ACCURATE: true or false\nOUTCOME: Revenue rose 12%.\nLESSON: Trend held.");
    await scorePendingPredictions();
    expect(db.update.mock.calls[0][0].data.status).toBe("pending");
  });

  it("a hedged 'true-ish' verdict stays pending, not confirmed", async () => {
    reply("ACCURATE: true-ish\nOUTCOME: Roughly right.\nLESSON: Close enough.");
    await scorePendingPredictions();
    expect(db.update.mock.calls[0][0].data.status).toBe("pending");
  });

  it("a reply with no ACCURATE line stays pending, not disproven", async () => {
    reply("OUTCOME: Revenue rose 12%.\nLESSON: Trend held.");
    await scorePendingPredictions();
    expect(db.update.mock.calls[0][0].data.status).toBe("pending");
  });

  it("underscores in the outcome and lesson are stored as written, not stripped", async () => {
    reply("ACCURATE: true\nOUTCOME: The utm_source tag was missing.\nLESSON: Check utm_source on every link.");
    await scorePendingPredictions();
    const data = db.update.mock.calls[0][0].data;
    expect(data.outcome).toBe("The utm_source tag was missing.");
    expect(data.metadata.lesson).toBe("Check utm_source on every link.");
    expect(remember.mock.calls[0][2]).toContain("utm_source");
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
