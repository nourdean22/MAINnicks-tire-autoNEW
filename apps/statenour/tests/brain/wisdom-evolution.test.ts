/**
 * v10.0.411 · wisdom-evolution regression armor.
 *
 * Mocks the Prisma calls so we can verify the candidate-selection
 * logic (stale + redundant + low-trust) without booting the DB.
 *
 * Why this matters · the evolution panel surfaces operator-confirm
 * deprecate buttons. If the underlying selection logic regresses
 * (e.g. wrong threshold direction, off-by-one on days), the
 * operator gets shown wisdoms that shouldn't be candidates.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock prisma BEFORE importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: vi.fn(),
    },
    vectorEmbedding: {
      findMany: vi.fn(),
    },
  },
}));

// Mock topic tagger so we can control sharedTopics deterministically
vi.mock("@/lib/brain/wisdom-topic-tagger", () => ({
  tagWisdomTopics: vi.fn((content: string) => {
    if (content.includes("money")) return ["money", "strategy"];
    if (content.includes("focus")) return ["execution", "self"];
    if (content.includes("orthogonal")) return ["execution"];
    return [];
  }),
  topicLabel: (t: string) => t,
}));

import {
  findStaleCandidates,
  findRedundantPairs,
  findLowTrustCandidates,
} from "@/lib/brain/wisdom-evolution";
import { prisma } from "@/lib/prisma";

const findManyBrain = prisma.brainMemory.findMany as unknown as ReturnType<typeof vi.fn>;
const findManyEmbed = prisma.vectorEmbedding.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  findManyBrain.mockReset();
  findManyEmbed.mockReset();
});

describe("findStaleCandidates · last_seen + confidence gating", () => {
  it("returns candidates with daysSinceLastSeen + reason", async () => {
    const sixtyOneDaysAgo = new Date(Date.now() - 61 * 86_400_000);
    findManyBrain.mockResolvedValueOnce([
      {
        id: "w1",
        key: "wisdom_test_1",
        content: "Some old wisdom",
        confidence: 0.4,
        lastSeen: sixtyOneDaysAgo,
      },
    ]);

    const out = await findStaleCandidates();
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("stale");
    expect(out[0].id).toBe("w1");
    expect(out[0].daysSinceLastSeen).toBeGreaterThanOrEqual(60);
    expect(out[0].reason).toContain("Last seen");
    expect(out[0].reason).toContain("confidence");
  });

  it("queries with category=wisdom + deletedAt null", async () => {
    findManyBrain.mockResolvedValueOnce([]);
    await findStaleCandidates();
    const callArg = findManyBrain.mock.calls[0][0];
    expect(callArg.where.category).toBe("wisdom");
    expect(callArg.where.deletedAt).toBeNull();
  });

  it("uses lt (strictly less than) on confidence", async () => {
    findManyBrain.mockResolvedValueOnce([]);
    await findStaleCandidates(60, 0.5);
    const callArg = findManyBrain.mock.calls[0][0];
    expect(callArg.where.confidence).toEqual({ lt: 0.5 });
  });
});

describe("findRedundantPairs · cosine + topic gating", () => {
  it("returns empty when fewer than 2 wisdoms", async () => {
    findManyBrain.mockResolvedValueOnce([]);
    const out = await findRedundantPairs();
    expect(out).toEqual([]);
    expect(findManyEmbed).not.toHaveBeenCalled();
  });

  it("ranks higher-confidence as keep", async () => {
    const lowVec = JSON.stringify([1, 0, 0, 0]);
    const highVec = JSON.stringify([1, 0, 0, 0]); // identical · cos=1.0
    findManyBrain.mockResolvedValueOnce([
      { id: "low", key: "wisdom_test_low", content: "money advice", confidence: 0.6, lastSeen: new Date() },
      { id: "high", key: "wisdom_test_high", content: "money strategy", confidence: 0.9, lastSeen: new Date() },
    ]);
    findManyEmbed.mockResolvedValueOnce([
      { sourceId: "low", embedding: lowVec },
      { sourceId: "high", embedding: highVec },
    ]);

    const out = await findRedundantPairs();
    expect(out).toHaveLength(1);
    expect(out[0].keepId).toBe("high"); // 0.9 > 0.6
    expect(out[0].mergeId).toBe("low");
    expect(out[0].similarity).toBeCloseTo(1.0, 1);
    expect(out[0].sharedTopics).toContain("money");
  });

  it("requires shared topics — pairs with cosine ≥ 0.92 but no shared topic skip", async () => {
    // Two wisdoms with identical embeddings but disjoint topics shouldn't pair.
    findManyBrain.mockResolvedValueOnce([
      { id: "a", key: "wisdom_test_a", content: "money flow", confidence: 0.7, lastSeen: new Date() },
      { id: "b", key: "wisdom_test_b", content: "orthogonal item", confidence: 0.8, lastSeen: new Date() },
    ]);
    const sameVec = JSON.stringify([1, 0, 0]);
    findManyEmbed.mockResolvedValueOnce([
      { sourceId: "a", embedding: sameVec },
      { sourceId: "b", embedding: sameVec },
    ]);

    const out = await findRedundantPairs();
    expect(out).toEqual([]); // tagWisdomTopics mocked → "money" vs "execution" no overlap
  });

  it("rejects pairs below the similarity threshold", async () => {
    findManyBrain.mockResolvedValueOnce([
      { id: "a", key: "wisdom_a", content: "money tactic", confidence: 0.7, lastSeen: new Date() },
      { id: "b", key: "wisdom_b", content: "money pattern", confidence: 0.7, lastSeen: new Date() },
    ]);
    // Orthogonal vectors → cos = 0
    findManyEmbed.mockResolvedValueOnce([
      { sourceId: "a", embedding: JSON.stringify([1, 0]) },
      { sourceId: "b", embedding: JSON.stringify([0, 1]) },
    ]);
    const out = await findRedundantPairs();
    expect(out).toEqual([]);
  });
});

describe("findLowTrustCandidates · confidence band + recency", () => {
  it("queries within confidence band [0.2, 0.5)", async () => {
    findManyBrain.mockResolvedValueOnce([]);
    await findLowTrustCandidates();
    const callArg = findManyBrain.mock.calls[0][0];
    expect(callArg.where.confidence).toEqual({ lt: 0.5, gte: 0.2 });
  });

  it("returns candidates with conf-mention reason", async () => {
    findManyBrain.mockResolvedValueOnce([
      {
        id: "lt1",
        key: "wisdom_lowtrust_1",
        content: "doubtful wisdom",
        confidence: 0.35,
        lastSeen: new Date(),
      },
    ]);
    const out = await findLowTrustCandidates();
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("low_trust");
    expect(out[0].reason).toContain("0.35");
    expect(out[0].reason.toLowerCase()).toContain("review");
  });
});
