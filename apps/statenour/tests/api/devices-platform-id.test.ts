/**
 * tests/api/devices-platform-id.test.ts · 2026-09-08
 *
 * The camera bridge addresses devices by `platformDeviceId`
 * ("v380-shopsign" — camera-bridge/visitd config, README, PR #315), while
 * every `[id]` route resolved `SmartDevice.id`, a cuid the bridge can never
 * learn. Prod receipt: v380-shopsign = cmn7h45nu0009rls02e3rypx0, and
 * `device_events` holds zero rows for it (2026-09-08 probe). The June test
 * device only passed because it was created with id == platformDeviceId.
 *
 * POSITIVE CONTROL: against the unfixed routes this file fails — every
 * slug-addressed call returns 404 "Device not found". Recorded on
 * 2026-09-08 before the fix landed (see the PR body).
 *
 * The Prisma mock keeps real semantics: `findUnique` matches the cuid only;
 * `findFirst` honours an `OR` of id / platformDeviceId; `update` throws
 * when `where.id` is not the cuid (what Prisma does on a miss).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const DEVICE = {
  id: "cmn7h45nu0009rls02e3rypx0",
  platformDeviceId: "v380-shopsign",
  name: "Shop Sign Camera",
  platform: "V380",
  deviceType: "CAMERA",
  status: "OFFLINE",
  lastSeenAt: null as Date | null,
  metadata: null as unknown,
};

const db = vi.hoisted(() => ({
  smartDevice: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  deviceEvent: { createMany: vi.fn(), findMany: vi.fn() },
  deviceCommand: { findMany: vi.fn(), create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));
vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireSession: vi.fn(async () => ({ id: "op", email: "op@test", role: "operator" })),
  safeEqual: () => true,
}));
const handleVehicleEvent = vi.hoisted(() => vi.fn(async () => "evt_1"));
vi.mock("@/lib/services/vehicle-detection", () => ({ handleVehicleEvent }));

import { POST as postEvents } from "@/app/api/devices/[id]/events/route";
import { PATCH as patchDevice } from "@/app/api/devices/[id]/route";
import { GET as getCommands } from "@/app/api/devices/[id]/command/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`https://example.test${path}`, {
    method,
    headers: { "content-type": "application/json", "x-sync-key": "test-key" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const VEHICLE_EVENT = {
  schemaVersion: 2,
  event: "vehicle_detected",
  eventId: "e1",
  source: "frigate",
  timestamp: "2026-09-08T16:02:11Z",
  data: { cameraId: "sign", visitId: "v-1", trackId: "t-1", zone: "front_lot", state: "CONFIRMED_ARRIVAL" },
};

describe("[id] device routes resolve platformDeviceId as well as the cuid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.smartDevice.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === DEVICE.id ? DEVICE : null,
    );
    db.smartDevice.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const ors = (where?.OR as Array<Record<string, unknown>> | undefined) ?? [where];
      return ors.some((w) => w.id === DEVICE.id || w.platformDeviceId === DEVICE.platformDeviceId) ? DEVICE : null;
    });
    db.smartDevice.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      if (where.id !== DEVICE.id) throw new Error("Record to update not found.");
      return { ...DEVICE, ...data };
    });
    db.deviceEvent.createMany.mockResolvedValue({ count: 1 });
    db.deviceCommand.findMany.mockResolvedValue([]);
  });

  it("POST /api/devices/v380-shopsign/events ingests and hands the cuid to handleVehicleEvent", async () => {
    const res = await postEvents(req("/api/devices/v380-shopsign/events", "POST", VEHICLE_EVENT), ctx("v380-shopsign"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ synced: 1 });
    expect(handleVehicleEvent).toHaveBeenCalledWith(DEVICE.id, expect.objectContaining({ event: "vehicle_detected" }));
    expect(db.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DEVICE.id }, data: expect.objectContaining({ status: "ONLINE" }) }),
    );
  });

  it("POST by cuid keeps working (back-compat for the cockpit test panel)", async () => {
    const res = await postEvents(req(`/api/devices/${DEVICE.id}/events`, "POST", VEHICLE_EVENT), ctx(DEVICE.id));
    expect(res.status).toBe(200);
    expect(handleVehicleEvent).toHaveBeenCalledWith(DEVICE.id, expect.anything());
  });

  it("PATCH /api/devices/v380-shopsign (bridge heartbeat) updates the cuid row", async () => {
    const res = await patchDevice(
      req("/api/devices/v380-shopsign", "PATCH", { status: "ONLINE", lastSeenAt: "2026-09-08T16:03:00Z" }),
      ctx("v380-shopsign"),
    );
    expect(res.status).toBe(200);
    expect(db.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DEVICE.id }, data: expect.objectContaining({ status: "ONLINE" }) }),
    );
  });

  it("GET /api/devices/v380-shopsign/command polls by the cuid and 404s an unknown device instead of an empty list", async () => {
    const ok = await getCommands(req("/api/devices/v380-shopsign/command", "GET"), ctx("v380-shopsign"));
    expect(ok.status).toBe(200);
    expect(db.deviceCommand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deviceId: DEVICE.id }) }),
    );
    const missing = await getCommands(req("/api/devices/nope/command", "GET"), ctx("nope"));
    expect(missing.status).toBe(404);
  });

  it("an unknown id is still fail-closed (404), never a silent no-op", async () => {
    const res = await postEvents(req("/api/devices/ghost/events", "POST", VEHICLE_EVENT), ctx("ghost"));
    expect(res.status).toBe(404);
    expect(handleVehicleEvent).not.toHaveBeenCalled();
    const hb = await patchDevice(req("/api/devices/ghost", "PATCH", { status: "ONLINE" }), ctx("ghost"));
    expect(hb.status).toBe(404);
  });

  it("POST ?dryRun=1 validates the payload and writes nothing (the gate G0 probe)", async () => {
    const res = await postEvents(req("/api/devices/v380-shopsign/events?dryRun=1", "POST", VEHICLE_EVENT), ctx("v380-shopsign"));
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data).toMatchObject({ dryRun: true, valid: true, platformDeviceId: "v380-shopsign", deviceId: DEVICE.id });
    expect(data.events[0]).toMatchObject({ valid: true, state: "CONFIRMED_ARRIVAL", wouldAlert: true });
    expect(handleVehicleEvent).not.toHaveBeenCalled();
    expect(db.smartDevice.update).not.toHaveBeenCalled();
    expect(db.deviceEvent.createMany).not.toHaveBeenCalled();

    const bad = await postEvents(
      req("/api/devices/v380-shopsign/events?dryRun=1", "POST", { ...VEHICLE_EVENT, data: { ...VEHICLE_EVENT.data, confidence: "high" } }),
      ctx("v380-shopsign"),
    );
    expect((await bad.json()).data).toMatchObject({ dryRun: true, valid: false });
    expect(handleVehicleEvent).not.toHaveBeenCalled();
  });
});
