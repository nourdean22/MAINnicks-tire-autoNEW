/**
 * Nick's harness node rides the 15-minute device sentinel tick. Its failure, in any shape, never fails the
 * sentinel (job 2026-11-06-harness-control-nick-node).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, heartbeatNick } = vi.hoisted(() => ({
  db: { smartDevice: { findMany: vi.fn(async () => []), update: vi.fn(), updateMany: vi.fn() } },
  heartbeatNick: vi.fn(),
}));

vi.mock("@/lib/utils/http", () => ({ cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h }));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn(), formatTelegramNotification: () => "" }));
vi.mock("@/lib/notifications/push", () => ({ sendPush: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/services/harness-control", () => ({ heartbeatNick }));

import { GET } from "@/app/api/cron/device-heartbeat-sentinel/route";

const tick = () => (GET as unknown as () => Promise<Record<string, unknown>>)();

describe("device sentinel · Nick's harness heartbeat", () => {
  beforeEach(() => heartbeatNick.mockReset());

  it("POSITIVE CONTROL: a good stamp is reported beside the sentinel result", async () => {
    heartbeatNick.mockResolvedValueOnce("stamped");
    expect(await tick()).toMatchObject({ nickHarness: "stamped" });
  });

  it("a heartbeat that reports its own failure leaves the sentinel result whole", async () => {
    heartbeatNick.mockResolvedValueOnce("failed: db down");
    const out = await tick();
    expect(out.nickHarness).toBe("failed: db down");
    expect(Object.keys(out).length).toBeGreaterThan(1);
  });

  it("a heartbeat that throws anyway never fails the tick", async () => {
    heartbeatNick.mockRejectedValueOnce(new Error("boom"));
    expect(await tick()).toMatchObject({ nickHarness: "failed: boom" });
  });
});
