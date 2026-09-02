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
  loadIdentitySnapshotRaw: vi.fn(),
  measureLearningVelocity: vi.fn(),
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
