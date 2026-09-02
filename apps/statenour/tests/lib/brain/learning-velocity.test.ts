/**
 * Learning-velocity metrics-honesty canaries · 2026-09-02
 *
 * Every test here fails if the corresponding fix is reverted. They assert
 * BEHAVIOUR (the number a given database state produces), not the presence
 * of a field or a comment.
 *
 * The prisma mock ROUTES on the `where` clause rather than on call order, so
 * a test that says "the 30d contradiction count is filtered by updatedAt" is
 * actually proving the query carries that filter: drop the filter and the
 * router hands back the lifetime number and the assertion fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

interface Counts {
  memories7d: number;
  memoriesPrior7d: number;
  memories30d: number;
  memoriesPrior30d: number;
  memoriesTotal: number;
  wisdomTotal: number;
  wisdom30d: number;
  predConfirmed: number;
  predDisproven: number;
  predConfirmedOld: number;
  predDisprovenOld: number;
  chainsTotal: number;
  chains30d: number;
  contraResolvedAllTime: number;
  contraResolved30d: number;
  contraUnresolved: number;
  /** Soft-deleted (dismissed) rows -- only excluded when deletedAt is filtered. */
  contraDismissedResolved: number;
  contraDismissedUnresolved: number;
  edgesTotal: number;
  edges30d: number;
}

const BASE: Counts = {
  memories7d: 10,
  memoriesPrior7d: 10,
  memories30d: 40,
  memoriesPrior30d: 40,
  memoriesTotal: 500,
  wisdomTotal: 50,
  wisdom30d: 5,
  predConfirmed: 5,
  predDisproven: 5,
  predConfirmedOld: 2,
  predDisprovenOld: 2,
  chainsTotal: 12,
  chains30d: 3,
  contraResolvedAllTime: 8,
  contraResolved30d: 2,
  contraUnresolved: 2,
  contraDismissedResolved: 0,
  contraDismissedUnresolved: 0,
  edgesTotal: 100,
  edges30d: 20,
};

const { counts, mockPrisma, mockLog } = vi.hoisted(() => {
  const state = { current: null as unknown };
  const daysOf = (d: Date) => Math.round((Date.now() - d.getTime()) / 86_400_000);
  const c = () => state.current as Counts;
  type Where = Record<string, unknown>;
  type Arg = { where?: Where } | undefined;
  const whereOf = (a: Arg): Where => a?.where ?? {};
  const range = (v: unknown) => v as { gte?: Date; lt?: Date } | undefined;

  return {
    counts: state,
    mockLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    mockPrisma: {
      brainMemory: {
        count: vi.fn(async (args: Arg) => {
          const w = whereOf(args);
          const created = range(w.createdAt);
          if (w.category === "wisdom") return created?.gte ? c().wisdom30d : c().wisdomTotal;
          if (!created?.gte) return c().memoriesTotal;
          const gte = daysOf(created.gte);
          if (created.lt) return gte >= 45 ? c().memoriesPrior30d : c().memoriesPrior7d;
          return gte <= 10 ? c().memories7d : c().memories30d;
        }),
        upsert: vi.fn(async () => ({ id: "m1" })),
      },
      prediction: {
        count: vi.fn(async (args: Arg) => {
          const w = whereOf(args);
          const old = Boolean(range(w.createdAt)?.lt);
          if (w.status === "confirmed") return old ? c().predConfirmedOld : c().predConfirmed;
          return old ? c().predDisprovenOld : c().predDisproven;
        }),
      },
      causalChain: {
        count: vi.fn(async (args: Arg) =>
          whereOf(args).createdAt ? c().chains30d : c().chainsTotal,
        ),
      },
      contradiction: {
        count: vi.fn(async (args: Arg) => {
          const w = whereOf(args);
          // Dismissed rows are in the table. They only disappear when the
          // caller filters deletedAt -- which is the whole point of the fix.
          const filtersDeleted = w.deletedAt === null;
          if (w.resolved === true) {
            if (range(w.updatedAt)?.gte) return c().contraResolved30d;
            return c().contraResolvedAllTime + (filtersDeleted ? 0 : c().contraDismissedResolved);
          }
          return c().contraUnresolved + (filtersDeleted ? 0 : c().contraDismissedUnresolved);
        }),
      },
      memoryEdge: {
        count: vi.fn(async (args: Arg) =>
          whereOf(args).createdAt ? c().edges30d : c().edgesTotal,
        ),
      },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => mockLog } }));

