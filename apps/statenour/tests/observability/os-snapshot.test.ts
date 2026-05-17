/**
 * tests/observability/os-snapshot.test.ts · v10.0.526 · Arc A F5
 *
 * Covers:
 *   1. counts the manifest's active crons (no stubs · real CRONS).
 *   2. counts the live TOOL_CATALOG (real catalog · drift guard).
 *   3. countRoutes walks the actual app/api tree and returns a
 *      non-zero count whose shape matches the audit-api convention.
 *   4. snapshotToMetricRows projects every domain LOC + every scalar
 *      metric into its own `os_snapshot.*` row.
 *   5. compareToWeekAgo returns an empty regression set when no data
 *      exists (no false positives).
 *   6. compareToWeekAgo flags a capability-loss regression (route_count
 *      drops 20%).
 *   7. compareToWeekAgo flags a debt-growth regression (any_usage
 *      grows 50%).
 *   8. composeDriftAlert returns null when no warn/critical entries
 *      exist (telegram silence on noise-floor days).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  countCrons,
  countTools,
  countRoutes,
  snapshotToMetricRows,
  OS_SNAPSHOT_METRIC_NAMES,
  type OsSnapshot,
} from "@/lib/observability/os-snapshot";
import {
  compareToWeekAgo,
  composeDriftAlert,
} from "@/lib/observability/drift-detector";
import { CRONS } from "@/config/crons";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

// Mock prisma so drift tests can drive the input set deterministically.
vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      systemMetric: {
        findMany: vi.fn(),
      },
      brainMemory: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

import { prisma } from "@/lib/prisma";
const mockedSystemMetricFindMany = prisma.systemMetric.findMany as unknown as ReturnType<typeof vi.fn>;

describe("os-snapshot · counts mirror canonical sources", () => {
  it("countCrons returns the active-mode count from the CRONS manifest", () => {
    const expected = CRONS.filter((c) => c.mode === "active").length;
    expect(countCrons()).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("countTools returns TOOL_CATALOG.length verbatim", () => {
    expect(countTools()).toBe(TOOL_CATALOG.length);
    expect(TOOL_CATALOG.length).toBeGreaterThan(0);
  });

  it("countRoutes walks app/api and returns a positive count", async () => {
    const n = await countRoutes();
    expect(n).toBeGreaterThan(0);
  }, 30_000);
});

describe("os-snapshot · projection to SystemMetric rows", () => {
  it("snapshotToMetricRows includes every tracked metric exactly once", () => {
    const snap: OsSnapshot = {
      routeCount: 100,
      cronCount: 30,
      toolCount: 50,
      locByDomain: { app: 10_000, components: 5_000, lib: 30_000, hooks: 1_000, prisma: 2_000 },
      locTotal: 48_000,
      testFileCount: 80,
      monsterFileCount: 5,
      monsterFiles: [],
      anyUsageCount: 42,
      consoleCallCount: 7,
      capturedAt: new Date().toISOString(),
    };

    const rows = snapshotToMetricRows(snap);
    const metricNames = rows.map((r) => r.metric).sort();

    // Every tracked name must appear exactly once.
    expect(new Set(metricNames).size).toBe(metricNames.length);
    expect(metricNames).toEqual([...OS_SNAPSHOT_METRIC_NAMES].sort());

    // Spot-check a few values flow through correctly.
    expect(rows.find((r) => r.metric === "os_snapshot.route_count")?.value).toBe(100);
    expect(rows.find((r) => r.metric === "os_snapshot.loc_total")?.value).toBe(48_000);
    expect(rows.find((r) => r.metric === "os_snapshot.loc_app")?.value).toBe(10_000);
    expect(rows.find((r) => r.metric === "os_snapshot.any_usage_count")?.value).toBe(42);
  });
});

describe("drift-detector · week-over-week comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no regressions when no metric rows exist", async () => {
    mockedSystemMetricFindMany.mockResolvedValue([]);

    const report = await compareToWeekAgo();
    expect(report.regressions).toEqual([]);
    expect(report.improvements).toEqual([]);
    expect(report.worst).toBe("info");
  });

  it("flags critical regression when a capability metric drops sharply", async () => {
    const now = new Date("2026-05-12T00:00:00Z");
    const day = 24 * 60 * 60_000;
    // Baseline: route_count steady at 100 across the 14d-to-7d window.
    // Today: route_count = 70 (-30% — critical tier).
    mockedSystemMetricFindMany.mockImplementation(async (args: unknown) => {
      const a = args as { where: { metric: string } };
      if (a.where.metric === "os_snapshot.route_count") {
        return [
          { value: 70, createdAt: now }, // today
          { value: 100, createdAt: new Date(now.getTime() - 9 * day) },
          { value: 100, createdAt: new Date(now.getTime() - 10 * day) },
          { value: 100, createdAt: new Date(now.getTime() - 11 * day) },
        ];
      }
      return [];
    });

    const report = await compareToWeekAgo(now);
    const routeReg = report.regressions.find((r) => r.metric === "os_snapshot.route_count");
    expect(routeReg).toBeDefined();
    expect(routeReg?.direction).toBe("regressed");
    expect(routeReg?.severity).toBe("critical");
    expect(report.worst).toBe("critical");
  });

  it("flags debt-growth regression when any_usage grows substantially", async () => {
    const now = new Date("2026-05-12T00:00:00Z");
    const day = 24 * 60 * 60_000;
    // Baseline: any_usage at 100. Today: 150 (+50% — critical for debt).
    mockedSystemMetricFindMany.mockImplementation(async (args: unknown) => {
      const a = args as { where: { metric: string } };
      if (a.where.metric === "os_snapshot.any_usage_count") {
        return [
          { value: 150, createdAt: now },
          { value: 100, createdAt: new Date(now.getTime() - 9 * day) },
          { value: 100, createdAt: new Date(now.getTime() - 10 * day) },
          { value: 100, createdAt: new Date(now.getTime() - 11 * day) },
        ];
      }
      return [];
    });

    const report = await compareToWeekAgo(now);
    const anyReg = report.regressions.find((r) => r.metric === "os_snapshot.any_usage_count");
    expect(anyReg).toBeDefined();
    expect(anyReg?.direction).toBe("regressed");
    expect(anyReg?.severity).toBe("critical");
  });
});

describe("drift-detector · alert composer", () => {
  it("composeDriftAlert returns null when only info-tier regressions exist", () => {
    const text = composeDriftAlert({
      date: "2026-05-12",
      regressions: [
        {
          metric: "os_snapshot.route_count",
          today: 99,
          baseline: 100,
          pctDelta: -0.01,
          absDelta: -1,
          direction: "regressed",
          severity: "info",
        },
      ],
      improvements: [],
      worst: "info",
    });
    expect(text).toBeNull();
  });

  it("composeDriftAlert emits formatted HTML when warn+ regressions exist", () => {
    const text = composeDriftAlert({
      date: "2026-05-12",
      regressions: [
        {
          metric: "os_snapshot.any_usage_count",
          today: 150,
          baseline: 100,
          pctDelta: 0.5,
          absDelta: 50,
          direction: "regressed",
          severity: "critical",
        },
      ],
      improvements: [],
      worst: "critical",
    });
    expect(text).not.toBeNull();
    expect(text).toContain("OS-drift");
    expect(text).toContain("any_usage_count");
    expect(text).toContain("+50.0%");
  });
});
