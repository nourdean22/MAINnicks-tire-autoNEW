/**
 * tests/api/devices-retire-stale.test.ts · 2026-09-07
 *
 * Retirement is an OWNER lifecycle decision, and it must keep history.
 * The route used to `deleteMany` the device rows (and their events and
 * commands) — "nuke the corpse". Now it marks them `RETIRED`: they leave
 * every health count (see classifyDevices) but their rows, events and
 * commands stay inspectable. Dry-run still only lists candidates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  smartDevice: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  deviceCommand: { deleteMany: vi.fn() },
  deviceEvent: { deleteMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));

import { POST } from "@/app/api/devices/retire-stale/route";

const post = (body: unknown) =>
  new NextRequest("https://example.test/api/devices/retire-stale", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const CANDIDATES = [
  { id: "cam-1", name: "Bay camera", platform: "V380", lastSeenAt: new Date("2026-04-14T00:00:00Z"), status: "OFFLINE" },
  { id: "cam-2", name: "Front camera", platform: "V380", lastSeenAt: new Date("2026-04-14T00:00:00Z"), status: "OFFLINE" },
];

describe("POST /api/devices/retire-stale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.smartDevice.findMany.mockResolvedValue(CANDIDATES);
    db.smartDevice.updateMany.mockResolvedValue({ count: CANDIDATES.length });
  });

  it("dry run lists candidates and writes nothing", async () => {
    const res = await POST(post({ olderThanDays: 30, dryRun: true }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data ?? body).toMatchObject({ dryRun: true, count: 2 });
    expect(db.smartDevice.updateMany).not.toHaveBeenCalled();
    expect(db.smartDevice.deleteMany).not.toHaveBeenCalled();
  });

  it("retires by marking RETIRED — rows, events and commands are kept", async () => {
    const res = await POST(post({ olderThanDays: 30 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect((body.data ?? body).retired).toBe(2);
    expect(db.smartDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["cam-1", "cam-2"] } }, data: expect.objectContaining({ status: "RETIRED" }) }),
    );
    expect(db.smartDevice.deleteMany).not.toHaveBeenCalled();
    expect(db.deviceEvent.deleteMany).not.toHaveBeenCalled();
    expect(db.deviceCommand.deleteMany).not.toHaveBeenCalled();
  });

  it("never re-retires: the candidate query excludes RETIRED by construction", async () => {
    await POST(post({ olderThanDays: 30 }));
    const where = db.smartDevice.findMany.mock.calls[0][0].where;
    expect(where.status.in).not.toContain("RETIRED");
  });

  it("nothing to do is an honest zero", async () => {
    db.smartDevice.findMany.mockResolvedValue([]);
    const res = await POST(post({}));
    expect((await res.json()).data ?? {}).toMatchObject({ retired: 0 });
    expect(db.smartDevice.updateMany).not.toHaveBeenCalled();
  });
});
