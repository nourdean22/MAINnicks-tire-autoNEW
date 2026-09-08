/**
 * tests/services/vehicle-detection.test.ts · rewritten 2026-09-08 (ADR-0017).
 *
 * Covers the arrival ingest contract end to end against an in-memory Prisma
 * that honours the JSON-path filters the service actually issues (data.path
 * + equals, AND lists). Cases: v1 track dedupe (kept from the original
 * file), v2 visit dedupe across a Frigate re-id, eventId idempotency, quiet
 * hours, per-camera cooldown, payload validation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { handleVehicleEvent, isQuietHoursET } from "@/lib/services/vehicle-detection";
import * as telegram from "@/lib/services/telegram";
import * as push from "@/lib/notifications/push";
import * as datetime from "@/lib/utils/datetime";

vi.mock("@/lib/services/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof telegram>();
  return {
    ...actual,
    sendTelegramWithButtons: vi.fn().mockResolvedValue({ ok: true, messageId: 999123 }),
    editTelegramMessage: vi.fn().mockResolvedValue(true),
  };
});
vi.mock("@/lib/feature-flags", () => ({
  getFlag: vi.fn().mockReturnValue({ key: "NICK_ARRIVAL_INTELLIGENCE", isOn: true }),
}));
vi.mock("@/lib/notifications/push", () => ({
  sendPush: vi.fn().mockResolvedValue({ sent: 1, failed: 0 }),
}));
const mockLink = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/services/vehicle-customer-link", () => ({ linkVisitToCustomer: mockLink }));
vi.mock("@/lib/utils/datetime", async (importOriginal) => {
  const actual = await importOriginal<typeof datetime>();
  return { ...actual, hourET: vi.fn(() => 12) };
});

type Row = { id: string; deviceId: string; event: string; data: Record<string, unknown>; createdAt: Date; timestamp: Date };
const store = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>>, seq: 0 }));

vi.mock("@/lib/prisma", () => {
  const dig = (obj: unknown, path: string[]) => path.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
  const matchData = (row: Row, cond?: { path: string[]; equals: unknown }) => !cond || dig(row.data, cond.path) === cond.equals;
  const matches = (row: Row, where: Record<string, unknown>) =>
    (!where.deviceId || row.deviceId === where.deviceId) &&
    (!where.event || row.event === where.event) &&
    matchData(row, where.data as { path: string[]; equals: unknown } | undefined) &&
    ((where.AND as Array<{ data: { path: string[]; equals: unknown } }> | undefined) ?? []).every((c) => matchData(row, c.data));
  return {
    prisma: {
      deviceEvent: {
        deleteMany: vi.fn(async () => { store.events.length = 0; return { count: 0 }; }),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const rows = (store.events as Row[]).filter((r) => matches(r, where));
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return rows[0] ?? null;
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `event_${++store.seq}`, createdAt: new Date(), ...data };
          store.events.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = store.events.find((r) => r.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.events.find((r) => r.id === where.id) ?? null),
      },
    },
  };
});

const deviceId = "cmn7h45nu0009rls02e3rypx0";
const base = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  event: "vehicle_detected",
  source: "frigate",
  timestamp: new Date().toISOString(),
  ...extra,
  data: {
    cameraId: "sign",
    cameraName: "Shop Sign Camera",
    zone: "front_lot",
    zoneName: "Front Lot",
    label: "car",
    confidence: 0.9,
    dwellSeconds: 0,
    plate: { status: "NONE" },
    ...data,
  },
});

describe("Arrival Intelligence ingest", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(datetime.hourET).mockReturnValue(12);
    await prisma.deviceEvent.deleteMany({});
  });

  it("v1: ENTERED_ZONE creates the row, sends Telegram and a tagged push", async () => {
    const id = await handleVehicleEvent(deviceId, base({ state: "ENTERED_ZONE", trackId: "track-xyz-123" }));
    const row = await prisma.deviceEvent.findUnique({ where: { id } });
    expect(row?.event).toBe("vehicle_detected");
    expect((row?.data as Record<string, unknown>).trackId).toBe("track-xyz-123");
    expect((row?.data as Record<string, unknown>).telegramMessageId).toBe("999123");
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBeNull();
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    expect(push.sendPush).toHaveBeenCalledWith(expect.objectContaining({ tag: "arrival:track-xyz-123", level: "medium" }));
  });

  it("v1: the same trackId updates the row and edits the Telegram message instead of sending again", async () => {
    const first = await handleVehicleEvent(deviceId, base({ state: "ENTERED_ZONE", trackId: "t-1", dwellSeconds: 1 }));
    const second = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", trackId: "t-1", dwellSeconds: 50 }));
    expect(second).toBe(first);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    expect(telegram.editTelegramMessage).toHaveBeenCalledOnce();
    const row = await prisma.deviceEvent.findUnique({ where: { id: first } });
    expect((row?.data as Record<string, unknown>).state).toBe("CONFIRMED_ARRIVAL");
  });

  it("v2: visitId keys the visit across a Frigate re-id (new trackId, same visit)", async () => {
    const first = await handleVehicleEvent(deviceId, base({ state: "ENTERED_ZONE", visitId: "visit-A", trackId: "t-1" }, { schemaVersion: 2, eventId: "e1" }));
    const second = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "visit-A", trackId: "t-9", dwellSeconds: 47 }, { schemaVersion: 2, eventId: "e2" }));
    expect(second).toBe(first);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    expect(push.sendPush).toHaveBeenCalledWith(expect.objectContaining({ tag: "arrival:visit-A" }));
  });

  it("v2: a repeated eventId is a retry — same row, no second alert", async () => {
    const payload = base({ state: "CONFIRMED_ARRIVAL", visitId: "visit-B", trackId: "t-2" }, { schemaVersion: 2, eventId: "e-dup" });
    const first = await handleVehicleEvent(deviceId, payload);
    const again = await handleVehicleEvent(deviceId, payload);
    expect(again).toBe(first);
    expect(prisma.deviceEvent.create).toHaveBeenCalledTimes(1);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    expect(push.sendPush).toHaveBeenCalledTimes(1);
  });

  it("quiet hours: the row is stored, nothing pages, and the silence is recorded", async () => {
    vi.mocked(datetime.hourET).mockReturnValue(23);
    const id = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", trackId: "t-night" }));
    const row = await prisma.deviceEvent.findUnique({ where: { id } });
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBe("quiet_hours");
    expect(telegram.sendTelegramWithButtons).not.toHaveBeenCalled();
    expect(push.sendPush).not.toHaveBeenCalled();
    expect(isQuietHoursET(23)).toBe(true);
    expect(isQuietHoursET(6)).toBe(true);
    expect(isQuietHoursET(7)).toBe(false);
    expect(isQuietHoursET(19)).toBe(false);
  });

  it("cooldown is per camera + zone: a second camera in the same zone still alerts, the same camera does not", async () => {
    await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", trackId: "a-1", cameraId: "sign" }));
    await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", trackId: "b-1", cameraId: "lot" }));
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledTimes(2);
    const suppressedId = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", trackId: "a-2", cameraId: "sign" }));
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledTimes(2);
    const row = await prisma.deviceEvent.findUnique({ where: { id: suppressedId } });
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBe("cooldown");
  });

  it("a confirmed arrival with a readable plate asks nickstire who it is; a bare entry does not", async () => {
    await handleVehicleEvent(deviceId, base({ state: "ENTERED_ZONE", trackId: "p-0" }));
    expect(mockLink).not.toHaveBeenCalled();
    await handleVehicleEvent(
      deviceId,
      base({ state: "CONFIRMED_ARRIVAL", trackId: "p-1", cameraId: "lot", plate: { status: "CANDIDATE", text: "ABC 1234", normalizedText: "ABC1234", confidence: 0.91 } }),
    );
    expect(mockLink).toHaveBeenCalledWith(expect.objectContaining({ plate: "ABC1234", telegramMessageId: "999123" }));
    await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", trackId: "p-2", cameraId: "sign", plate: { status: "UNREADABLE" } }));
    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  it("customer link: lookup_failed and a corrected plate are retried; a terminal answer for the same plate is not", async () => {
    const confirmed = (plate: Record<string, unknown>) =>
      base({ state: "CONFIRMED_ARRIVAL", visitId: "v-link", cameraId: "lot", plate: { status: "CANDIDATE", confidence: 0.9, ...plate } });
    const setRef = async (id: string, customerRef: Record<string, unknown>) => {
      const row = (await prisma.deviceEvent.findUnique({ where: { id } }))!;
      row.data = { ...(row.data as Record<string, unknown>), customerRef };
    };
    const id = await handleVehicleEvent(deviceId, confirmed({ text: "ABC 1234", normalizedText: "ABC1234" }));
    expect(mockLink).toHaveBeenCalledTimes(1);

    // the bridge was down (or the nickstire handler not deployed yet): retried
    await setRef(id, { status: "lookup_failed", plate: "ABC1234" });
    await handleVehicleEvent(deviceId, confirmed({ text: "ABC 1234", normalizedText: "ABC1234" }));
    expect(mockLink).toHaveBeenCalledTimes(2);

    // a terminal answer for this plate text: not asked again
    await setRef(id, { status: "unmatched", plate: "ABC1234" });
    await handleVehicleEvent(deviceId, confirmed({ text: "ABC 1234", normalizedText: "ABC1234" }));
    expect(mockLink).toHaveBeenCalledTimes(2);

    // the edge corrected the read: the new plate is looked up
    await handleVehicleEvent(deviceId, confirmed({ text: "ABC 1284", normalizedText: "ABC1284" }));
    expect(mockLink).toHaveBeenCalledTimes(3);
    expect(mockLink).toHaveBeenLastCalledWith(expect.objectContaining({ plate: "ABC1284" }));
  });

  it("rejects a malformed payload with a 400 ServiceError instead of persisting garbage", async () => {
    await expect(handleVehicleEvent(deviceId, base({ state: "ENTERED_ZONE", confidence: "high" as unknown as number }))).rejects.toMatchObject({ status: 400 });
    expect(prisma.deviceEvent.create).not.toHaveBeenCalled();
  });
});
