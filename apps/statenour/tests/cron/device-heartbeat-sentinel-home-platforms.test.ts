/**
 * The sentinel watches the home Ring and Tuya rows · 2026-10-30 · Ring/Tuya W0.
 *
 * WATCHED was CAMERA / BRIDGE / V380 / FRIGATE. The 8 Tuya rows are a lock, a
 * water heater, remotes and a speaker: when the home agent dies they would
 * keep reading ONLINE forever. Asserted on the query the sentinel actually
 * runs, by evaluating its OR clause against the real row shapes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: { smartDevice: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock("@/lib/utils/http", () => ({ cronHandler: (h: unknown) => h }));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn(), formatTelegramNotification: vi.fn() }));
vi.mock("@/lib/notifications/push", () => ({ sendPush: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { runHeartbeatSentinel } from "@/app/api/cron/device-heartbeat-sentinel/route";

type Clause = Record<string, string>;
const matches = (or: Clause[], row: Record<string, string>) =>
  or.some((c) => Object.entries(c).every(([k, v]) => row[k] === v));

beforeEach(() => {
  vi.clearAllMocks();
  db.smartDevice.findMany.mockResolvedValue([]);
});

describe("sentinel WATCHED covers the home platforms", () => {
  it("the stale query selects a silent Tuya lock, a Tuya heater and a Ring camera", async () => {
    await runHeartbeatSentinel(new Date("2026-10-30T20:00:00Z"));
    const or = db.smartDevice.findMany.mock.calls[0][0].where.OR as Clause[];
    expect(matches(or, { platform: "TUYA", deviceType: "LOCK" })).toBe(true);
    expect(matches(or, { platform: "TUYA", deviceType: "HEATER" })).toBe(true);
    expect(matches(or, { platform: "RING", deviceType: "SENSOR" })).toBe(true);
  });

  it("flipping a stored Tuya row OFFLINE does not carry its local_key forward", async () => {
    const lastSeenAt = new Date("2026-10-30T19:00:00Z");
    db.smartDevice.findMany.mockResolvedValueOnce([
      { id: "d-lock", name: "Nour Roomlock", platformDeviceId: "eb1060", lastSeenAt, location: "home", metadata: { category: "ms", local_key: "LANKEY" } },
    ]);
    db.smartDevice.updateMany.mockResolvedValue({ count: 1 });
    await runHeartbeatSentinel(new Date("2026-10-30T20:00:00Z"));
    const written = db.smartDevice.updateMany.mock.calls[0][0].data.metadata;
    expect(written.category).toBe("ms");
    expect(written.sentinel).toBeTruthy();
    expect(JSON.stringify(written)).not.toContain("LANKEY");
  });

  it("positive control: the shop V380 camera is still watched, a manual row is not", async () => {
    await runHeartbeatSentinel(new Date("2026-10-30T20:00:00Z"));
    const or = db.smartDevice.findMany.mock.calls[0][0].where.OR as Clause[];
    expect(matches(or, { platform: "V380", deviceType: "CAMERA" })).toBe(true);
    expect(matches(or, { platform: "MANUAL", deviceType: "LIGHT" })).toBe(false);
  });
});
