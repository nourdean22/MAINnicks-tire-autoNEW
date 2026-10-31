/**
 * Quiet hours DEFER, never drop (home-pulse W4, 2026-10-31).
 *
 * sendPush returned { sent: 0, failed: 0 } for a low or medium push between 21:00 and 07:00 ET (and a
 * low one 08:00-11:00): the same answer as "no device", with no row anywhere, so the notice was lost.
 * A held push now lands in the Pulse sheet as a coach event (surface "pulse" only, so no page banner
 * shows it), leaves a push_deferred audit row, and says deferred: 1. Same tag twice = one Pulse row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => {
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  return {
    findMany: vi.fn(),
    auditFindFirst: vi.fn(),
    auditCreate: vi.fn().mockResolvedValue({ id: "audit" }),
    sendNotification: vi.fn().mockResolvedValue(undefined),
    setVapidDetails: vi.fn(),
    recordCoachEvent: vi.fn().mockResolvedValue({ eventId: "e" }),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userPreference: { findMany: h.findMany, upsert: vi.fn(), deleteMany: vi.fn() },
    auditEvent: { findFirst: h.auditFindFirst, create: h.auditCreate },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("web-push", () => ({ setVapidDetails: h.setVapidDetails, sendNotification: h.sendNotification }));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: h.recordCoachEvent }));

import { sendPush } from "@/lib/notifications/push";

const SUB = { endpoint: "https://push.example/e1", keys: { p256dh: "k", auth: "a" } };
// 23:30 ET on 2026-10-31 (EDT, UTC-4) and 09:30 ET.
const NIGHT = new Date("2026-11-01T03:30:00Z");
const PEAK = new Date("2026-10-31T13:30:00Z");
const NOON = new Date("2026-10-31T16:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  h.findMany.mockResolvedValue([{ value: JSON.stringify(SUB) }]);
  h.auditFindFirst.mockResolvedValue(null);
  h.auditCreate.mockResolvedValue({ id: "audit" });
  h.recordCoachEvent.mockResolvedValue({ eventId: "e" });
});
afterEach(() => vi.useRealTimers());

const at = (d: Date) => vi.useFakeTimers({ now: d, toFake: ["Date"] });

describe("sendPush · quiet hours defer into the Pulse sheet", () => {
  it("a medium push at 23:30 ET is held: deferred 1, a Pulse-only coach event, an audit row, no delivery", async () => {
    at(NIGHT);
    const res = await sendPush({ title: "Estimate aging 48h", body: "Two estimates are waiting", level: "medium", tag: "estimate-aging", url: "/missions" });
    expect(res).toEqual({ sent: 0, failed: 0, deferred: 1 });
    expect(h.sendNotification).not.toHaveBeenCalled();
    expect(h.recordCoachEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "held-notification",
        subjectId: "estimate-aging",
        priority: "P2",
        title: "Estimate aging 48h",
        body: "Two estimates are waiting",
        deepLink: "/missions",
        surfaces: ["pulse"],
      }),
    );
    expect(h.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "push_deferred" }) }),
    );
  });

  it("a low push in the 08:00-11:00 block is held the same way", async () => {
    at(PEAK);
    const res = await sendPush({ title: "Brain report ready", body: "b", level: "low" });
    expect(res.deferred).toBe(1);
    expect(h.recordCoachEvent).toHaveBeenCalledTimes(1);
  });

  it("an untagged push gets a stable subject from its title, so a repeat is one Pulse row", async () => {
    at(NIGHT);
    await sendPush({ title: "Score reminder", body: "b1", level: "low" });
    await sendPush({ title: "Score reminder", body: "b2", level: "low" });
    const subjects = h.recordCoachEvent.mock.calls.map((c) => c[0].subjectId);
    expect(subjects[0]).toBe(subjects[1]);
  });

  it("control: a critical push at night still delivers and is not held", async () => {
    at(NIGHT);
    const res = await sendPush({ title: "Lead", body: "b", level: "critical" });
    expect(res.sent).toBe(1);
    expect(res.deferred).toBeUndefined();
    expect(h.recordCoachEvent).not.toHaveBeenCalled();
  });

  it("control: a medium push at noon delivers", async () => {
    at(NOON);
    const res = await sendPush({ title: "Estimate aging", body: "b", level: "medium" });
    expect(res.sent).toBe(1);
    expect(h.recordCoachEvent).not.toHaveBeenCalled();
  });

  it("if parking the held push fails, the answer says so (failed 1), never a silent zero", async () => {
    at(NIGHT);
    h.recordCoachEvent.mockResolvedValueOnce(null);
    const res = await sendPush({ title: "Estimate aging", body: "b", level: "medium" });
    expect(res).toEqual({ sent: 0, failed: 1, deferred: 0 });
  });
});
