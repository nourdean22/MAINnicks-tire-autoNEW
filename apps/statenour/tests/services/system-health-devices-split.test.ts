/**
 * buildSystemHealth (system.healthSummary, GET /api/health) device rollup.
 *
 * It counted every status that was not ONLINE as offline, so an ERROR device and a never-reported UNKNOWN device
 * (the schema default) both read as "offline". Same defect R3-01 fixed in buildDiagnostics; the split here mirrors
 * that shape: ERROR -> error, UNKNOWN -> notReporting, only OFFLINE (or any other status) -> offline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ deviceGroupBy: vi.fn() }));

vi.mock("@/lib/utils/cache", () => ({
  cached: (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/inngest/functions", () => ({ fnA: {} }));
vi.mock("@/lib/prisma", () => {
  const empty = () => Promise.resolve([]);
  const prisma = {
    task: { groupBy: empty },
    commitment: { count: () => Promise.resolve(0) },
    smartDevice: { groupBy: (...a: unknown[]) => h.deviceGroupBy(...a) },
    journalThread: { groupBy: empty },
    brainMemory: { findMany: empty, count: () => Promise.resolve(0), findUnique: () => Promise.resolve(null) },
    cronJobLog: { findFirst: () => Promise.resolve(null) },
  };
  return { prisma, checkDbConnection: () => Promise.resolve({ connected: true, latency_ms: 1 }) };
});

import { buildSystemHealth } from "@/lib/services/system-pages";

beforeEach(() => {
  h.deviceGroupBy.mockReset();
});

describe("buildSystemHealth device rollup", () => {
  it("ERROR and UNKNOWN devices are not counted offline", async () => {
    h.deviceGroupBy.mockResolvedValue([
      { status: "ERROR", _count: { id: 1 } },
      { status: "UNKNOWN", _count: { id: 2 } },
    ]);
    const { devices } = await buildSystemHealth();
    expect(devices).toEqual({ online: 0, offline: 0, error: 1, notReporting: 2, total: 3 });
  });

  it("control: OFFLINE still counts offline and ONLINE stays online", async () => {
    h.deviceGroupBy.mockResolvedValue([
      { status: "OFFLINE", _count: { id: 2 } },
      { status: "ONLINE", _count: { id: 3 } },
    ]);
    const { devices } = await buildSystemHealth();
    expect(devices).toMatchObject({ online: 3, offline: 2, total: 5 });
  });
});
