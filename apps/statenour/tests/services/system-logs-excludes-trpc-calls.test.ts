/**
 * The unified /api/system/logs feed reads the NEWEST system_metrics rows with no metric filter, 40 per
 * source. trpc.call rows (2026-10-23) are high-volume telemetry; left in, the 40 newest rows would all be
 * trpc.call and every other metric (cron.duration, drift scores, ...) would vanish from the feed. The feed
 * must exclude the metric. The fake below applies the where clause the way the database would, so this
 * fails if the exclusion is dropped or written in a form the clause does not express.
 */
import { describe, expect, it, vi } from "vitest";

type MetricRow = { id: string; createdAt: Date; metric: string; value: number; unit: string; tags: unknown; source: string };
type Where = { createdAt?: { gte: Date }; metric?: { not?: string } };

const { rows } = vi.hoisted(() => ({ rows: [] as MetricRow[] }));
vi.mock("@/lib/prisma", () => {
  const none = { findMany: async () => [] };
  return {
    prisma: {
      errorLog: none,
      cronJobLog: none,
      autonomousAction: none,
      apiRequestLog: none,
      systemMetric: {
        findMany: async ({ where, take }: { where: Where; take: number }) =>
          rows
            .filter((r) => (where.createdAt ? r.createdAt >= where.createdAt.gte : true))
            .filter((r) => (where.metric?.not ? r.metric !== where.metric.not : true))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, take),
      },
    },
  };
});

import { buildSystemLogs } from "@/lib/services/system-pages-b";
import { TRPC_CALL_METRIC } from "@/lib/trpc/call-telemetry";

describe("buildSystemLogs and trpc.call telemetry", () => {
  it("100 newer trpc.call rows do not push the older cron.duration row out of the feed, and none of them show", async () => {
    const now = Date.now();
    rows.length = 0;
    rows.push({ id: "cron1", createdAt: new Date(now - 60_000), metric: "cron.duration", value: 12, unit: "ms", tags: null, source: "cron" });
    for (let i = 0; i < 100; i++) {
      rows.push({ id: `t${i}`, createdAt: new Date(now - i * 100), metric: TRPC_CALL_METRIC, value: 5, unit: "ms", tags: { procedure: "x.y" }, source: "trpc" });
    }
    const view = await buildSystemLogs({ sources: ["metrics"], limit: 200 });
    const labels = view.entries.map((e) => e.label);
    expect(labels.some((l) => l.startsWith("cron.duration"))).toBe(true);
    expect(labels.some((l) => l.startsWith(TRPC_CALL_METRIC))).toBe(false);
  });

  it("positive control: without any trpc.call rows the metric feed still lists ordinary metrics", async () => {
    rows.length = 0;
    rows.push({ id: "c", createdAt: new Date(Date.now() - 1000), metric: "cron.duration", value: 1, unit: "ms", tags: null, source: "cron" });
    const view = await buildSystemLogs({ sources: ["metrics"], limit: 200 });
    expect(view.entries).toHaveLength(1);
  });
});
