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

  it("acting on a missing event reports false, never a silent success", async () => {
    expect(await markCoachEventDone("coach:system-alert:nope")).toBe(false);
    expect(await snoozeCoachEvent("coach:system-alert:nope", 1)).toBe(false);
  });
});
