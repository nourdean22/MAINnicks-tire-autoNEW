/**
 * tests/cron/correlation-alarm-snapshot-collision.test.ts
 * 2026-09-02 · the snapshot write must tolerate its own idempotency key.
 *
 * /system/health reported 354 failed of 924 runs — 38%, the worst ratio on
 * the page. The alert-write loop had tolerated P2002 since it was written;
 * the snapshot write thirty lines above it had not.
 *
 * The snapshot key is minute-resolution (YYYY-MM-DD-HHmm) against a unique
 * on (category, key), so any two triggers inside the same minute collide —
 * a manual re-fire, or cron-healer re-running a job it believes is stuck.
 * Worse, the collision happens AFTER the alerts are written, so the run did
 * its actual work and was still recorded as a failure.
 *
 * Two things must hold, and the second is what makes the first safe:
 * a duplicate snapshot is tolerated, and every OTHER database error still
 * propagates. A catch that swallowed both would turn a 38% failure rate into
 * a 0% failure rate with the same amount of lost data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockFindCorrelations } = vi.hoisted(() => ({
  mockFindCorrelations: vi.fn(),
  mockPrisma: {
    brainMemory: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/brain/correlation-finder", () => ({ findCorrelations: mockFindCorrelations }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { runCorrelationAlarm } from "@/lib/brain/correlation-alarm";

const SNAPSHOT_CATEGORY = "correlation_snapshot";

/** One strong correlation, so the run reaches the snapshot write. */
const STRONG = [
  {
    metricA: "revenue",
    metricB: "leads",
    coefficient: 0.91,
    direction: "positive",
    strength: "strong",
    dataPoints: 30,
    surprising: false,
    interpretation: "revenue tracks leads",
  },
];

/** A Prisma unique-constraint error, shaped as the client throws it. */
function p2002(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

/** create() that fails only on the snapshot row, with the given error. */
function failSnapshotWith(err: Error) {
  mockPrisma.brainMemory.create.mockImplementation(
    async (args: { data: { category: string } }) => {
      if (args.data.category === SNAPSHOT_CATEGORY) throw err;
      return { id: "alert-1", ...args.data };
    },
  );
}

describe("correlation-alarm · a duplicate snapshot is dedup, not a failed run", () => {
  beforeEach(() => {
    mockPrisma.brainMemory.create.mockReset();
    mockFindCorrelations.mockReset();
    mockFindCorrelations.mockResolvedValue(STRONG);
  });

  it("PLANTED POSITIVE · a clean run writes both rows and reports a snapshot key", () => {
    // Establishes the baseline the two tests below deviate from. Without it,
    // a run that silently stopped writing anything would look identical to a
    // run that tolerated a collision.
    mockPrisma.brainMemory.create.mockImplementation(async (args: { data: unknown }) => ({
      id: "row-1",
      ...(args.data as object),
    }));
    return runCorrelationAlarm().then((report) => {
      expect(report.snapshotKey).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}$/);
      expect(mockPrisma.brainMemory.create).toHaveBeenCalledTimes(2); // alert + snapshot
    });
  });

  it("survives a P2002 on the snapshot write", async () => {
    failSnapshotWith(p2002());
    await expect(runCorrelationAlarm()).resolves.toBeDefined();
  });

  it("keeps the alerts it already wrote when the snapshot collides", async () => {
    // This is the cost of the old behaviour: the run had done its real work
    // before it threw, and the throw discarded the report anyway.
    failSnapshotWith(p2002());
    const report = await runCorrelationAlarm();
    expect(report.newAlerts).toHaveLength(1);
    expect(report.newAlerts[0].a).toBe("revenue");
  });

  it("PLANTED POSITIVE · a NON-P2002 database error still propagates", async () => {
    // The narrow catch is the whole safety argument. If this ever passes by
    // resolving, the guard has become a blanket swallow and every real
    // database fault is now invisible.
    failSnapshotWith(Object.assign(new Error("connection terminated"), { code: "P1017" }));
    await expect(runCorrelationAlarm()).rejects.toThrow("connection terminated");
  });
});
