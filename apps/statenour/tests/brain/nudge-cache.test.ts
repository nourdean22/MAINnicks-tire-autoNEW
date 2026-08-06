/**
 * 2026-08-06 · pins the computeNudges() 300s cache AND its invalidation.
 *
 * Why both, and why the second test is the one that matters: the cache
 * exists because computeNudges cost ~12 Postgres round-trips on a chat
 * hot path whose measured p50 time-to-first-token was 10,453ms. But a
 * cache without invalidation is a regression, not an optimization — the
 * operator taps dismiss in the NudgePanel and the nudge walks back onto
 * the screen for up to five minutes. Test (a) alone passes on a cache
 * that never invalidates, so it is not sufficient on its own.
 *
 * Everything computeNudges reads is mocked; the cache module itself is
 * REAL. Only the Redis L2 is stubbed, so the assertions land on the
 * actual `cached()` / `invalidate()` behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type AckRow = { key: string; metadata: { expiresAt: string | null } | null };
type ContradictionRow = { id: string; content: string; createdAt: Date };

const mocks = vi.hoisted(() => ({
  loadIdentitySnapshot: vi.fn(),
  countUnresolved: vi.fn(),
  loadGhostAccuracy: vi.fn(),
  loadActiveSkills: vi.fn(),
  loadPendingSkills: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  remember: vi.fn(),
  cleanupResolvedContradiction: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  redisDelPrefix: vi.fn(),
}));

vi.mock("@/lib/brain/identity-snapshot", () => ({
  loadIdentitySnapshot: mocks.loadIdentitySnapshot,
}));
// Partial mock ON PURPOSE. Test (c) exercises the REAL
// `resolveContradiction` — a hand-rolled stand-in would prove only that
// the stand-in calls invalidate. Only `countUnresolved` is replaced, so
// the test can drive the count the nudge text is built from.
vi.mock("@/lib/brain/contradiction-surfacer", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/brain/contradiction-surfacer")
  >();
  return { ...actual, countUnresolved: mocks.countUnresolved };
});
// Pulled in only by `surfaceContradictions` (not on the resolve path);
// stubbed so the real module doesn't drag @/lib/ai/provider in.
vi.mock("@/lib/brain/embedding-utils", () => ({ semanticSearch: vi.fn() }));
vi.mock("@/lib/brain/contradiction-cleanup", () => ({
  cleanupResolvedContradiction: mocks.cleanupResolvedContradiction,
}));
vi.mock("@/lib/brain/ghost-nick", () => ({
  loadGhostAccuracy: mocks.loadGhostAccuracy,
}));
vi.mock("@/lib/brain/skill-extractor", () => ({
  loadActiveSkills: mocks.loadActiveSkills,
  loadPendingSkills: mocks.loadPendingSkills,
}));
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: mocks.remember },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));
// L2 stub — keeps the test hermetic (no live Redis) while leaving the
// real two-tier logic in lib/utils/cache.ts under test.
vi.mock("@/lib/utils/redis", () => ({
  redisGet: mocks.redisGet,
  redisSet: mocks.redisSet,
  redisDel: mocks.redisDel,
  redisDelPrefix: mocks.redisDelPrefix,
}));

import { buildNudgeContextBlock, dismissNudge } from "@/lib/brain/cross-system-nudge";
import { resolveContradiction } from "@/lib/brain/contradiction-surfacer";

/** Ack rows the mocked `nudge_ack` query returns. Mutated per-test. */
let ackRows: AckRow[] = [];

/** The contradiction row `resolveContradiction` loads. Set in test (c). */
let contradictionRow: ContradictionRow | null = null;

/** Every Postgres round-trip computeNudges makes, across all methods. */
function prismaRoundTrips(): number {
  return (
    mocks.findFirst.mock.calls.length +
    mocks.findMany.mock.calls.length +
    mocks.findUnique.mock.calls.length
  );
}

beforeEach(async () => {
  ackRows = [];
  contradictionRow = null;

  // One contradiction nudge fires; every other source stays silent.
  // A nudge MUST fire — buildNudgeContextBlock returns "" on an empty
  // set, and "" === "" would false-green the identity assertion below.
  mocks.loadIdentitySnapshot.mockResolvedValue(null);
  mocks.countUnresolved.mockResolvedValue(3);
  mocks.loadGhostAccuracy.mockResolvedValue(null);
  mocks.loadActiveSkills.mockResolvedValue([]);
  mocks.loadPendingSkills.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(null);
  // Two callers share findUnique: computeNudges' decision_drift lookup
  // (wants null) and resolveContradiction's row load (wants the row).
  mocks.findUnique.mockImplementation(
    async (args: { where?: { category_key?: { category?: string } } }) =>
      args?.where?.category_key?.category === "contradiction" ? contradictionRow : null,
  );
  mocks.findMany.mockImplementation(async (args: { where?: { category?: string } }) =>
    args?.where?.category === "nudge_ack" ? ackRows : [],
  );
  mocks.update.mockResolvedValue({});
  mocks.cleanupResolvedContradiction.mockResolvedValue(undefined);
  mocks.remember.mockResolvedValue(undefined);
  mocks.redisGet.mockResolvedValue(null);
  mocks.redisSet.mockResolvedValue(true);
  mocks.redisDel.mockResolvedValue(true);

  // Drop any L1 entry left by the previous test — deliberately via the
  // production dismiss path rather than a hardcoded cache key, so this
  // file goes red if the invalidate() call is ever removed from
  // dismissNudge.
  await dismissNudge({ source: "__test_reset__", text: "__test_reset__" });

  vi.clearAllMocks();
});

