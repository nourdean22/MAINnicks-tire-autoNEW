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
vi.mock("@/lib/services/vehicle-customer-link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/vehicle-customer-link")>()),
  linkVisitToCustomer: mockLink,
}));
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
    // The service's windows are createdAt lower bounds; honour them so a window can be tested.
    (!(where.createdAt as { gte?: Date } | undefined)?.gte || row.createdAt >= (where.createdAt as { gte: Date }).gte) &&
    matchData(row, where.data as { path: string[]; equals: unknown } | undefined) &&
    ((where.AND as Array<{ data: { path: string[]; equals: unknown } }> | undefined) ?? []).every((c) => matchData(row, c.data));
  return {
    prisma: {
      deviceEvent: {
        deleteMany: vi.fn(async () => { store.events.length = 0; return { count: 0 }; }),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const rows = (store.events as Row[]).filter((r) => matches(r, where));
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          // A SNAPSHOT, as Postgres returns one: a caller that read the row keeps what it read
          // even after another caller's UPDATE lands. Returning the live object would let the
          // second of two racing retries see the first one's claim for free.
          return rows[0] ? structuredClone(rows[0]) : null;
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          // The partial UNIQUE index of migrations-pending/20261007120000_device_events_identity_indexes:
          // one non-null data->>'eventId' per device. Prisma surfaces the violation as P2002.
          const eventId = (data.data as Record<string, unknown> | undefined)?.eventId;
          if (eventId && (store.events as Row[]).some((r) => r.deviceId === data.deviceId && r.data?.eventId === eventId)) {
            throw Object.assign(new Error("Unique constraint failed on the fields: (`device_id`,`data->>'eventId'`)"), { code: "P2002" });
          }
          const row = { id: `event_${++store.seq}`, createdAt: new Date(), ...data };
          store.events.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = store.events.find((r) => r.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
        // The compare-and-swap the page claim uses: every row matching the WHERE (id, JSON-path
        // equals, AND list) is rewritten, and the count says who won. Synchronous inside the
        // mock, like one UPDATE statement, so two callers interleave the way Postgres serialises
        // them: the second swap sees the first swap's write.
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const rows = (store.events as Row[]).filter((r) => (!where.id || r.id === where.id) && matches(r, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
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

  it("a replayed event (edge outbox flushing after an outage) is stored but never pages now", async () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const id = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "v-old" }, { timestamp: old }));
    expect(telegram.sendTelegramWithButtons).not.toHaveBeenCalled();
    expect(push.sendPush).not.toHaveBeenCalled();
    const row = await prisma.deviceEvent.findUnique({ where: { id } });
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBe("stale_replay");
  });

  it("eventId idempotency spans the 90-day retention window, not a day", async () => {
    await handleVehicleEvent(deviceId, base({ state: "ENTERED_ZONE", visitId: "v-w" }, { eventId: "e-w" }));
    const first = vi.mocked(prisma.deviceEvent.findFirst).mock.calls[0][0] as { where: { createdAt: { gte: Date } } };
    expect(Date.now() - first.where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(89 * 24 * 60 * 60 * 1000);
  });

  it("a refreshed alert keeps the persisted customer line and does not ask nickstire again", async () => {
    const plate = { status: "CANDIDATE", text: "ABC1234", normalizedText: "ABC1234", confidence: 0.9 };
    const id = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "v-cust", plate }));
    const row = (await prisma.deviceEvent.findUnique({ where: { id } }))!;
    row.data = {
      ...(row.data as Record<string, unknown>),
      customerRef: {
        status: "matched",
        plate: "ABC1234",
        matches: [{ name: "Jane Member", phoneMasked: "***-0199", exact: true, bookingsToday: [{ service: "Oil change", linkage: "phone+name" }] }],
      },
    };
    await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "v-cust", dwellSeconds: 90, plate: { ...plate, status: "CONFIRMED" } }));
    const edits = vi.mocked(telegram.editTelegramMessage).mock.calls;
    expect(edits.length).toBeGreaterThan(0);
    const text = edits[edits.length - 1][1] as string;
    expect(text).toContain("Jane Member (***-0199)");
    expect(text).toContain("booked today: Oil change");
    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed payload with a 400 ServiceError instead of persisting garbage", async () => {
    await expect(handleVehicleEvent(deviceId, base({ state: "ENTERED_ZONE", confidence: "high" as unknown as number }))).rejects.toMatchObject({ status: 400 });
    expect(prisma.deviceEvent.create).not.toHaveBeenCalled();
  });
});

/**
 * Hardening 2026-10-07 (camera audit, PR #2920). The ingest used to page, then write the
 * row; a failed write after a sent page meant a 5xx to the edge, an outbox retry, no row to
 * find, and a second page. The dedupe also had no database behind it.
 */
