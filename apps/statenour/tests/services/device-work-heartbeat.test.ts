/**
 * tests/services/device-work-heartbeat.test.ts · 2026-10-30
 *
 * The lot camera's device row read "last seen 10-23" for a week while the camera ran: the
 * edge never PATCHed, and the only thing that moved lastSeenAt was a posted visit. The fix
 * must not swap that trap for the opposite one (a heartbeat that says "online" while the
 * counter is blind), so the status comes from the WORK counters advancing, never from the
 * PATCH arriving (shop-camera-best-in-class, Liveness).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: { smartDevice: { findFirst: vi.fn(), update: vi.fn() }, deviceEvent: { createMany: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/utils/http", () => ({ apiHandler: (h: unknown) => h }));

import {
  deriveWorkStatus,
  parseEdgeWork,
  WORK_STALL_BEATS,
  EDGE_WORK_KIND,
} from "@/lib/services/device-work-heartbeat";
import { PATCH } from "@/app/api/devices/[id]/route";
import { POST as POST_EVENTS } from "@/app/api/devices/[id]/events/route";

const T0 = new Date("2026-10-30T20:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

function beat(framesTotal: number, extra: Record<string, unknown> = {}) {
  return parseEdgeWork({
    kind: EDGE_WORK_KIND,
    producerInstanceId: "inst-a",
    heartbeatSeq: 1,
    framesTotal,
    detectionsTotal: 0,
    arrivalsTotal: 0,
    crossingsSinceLastBeat: 0,
    blindGatesSinceLastBeat: [],
    ...extra,
  });
}

describe("deriveWorkStatus", () => {
  it("frames advancing -> ONLINE and lastSeenAt moves", () => {
    const first = deriveWorkStatus("OFFLINE", null, beat(120), at(0));
    expect(first.status).toBe("ONLINE");
    expect(first.lastSeenAt).toEqual(at(0));
    const second = deriveWorkStatus("ONLINE", first.currentState, beat(240), at(30));
    expect(second.status).toBe("ONLINE");
    expect(second.lastSeenAt).toEqual(at(30));
  });

  it(`frames flat for ${WORK_STALL_BEATS} beats -> ERROR, and lastSeenAt does NOT move (the canary)`, () => {
    let r = deriveWorkStatus("OFFLINE", null, beat(500), at(0));
    let status = r.status ?? "ONLINE";
    for (let i = 1; i <= WORK_STALL_BEATS; i++) {
      r = deriveWorkStatus(status, r.currentState, beat(500, { heartbeatSeq: i + 1 }), at(30 * i));
      if (r.status) status = r.status;
      expect(r.lastSeenAt).toBeUndefined();
    }
    expect(status).toBe("ERROR");
    expect(r.currentState.flatBeats).toBe(WORK_STALL_BEATS);
    expect(r.currentState.workStallSince).toBe(at(30).toISOString());
    expect(r.currentState.lastBeatAt).toBe(at(30 * WORK_STALL_BEATS).toISOString());
  });

  it("one or two flat beats leave the status alone (a short gap is not a stall)", () => {
    const r0 = deriveWorkStatus("OFFLINE", null, beat(500), at(0));
    const r1 = deriveWorkStatus("ONLINE", r0.currentState, beat(500), at(30));
    expect(r1.status).toBeUndefined();
    expect(r1.currentState.flatBeats).toBe(1);
  });

  it("frames moving again clears the stall", () => {
    let r = deriveWorkStatus("OFFLINE", null, beat(500), at(0));
    for (let i = 1; i <= WORK_STALL_BEATS; i++) r = deriveWorkStatus("ONLINE", r.currentState, beat(500), at(30 * i));
    const back = deriveWorkStatus("ERROR", r.currentState, beat(620), at(150));
    expect(back.status).toBe("ONLINE");
    expect(back.currentState.flatBeats).toBe(0);
    expect(back.currentState.workStallSince).toBeNull();
  });

  it("a new producer instance resets the baseline: a restart with lower totals is not a stall", () => {
    const old = deriveWorkStatus("OFFLINE", null, beat(90_000), at(0));
    const restarted = deriveWorkStatus("ONLINE", old.currentState, beat(40, { producerInstanceId: "inst-b" }), at(30));
    expect(restarted.status).toBe("ONLINE");
  });

  it("frames decoded but every one blind-gated is a stall, not work", () => {
    let r = deriveWorkStatus("ONLINE", null, beat(100, { suppressedFramesTotal: { unverified: 0 } }), at(0));
    let status = r.status ?? "ONLINE";
    for (let i = 1; i <= WORK_STALL_BEATS; i++) {
      r = deriveWorkStatus(status, r.currentState,
        beat(100 + 120 * i, { suppressedFramesTotal: { unverified: 120 * i } }), at(30 * i));
      if (r.status) status = r.status;
    }
    expect(status).toBe("ERROR");
  });

  it("an edge that keeps restarting without decoding reaches ERROR (the run carries across instances)", () => {
    let r = deriveWorkStatus("ONLINE", null, beat(900), at(0));
    let status = r.status ?? "ONLINE";
    for (let i = 1; i <= WORK_STALL_BEATS; i++) {
      r = deriveWorkStatus(status, r.currentState, beat(0, { producerInstanceId: `restart-${i}` }), at(30 * i));
      if (r.status) status = r.status;
    }
    expect(status).toBe("ERROR");
  });

  it("a fresh instance that has decoded nothing yet is one flat beat, not online", () => {
    const r = deriveWorkStatus("OFFLINE", null, beat(0), at(0));
    expect(r.status).toBeUndefined();
    expect(r.lastSeenAt).toBeUndefined();
    expect(r.currentState.flatBeats).toBe(1);
  });
});

describe("parseEdgeWork", () => {
  it("rejects a missing or negative frame total", () => {
    expect(() => parseEdgeWork({ kind: EDGE_WORK_KIND, producerInstanceId: "x" })).toThrow();
    expect(() => parseEdgeWork({ kind: EDGE_WORK_KIND, producerInstanceId: "x", framesTotal: -1 })).toThrow();
    expect(() => parseEdgeWork({ kind: EDGE_WORK_KIND, framesTotal: 3 })).toThrow();
  });
});

describe("PATCH /api/devices/:id with edge work counters", () => {
  const ROW = { id: "cmn-sign", status: "ONLINE", currentState: null };
  const req = (body: unknown) => new Request("https://bdnick.info/api/devices/v380-shopsign", {
    method: "PATCH", body: JSON.stringify(body),
  });
  const ctx = { params: Promise.resolve({ id: "v380-shopsign" }) };

  beforeEach(() => {
    vi.clearAllMocks();
    db.smartDevice.update.mockImplementation(async ({ data }: { data: unknown }) => ({ id: ROW.id, ...(data as object) }));
  });

  it("ignores a status and lastSeenAt the body claims; frames flat for the stall run -> ERROR", async () => {
    let state: unknown = null;
    let status = "ONLINE";
    for (let i = 0; i <= WORK_STALL_BEATS; i++) {
      db.smartDevice.findFirst.mockResolvedValueOnce({ ...ROW, status, currentState: state });
      await (PATCH as unknown as (r: Request, c: unknown) => Promise<unknown>)(req({
        status: "ONLINE",
        lastSeenAt: at(i).toISOString(),
        currentState: { kind: EDGE_WORK_KIND, producerInstanceId: "inst-a", heartbeatSeq: i, framesTotal: 777 },
      }), ctx);
      const data = db.smartDevice.update.mock.calls.at(-1)![0].data;
      state = data.currentState;
      if (data.status) status = data.status;
      expect(data.lastSeenAt === undefined || i === 0).toBe(true);
    }
    expect(status).toBe("ERROR");
  });

  it("a body without the work kind keeps the old pass-through (visitd's PATCH is unchanged)", async () => {
    db.smartDevice.findFirst.mockResolvedValueOnce(ROW);
    await (PATCH as unknown as (r: Request, c: unknown) => Promise<unknown>)(req({ status: "ONLINE", lastSeenAt: at(0).toISOString() }), ctx);
    const data = db.smartDevice.update.mock.calls.at(-1)![0].data;
    expect(data.status).toBe("ONLINE");
    expect(data.lastSeenAt).toEqual(at(0));
  });
});

describe("POST /api/devices/:id/events on a work-heartbeat device (Codex P2 on #3414)", () => {
  const ctx = { params: Promise.resolve({ id: "v380-shopsign" }) };
  const post = (body: unknown) => (POST_EVENTS as unknown as (r: Request, c: unknown) => Promise<unknown>)(
    new Request("https://bdnick.info/api/devices/v380-shopsign/events", { method: "POST", body: JSON.stringify(body) }), ctx);

  beforeEach(() => {
    vi.clearAllMocks();
    db.deviceEvent.createMany.mockResolvedValue({ count: 1 });
    db.smartDevice.update.mockResolvedValue({});
  });

  it("a late event never flips a work-heartbeat device ONLINE or moves its lastSeenAt", async () => {
    db.smartDevice.findFirst.mockResolvedValueOnce({
      id: "cmn-sign", status: "ERROR",
      currentState: { kind: EDGE_WORK_KIND, producerInstanceId: "inst-a", framesTotal: 9 },
    });
    await post({ event: "note", data: {} });
    expect(db.deviceEvent.createMany).toHaveBeenCalledTimes(1);
    expect(db.smartDevice.update).not.toHaveBeenCalled();
  });

  it("a device without the work heartbeat keeps the old ONLINE + lastSeenAt on every event", async () => {
    db.smartDevice.findFirst.mockResolvedValueOnce({ id: "cmn-other", status: "OFFLINE", currentState: null });
    await post({ event: "note", data: {} });
    expect(db.smartDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ONLINE" }) }));
  });
});
