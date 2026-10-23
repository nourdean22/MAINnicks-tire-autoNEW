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
 * REAL — `cached()` / `invalidate()` are wrapped in spies that call
 * through, so (b2) can compare the keys the two sides use.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type AckRow = { key: string; metadata: { expiresAt: string | null } | null };

const mocks = vi.hoisted(() => ({
  loadIdentitySnapshot: vi.fn(),
  loadGhostAccuracy: vi.fn(),
  loadActiveSkills: vi.fn(),
  loadPendingSkills: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  remember: vi.fn(),
  cachedKeys: [] as string[],
  invalidatedKeys: [] as string[],
}));

vi.mock("@/lib/brain/identity-snapshot", () => ({
  loadIdentitySnapshot: mocks.loadIdentitySnapshot,
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
// Call-through wrappers: the real lib/utils/cache.ts runs, and each key
// it is handed is recorded so (b2) can pin write-key === invalidate-key.
vi.mock("@/lib/utils/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/cache")>();
  return {
    ...actual,
    cached: (key: string, ttl: number, compute: () => Promise<unknown>) => {
      mocks.cachedKeys.push(key);
      return actual.cached(key, ttl, compute);
    },
    invalidate: (key: string) => {
      mocks.invalidatedKeys.push(key);
      actual.invalidate(key);
    },
  };
});

import { buildNudgeContextBlock, dismissNudge } from "@/lib/brain/cross-system-nudge";

/** Ack rows the mocked `nudge_ack` query returns. Mutated per-test. */
let ackRows: AckRow[] = [];

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

  // One skill-candidate nudge fires (10 pending); every other source stays silent.
  // A nudge MUST fire — buildNudgeContextBlock returns "" on an empty
  // set, and "" === "" would false-green the identity assertion below.
  mocks.loadIdentitySnapshot.mockResolvedValue(null);
  mocks.loadGhostAccuracy.mockResolvedValue(null);
  mocks.loadActiveSkills.mockResolvedValue([]);
  mocks.loadPendingSkills.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `s${i}` })));
  mocks.findFirst.mockResolvedValue(null);
  mocks.findUnique.mockResolvedValue(null);
  mocks.findMany.mockImplementation(async (args: { where?: { category?: string } }) =>
    args?.where?.category === "nudge_ack" ? ackRows : [],
  );
  mocks.update.mockResolvedValue({});
  mocks.remember.mockResolvedValue(undefined);

  // Drop any L1 entry left by the previous test — deliberately via the
  // production dismiss path rather than a hardcoded cache key, so this
  // file goes red if the invalidate() call is ever removed from
  // dismissNudge.
  await dismissNudge({ source: "__test_reset__", text: "__test_reset__" });

  vi.clearAllMocks();
  mocks.cachedKeys.length = 0;
  mocks.invalidatedKeys.length = 0;
});

describe("computeNudges() 300s cache", () => {
  it("(a) second call re-uses the cached result — zero extra queries", async () => {
    const first = await buildNudgeContextBlock();
    const queriesAfterFirst = prismaRoundTrips();

    // Guard the assertion below against the empty-string false green.
    expect(first).not.toBe("");
    expect(first).toContain("unreviewed skill candidates");
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
    expect(first).toContain("unreviewed skill candidates");

    // Dismiss the exact nudge that is on screen. The real key
    // derivation runs inside dismissNudge and comes back to us, so the
    // ack row we stage is the one computeNudges will match against.
    const { key } = await dismissNudge({
      source: "skill",
      text: "10 unreviewed skill candidates · triage in /brain",
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
    expect(second).not.toContain("unreviewed skill candidates");
    expect(second).toBe("");
  });

  it("(b2) dismiss invalidates the exact key the cache was written under", async () => {
    await buildNudgeContextBlock();
    const cachedKey = mocks.cachedKeys[0];
    expect(cachedKey).toBeTruthy();

    await dismissNudge({ source: "skill", text: "anything" });

    // Same key on both sides — a rename that misses one side fails here.
    expect(mocks.invalidatedKeys).toContain(cachedKey);
  });
});
