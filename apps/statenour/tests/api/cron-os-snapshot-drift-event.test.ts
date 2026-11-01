/**
 * os-snapshot's drift Pulse row expires (2026-11-01).
 *
 * The coach event is keyed one per ET day (`os-drift:<date>`) and had no expiry,
 * so every night's row stayed on the Pulse: rows back to 08-27 were still live
 * on 11-01. A day whose only regressions are standing writes no row at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ report: {} as Record<string, unknown>, record: vi.fn() }));
vi.mock("@/lib/utils/http", () => ({ cronHandler: (fn: () => Promise<unknown>) => fn }));
vi.mock("@/lib/prisma", () => ({ prisma: { systemMetric: { create: async () => ({}) } } }));
vi.mock("@/lib/observability/os-snapshot", () => ({
  snapshotAll: async () => ({ capturedAt: "2026-11-01T03:00:00Z", toolCount: 130 }),
  snapshotToMetricRows: () => [],
}));
vi.mock("@/lib/observability/drift-detector", () => ({
  compareToWeekAgo: async () => h.report,
  pushDriftAlertIfNeeded: async () => ({ pushed: false }),
}));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: h.record }));

import { GET } from "@/app/api/cron/os-snapshot/route";

const run = GET as unknown as () => Promise<Record<string, unknown>>;
const tool = { metric: "os_snapshot.tool_count", today: 110, baseline: 176, pctDelta: -0.375, absDelta: -66, direction: "regressed", severity: "critical" };

beforeEach(() => h.record.mockReset());

describe("os-snapshot drift Pulse row", () => {
  it("a warn+ day writes one row that expires in about 25h", async () => {
    h.report = { date: "2026-11-01", regressions: [tool], improvements: [], worst: "critical", metricsUnreadable: [], standing: [] };
    const before = Date.now();
    await run();
    expect(h.record).toHaveBeenCalledTimes(1);
    const exp = Date.parse(h.record.mock.calls[0][0].expiresAt);
    expect(exp - before).toBeGreaterThanOrEqual(24 * 3_600_000);
    expect(exp - before).toBeLessThanOrEqual(26 * 3_600_000);
  });

  it("CONTROL · a day with only standing regressions writes no row and reports them", async () => {
    h.report = { date: "2026-11-01", regressions: [], improvements: [], worst: "info", metricsUnreadable: [], standing: [tool] };
    const out = await run();
    expect(h.record).not.toHaveBeenCalled();
    expect((out.drift as { standing: string[] }).standing).toEqual(["os_snapshot.tool_count"]);
  });
});
