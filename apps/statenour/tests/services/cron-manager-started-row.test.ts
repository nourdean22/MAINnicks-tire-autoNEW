/**
 * Route crons open a `started` row BEFORE the work and settle THAT row
 * (audit 08-F14, 2026-10-10).
 *
 * logCronRun used to write one row at the END. A deploy that killed a route
 * cron mid-run (mega's detached children: consolidate, think, mastery-xp) left
 * no row at all, so the run vanished. With a `started` row first, the existing
 * age sweep in lib/inngest/cron-lifecycle.ts settles a dead run to
 * `interrupted` (a hard failure) instead of nothing.
 *
 * Also pins getCronStatus (Nick's tool): it read the newest 50 rows ACROSS all
 * jobs and counted started / interrupted / duplicate as successes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  publishDurable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cronJobLog: { create: h.create, update: h.update, findMany: h.findMany, groupBy: h.groupBy },
  },
}));
vi.mock("@/lib/db/brain-bus-durable", () => ({ publishDurable: h.publishDurable }));

import { logCronRun, getCronStatus } from "@/lib/services/cron-manager";

beforeEach(() => {
  h.create.mockReset();
  h.update.mockReset();
  h.findMany.mockReset();
  h.groupBy.mockReset();
  h.create.mockResolvedValue({ id: "row-1" });
  h.update.mockResolvedValue({ id: "row-1" });
  h.findMany.mockResolvedValue([]);
  h.groupBy.mockResolvedValue([]);
});

describe("logCronRun · started first, then settle the same row", () => {
  it("writes a `started` row BEFORE the handler runs", async () => {
    let createsBeforeWork = -1;
    await logCronRun("consolidate", async () => {
      createsBeforeWork = h.create.mock.calls.length;
      return { ok: true };
    });
    expect(createsBeforeWork, "the started row must exist while the work runs").toBe(1);
    expect(h.create.mock.calls[0][0]).toMatchObject({ data: { jobName: "consolidate", status: "started" } });
  });

  it("a run that never returns leaves the `started` row for the age sweep (no terminal write)", async () => {
    // Simulates a process killed mid-run: the handler never settles.
    void logCronRun("think", () => new Promise(() => {}));
    await vi.waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0]).toMatchObject({ data: { status: "started" } });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("settles the SAME row to success, by id", async () => {
    await logCronRun("mastery-xp", async () => ({ resultCount: 3 }));
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0]).toMatchObject({
      where: { id: "row-1" },
      data: { status: "success", resultCount: 3 },
    });
  });

  it("settles the SAME row to failed when the handler throws", async () => {
    const run = await logCronRun("boom", async () => {
      throw new Error("upstream down");
    });
    expect(run.success).toBe(false);
    expect(h.update.mock.calls[0][0]).toMatchObject({
      where: { id: "row-1" },
      data: { status: "failed", error: "upstream down" },
    });
  });

  it("settles the SAME row to failed on a resolved ok:false", async () => {
    await logCronRun("liveness", async () => ({ ok: false, reason: "stale" }));
    expect(h.update.mock.calls[0][0]).toMatchObject({
      where: { id: "row-1" },
      data: { status: "failed", error: "stale" },
    });
  });

  it("CONTROL: if the started write fails, the terminal row is still CREATED (never lost)", async () => {
    h.create.mockRejectedValueOnce(new Error("pool timeout")).mockResolvedValue({ id: "row-2" });
    await logCronRun("outbox-drain", async () => ({ ok: true }));
    expect(h.update).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalledTimes(2);
    expect(h.create.mock.calls[1][0]).toMatchObject({ data: { jobName: "outbox-drain", status: "success" } });
  });
});

describe("getCronStatus · per-job, terminal-only", () => {
  it("does not let one busy job crowd another out (no cross-job row cap)", async () => {
    // groupBy returns one row per (job, status): a quiet weekly job is present
    // no matter how many rows a */15 job wrote since.
    h.groupBy.mockResolvedValue([
      { jobName: "outbox-drain", status: "success", _count: { _all: 900 }, _max: { createdAt: new Date("2026-10-10T12:00:00Z") } },
      { jobName: "weekly-review", status: "success", _count: { _all: 1 }, _max: { createdAt: new Date("2026-10-05T03:00:00Z") } },
    ]);
    const res = await getCronStatus();
    expect(res.summary.map((s) => s.jobName).sort()).toEqual(["outbox-drain", "weekly-review"]);
  });

  it("asks the DB for terminal statuses only (started / duplicate are never a run outcome)", async () => {
    await getCronStatus();
    const where = (h.groupBy.mock.calls[0][0] as { where: { status: { in: string[] } } }).where;
    expect(where.status.in).toEqual(expect.arrayContaining(["success", "partial", "failed", "interrupted"]));
    expect(where.status.in).not.toContain("started");
    expect(where.status.in).not.toContain("duplicate");
  });

  it("counts interrupted as a failure and takes lastStatus from the newest TERMINAL row", async () => {
    h.groupBy.mockResolvedValue([
      { jobName: "consolidate", status: "success", _count: { _all: 2 }, _max: { createdAt: new Date("2026-10-08T03:05:00Z") } },
      { jobName: "consolidate", status: "interrupted", _count: { _all: 1 }, _max: { createdAt: new Date("2026-10-09T03:05:00Z") } },
      { jobName: "consolidate", status: "partial", _count: { _all: 1 }, _max: { createdAt: new Date("2026-10-07T03:05:00Z") } },
    ]);
    const res = await getCronStatus();
    const row = res.summary.find((s) => s.jobName === "consolidate")!;
    expect(row.total).toBe(4);
    expect(row.failures).toBe(1);
    expect(row.partials).toBe(1);
    expect(row.successRate).toBe(50);
    expect(row.lastStatus).toBe("interrupted");
    expect(row.lastRun.toISOString()).toBe("2026-10-09T03:05:00.000Z");
  });
});
