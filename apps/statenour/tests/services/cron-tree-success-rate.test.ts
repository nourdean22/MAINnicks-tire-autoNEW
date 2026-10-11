/**
 * The cron lineage tree must not score a job with ZERO runs as 100%
 * (2026-10-10, same defect as the command deck in system-pages.ts).
 *
 * buildCronTree defaulted `successRate` to 100 when the 14d window was empty,
 * and its no-stats fallback also lacked `partial14d`, so `total` was NaN and
 * that row shipped `partial14d: undefined`. Drives the REAL cron-control stats
 * over a faked prisma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CRONS } from "@/config/crons";

const h = vi.hoisted(() => ({ groupBy: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findMany: async () => [] },
    cronJobLog: { groupBy: (...a: unknown[]) => h.groupBy(...a), findMany: async () => [] },
  },
}));

import { buildCronTree } from "@/lib/services/cron-tree";

beforeEach(() => {
  h.groupBy.mockReset();
  h.groupBy.mockResolvedValue([]);
});

describe("buildCronTree · success rate", () => {
  it("BREAKS: a job with no runs in the window has NO rate (null) and a real partial14d of 0", async () => {
    const tree = await buildCronTree();
    expect(tree.rows.length).toBeGreaterThan(0);
    for (const row of tree.rows) {
      expect(row.successRate, `${row.name} has no runs`).toBeNull();
      expect(row.partial14d, `${row.name} partial14d`).toBe(0);
    }
  });

  it("CONTROL: a job with runs still gets its measured rate", async () => {
    const name = CRONS[0].name;
    const countRows = [
      { jobName: name, status: "success", _count: { id: 3 } },
      { jobName: name, status: "failed", _count: { id: 1 } },
    ];
    // getCronStats also reads each job's newest success/failure (groupBy _max).
    h.groupBy.mockImplementation(async (a: { _max?: unknown }) => (a._max ? [] : countRows));
    const tree = await buildCronTree();
    const row = tree.rows.find((r) => r.name === name)!;
    expect(row.successRate).toBe(75);
  });
});
