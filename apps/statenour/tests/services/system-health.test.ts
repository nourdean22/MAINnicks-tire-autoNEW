/**
 * buildHealthReport tests · 2026-08-19.
 *
 * First coverage for the module that computes the ENTIRE /system/health
 * dashboard — it had none, and the 2026-08-19 audit found the page
 * rendering "OPERATIONAL · ALL CLEAR" over 1,423 errors and a 2% cron
 * failure rate because of measurement defects in here. These tests pin
 * the fixed semantics:
 *
 *   1. cron "partial" (mega fan-out degraded heartbeat) is NOT a hard
 *      failure — it is counted separately.
 *   2. error patterns aggregate over the WHOLE window in SQL (not the
 *      newest-50 sample) and volatile ids/digits are normalized so one
 *      root cause is one pattern.
 *   3. a probe row older than 48h is marked stale.
 *   4. an unparseable probe row is NOT ok (fail closed — `{} !== false`
 *      used to read as healthy).
 *   5. errors are broken down by level so warns stop rendering as errors.
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

/** Route every mocked read to a benign empty default, then override per test. */
function primeDefaults() {
  h.prisma.cronJobLog.findMany.mockResolvedValue([]);
  h.prisma.errorLog.count.mockResolvedValue(0);
  h.prisma.errorLog.groupBy.mockResolvedValue([]);
  // $queryRaw serves topErrors then distinctPatterns (call order in the
  // Promise.all is stable); default both to empty.
  h.prisma.$queryRaw.mockResolvedValue([]);
  h.prisma.captureInboxItem.count.mockResolvedValue(0);
  h.prisma.captureInboxItem.findFirst.mockResolvedValue(null);
  h.prisma.commitment.count.mockResolvedValue(0);
  h.prisma.task.count.mockResolvedValue(0);
  h.prisma.brainMemory.findMany.mockResolvedValue([]);
  h.prisma.brainMemory.findUnique.mockResolvedValue(null);
  h.prisma.brainMemory.findFirst.mockResolvedValue(null);
  h.prisma.brainDump.findFirst.mockResolvedValue(null);
  h.prisma.reflection.findFirst.mockResolvedValue(null);
  h.prisma.situationLog.count.mockResolvedValue(0);
  h.prisma.vectorEmbedding.groupBy.mockResolvedValue([]);
  h.prisma.systemMetric.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const table of Object.values(h.prisma)) {
    if (typeof table === "function") {
      (table as ReturnType<typeof vi.fn>).mockReset();
      continue;
    }
    for (const m of Object.values(table)) (m as ReturnType<typeof vi.fn>).mockReset();
  }
  primeDefaults();
  delete process.env.VAPI_API_KEY; // voice probe short-circuits to null
});

describe("buildHealthReport · cron status semantics", () => {
  it("counts partial separately from failed — never as a hard failure", async () => {
    h.prisma.cronJobLog.findMany
      .mockResolvedValueOnce([
        { jobName: "mega-evening", status: "partial", duration: 100, createdAt: new Date() },
        { jobName: "mega-evening", status: "success", duration: 100, createdAt: new Date() },
        { jobName: "predict", status: "failed", duration: 50, createdAt: new Date() },
      ])
      // prior window
      .mockResolvedValueOnce([{ status: "partial" }, { status: "failed" }]);

    const r = await buildHealthReport({ range: "7d" });

    expect(r.cron.failureCount).toBe(1); // only `failed`
    expect(r.cron.partialCount).toBe(1);
    const mega = r.cron.jobs.find((j) => j.jobName === "mega-evening")!;
    expect(mega.partial).toBe(1);
    expect(mega.failed).toBe(0);
    expect(mega.healthy).toBe(true); // partial alone does not mark unhealthy
    // prior window: partial excluded from failures there too
    expect(r.previous.cronFailures).toBe(1);
  });
});

