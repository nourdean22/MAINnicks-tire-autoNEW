/**
 * /system diagnostics device rollup (audit 10-X2 adjacent, 2026-10-10).
 *
 * SmartDevice.status defaults to "UNKNOWN" (schema.prisma). buildDiagnostics
 * counted every status that was not ONLINE or ERROR as offline, so a device
 * that has never reported read as "1 device offline" on the control tower.
 * Never-reported is its own state: not reporting, not offline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ deviceGroupBy: vi.fn() }));

vi.mock("@/lib/services/metrics", () => ({ getKpiSummary: () => Promise.resolve({}) }));
vi.mock("@/lib/prisma", () => {
  const count = { count: () => Promise.resolve(0) };
  const prisma = {
    mission: count,
    task: count,
    smartDevice: { count: () => Promise.resolve(0), groupBy: (...a: unknown[]) => h.deviceGroupBy(...a) },
    deviceEvent: count,
    chatMessage: count,
    aiGeneration: count,
    systemMetric: count,
    brainMemory: count,
    automationRule: count,
    integration: { findMany: () => Promise.resolve([]) },
  };
  return { prisma, checkDbConnection: () => Promise.resolve({ connected: true, latency_ms: 1 }) };
});

import { buildDiagnostics } from "@/lib/services/system-pages";

beforeEach(() => h.deviceGroupBy.mockReset());

describe("buildDiagnostics device rollup", () => {
  it("an UNKNOWN-status device is not reporting, not offline", async () => {
    h.deviceGroupBy.mockResolvedValue([{ status: "UNKNOWN", _count: { id: 1 } }]);
    const { devices } = await buildDiagnostics();
    expect(devices).toEqual({ online: 0, offline: 0, error: 0, notReporting: 1, total: 1 });
  });

  it("CONTROL: an OFFLINE device still counts offline, and ONLINE/ERROR keep their buckets", async () => {
    h.deviceGroupBy.mockResolvedValue([
      { status: "OFFLINE", _count: { id: 2 } },
      { status: "ONLINE", _count: { id: 3 } },
      { status: "ERROR", _count: { id: 1 } },
    ]);
    const { devices } = await buildDiagnostics();
    expect(devices).toMatchObject({ online: 3, offline: 2, error: 1, total: 6 });
  });
});
