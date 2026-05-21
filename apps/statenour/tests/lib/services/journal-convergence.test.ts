/**
 * Tests for lib/services/journal-convergence.ts — the journal
 * theme-detection layer (ADR-0013 · Phase D).
 *
 * Pre-2026-05-20 this module had zero coverage; the journal-slice
 * code-review fan-out flagged the gap. Coverage focus:
 *
 *  - Pure vector helpers — encodeCentroid / decodeCentroid /
 *    rollCentroid / bulkCentroid
 *  - detectConvergence — the greedy cosine-clustering core
 *  - pruneCandidatesForExistingThreads — regression-locks the
 *    2026-05-20 fix (commit 61b1d0f) that stopped clusterHash from
 *    being recomputed on prune. Recomputing minted a new BrainMemory
 *    key whenever a member was claimed by a thread, orphaning the
 *    prior candidate row.
 *
 * Vector math (cosineSimilarity / vectorCentroid) runs for real — only
 * @/lib/prisma and @/lib/ai/provider are mocked so the module imports
 * without a live DB or AI provider.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  journalThreadEntry: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    journalThreadEntry: mocks.journalThreadEntry,
  },
}));

// getEmbedding / aiChat are never called by the functions under test —
// stub them so the module (and embedding-utils) import without an AI
// provider configured.
vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: vi.fn(),
  aiChat: vi.fn(),
}));

import {
  decodeCentroid,
  encodeCentroid,
  rollCentroid,
  bulkCentroid,
  detectConvergence,
  pruneCandidatesForExistingThreads,
  type JournalEntryUnit,
  type ConvergenceCandidate,
  type EntrySource,
} from "@/lib/services/journal-convergence";

type RawCandidate = Omit<ConvergenceCandidate, "nameSuggestions">;

const FIXED_DATE = new Date("2026-05-01T12:00:00.000Z");

function mkEntry(entrySource: EntrySource, entryId: string): JournalEntryUnit {
  return {
    entrySource,
    entryId,
    text: `body text for ${entryId}`,
    excerpt: `excerpt ${entryId}`,
    createdAt: FIXED_DATE,
  };
}

function mkCandidate(
  clusterHash: string,
  members: JournalEntryUnit[],
): RawCandidate {
  return {
    clusterHash,
    size: members.length,
    coherence: 0.9,
    members,
    detectedAt: FIXED_DATE,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decodeCentroid", () => {
  it("parses a JSON number array", () => {
    expect(decodeCentroid("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("returns null for null input", () => {
    expect(decodeCentroid(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(decodeCentroid("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(decodeCentroid("not json")).toBeNull();
  });

  it("returns null for an empty array — no usable vector", () => {
    expect(decodeCentroid("[]")).toBeNull();
  });

  it("returns null when the JSON is not an array", () => {
    expect(decodeCentroid('{"x":1}')).toBeNull();
  });
});

describe("encodeCentroid", () => {
  it("serializes a vector to JSON", () => {
    expect(encodeCentroid([1, 2, 3])).toBe("[1,2,3]");
  });

  it("round-trips through decodeCentroid", () => {
    const vec = [0.5, -1.25, 3];
    expect(decodeCentroid(encodeCentroid(vec))).toEqual(vec);
  });
});

describe("rollCentroid", () => {
  it("returns a copy of the new vector when there is no prior centroid", () => {
    expect(rollCentroid(null, 5, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns the new vector when the prior count is zero", () => {
    expect(rollCentroid([9, 9, 9], 0, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns the new vector when dimensions mismatch", () => {
    expect(rollCentroid([1, 1], 3, [4, 4, 4])).toEqual([4, 4, 4]);
  });

  it("folds the new vector into the running mean", () => {
    // one prior member at [2,2,2], add [4,4,4] → mean [3,3,3]
    expect(rollCentroid([2, 2, 2], 1, [4, 4, 4])).toEqual([3, 3, 3]);
  });

  it("weights the prior centroid by its member count", () => {
    // 3 prior members at [0,0,0], add [4,8,12] → (0*3 + v) / 4
    expect(rollCentroid([0, 0, 0], 3, [4, 8, 12])).toEqual([1, 2, 3]);
  });

  it("does not mutate the input centroid", () => {
    const old = [2, 2, 2];
    rollCentroid(old, 1, [4, 4, 4]);
    expect(old).toEqual([2, 2, 2]);
  });
});

describe("bulkCentroid", () => {
  it("computes the element-wise mean", () => {
    expect(
      bulkCentroid([
        [0, 0],
        [4, 8],
      ]),
    ).toEqual([2, 4]);
  });

  it("returns the vector unchanged for identical inputs", () => {
    expect(
      bulkCentroid([
        [2, 4],
        [2, 4],
        [2, 4],
      ]),
    ).toEqual([2, 4]);
  });
});

describe("detectConvergence", () => {
  const opts = { minClusterSize: 3, cohesionThreshold: 0.75 };

  it("returns [] for no entries", () => {
    expect(detectConvergence([], new Map(), opts)).toEqual([]);
  });

  it("returns [] when there are fewer entries than minClusterSize", () => {
    const entries = [mkEntry("brain_dump", "a"), mkEntry("reflection", "b")];
    const vecs = new Map([
      ["brain_dump:a", [1, 0, 0]],
      ["reflection:b", [1, 0, 0]],
    ]);
    expect(detectConvergence(entries, vecs, opts)).toEqual([]);
  });

  it("returns [] when the entries have no embeddings", () => {
    const entries = [
      mkEntry("brain_dump", "a"),
      mkEntry("reflection", "b"),
      mkEntry("situation_log", "c"),
    ];
    expect(detectConvergence(entries, new Map(), opts)).toEqual([]);
  });

  it("detects one candidate from a tight cluster", () => {
    const entries = [
      mkEntry("brain_dump", "a"),
      mkEntry("reflection", "b"),
      mkEntry("situation_log", "c"),
    ];
    const vecs = new Map([
      ["brain_dump:a", [1, 0, 0]],
      ["reflection:b", [1, 0, 0]],
      ["situation_log:c", [1, 0, 0]],
    ]);
    const out = detectConvergence(entries, vecs, opts);
    expect(out).toHaveLength(1);
    expect(out[0].size).toBe(3);
    expect(out[0].coherence).toBe(1);
    expect(out[0].members).toHaveLength(3);
    expect(out[0].members.map((m) => m.entryId).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(out[0].clusterHash).toMatch(/^[0-9a-f]+$/);
    expect(out[0].detectedAt).toBeInstanceOf(Date);
  });

  it("returns [] when entries are mutually dissimilar", () => {
    const entries = [
      mkEntry("brain_dump", "a"),
      mkEntry("reflection", "b"),
      mkEntry("situation_log", "c"),
    ];
    const vecs = new Map([
      ["brain_dump:a", [1, 0, 0]],
      ["reflection:b", [0, 1, 0]],
      ["situation_log:c", [0, 0, 1]],
    ]);
    expect(detectConvergence(entries, vecs, opts)).toEqual([]);
  });

  it("rejects a formed cluster whose coherence is below the threshold", () => {
    const entries = [
      mkEntry("brain_dump", "a"),
      mkEntry("reflection", "b"),
      mkEntry("situation_log", "c"),
    ];
    // Spread cluster · pairwise cosine ~0.93 · joins at 0.70 but sits
    // below a 0.99 cohesion bar and clears a lenient 0.50 bar.
    const vecs = new Map([
      ["brain_dump:a", [1, 0, 0]],
      ["reflection:b", [1, 0.3, 0]],
      ["situation_log:c", [1, 0.6, 0]],
    ]);
    expect(
      detectConvergence(entries, vecs, {
        minClusterSize: 3,
        cohesionThreshold: 0.99,
        joinThreshold: 0.7,
      }),
    ).toEqual([]);
    const lenient = detectConvergence(entries, vecs, {
      minClusterSize: 3,
      cohesionThreshold: 0.5,
      joinThreshold: 0.7,
    });
    expect(lenient).toHaveLength(1);
  });

  it("produces a deterministic clusterHash across runs", () => {
    const entries = [
      mkEntry("brain_dump", "a"),
      mkEntry("reflection", "b"),
      mkEntry("situation_log", "c"),
    ];
    const vecs = new Map([
      ["brain_dump:a", [1, 0, 0]],
      ["reflection:b", [1, 0, 0]],
      ["situation_log:c", [1, 0, 0]],
    ]);
    const h1 = detectConvergence(entries, vecs, opts)[0].clusterHash;
    const h2 = detectConvergence(entries, vecs, opts)[0].clusterHash;
    expect(h1).toBe(h2);
  });

  it("clusterHash is independent of entry order", () => {
    const vecs = new Map([
      ["brain_dump:a", [1, 0, 0]],
      ["reflection:b", [1, 0, 0]],
      ["situation_log:c", [1, 0, 0]],
    ]);
    const forward = detectConvergence(
      [
        mkEntry("brain_dump", "a"),
        mkEntry("reflection", "b"),
        mkEntry("situation_log", "c"),
      ],
      vecs,
      opts,
    )[0].clusterHash;
    const reversed = detectConvergence(
      [
        mkEntry("situation_log", "c"),
        mkEntry("reflection", "b"),
        mkEntry("brain_dump", "a"),
      ],
      vecs,
      opts,
    )[0].clusterHash;
    expect(forward).toBe(reversed);
  });

  it("sorts multiple candidates by coherence descending", () => {
    const entries = [
      mkEntry("brain_dump", "a1"),
      mkEntry("brain_dump", "a2"),
      mkEntry("brain_dump", "a3"),
      mkEntry("reflection", "b1"),
      mkEntry("reflection", "b2"),
      mkEntry("reflection", "b3"),
    ];
    const vecs = new Map([
      ["brain_dump:a1", [1, 0, 0]],
      ["brain_dump:a2", [1, 0, 0]],
      ["brain_dump:a3", [1, 0, 0]],
      ["reflection:b1", [0, 1, 0]],
      ["reflection:b2", [0, 1, 0]],
      ["reflection:b3", [0, 0.9, 0.4]],
    ]);
    const out = detectConvergence(entries, vecs, {
      minClusterSize: 3,
      cohesionThreshold: 0.7,
      joinThreshold: 0.7,
    });
    expect(out).toHaveLength(2);
    expect(out[0].coherence).toBeGreaterThanOrEqual(out[1].coherence);
  });
});

describe("pruneCandidatesForExistingThreads", () => {
  it("returns [] for no candidates without querying the DB", async () => {
    const out = await pruneCandidatesForExistingThreads([]);
    expect(out).toEqual([]);
    expect(mocks.journalThreadEntry.findMany).not.toHaveBeenCalled();
  });

  it("keeps every member when none belong to an active thread", async () => {
    mocks.journalThreadEntry.findMany.mockResolvedValue([]);
    const members = [
      mkEntry("brain_dump", "a"),
      mkEntry("reflection", "b"),
      mkEntry("situation_log", "c"),
      mkEntry("decision_replay", "d"),
    ];
    const out = await pruneCandidatesForExistingThreads([
      mkCandidate("hash-abcd", members),
    ]);
    expect(mocks.journalThreadEntry.findMany).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0].members).toHaveLength(4);
    expect(out[0].clusterHash).toBe("hash-abcd");
  });

  it("keeps the ORIGINAL clusterHash after pruning claimed members", async () => {
    // Regression lock · commit 61b1d0f. Pre-fix the hash was recomputed
    // from the pruned member set, so a member getting claimed by a
    // thread minted a new BrainMemory key and orphaned the prior row.
    mocks.journalThreadEntry.findMany.mockResolvedValue([
      { entrySource: "brain_dump", entryId: "a" },
    ]);
    const members = [
      mkEntry("brain_dump", "a"),
      mkEntry("reflection", "b"),
      mkEntry("situation_log", "c"),
      mkEntry("decision_replay", "d"),
    ];
    const out = await pruneCandidatesForExistingThreads([
      mkCandidate("stable-hash-xyz", members),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].clusterHash).toBe("stable-hash-xyz");
    expect(out[0].size).toBe(3);
    expect(out[0].members.map((m) => m.entryId).sort()).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("drops a candidate that falls below minClusterSize after pruning", async () => {
    mocks.journalThreadEntry.findMany.mockResolvedValue([
      { entrySource: "brain_dump", entryId: "a" },
    ]);
    const members = [
      mkEntry("brain_dump", "a"),
      mkEntry("reflection", "b"),
      mkEntry("situation_log", "c"),
    ];
    const out = await pruneCandidatesForExistingThreads([
      mkCandidate("hash-small", members),
    ]);
    expect(out).toEqual([]);
  });
});
