/**
 * Audit 2026-10-10 06-F15: a failed KNN read in calibrateAdvice returned [] and
 * the caller saw "no similar past advice", a confident cold start.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ queryRawUnsafe: vi.fn(), getEmbedding: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRawUnsafe: m.queryRawUnsafe } }));
vi.mock("@/lib/ai/provider", () => ({ getEmbedding: m.getEmbedding }));

import { calibrateAdvice } from "@/lib/ai/calibrated-confidence";

beforeEach(() => {
  vi.clearAllMocks();
  m.getEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("calibrateAdvice read failure", () => {
  it("a rejected KNN query says unknown, not cold start", async () => {
    m.queryRawUnsafe.mockRejectedValueOnce(new Error("vector index missing"));
    const out = await calibrateAdvice("raise the brake pad price by ten percent");
    expect(out.notes).not.toMatch(/no similar past advice/);
    expect(out.notes).toBe("calibration lookup failed: unknown, not cold start");
    expect(out.sampleSize).toBe(0);
  });

  it("CONTROL: an empty KNN result keeps the cold-start note", async () => {
    m.queryRawUnsafe.mockResolvedValueOnce([]);
    const out = await calibrateAdvice("raise the brake pad price by ten percent");
    expect(out.notes).toBe("no similar past advice with feedback found");
  });
});