describe("computeNudges() 300s cache", () => {
  it("(a) second call re-uses the cached result — zero extra queries", async () => {
    const first = await buildNudgeContextBlock();
    const queriesAfterFirst = prismaRoundTrips();

    // Guard the assertion below against the empty-string false green.
    expect(first).not.toBe("");
    expect(first).toContain("unresolved contradiction");
    expect(mocks.loadIdentitySnapshot).toHaveBeenCalledTimes(1);
    expect(queriesAfterFirst).toBeGreaterThan(0);

    const second = await buildNudgeContextBlock();

    // The compute body ran exactly ONCE across both calls.
    expect(mocks.loadIdentitySnapshot).toHaveBeenCalledTimes(1);
    expect(prismaRoundTrips()).toBe(queriesAfterFirst);
    expect(second).toBe(first);
  });

  it("(b) dismissNudge() invalidates — the next call DOES re-query, and the dismissed nudge is gone", async () => {
    const first = await buildNudgeContextBlock();
    const queriesAfterFirst = prismaRoundTrips();
    expect(first).toContain("unresolved contradiction");

    // Dismiss the exact nudge that is on screen. The real key
    // derivation runs inside dismissNudge and comes back to us, so the
    // ack row we stage is the one computeNudges will match against.
    const { key } = await dismissNudge({
      source: "contradiction",
      text: "3 unresolved contradictions · reconcile in /brain",
      until: "7d",
    });
    ackRows.push({
      key,
      metadata: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });

    const second = await buildNudgeContextBlock();

    // Re-queried: the compute body ran a SECOND time.
    expect(mocks.loadIdentitySnapshot).toHaveBeenCalledTimes(2);
    expect(prismaRoundTrips()).toBe(queriesAfterFirst * 2);

    // And the user-visible outcome: the dismissed nudge is gone
    // immediately, not 300 seconds later.
    expect(second).not.toContain("unresolved contradiction");
    expect(second).toBe("");
  });

  it("(c) resolveContradiction() invalidates too — the resolved one is gone from the very next block", async () => {
    const first = await buildNudgeContextBlock();
    expect(first).toContain("3 unresolved contradictions");

    // The row the operator is about to resolve.
    contradictionRow = {
      id: "bm_contradiction_1",
      content: JSON.stringify({
        new_memory_id: "mem_new",
        old_memory_id: "mem_old",
        similarity: 0.91,
        signal: "negation",
        new_excerpt: "shutting the ads down",
        old_excerpt: "doubling the ad budget",
        days_apart: 21,
        surfaced_at: new Date().toISOString(),
      }),
      createdAt: new Date(),
    };
    // Post-resolve the DB holds one fewer unresolved contradiction —
    // this is the delta the nudge must reflect immediately.
    mocks.countUnresolved.mockResolvedValue(2);

    const resolved = await resolveContradiction("bm_contradiction_1", "current_wins");

    // Guard the assertions below: resolveContradiction returns null on a
    // missing/corrupt row and short-circuits BEFORE the write and before
    // the invalidation, which would make the rest of this test vacuous.
    expect(resolved).not.toBeNull();
    // The status flip actually landed — assert the mechanism, not the call.
    const statusFlip = mocks.update.mock.calls.find(
      (c) => (c[0] as { where?: { category_key?: { key?: string } } })?.where?.category_key?.key,
    );
    expect(statusFlip).toBeDefined();
    expect(
      JSON.parse((statusFlip![0] as { data: { content: string } }).data.content).status,
    ).toBe("current_wins");

    const second = await buildNudgeContextBlock();

    // The user-visible outcome FIRST — it is the assertion that names
    // the actual defect, so it is the one a negative control should
    // report. The count drops now, not 300 seconds from now.
    expect(second).toContain("2 unresolved contradictions");
    expect(second).not.toContain("3 unresolved contradictions");

    // Re-queried: the compute body ran a SECOND time.
    expect(mocks.loadIdentitySnapshot).toHaveBeenCalledTimes(2);
  });

  it("(b2) invalidation clears L2 (Redis), not just the in-process L1", async () => {
    await buildNudgeContextBlock();
    const cachedKey = mocks.redisSet.mock.calls[0]?.[0];
    expect(cachedKey).toBeTruthy();

    await dismissNudge({ source: "contradiction", text: "anything" });

    // Same key on both sides — a rename that misses one side fails here.
    expect(mocks.redisDel).toHaveBeenCalledWith(cachedKey);
  });
});
