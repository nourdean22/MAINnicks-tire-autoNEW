/**
 * LANE-FAILURE PROVENANCE -- 2026-09-10.
 *
 * Review #2267 P2, and the reviewer was right.
 *
 * The provenance work replaced "hits: [] means nothing matched" with a
 * three-state answer -- and then recreated the identical defect one
 * level down. Each retrieval lane catches its own error and returns [],
 * which is correct for resilience: one dead lane must not take the turn
 * down. But the provenance mapper inferred ZERO from `scored.length`, so
 * during a Postgres or pgvector outage the panel would have said
 * "searched memory, nothing matched" when nothing was searched at all.
 *
 * That is the exact inversion the whole change exists to remove, which
 * is why it needs a test rather than a comment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbDown = () => Promise.reject(new Error("db down"));

// Every lane routes through one of these. Rejecting all three is the
// total-outage case; the surviving-lane case is covered below.
const queryRawUnsafe = vi.fn(dbDown);
const transaction = vi.fn((fn: (tx: unknown) => unknown) =>
  Promise.resolve(fn({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: async () => 0 })),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a),
    $executeRawUnsafe: async () => 0,
    $transaction: (fn: (tx: unknown) => unknown) => transaction(fn),
    brainMemory: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
    systemMetric: { create: async () => ({}) },
  },
}));
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: false }) }));

import { recallMemoriesForQuery, describeRecallState } from "@/lib/brain/memory-recall";

// A real-length vector so the padding + finiteness guards pass and the
// lanes are actually reached.
const EMBEDDING = Array.from({ length: 1536 }, () => 0.01);

beforeEach(() => {
  queryRawUnsafe.mockClear();
  queryRawUnsafe.mockImplementation(dbDown);
});

describe("a total retrieval outage is ERROR, never a measured ZERO", () => {
  it("reports ERROR when every lane fails", async () => {
    const report = await recallMemoriesForQuery("what did I decide about the taper plan", {
      embedding: EMBEDDING,
      limit: 5,
    });
    expect(report.hits).toHaveLength(0);
    // The whole point: empty hits, but NOT a measured zero.
    expect(report.provenance).toBe("ERROR");
    expect(report.provenanceReason).toMatch(/every retrieval lane failed/i);
  });

  it("the operator-facing line says the state is unknown, not empty", () => {
    const view = describeRecallState(0, "ERROR", "every retrieval lane failed (main, durable, lexical)");
    expect(view.countIsMeaningful).toBe(false);
    expect(view.headline).toMatch(/not empty/i);
    expect(view.headline).not.toMatch(/\b0\b/);
  });
});

describe("a partial outage still serves results, and says so", () => {
  it("surviving lanes produce hits, with the failure named in the reason", async () => {
    // Only the lexical lane answers; the vector lanes are dead.
    queryRawUnsafe.mockImplementation((sql: unknown) => {
      if (typeof sql === "string" && sql.includes("websearch_to_tsquery")) {
        return Promise.resolve([
          {
            memory_id: "m1",
            category: "preferences",
            key: "k",
            content: "the taper plan starts monday",
            confidence: 0.8,
            seen_count: 1,
            last_seen: new Date(),
            created_at: new Date(),
            distance: 0.2,
            source: "manual",
            created_by: "user",
          },
        ]);
      }
      return dbDown();
    });

    const report = await recallMemoriesForQuery("the taper plan", {
      embedding: EMBEDDING,
      limit: 5,
    });

    expect(report.hits.length).toBeGreaterThan(0);
    // Hits exist, so this is OK -- but the degradation must be visible,
    // or a chronically dead vector lane hides behind the lexical one
    // forever. Recovery that conceals failure is concealment.
    expect(report.provenance).toBe("OK");
    expect(report.provenanceReason).toMatch(/lane\(s\) failed/i);
  });
});
