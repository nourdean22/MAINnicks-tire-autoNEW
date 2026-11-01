/**
 * OS drift alerts on movement, not on a standing step (2026-11-01).
 *
 * Prod series: tool_count 184 (10-17..10-19), 181 (10-20), 133 from 10-21
 * (deliberate prune), 130 from 10-25. The week-over-week comparison re-alerted
 * the flat 130-133 every night until the step left the 14d window, and each
 * night wrote a new Pulse row ("OS drift · worst tool_count 130 vs 169 avg").
 */
import { describe, it, expect, vi } from "vitest";

type Row = { value: number; createdAt: Date };
let series: Row[] = [];

vi.mock("@/lib/observability/os-snapshot", () => ({ OS_SNAPSHOT_METRIC_NAMES: ["os_snapshot.tool_count"] }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemMetric: {
      findMany: async (args: { where: { createdAt: { gte: Date } } }) =>
        series
          .filter((r) => r.createdAt >= args.where.createdAt.gte)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    },
  },
}));

import { compareToWeekAgo, composeDriftAlert } from "@/lib/observability/drift-detector";

/** One 03:00Z sample per day, the os-snapshot cron's slot. */
function daily(from: string, to: string, value: number): Row[] {
  const out: Row[] = [];
  for (let d = new Date(`${from}T03:00:00Z`); d <= new Date(`${to}T03:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    out.push({ value, createdAt: new Date(d) });
  }
  return out;
}

const PROD = [...daily("2026-10-05", "2026-10-19", 184), ...daily("2026-10-20", "2026-10-20", 181), ...daily("2026-10-21", "2026-10-24", 133), ...daily("2026-10-25", "2026-10-30", 130)];

describe("OS drift: standing step vs new movement", () => {
  it("POSITIVE CONTROL · the step day (10-21, 181 -> 133) still alerts", async () => {
    series = PROD.filter((r) => r.createdAt <= new Date("2026-10-21T03:00:00Z"));
    const report = await compareToWeekAgo(new Date("2026-10-21T03:05:00Z"));
    expect(report.regressions.map((r) => r.metric)).toEqual(["os_snapshot.tool_count"]);
    expect(report.worst).toBe("warn");
    expect(composeDriftAlert(report)).not.toBeNull();
  });

  it("a flat day after the step (10-28, 130 vs 130 yesterday) is standing: listed, not alerted", async () => {
    series = PROD.filter((r) => r.createdAt <= new Date("2026-10-28T03:00:00Z"));
    const report = await compareToWeekAgo(new Date("2026-10-28T03:05:00Z"));
    expect(report.regressions).toEqual([]);
    expect(report.standing.map((r) => r.metric)).toEqual(["os_snapshot.tool_count"]);
    expect(report.worst).toBe("info");
    expect(composeDriftAlert(report)).toBeNull();
  });

  it("a same-day re-run does not count as the previous snapshot (step day re-fired by the healer)", async () => {
    series = [...PROD.filter((r) => r.createdAt <= new Date("2026-10-21T03:00:00Z")), { value: 133, createdAt: new Date("2026-10-21T09:00:00Z") }];
    const report = await compareToWeekAgo(new Date("2026-10-21T09:05:00Z"));
    expect(report.regressions.map((r) => r.metric)).toEqual(["os_snapshot.tool_count"]);
  });

  it("a further drop on a standing metric alerts again", async () => {
    series = [...PROD.filter((r) => r.createdAt <= new Date("2026-10-27T03:00:00Z")), { value: 110, createdAt: new Date("2026-10-28T03:00:00Z") }];
    const report = await compareToWeekAgo(new Date("2026-10-28T03:05:00Z"));
    expect(report.regressions.map((r) => r.metric)).toEqual(["os_snapshot.tool_count"]);
    expect(report.standing).toEqual([]);
  });
});
