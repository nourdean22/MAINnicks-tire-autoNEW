/**
 * Operator state on coach events survives a writer re-firing (home-pulse W3, 2026-10-31).
 *
 * recordCoachEvent upserts on (category, key) and REPLACED metadata wholesale, so a cron that
 * re-fired the same alert erased the operator's dismissal and the item came back on every device
 * (the W3 kill criterion). Rules pinned here:
 *   · "done" holds for the occurrence: a re-fire keeps it hidden (for 24 h if the writer never resolves it)
 *   · "snooze" holds until its time passes, then the event returns
 *   · a writer resolving the event (ackCoachEvent) ends the occurrence: the next fire is new and shows
 *   · state lives on the server row, so a second reader (another device) sees the same result
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; category: string; key: string; content: string; metadata: unknown; createdAt: Date; updatedAt: Date };
const h = vi.hoisted(() => ({ rows: new Map<string, Row>() }));

const k = (w: { category_key: { category: string; key: string } }) => `${w.category_key.category}|${w.category_key.key}`;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findUnique: async ({ where }: any) => h.rows.get(k(where)) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const id = k(where);
        const prev = h.rows.get(id);
        const now = new Date();
        const row: Row = prev
          ? { ...prev, ...update, updatedAt: now }
          : { id, ...create, createdAt: now, updatedAt: now };
        h.rows.set(id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const id = k(where);
        const prev = h.rows.get(id);
        if (!prev) throw new Error("not found");
        const row = { ...prev, ...data, updatedAt: new Date() };
        h.rows.set(id, row);
        return row;
      },
      findMany: async () => [...h.rows.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    },
  },
}));
vi.mock("@/lib/notifications/push", () => ({ sendPush: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }) }));

import {
  ackCoachEvent,
  buildCoachEventKey,
  getActiveCoachEvents,
  markCoachEventDone,
  snoozeCoachEvent,
  recordCoachEvent,
} from "@/lib/services/coach-events";

const fire = () =>
  recordCoachEvent({ kind: "system-alert", subjectId: "cost-slo", priority: "P1", title: "Spend over budget", body: "Model spend passed the daily cap" });
const KEY = buildCoachEventKey("system-alert", "cost-slo");

beforeEach(() => {
  h.rows.clear();
  vi.useRealTimers();
});

describe("coach events · operator state on the server row", () => {
  it("done hides the event and a writer re-fire does not bring it back", async () => {
    await fire();
    expect(await markCoachEventDone(KEY)).toBe(true);
    await fire();
    // Two reads = two devices: both see it gone.
    expect(await getActiveCoachEvents({ limit: 30 })).toEqual([]);
    expect(await getActiveCoachEvents({ limit: 30 })).toEqual([]);
  });

  it("a done event that the writer still fires a day later comes back", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00Z"), toFake: ["Date"] });
    await fire();
    await markCoachEventDone(KEY);
    vi.setSystemTime(new Date("2026-11-01T12:30:00Z"));
    await fire();
    expect((await getActiveCoachEvents({ limit: 30 })).map((e) => e.title)).toEqual(["Spend over budget"]);
  });

  it("snooze hides the event until its time passes, re-fire included", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00Z"), toFake: ["Date"] });
    await fire();
    expect(await snoozeCoachEvent(KEY, 1)).toBe(true);
    await fire();
    expect(await getActiveCoachEvents({ limit: 30 })).toEqual([]);
    vi.setSystemTime(new Date("2026-10-31T13:01:00Z"));
    expect((await getActiveCoachEvents({ limit: 30 })).length).toBe(1);
  });

  it("the writer resolving the event ends the occurrence: the next fire is new and shows", async () => {
    await fire();
    await markCoachEventDone(KEY);
    await ackCoachEvent(KEY); // the writer saw the condition clear
    await fire(); // and it is back
    const events = await getActiveCoachEvents({ limit: 30 });
    expect(events.length).toBe(1);
    expect(events[0].doneAt).toBeUndefined();
  });

  it("done also sets ackedAt, kept across a re-fire, so the ~18 surfaces that read rows directly (`!meta.ackedAt`) hide it too", async () => {
    await fire();
    await markCoachEventDone(KEY);
    const rowMeta = () => h.rows.get(`coach_event|${KEY}`)!.metadata as Record<string, unknown>;
    expect(typeof rowMeta().ackedAt).toBe("string");
    await fire();
    expect(typeof rowMeta().ackedAt).toBe("string");
    expect(typeof rowMeta().doneAt).toBe("string");
  });

  it("acting on a missing event reports false, never a silent success", async () => {
    expect(await markCoachEventDone("coach:system-alert:nope")).toBe(false);
    expect(await snoozeCoachEvent("coach:system-alert:nope", 1)).toBe(false);
  });
});

// A held push (quiet hours) parks as a "held-notification" row keyed by the push tag, P2, Pulse sheet only.
// deferPush then tells the caller deferred: 1 and writes an audit row saying "in the Pulse sheet". A repeat
// of the same tag after Nour tapped Done used to inherit that Done and vanish while still reporting
// "in the Pulse sheet". A repeat of a held push is a NEW notice (the device that went quiet at 23:00 and
// came back at 22:00 the next night), so the operator's old Done or Snooze does not apply to it.
describe("coach events · a repeated held push is a new notice", () => {
  const hold = () =>
    recordCoachEvent({
      kind: "held-notification",
      subjectId: "device-online:abc",
      priority: "P2",
      title: "A device went quiet",
      body: "It has not checked in",
      surfaces: ["pulse"],
      expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    });
  const HELD_KEY = buildCoachEventKey("held-notification", "device-online:abc");
  const rowMeta = () => h.rows.get(`coach_event|${HELD_KEY}`)!.metadata as Record<string, unknown>;
  // The Pulse sheet's own read (lib/trpc/routers/operator.ts: getActiveCoachEvents({ limit: 30 })).
  const pulseSheet = async () => (await getActiveCoachEvents({ limit: 30 })).map((e) => e.title);

  it("a held push that repeats after Done is visible in the Pulse sheet again", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T03:00:00Z"), toFake: ["Date"] });
    await hold();
    expect(await markCoachEventDone(HELD_KEY)).toBe(true);
    expect(await pulseSheet()).toEqual([]); // CONTROL: Done still hides the one he dismissed
    vi.setSystemTime(new Date("2026-10-31T14:00:00Z")); // 11 hours later, inside the 24 h done hold
    await hold();
    expect(await pulseSheet()).toEqual(["A device went quiet"]);
    expect(rowMeta().doneAt).toBeUndefined();
    expect(rowMeta().ackedAt).toBeUndefined();
  });

  it("a held push that repeats during a Snooze is visible again too", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T03:00:00Z"), toFake: ["Date"] });
    await hold();
    expect(await snoozeCoachEvent(HELD_KEY, 12)).toBe(true);
    expect(await pulseSheet()).toEqual([]); // CONTROL: the snooze hides the row it was set on
    vi.setSystemTime(new Date("2026-10-31T05:00:00Z"));
    await hold();
    expect(await pulseSheet()).toEqual(["A device went quiet"]);
    expect(rowMeta().snoozeUntil).toBeUndefined();
  });

  it("CONTROL: a non-held kind still inherits Done on a re-fire (the carry stays for writers that never resolve)", async () => {
    await fire();
    await markCoachEventDone(KEY);
    await fire();
    expect(await getActiveCoachEvents({ limit: 30 })).toEqual([]);
  });
});
