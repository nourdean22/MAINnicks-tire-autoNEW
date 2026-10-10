/**
 * A cron that stopped running must show as `silent` on /system/health, not drop out of the
 * table (audit 2026-10-10, 08 section 3). Expected jobs come from cron-heartbeat's
 * manifest-driven expectedJobs(); a job is judged only when its max silence fits the window.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    prisma: {
      cronJobLog: { findMany: fn() },
      errorLog: { count: fn(), findMany: fn(), groupBy: fn() },
      captureInboxItem: { count: fn(), findFirst: fn() },
      commitment: { count: fn() },
      task: { count: fn() },
      brainMemory: { findMany: fn(), findUnique: fn(), findFirst: fn() },
      brainDump: { findFirst: fn() },
      reflection: { findFirst: fn() },
      situationLog: { count: fn() },
      vectorEmbedding: { groupBy: fn() },
      systemMetric: { findMany: fn() },
      $queryRaw: fn(),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

import { buildHealthReport } from "@/lib/services/system-health";
import { expectedJobs } from "@/lib/inngest/functions/cron-heartbeat";

beforeEach(() => {
  for (const table of Object.values(h.prisma)) {
    if (typeof table === "function") {
      (table as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
      continue;
    }
    for (const m of Object.values(table)) (m as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null);
  }
  h.prisma.cronJobLog.findMany.mockResolvedValue([]);
  h.prisma.errorLog.count.mockResolvedValue(0);
  h.prisma.errorLog.groupBy.mockResolvedValue([]);
  h.prisma.captureInboxItem.count.mockResolvedValue(0);
  h.prisma.commitment.count.mockResolvedValue(0);
  h.prisma.task.count.mockResolvedValue(0);
  h.prisma.brainMemory.findMany.mockResolvedValue([]);
  h.prisma.situationLog.count.mockResolvedValue(0);
  h.prisma.vectorEmbedding.groupBy.mockResolvedValue([]);
  h.prisma.systemMetric.findMany.mockResolvedValue([]);
  delete process.env.VAPI_API_KEY;
});

describe("buildHealthReport · a stopped cron is silent, not absent", () => {
  it("an expected job with no run in the window is listed as silent and unhealthy", async () => {
    const daily = expectedJobs().find((j) => j.maxAgeH <= 7 * 24)!;
    const r = await buildHealthReport({ range: "7d" });
    expect(r.cron.jobs.find((j) => j.jobName === daily.name)).toMatchObject({
      silent: true,
      healthy: false,
      success: 0,
      failed: 0,
    });
  });

  it("CONTROL: a job that ran is not silent; a 24h window does not judge a daily job", async () => {
    const daily = expectedJobs().find((j) => j.maxAgeH > 24 && j.maxAgeH <= 7 * 24)!;
    h.prisma.cronJobLog.findMany
      .mockResolvedValueOnce([{ jobName: daily.name, status: "success", duration: 10, createdAt: new Date() }])
      .mockResolvedValueOnce([]);
    const r = await buildHealthReport({ range: "7d" });
    const row = r.cron.jobs.find((j) => j.jobName === daily.name) as { silent?: boolean } | undefined;
    expect(row).toBeDefined();
    expect(row?.silent).toBeFalsy();
    const r24 = await buildHealthReport({ range: "24h" });
    expect(r24.cron.jobs.find((j) => j.jobName === daily.name)).toBeUndefined();
    expect(r.cron.failureCount).toBe(0); // silent rows are not hard failures
  });
});