import {
  measureLearningVelocity,
  snapshotLearningVelocity,
} from "@/lib/brain/learning-velocity";

function given(overrides: Partial<Counts> = {}) {
  counts.current = { ...BASE, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  given();
});

// -- Defect 1 - the headline is a real 30-day comparison --------------------

describe("30-day headline", () => {
  it("reports 0% for a month that created exactly as many memories as the month before", async () => {
    // The worked floor from the audit: a brain that learned nothing scored
    // about +28% because three of the composite's five terms were all-time
    // levels. A static month must read as no change.
    given({ memories30d: 40, memoriesPrior30d: 40 });
    const v = await measureLearningVelocity();
    expect(v.memoryGrowth30d.pctChange).toBe(0);
  });

  it("does not let a busy WEEK manufacture a 30-day gain", async () => {
    // The only quasi-temporal term in the old composite compared week 1 to
    // week 2 and called the result "vs 30d ago".
    given({ memories7d: 40, memoriesPrior7d: 1, memories30d: 40, memoriesPrior30d: 40 });
    const v = await measureLearningVelocity();
    expect(v.memoryGrowth30d.pctChange).toBe(0);
  });

  it("computes the change from the 30d and prior-30d windows", async () => {
    given({ memories30d: 60, memoriesPrior30d: 40 });
    const v = await measureLearningVelocity();
    expect(v.memoryGrowth30d.pctChange).toBe(50);
  });

  it("returns null, not 0, when the prior 30-day window is empty", async () => {
    given({ memories30d: 12, memoriesPrior30d: 0 });
    const v = await measureLearningVelocity();
    expect(v.memoryGrowth30d.pctChange).toBeNull();
  });
});

// -- Defect 2 - decline is visible ------------------------------------------

describe("decline", () => {
  it("reports a NEGATIVE change when the brain slowed down", async () => {
    // Math.max(0, ...) made falling and flat contribute an identical 0.
    given({ memories30d: 20, memoriesPrior30d: 40 });
    const v = await measureLearningVelocity();
    expect(v.memoryGrowth30d.pctChange).toBe(-50);
  });

  it("distinguishes a decline from a flat month", async () => {
    given({ memories30d: 20, memoriesPrior30d: 40 });
    const declining = await measureLearningVelocity();
    given({ memories30d: 40, memoriesPrior30d: 40 });
    const flat = await measureLearningVelocity();
    expect(declining.memoryGrowth30d.pctChange).toBeLessThan(
      flat.memoryGrowth30d.pctChange as number,
    );
  });
});

// -- Defect 3 - unmeasured dimensions do not pay ----------------------------

describe("self-correction with no contradictions", () => {
  it("reports resolutionRate null, not a perfect 1", async () => {
    given({ contraResolvedAllTime: 0, contraResolved30d: 0, contraUnresolved: 0 });
    const v = await measureLearningVelocity();
    expect(v.contradictions.resolutionRate).toBeNull();
  });

  it("does not score an empty table as well as a genuinely self-correcting one", async () => {
    given({ contraResolvedAllTime: 0, contraResolved30d: 0, contraUnresolved: 0 });
    const empty = await measureLearningVelocity();
    given({ contraResolvedAllTime: 9, contraResolved30d: 3, contraUnresolved: 1 });
    const resolving = await measureLearningVelocity();
    // The old code gave both 15/15 for self-correction.
    expect(empty.healthScore).toBeLessThan(resolving.healthScore);
  });

  it("shrinks healthScoreMax by the self-correction points instead of gifting them", async () => {
    given({ contraResolvedAllTime: 0, contraResolved30d: 0, contraUnresolved: 0 });
    const v = await measureLearningVelocity();
    expect(v.healthScoreMax).toBe(85);
    expect(v.healthScore).toBeLessThanOrEqual(v.healthScoreMax);
  });

  it("applies the same rule to predictions with nothing resolved", async () => {
    given({ predConfirmed: 0, predDisproven: 0, predConfirmedOld: 0, predDisprovenOld: 0 });
    const v = await measureLearningVelocity();
    expect(v.predictionAccuracy.rate).toBeNull();
    expect(v.healthScoreMax).toBe(85);
  });

  it("drops both dimensions when neither can be measured", async () => {
    given({
      predConfirmed: 0,
      predDisproven: 0,
      predConfirmedOld: 0,
      predDisprovenOld: 0,
      contraResolvedAllTime: 0,
      contraResolved30d: 0,
      contraUnresolved: 0,
    });
    const v = await measureLearningVelocity();
    expect(v.healthScoreMax).toBe(70);
  });
});

