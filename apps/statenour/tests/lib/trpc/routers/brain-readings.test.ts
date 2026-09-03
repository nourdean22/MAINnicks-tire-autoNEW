/**
 * Router degradation canaries · 2026-09-02, rewritten same day.
 *
 * Three /brain readings used to swallow read failures into a shape that was
 * indistinguishable from "nothing to report":
 *
 *   · brain.calibrationSummary  -> { resolved: 0, verdict: "unknown" }
 *   · brain.identityDelta       -> null
 *   · journal.learningVelocity  -> null
 *
 * Each consuming tile hides itself on exactly that value, so a broken Prisma
 * read rendered as a clean, healthy dashboard.
 *
 * ── WHY THIS FILE WAS REWRITTEN ──────────────────────────────────────
 * The first version asserted SOURCE TEXT: 28 string matches against sliced
 * procedure bodies, including `expect(body()).not.toContain("catch")` and a
 * match on the exact formatting of a call expression. That violates this
 * repo's own rule -- assert BEHAVIOUR, never presence -- in the specific way
 * the rule exists to prevent: `not.toContain("catch")` fails on any legitimate
 * catch added later, and passes for a swallow spelled `?? null`. The
 * formatting match would have failed on a reformat that changed nothing.
 *
 * It also could not have been trusted for the thing it claimed. A procedure
 * whose source lacks the word "catch" can still resolve to a fabricated empty
 * result; only calling it proves otherwise.
 *
 * `appRouter.createCaller` is the repo's established way to invoke a procedure
 * in a test (tests/trpc/mutation-gate.test.ts, tests/api/journal.test.ts), so
 * these now REJECT or RESOLVE for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  summarizeCalibration: vi.fn(),
  measureLearningVelocity: vi.fn(),
  // identityDelta reads the module-level prisma client (brain.ts:1797), not
  // ctx.db, so it is driven from here rather than through the caller.
  identitySnapshotFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { identitySnapshot: { findFirst: mocks.identitySnapshotFindFirst } },
}));

vi.mock("@/lib/brain/calibration", () => ({
  summarizeCalibration: mocks.summarizeCalibration,
}));
vi.mock("@/lib/brain/learning-velocity", () => ({
  measureLearningVelocity: mocks.measureLearningVelocity,
  snapshotLearningVelocity: vi.fn(),
}));

import { appRouter } from "@/lib/trpc/root";

type Caller = ReturnType<typeof appRouter.createCaller>;

function operatorCaller(db: unknown): Caller {
  return appRouter.createCaller({
    session: {
      id: "operator-1",
      email: "operator@statenour.local",
      role: "operator",
    },
    db: db as never,
  } as never);
}

/** A prisma double whose every reachable read rejects. */
const DEAD_DB = new Proxy(
  {},
  {
    get: () =>
      new Proxy(
        {},
        { get: () => () => Promise.reject(new Error("db down")) },
      ),
  },
);

describe("brain.calibrationSummary · a failed read is not an empty window", () => {
  beforeEach(() => vi.clearAllMocks());

  it("REJECTS when the helper throws, instead of fabricating resolved:0", async () => {
    // The defect, behaviourally: the tile hides itself on resolved === 0, so
    // returning that shape turned a broken read into a clean dashboard.
    mocks.summarizeCalibration.mockRejectedValue(new Error("db down"));
    const caller = operatorCaller(DEAD_DB);
    await expect(caller.brain.calibrationSummary({ days: 30 })).rejects.toThrow(
      "db down",
    );
  });

  it("PLANTED POSITIVE · a genuinely empty window still resolves to resolved:0", async () => {
    // Without this, a procedure that rethrew unconditionally would satisfy the
    // test above while destroying the healthy path.
    mocks.summarizeCalibration.mockResolvedValue({
      resolved: 0,
      confirmed: 0,
      verdict: "unknown",
    });
    const caller = operatorCaller(DEAD_DB);
    await expect(
      caller.brain.calibrationSummary({ days: 30 }),
    ).resolves.toMatchObject({ resolved: 0, verdict: "unknown" });
  });

  it("passes the caller's window through rather than a hardcoded one", async () => {
    mocks.summarizeCalibration.mockResolvedValue({
      resolved: 1,
      confirmed: 1,
      verdict: "calibrated",
    });
    const caller = operatorCaller(DEAD_DB);
    await caller.brain.calibrationSummary({ days: 7 });
    expect(mocks.summarizeCalibration).toHaveBeenCalledWith(
      expect.objectContaining({ days: 7 }),
    );
  });
});