describe("Arrival Intelligence ingest · row before page, unique eventId, weekend visits", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(datetime.hourET).mockReturnValue(12);
    await prisma.deviceEvent.deleteMany({});
  });

  it("writes the row BEFORE it pages, with the pending marker, and clears the marker after", async () => {
    const id = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "v-order" }, { schemaVersion: 2, eventId: "e-order" }));
    const createOrder = vi.mocked(prisma.deviceEvent.create).mock.invocationCallOrder[0];
    const pageOrder = vi.mocked(telegram.sendTelegramWithButtons).mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(pageOrder);
    const created = vi.mocked(prisma.deviceEvent.create).mock.calls[0][0] as { data: { data: Record<string, unknown> } };
    expect(created.data.data.alertSuppressedReason).toBe("pending");
    expect(created.data.data.telegramMessageId).toBeNull();
    const row = await prisma.deviceEvent.findUnique({ where: { id } });
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBeNull();
    expect((row?.data as Record<string, unknown>).telegramMessageId).toBe("999123");
  });

  it("a suppressed row never carries the pending marker: the reason is written with the row", async () => {
    vi.mocked(datetime.hourET).mockReturnValue(23);
    const id = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "v-quiet" }, { eventId: "e-quiet" }));
    const row = await prisma.deviceEvent.findUnique({ where: { id } });
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBe("quiet_hours");
    expect(prisma.deviceEvent.update).not.toHaveBeenCalled();
  });

  it("a row whose page never completed is paged on the retry -- once", async () => {
    // The process died between INSERT and page: the row exists with the marker still set.
    const seeded = await prisma.deviceEvent.create({
      data: {
        deviceId,
        event: "vehicle_detected",
        source: "frigate",
        timestamp: new Date(),
        data: { eventId: "e-crash", visitId: "v-crash", state: "CONFIRMED_ARRIVAL", zone: "front_lot", cameraId: "sign", telegramMessageId: null, alertSuppressedReason: "pending" },
      },
    });
    vi.clearAllMocks();
    const payload = base({ state: "CONFIRMED_ARRIVAL", visitId: "v-crash" }, { schemaVersion: 2, eventId: "e-crash" });
    const id = await handleVehicleEvent(deviceId, payload);
    expect(id).toBe(seeded.id);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    expect(push.sendPush).toHaveBeenCalledOnce();
    expect(prisma.deviceEvent.create).not.toHaveBeenCalled();
    const row = await prisma.deviceEvent.findUnique({ where: { id } });
    expect((row?.data as Record<string, unknown>).telegramMessageId).toBe("999123");
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBeNull();
    // The next retry finds the page complete and does nothing.
    await handleVehicleEvent(deviceId, payload);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
  });

  it("a retry that lost the pre-check race is answered with the row that won, and nothing pages twice", async () => {
    const payload = base({ state: "CONFIRMED_ARRIVAL" }, { schemaVersion: 2, eventId: "e-race" });
    const first = await handleVehicleEvent(deviceId, payload);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    // The twin's eventId pre-check ran before the first INSERT landed and saw nothing...
    vi.mocked(prisma.deviceEvent.findFirst).mockResolvedValueOnce(null);
    const second = await handleVehicleEvent(deviceId, payload);
    // ...so it reached the INSERT, which the unique index refused (P2002), and it was
    // answered with the first row. One row, one page.
    expect(second).toBe(first);
    expect(prisma.deviceEvent.create).toHaveBeenCalledTimes(2);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    expect(store.events).toHaveLength(1);
  });

  it("a car that sits over the weekend is ONE visit; a visitId older than the 7-day window is not", async () => {
    const first = await handleVehicleEvent(deviceId, base({ state: "ENTERED_ZONE", visitId: "v-weekend", trackId: "t-fri" }, { schemaVersion: 2, eventId: "e-fri" }));
    const row = store.events.find((r) => r.id === first) as Row;
    row.createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const monday = await handleVehicleEvent(deviceId, base({ state: "DEPARTING", visitId: "v-weekend", trackId: "t-mon", dwellSeconds: 180_000 }, { schemaVersion: 2, eventId: "e-mon" }));
    expect(monday).toBe(first);
    expect(store.events).toHaveLength(1);

    row.createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const later = await handleVehicleEvent(deviceId, base({ state: "ENTERED_ZONE", visitId: "v-weekend", trackId: "t-next" }, { schemaVersion: 2, eventId: "e-next" }));
    expect(later).not.toBe(first);
    expect(store.events).toHaveLength(2);
  });
});

/**
 * Hardening 2026-10-08 (Codex P1 on #2920). Finishing a pending page was a read-then-update:
 * two retries that both found the marker both paged. The page is now a CLAIM (compare-and-swap
 * pinned on the marker and the lease deadline the decision read), and the writer's own lease
 * keeps a retry off a page that is still in flight. Positive control: against the pre-fix
 * service the first test paged twice (sendTelegramWithButtons called 2 times) and the second
 * paged once where it must not; both green after.
 */