// -- Contradiction counts exclude dismissed rows ----------------------------

describe("dismissed contradictions", () => {
  it("keeps soft-deleted rows out of the resolution-rate denominator", async () => {
    given({
      contraResolvedAllTime: 5,
      contraUnresolved: 5,
      contraDismissedResolved: 0,
      contraDismissedUnresolved: 90,
    });
    const v = await measureLearningVelocity();
    // 5/(5+5) = 0.5. Counting the 90 dismissed rows would give 5/100 = 0.05.
    expect(v.contradictions.resolutionRate).toBeCloseTo(0.5, 5);
  });
});

// -- Defect 4 - every number names its own window ---------------------------

describe("windows", () => {
  it("reports contradictions resolved in 30d separately from the lifetime total", async () => {
    // The UI cell used the lifetime running total, which can only go up and
    // would never show a bad week.
    given({ contraResolvedAllTime: 50, contraResolved30d: 2, contraUnresolved: 5 });
    const v = await measureLearningVelocity();
    expect(v.contradictions.resolvedLast30d).toBe(2);
    expect(v.contradictions.resolvedAllTime).toBe(50);
  });

  it("filters the 30d contradiction count by updatedAt", async () => {
    await measureLearningVelocity();
    const wheres = mockPrisma.contradiction.count.mock.calls.map(
      (call) => (call[0] as { where?: Record<string, unknown> } | undefined)?.where ?? {},
    );
    const windowed = wheres.filter((w) => w.updatedAt !== undefined);
    expect(windowed).toHaveLength(1);
    expect(windowed[0].resolved).toBe(true);
  });

  it("keeps the 7d memory pair and the 30d memory pair distinct", async () => {
    given({ memories7d: 3, memoriesPrior7d: 1, memories30d: 100, memoriesPrior30d: 50 });
    const v = await measureLearningVelocity();
    expect(v.memoriesCreated.thisWeek).toBe(3);
    expect(v.memoriesCreated.delta).toBe(2);
    expect(v.memoryGrowth30d.last30d).toBe(100);
    expect(v.memoryGrowth30d.pctChange).toBe(100);
  });
});

// -- Defect 6 - a read must not write ---------------------------------------

describe("reads do not write", () => {
  it("never writes when only measuring", async () => {
    await measureLearningVelocity();
    expect(mockPrisma.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("writes the snapshot only through the explicit snapshot function", async () => {
    const r = await snapshotLearningVelocity();
    expect(mockPrisma.brainMemory.upsert).toHaveBeenCalledTimes(1);
    expect(r.snapshotWritten).toBe(true);
  });

  it("reports and logs a failed snapshot write instead of swallowing it", async () => {
    // The old code was `.catch(() => {})`. Under the Neon read-only lock this
    // repo hit on 2026-08-19 that silence would have lasted days.
    mockPrisma.brainMemory.upsert.mockRejectedValueOnce(new Error("read-only"));
    const r = await snapshotLearningVelocity();
    expect(r.snapshotWritten).toBe(false);
    expect(mockLog.error).toHaveBeenCalledTimes(1);
    // The measurement still comes back.
    expect(r.velocity.healthScoreMax).toBeGreaterThan(0);
  });
});
