/**
 * buildSystemHealth (system.healthSummary, GET /api/health) device rollup.
 *
 * It counted every status that was not ONLINE as offline, so an ERROR device and a never-reported UNKNOWN device
 * (the schema default) both read as "offline". Same defect R3-01 fixed in buildDiagnostics; the split here mirrors
 * that shape: ERROR -> error, UNKNOWN -> notReporting, only OFFLINE (or any other status) -> offline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ deviceFindMany: vi.fn() }));

vi.mock("@/lib/utils/cache", () => ({
  cached: (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/inngest/functions", () => ({ fnA: {} }));
vi.mock("@/lib/prisma", () => {
  const empty = () => Promise.resolve([]);
  const prisma = {
    task: { groupBy: empty },
    commitment: { count: () => Promise.resolve(0) },
    smartDevice: { findMany: (...a: unknown[]) => h.deviceFindMany(...a) },
    journalThread: { groupBy: empty },
    brainMemory: { findMany: empty, count: () => Promise.resolve(0), findUnique: () => Promise.resolve(null) },
    cronJobLog: { findFirst: () => Promise.resolve(null) },
  };
  return { prisma, checkDbConnection: () => Promise.resolve({ connected: true, latency_ms: 1 }) };
});

import { buildSystemHealth } from "@/lib/services/system-pages";

// 2026-10-30: device rollups read rows (deviceTally applies the 7-day age rule), not status buckets.
// Contact just now, so OFFLINE rows land in the recent bucket these cases are about.
const rows = (status: string, n: number) =>
  Array.from({ length: n }, () => ({ status, lastSeenAt: new Date(), createdAt: new Date() }));

beforeEach(() => {
  h.deviceFindMany.mockReset();
});

describe("buildSystemHealth device rollup", () => {
  it("ERROR and UNKNOWN devices are not counted offline", async () => {
    h.deviceFindMany.mockResolvedValue([
      ...rows("ERROR", 1),
      ...rows("UNKNOWN", 2),
    ]);
    const { devices } = await buildSystemHealth();
    expect(devices).toEqual({ online: 0, offline: 0, offlineLong: 0, error: 1, notReporting: 2, retired: 0, total: 3 });
  });

  it("control: OFFLINE still counts offline and ONLINE stays online", async () => {
    h.deviceFindMany.mockResolvedValue([
      ...rows("OFFLINE", 2),
      ...rows("ONLINE", 3),
    ]);
    const { devices } = await buildSystemHealth();
    expect(devices).toMatchObject({ online: 3, offline: 2, total: 5 });
  });
});