describe("Arrival Intelligence ingest · exclusive page claim", () => {
  const pendingRow = (eventId: string, visitId: string, extra: Record<string, unknown> = {}) =>
    prisma.deviceEvent.create({
      data: {
        deviceId,
        event: "vehicle_detected",
        source: "frigate",
        timestamp: new Date(),
        data: { eventId, visitId, state: "CONFIRMED_ARRIVAL", zone: "front_lot", cameraId: "sign", telegramMessageId: null, alertSuppressedReason: "pending", ...extra },
      },
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(datetime.hourET).mockReturnValue(12);
    await prisma.deviceEvent.deleteMany({});
  });

  it("two retries that both find a dead writer's pending row page ONCE: the second loses the swap", async () => {
    const seeded = await pendingRow("e-two", "v-two"); // a row from before leases: no deadline to pin, marker alone decides
    vi.clearAllMocks();
    // Hold the first page open so the second retry arrives while it is in flight.
    let release!: (v: { ok: boolean; messageId: number }) => void;
    const gate = new Promise<{ ok: boolean; messageId: number }>((resolve) => { release = resolve; });
    vi.mocked(telegram.sendTelegramWithButtons).mockImplementationOnce(() => gate as never);
    const payload = base({ state: "CONFIRMED_ARRIVAL", visitId: "v-two" }, { schemaVersion: 2, eventId: "e-two" });
    const first = handleVehicleEvent(deviceId, payload);
    const second = handleVehicleEvent(deviceId, payload);
    // Attach the handlers now: the loser rejects while the winner is still parked on the gate,
    // and a rejection nobody is listening for yet is an unhandled rejection that fails the run.
    const settled = Promise.allSettled([first, second]);
    // One macrotask drains every microtask: the first caller is parked on the gate with its
    // page in flight, the second has read the row, lost the swap and been told to retry.
    await new Promise((r) => setTimeout(r, 0));
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    release({ ok: true, messageId: 424242 });
    const [won, lost] = await settled;
    expect(won).toEqual({ status: "fulfilled", value: seeded.id });
    // Retryable, never acknowledged: the winner's page was not confirmed when the loser answered.
    expect(lost.status).toBe("rejected");
    expect((lost as PromiseRejectedResult).reason).toMatchObject({ name: "ServiceError", status: 503 });
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    expect(push.sendPush).toHaveBeenCalledOnce();
    // The loser's retry, once the page is done, is acknowledged and pages nothing.
    expect(await handleVehicleEvent(deviceId, payload)).toBe(seeded.id);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    const row = await prisma.deviceEvent.findUnique({ where: { id: seeded.id } });
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBeNull();
    expect((row?.data as Record<string, unknown>).telegramMessageId).toBe("424242");
    // The claim moved the marker before paging, so the losing swap found no "pending" row.
    const swaps = vi.mocked(prisma.deviceEvent.updateMany).mock.calls.map((c) => c[0] as { where: { AND?: unknown[] } });
    expect(swaps.filter((s) => Array.isArray(s.where.AND)).length).toBe(2);
  });

  it("a retry inside the writer's lease leaves the row alone and is told to retry (503), not acknowledged", async () => {
    const seeded = await pendingRow("e-fresh", "v-fresh", { alertClaimedAt: Date.now() - 5_000 });
    vi.clearAllMocks();
    await expect(
      handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "v-fresh" }, { schemaVersion: 2, eventId: "e-fresh" })),
    ).rejects.toMatchObject({ name: "ServiceError", status: 503, details: { existing: seeded.id } });
    expect(telegram.sendTelegramWithButtons).not.toHaveBeenCalled();
    expect(push.sendPush).not.toHaveBeenCalled();
    expect(prisma.deviceEvent.updateMany).not.toHaveBeenCalled();
    const row = await prisma.deviceEvent.findUnique({ where: { id: seeded.id } });
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBe("pending");
  });

  // Codex P1 on #2931: the retry inside the lease used to be answered with the row id, a 2xx the
  // edge outbox acknowledges for good. When the writer had died before paging, that retry was the
  // last one and the page was lost. Now every retry stays retryable until one can finish the page.
  it("a writer that died inside its lease does not take the page with it: the retry after the lease pages once", async () => {
    const seeded = await pendingRow("e-dead", "v-dead", { alertClaimedAt: Date.now() - 5_000 });
    vi.clearAllMocks();
    const payload = base({ state: "CONFIRMED_ARRIVAL", visitId: "v-dead" }, { schemaVersion: 2, eventId: "e-dead" });
    await expect(handleVehicleEvent(deviceId, payload)).rejects.toMatchObject({ status: 503 });
    expect(telegram.sendTelegramWithButtons).not.toHaveBeenCalled();
    // The edge keeps retrying; the dead writer's lease lapses.
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    try {
      expect(await handleVehicleEvent(deviceId, payload)).toBe(seeded.id);
      expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
      expect(await handleVehicleEvent(deviceId, payload)).toBe(seeded.id);
      expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a twin that lost the INSERT race while the winner is still paging is told to retry, not acknowledged", async () => {
    let release!: (v: { ok: boolean; messageId: number }) => void;
    const gate = new Promise<{ ok: boolean; messageId: number }>((resolve) => { release = resolve; });
    vi.mocked(telegram.sendTelegramWithButtons).mockImplementationOnce(() => gate as never);
    const payload = base({ state: "CONFIRMED_ARRIVAL" }, { schemaVersion: 2, eventId: "e-twin" });
    const first = handleVehicleEvent(deviceId, payload);
    await new Promise((r) => setTimeout(r, 0)); // the winner's row exists; its page is in flight
    vi.mocked(prisma.deviceEvent.findFirst).mockResolvedValueOnce(null); // the twin's pre-check saw nothing
    await expect(handleVehicleEvent(deviceId, payload)).rejects.toMatchObject({ name: "ServiceError", status: 503 });
    release({ ok: true, messageId: 777 });
    const id = await first;
    // Once the page is done the twin's retry is acknowledged with the winner's row. One row, one page.
    expect(await handleVehicleEvent(deviceId, payload)).toBe(id);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    expect(store.events).toHaveLength(1);
  });

  it("a retry past the lease claims the page and pins BOTH fields it read: the marker and the deadline", async () => {
    const stale = Date.now() - 120_000;
    const seeded = await pendingRow("e-stale", "v-stale", { alertClaimedAt: stale });
    vi.clearAllMocks();
    const id = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "v-stale" }, { schemaVersion: 2, eventId: "e-stale" }));
    expect(id).toBe(seeded.id);
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    const claim = vi.mocked(prisma.deviceEvent.updateMany).mock.calls[0][0] as {
      where: { id: string; AND: Array<{ data: { path: string[]; equals: unknown } }> };
      data: { data: Record<string, unknown> };
    };
    expect(claim.where.id).toBe(seeded.id);
    expect(claim.where.AND).toEqual([
      { data: { path: ["alertSuppressedReason"], equals: "pending" } },
      { data: { path: ["alertClaimedAt"], equals: stale } },
    ]);
    expect(claim.data.data.alertSuppressedReason).toBe("paging");
    expect(claim.data.data.alertClaimedAt).toBeGreaterThan(stale);
    // The clear is pinned on the lease the claim wrote, never a bare update by id.
    const clear = vi.mocked(prisma.deviceEvent.updateMany).mock.calls[1][0] as { where: { data: { path: string[]; equals: unknown } } };
    expect(clear.where.data).toEqual({ path: ["alertClaimedAt"], equals: claim.data.data.alertClaimedAt });
    expect(prisma.deviceEvent.update).not.toHaveBeenCalled();
  });

  it("the writer leases its own page and clears it pinned on that lease", async () => {
    const id = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "v-own" }, { schemaVersion: 2, eventId: "e-own" }));
    const created = vi.mocked(prisma.deviceEvent.create).mock.calls[0][0] as { data: { data: Record<string, unknown> } };
    expect(created.data.data.alertSuppressedReason).toBe("pending");
    expect(typeof created.data.data.alertClaimedAt).toBe("number");
    const clear = vi.mocked(prisma.deviceEvent.updateMany).mock.calls[0][0] as { where: { id: string; data: { path: string[]; equals: unknown } } };
    expect(clear.where).toEqual({ id, data: { path: ["alertClaimedAt"], equals: created.data.data.alertClaimedAt } });
    const row = await prisma.deviceEvent.findUnique({ where: { id } });
    expect((row?.data as Record<string, unknown>).alertSuppressedReason).toBeNull();
  });

  it("a lease lost mid-page is recorded, not thrown, and never overwrites the new holder's marker", async () => {
    // The page outran the lease and a retry re-claimed the row: the writer's pinned clear matches nothing.
    vi.mocked(prisma.deviceEvent.updateMany).mockResolvedValueOnce({ count: 0 });
    const id = await handleVehicleEvent(deviceId, base({ state: "CONFIRMED_ARRIVAL", visitId: "v-lost" }, { schemaVersion: 2, eventId: "e-lost" }));
    expect(typeof id).toBe("string");
    expect(telegram.sendTelegramWithButtons).toHaveBeenCalledOnce();
    expect(prisma.deviceEvent.update).not.toHaveBeenCalled();
  });
});
