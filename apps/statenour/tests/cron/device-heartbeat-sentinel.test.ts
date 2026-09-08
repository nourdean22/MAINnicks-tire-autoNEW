/**
 * tests/cron/device-heartbeat-sentinel.test.ts · 2026-09-08
 *
 * The sentinel exists because the camera bridge can die silently (the April
 * 2026 local agent did, for months). Three behaviours are pinned:
 *   1. a device that reported once and went silent flips OFFLINE and pages
 *      exactly once (the canary: remove the alert and this fails);
 *   2. a device that NEVER reported is not even a candidate (#1737 rule) —
 *      asserted on the query shape, because that is where the guarantee lives;
 *   3. a device the sentinel flagged that resumes heartbeats is cleared with a
 *      low push, and `alerted` reflects delivery, never intent;
 *   4. the flip is a CONDITIONAL write - a heartbeat that lands between the
 *      read and the write wins, and nothing pages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, mockSendTelegram, mockSendPush } = vi.hoisted(() => ({
  db: { smartDevice: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
  mockSendTelegram: vi.fn(),
  mockSendPush: vi.fn(),
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: mockSendTelegram,
  formatTelegramNotification: (title: string, body: string) => `${title}\n${body}`,
}));
vi.mock("@/lib/notifications/push", () => ({ sendPush: mockSendPush }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { runHeartbeatSentinel, STALE_AFTER_MS, GET } from "@/app/api/cron/device-heartbeat-sentinel/route";

const NOW = new Date("2026-09-08T16:00:00Z");
const SILENT = {
  id: "cmn-sign",
  name: "Shop Sign Camera",
  platformDeviceId: "v380-shopsign",
  lastSeenAt: new Date(NOW.getTime() - STALE_AFTER_MS - 60_000),
  metadata: { source: "V380" },
};

describe("device-heartbeat-sentinel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.smartDevice.findMany.mockResolvedValue([]);
    db.smartDevice.update.mockResolvedValue({});
    db.smartDevice.updateMany.mockResolvedValue({ count: 1 });
    mockSendTelegram.mockResolvedValue(true);
    mockSendPush.mockResolvedValue({ sent: 1, failed: 0 });
  });

  it("flips a silent device OFFLINE and pages once per transition (the canary)", async () => {
    db.smartDevice.findMany.mockResolvedValueOnce([SILENT]).mockResolvedValueOnce([]);
    const res = await runHeartbeatSentinel(NOW);
    expect(res.flipped).toHaveLength(1);
    expect(res.flipped[0]).toMatchObject({ platformDeviceId: "v380-shopsign", alerted: true, silentMinutes: 21 });
    expect(db.smartDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cmn-sign", status: "ONLINE", lastSeenAt: { lt: new Date(NOW.getTime() - STALE_AFTER_MS) } },
        data: expect.objectContaining({ status: "OFFLINE", metadata: expect.objectContaining({ sentinel: expect.any(Object) }) }),
      }),
    );
    expect(mockSendTelegram).toHaveBeenCalledTimes(1);
    expect(mockSendPush).toHaveBeenCalledWith(expect.objectContaining({ tag: "device-offline:v380-shopsign", level: "high" }));
    expect(res.ok).toBe(true);
  });

  it("never-reported devices cannot be candidates: the stale query requires lastSeenAt < cutoff and status ONLINE", async () => {
    await runHeartbeatSentinel(NOW);
    const staleWhere = db.smartDevice.findMany.mock.calls[0][0].where;
    expect(staleWhere.status).toBe("ONLINE");
    expect(staleWhere.lastSeenAt).toEqual({ lt: new Date(NOW.getTime() - STALE_AFTER_MS) });
    expect(mockSendTelegram).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("a device that resumed heartbeats is cleared and announced quietly", async () => {
    const back = { ...SILENT, lastSeenAt: NOW, metadata: { source: "V380", sentinel: { offlineAt: "2026-09-08T15:00:00Z", lastSeenAt: null } } };
    db.smartDevice.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([back]);
    const res = await runHeartbeatSentinel(NOW);
    expect(res.recovered).toEqual([{ id: "cmn-sign", platformDeviceId: "v380-shopsign", offlineAt: "2026-09-08T15:00:00Z" }]);
    expect(db.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cmn-sign" }, data: { metadata: { source: "V380" } } }),
    );
    expect(mockSendPush).toHaveBeenCalledWith(expect.objectContaining({ tag: "device-online:v380-shopsign", level: "low" }));
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  it("`alerted` reflects delivery: a failed Telegram send is reported, not claimed", async () => {
    db.smartDevice.findMany.mockResolvedValueOnce([SILENT]).mockResolvedValueOnce([]);
    mockSendTelegram.mockResolvedValue(false);
    const res = await runHeartbeatSentinel(NOW);
    expect(res.flipped[0].alerted).toBe(false);
    expect(res.ok).toBe(false);
    // the state change still happened — silence is the failure, not the flip
    expect(db.smartDevice.updateMany).toHaveBeenCalledTimes(1);
  });

  it("a heartbeat that lands between the read and the write wins: no flip, no page", async () => {
    db.smartDevice.findMany.mockResolvedValueOnce([SILENT]).mockResolvedValueOnce([]);
    db.smartDevice.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await runHeartbeatSentinel(NOW);
    expect(res.flipped).toEqual([]);
    expect(res.ok).toBe(true);
    expect(mockSendTelegram).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("push failures never break the sweep", async () => {
    db.smartDevice.findMany.mockResolvedValueOnce([SILENT]).mockResolvedValueOnce([]);
    mockSendPush.mockRejectedValue(new Error("vapid missing"));
    const res = await runHeartbeatSentinel(NOW);
    expect(res.flipped).toHaveLength(1);
    expect(res.flipped[0].alerted).toBe(true);
  });

  it("is exported as a cron GET handler", async () => {
    expect(typeof GET).toBe("function");
  });
});