describe("journal.learningVelocity · a failed read is not a missing reading", () => {
  beforeEach(() => vi.clearAllMocks());

  it("REJECTS when the helper throws, instead of resolving null", async () => {
    mocks.measureLearningVelocity.mockRejectedValue(new Error("db down"));
    const caller = operatorCaller(DEAD_DB);
    await expect(caller.journal.learningVelocity()).rejects.toThrow("db down");
  });

  it("PLANTED POSITIVE · a successful read still resolves", async () => {
    // Shape taken from the mapping at lib/trpc/routers/journal.ts:358-369,
    // not invented — a fixture that does not match the reader proves nothing
    // about the reader.
    mocks.measureLearningVelocity.mockResolvedValue({
      memoriesCreated: { thisWeek: 3, delta: 1 },
      memoryGrowth30d: { last30d: 3, prior30d: 2, pctChange: 50 },
      connections: { last30d: 0 },
      contradictions: { resolvedLast30d: 0 },
      wisdomCreated: { last30d: 1 },
      healthScore: 10,
      healthScoreMax: 85,
    });
    const caller = operatorCaller(DEAD_DB);
    // Assert a mapped FIELD, not just "defined" — a procedure returning {}
    // would satisfy toBeDefined while dropping every reading.
    await expect(caller.journal.learningVelocity()).resolves.toMatchObject({
      memoriesThisWeek: 3,
      memoryPctChange30d: 50,
      healthScoreMax: 85,
    });
  });
});

/**
 * 2026-09-02, from review (#2092) · RESTORED.
 *
 * My rewrite of this file claimed to cover three degraded readings and covered
 * two: `identityDelta` lost its only canary, so re-introducing the old
 * `catch { return null }` swallow would have passed the suite. I deleted
 * coverage while reporting that I had improved it — the review caught it.
 *
 * It reads prisma directly (brain.ts:1797), so unlike its two neighbours it is
 * driven through the caller's db rather than a mocked helper.
 */
describe("brain.identityDelta · a failed read is not a missing delta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("REJECTS when the snapshot read throws, instead of resolving null", async () => {
    // The tile hides itself on null, so a swallowed read rendered as
    // "identity has not moved" — indistinguishable from a healthy quiet week.
    mocks.identitySnapshotFindFirst.mockRejectedValue(new Error("db down"));
    await expect(
      operatorCaller(DEAD_DB).brain.identityDelta(),
    ).rejects.toThrow("db down");
  });

  it("PLANTED POSITIVE · a genuinely absent row still resolves to null", async () => {
    mocks.identitySnapshotFindFirst.mockResolvedValue(null);
    await expect(operatorCaller(DEAD_DB).brain.identityDelta()).resolves.toBeNull();
  });

  it("a BLANK delta is also a real null, not an error", async () => {
    // brain.ts:1801 treats whitespace-only as absent. Pinned so the reject
    // path above cannot be widened into "anything falsy throws".
    mocks.identitySnapshotFindFirst.mockResolvedValue({
      deltaFromLast: "   ",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      date: "2026-09-01",
    });
    await expect(operatorCaller(DEAD_DB).brain.identityDelta()).resolves.toBeNull();
  });

  it("PLANTED POSITIVE · a real delta comes back mapped", async () => {
    // Without this, a procedure returning null unconditionally would satisfy
    // both null tests above while deleting the reading entirely.
    mocks.identitySnapshotFindFirst.mockResolvedValue({
      deltaFromLast: "focus up, tempo down",
      createdAt: new Date("2026-09-01T12:00:00Z"),
      date: "2026-09-01",
    });
    await expect(operatorCaller(DEAD_DB).brain.identityDelta()).resolves.toMatchObject({
      delta: "focus up, tempo down",
      date: "2026-09-01",
    });
  });
});
