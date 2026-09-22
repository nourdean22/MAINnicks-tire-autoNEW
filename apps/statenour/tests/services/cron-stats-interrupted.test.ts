import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// vi.mock is hoisted above every import and const, so the doubles must be hoisted too.
const { groupBy, findMany } = vi.hoisted(() => ({ groupBy: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { cronJobLog: { groupBy, findMany } } }));

import { getCronStats } from "@/lib/services/cron-control";

/**
 * 2026-09-22 · review on #2525 (P1): the cron views compared `status === "failed"`
 * literally, so the lifecycle's `interrupted` (an age-settled dead run, defined as
 * terminal and NOT ok) would have been left out of fail14d, lastFailAt, failures24h
 * and the health-rate numerator - a dead run displayed inside a 100% success rate.
 * Every hard-failure status is its own groupBy row; the tallies SUM them through
 * isHardFailure(), the one positive list.
 */
describe("cron stats · interrupted runs count as failures (2026-09-22)", () => {
  beforeEach(() => {
    groupBy.mockReset();
    findMany.mockReset();
  });

  it("fail14d sums failed + interrupted rows; partial and started stay out; lastFailAt may come from an interrupted row", async () => {
    groupBy.mockResolvedValue([
      { jobName: "goal-pruner", status: "success", _count: { id: 3 } },
      { jobName: "goal-pruner", status: "failed", _count: { id: 1 } },
      { jobName: "goal-pruner", status: "interrupted", _count: { id: 2 } },
      { jobName: "goal-pruner", status: "partial", _count: { id: 1 } },
      { jobName: "goal-pruner", status: "started", _count: { id: 4 } },
    ]);
    const t1 = new Date("2026-09-22T10:00:00Z");
    const t0 = new Date("2026-09-22T09:00:00Z");
    findMany.mockResolvedValue([
      { jobName: "goal-pruner", status: "interrupted", createdAt: t1 },
      { jobName: "goal-pruner", status: "success", createdAt: t0 },
    ]);
    const stats = await getCronStats();
    expect(stats["goal-pruner"]).toEqual({
      success14d: 3,
      partial14d: 1,
      fail14d: 3,
      lastSuccessAt: t0.toISOString(),
      lastFailAt: t1.toISOString(),
    });
  });
});

describe('RATCHET · no cron view compares status to the literal "failed" (comment-stripped)', () => {
  const ROOT = join(__dirname, "..", "..");
  const strip = (s: string) =>
    s
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
  const files = [
    "lib/services/cron-control.ts",
    "lib/services/cron-tree.ts",
    "lib/system/cron-diagnostics.ts",
    "lib/services/system-pages.ts",
  ];
  for (const f of files) {
    it(`${f} routes failure through isHardFailure / HARD_FAILURE_STATUSES`, () => {
      const code = strip(readFileSync(join(ROOT, f), "utf8"));
      expect(code).not.toMatch(/[rs]\.status === "failed"/);
      // a cron_job_log where-clause on the literal (system-pages' deviceCommand query is another table)
      const cronWheres = code.match(/cronJobLog\.\w+\(\{[\s\S]{0,300}?status: "failed"/g) ?? [];
      expect(cronWheres).toEqual([]);
    });
  }
});