describe("buildHealthReport · error patterns", () => {
  it("returns SQL-aggregated patterns and window-wide distinct count", async () => {
    h.prisma.errorLog.count.mockResolvedValue(1423);
    h.prisma.$queryRaw
      .mockResolvedValueOnce([
        { msg: "[provider] embed timeout", count: 900n },
        { msg: "[/api/cron/predict] all_failed", count: 300n },
      ])
      .mockResolvedValueOnce([{ count: 37n }]);

    const r = await buildHealthReport({ range: "30d" });

    expect(r.errors.total).toBe(1423);
    // bigint coerced at the boundary — JSON.stringify must not throw
    expect(r.errors.topPatterns).toEqual([
      { msg: "[provider] embed timeout", count: 900 },
      { msg: "[/api/cron/predict] all_failed", count: 300 },
    ]);
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r.errors.distinctPatterns).toBe(37);
  });

  it("exposes the level breakdown so warns are separable from errors", async () => {
    h.prisma.errorLog.groupBy.mockResolvedValue([
      { level: "warn", _count: { _all: 968 } },
      { level: "error", _count: { _all: 455 } },
    ]);

    const r = await buildHealthReport({ range: "30d" });

    expect(r.errors.byLevel).toEqual([
      { level: "warn", count: 968 },
      { level: "error", count: 455 },
    ]);
  });
});

describe("buildHealthReport · data-source probes", () => {
  const freshDate = () => new Date(Date.now() - 60 * 60 * 1000); // 1h old
  const staleDate = () => new Date(Date.now() - 72 * 60 * 60 * 1000); // 72h old

  function probeRow(name: string, ok: boolean, updatedAt: Date) {
    return {
      key: `${name}_2026-08-19`,
      content: JSON.stringify({ probe: name, kind: "bridge", ok }),
      updatedAt,
    };
  }

  it("marks probes older than 48h stale — a dead probe cron is not a green canary", async () => {
    h.prisma.brainMemory.findMany.mockResolvedValue([
      probeRow("bridge.revenue_today", true, staleDate()),
      probeRow("legacy.dailyHabits", true, freshDate()),
    ]);

    const r = await buildHealthReport({ range: "7d" });

    expect(r.operational.dataSources).not.toBeNull();
    const ds = r.operational.dataSources!;
    expect(ds.total).toBe(2);
    expect(ds.stale).toBe(1);
    const staleProbe = ds.probes.find((p) => p.name === "bridge.revenue_today")!;
    expect(staleProbe.stale).toBe(true);
    expect(staleProbe.reason).toMatch(/last ran \d+h ago/);
    expect(ds.probes.find((p) => p.name === "legacy.dailyHabits")!.stale).toBe(false);
  });

  it("fails CLOSED on an unparseable probe row (was: `{} !== false` read as healthy)", async () => {
    h.prisma.brainMemory.findMany.mockResolvedValue([
      { key: "bridge.revenue_today_2026-08-19", content: "{corrupt", updatedAt: freshDate() },
    ]);

    const r = await buildHealthReport({ range: "7d" });

    const ds = r.operational.dataSources!;
    expect(ds.failing).toBe(1);
    expect(ds.probes[0].ok).toBe(false);
    expect(ds.probes[0].reason).toMatch(/unparseable/);
  });

  it("treats a missing ok field as NOT ok — only an explicit true passes", async () => {
    h.prisma.brainMemory.findMany.mockResolvedValue([
      {
        key: "x_2026-08-19",
        content: JSON.stringify({ probe: "x", kind: "shop" }), // no ok field
        updatedAt: freshDate(),
      },
    ]);

    const r = await buildHealthReport({ range: "7d" });
    expect(r.operational.dataSources!.probes[0].ok).toBe(false);
  });

  it("keeps null (read failed) distinct from empty (no probes)", async () => {
    h.prisma.brainMemory.findMany.mockImplementation((args: any) => {
      if (args?.where?.category === "data_source_probe") {
        return Promise.reject(new Error("db down"));
      }
      return Promise.resolve([]);
    });

    const r = await buildHealthReport({ range: "7d" });
    expect(r.operational.dataSources).toBeNull();
  });
});
