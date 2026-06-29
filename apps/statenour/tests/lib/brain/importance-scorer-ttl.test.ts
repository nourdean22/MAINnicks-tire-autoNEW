/**
 * Importance Scorer TTL & Tiebreaker tests · Track B.3
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: vi.fn(() => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

import { scoreMessage, persistIfImportant } from "@/lib/brain/importance-scorer";

describe("importance-scorer TTL & tiebreakers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("scoreMessage (deterministic tiebreakers)", () => {
    it("deterministically picks the primary category on equal-weight ties using localeCompare", () => {
      // "i decided i'm going to" -> DECIDE_RX (weight 3)
      // "i promise i'll finish tomorrow" -> COMMIT_RX (weight 3)
      // Both match decision and commitment (both weight 3).
      // LocaleCompare sort: "commitment".localeCompare("decision") is negative, so "commitment" comes first!
      const content = "I decided I'm going to do the task and I promise I'll finish tomorrow.";
      const result = scoreMessage(content);

      expect(result.categories).toContain("decision");
      expect(result.categories).toContain("commitment");
      expect(result.primary).toBe("commitment"); // alphabet: c < d
    });
  });

  describe("persistIfImportant TTL and confidence floors", () => {
    it("sets expiresAt to 30 days in the future for score < 8 (borderline)", async () => {
      // Score will be 3 (insight) + 2 (pain) = 5 (threshold: 5 to trigger persist)
      const content = "I keep noticing that when I wake up early, I am much more focused, but today I am super stuck and frustrated.";
      mocks.brainMemory.upsert.mockResolvedValue({ id: "m1" });

      const result = await persistIfImportant("msg-1", content, "conv-1", 5);

      expect(result.persisted).toBe(true);
      expect(result.score).toBe(5);

      const upsertArgs = mocks.brainMemory.upsert.mock.calls[0][0];
      expect(upsertArgs.create.confidence).toBe(0.5); // floored to 0.5 (was 0.55 + (5 - 7)*0.1 = 0.35)
      expect(upsertArgs.create.expiresAt).toBeInstanceOf(Date);
      
      const expDiff = upsertArgs.create.expiresAt.getTime() - (Date.now() + 30 * 86_400_000);
      expect(Math.abs(expDiff)).toBeLessThan(5000); // within 5 seconds
    });

    it("sets expiresAt to null for score >= 8 (permanent)", async () => {
      // Score will be 3 (decision) + 3 (commitment) + 3 (insight) + 2 (length) = 11 (capped at 10)
      const content = "I decided I'm locking in the design and I promise I will finish it tomorrow morning, because I realized I always drift when I don't set a hard target.";
      mocks.brainMemory.upsert.mockResolvedValue({ id: "m2" });

      const result = await persistIfImportant("msg-2", content, "conv-2", 6);

      expect(result.persisted).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(8);

      const upsertArgs = mocks.brainMemory.upsert.mock.calls[0][0];
      expect(upsertArgs.create.expiresAt).toBeNull();
      expect(upsertArgs.create.confidence).toBeGreaterThanOrEqual(0.65);
    });
  });
});
