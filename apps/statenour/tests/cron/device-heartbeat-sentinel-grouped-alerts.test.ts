/**
 * Ring W1b (2026-10-30): a stopped poller pages ONCE.
 *
 * The Ring poller (worker, PR 3413) writes 5 camera rows on one tick. When it
 * stops, all 5 go silent together and the sentinel flipped and paged each one:
 * 5 Telegrams + 5 pushes for one fault. Now each row still flips on its own
 * (conditional write unchanged) and keeps its own delivery record, but the
 * page goes out once per platform per tick. A lone device keeps today's alert.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, mockSendTelegram, mockSendPush } = vi.hoisted(() => ({
  db: { smartDevice: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
  mockSendTelegram: vi.fn(),
  mockSendPush: vi.fn(),
}));

vi.mock("@/lib/utils/http", () => ({ cronHandler: (h: unknown) => h }));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: mockSendTelegram,
  formatTelegramNotification: (title: string, body: string) => `${title}\n${body}`,
}));
vi.mock("@/lib/notifications/push", () => ({ sendPush: mockSendPush }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { runHeartbeatSentinel } from "@/app/api/cron/device-heartbeat-sentinel/route";

const NOW = new Date("2026-10-30T22:00:00Z");
const SILENT_AT = new Date("2026-10-30T21:30:00Z");
const ring = (n: number) => ({
  id: `d-ring-${n}`,
  name: `Ring ${n}`,
  platform: "RING",
  platformDeviceId: `ring-${n}`,
  lastSeenAt: SILENT_AT,
  metadata: null,
  location: "home",
});
const v380 = { id: "d-sign", name: "Shop Sign", platform: "V380", platformDeviceId: "v380-shopsign", lastSeenAt: SILENT_AT, metadata: null, location: "shop" };

/** The persisted delivery record per device id, from the follow-up update calls. */
const deliveries = () =>
  Object.fromEntries(
    db.smartDevice.update.mock.calls.map((c) => [c[0].where.id, c[0].data.metadata.sentinel as { alertedAt: string | null; alertAttempts: number }]),
  );

beforeEach(() => {
  vi.clearAllMocks();
  db.smartDevice.updateMany.mockResolvedValue({ count: 1 });
  db.smartDevice.update.mockResolvedValue({});
  mockSendTelegram.mockResolvedValue(true);
  mockSendPush.mockResolvedValue({ sent: 1 });
});

describe("sentinel pages once per platform per tick", () => {
  it("5 Ring cameras silent together: 5 rows flip, ONE Telegram, ONE push, every row records the delivery", async () => {
    const five = [1, 2, 3, 4, 5].map(ring);
    db.smartDevice.findMany.mockResolvedValueOnce(five).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await runHeartbeatSentinel(NOW);

    expect(db.smartDevice.updateMany).toHaveBeenCalledTimes(5);
    expect(mockSendTelegram).toHaveBeenCalledTimes(1);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(String(mockSendTelegram.mock.calls[0][0])).toMatch(/5 RING devices/);
    for (const d of five) expect(String(mockSendTelegram.mock.calls[0][0])).toContain(d.name);
    expect(mockSendPush.mock.calls[0][0].tag).toBe("device-offline:platform:RING@system");
    const rec = deliveries();
    expect(Object.keys(rec).sort()).toEqual(five.map((d) => d.id).sort());
    expect(Object.values(rec).every((r) => r.alertedAt === NOW.toISOString() && r.alertAttempts === 1)).toBe(true);
    expect(res.flipped.every((f) => f.alerted)).toBe(true);
  });

  it("two platforms silent in one tick: one page each", async () => {
    db.smartDevice.findMany.mockResolvedValueOnce([ring(1), ring(2), v380]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await runHeartbeatSentinel(NOW);
    expect(mockSendTelegram).toHaveBeenCalledTimes(2);
    expect(mockSendPush.mock.calls.map((c) => c[0].tag).sort()).toEqual(["device-offline:platform:RING@system", "device-offline:v380-shopsign"]);
  });

  it("a grouped page nobody received leaves EVERY row owed, and the retry pass pages them once", async () => {
    const two = [ring(1), ring(2)];
    mockSendTelegram.mockResolvedValue(false);
    mockSendPush.mockResolvedValue({ sent: 0 });
    db.smartDevice.findMany.mockResolvedValueOnce(two).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const first = await runHeartbeatSentinel(NOW);
    expect(first.ok).toBe(false);
    expect(Object.values(deliveries()).every((r) => r.alertedAt === null)).toBe(true);

    vi.clearAllMocks();
    db.smartDevice.update.mockResolvedValue({});
    mockSendTelegram.mockResolvedValue(true);
    mockSendPush.mockResolvedValue({ sent: 1 });
    const owed = two.map((d) => ({
      ...d,
      metadata: { sentinel: { offlineAt: NOW.toISOString(), lastSeenAt: SILENT_AT.toISOString(), alertedAt: null, alertAttempts: 1 } },
    }));
    db.smartDevice.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(owed);
    const second = await runHeartbeatSentinel(new Date(NOW.getTime() + 15 * 60_000));
    expect(mockSendTelegram).toHaveBeenCalledTimes(1);
    expect(second.retried).toHaveLength(2);
    expect(Object.values(deliveries()).every((r) => r.alertedAt !== null && r.alertAttempts === 2)).toBe(true);
  });

  it("positive control: a lone device keeps the per-device alert and tag", async () => {
    db.smartDevice.findMany.mockResolvedValueOnce([v380]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await runHeartbeatSentinel(NOW);
    expect(mockSendTelegram).toHaveBeenCalledTimes(1);
    expect(mockSendPush.mock.calls[0][0].tag).toBe("device-offline:v380-shopsign");
    expect(String(mockSendTelegram.mock.calls[0][0])).toContain("v380-shopsign");
  });
});
