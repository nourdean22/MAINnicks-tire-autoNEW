/**
 * Calendar r2 W3 (2026-10-31): bdnick writes to his Google calendar and proves it by reading back.
 *
 * Nour 2026-10-30 14:39Z: "vice versa from bdnick it will change in google calander so controlls
 * work both ways". Rules (manager rulings 13:49Z / 14:55Z): writes go through his calendar-of-record
 * slot ONLY and refuse when it is absent, expired or holds the shop's account; every write is read
 * back and a mismatch is a failure, never a success; nothing invites anyone (an invite is a send).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeCalendarEvent, type WriteDeps } from "@/lib/calendar/write";

type Call = { accountKey: string; method: string; path: string; body?: Record<string, unknown> };

function deps(account: Awaited<ReturnType<WriteDeps["account"]>>, answer: (c: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = [];
  const d: WriteDeps = {
    account: vi.fn(async () => account),
    request: vi.fn(async (accountKey, method, path, body) => {
      const c = { accountKey, method, path, body };
      calls.push(c);
      return answer(c);
    }),
  };
  return { d, calls };
}

const MINE = { state: "ok" as const, accountKey: "personal" };
const ev = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  status: "confirmed",
  summary: "Dentist",
  start: { dateTime: "2026-11-02T19:00:00Z" },
  end: { dateTime: "2026-11-02T20:00:00Z" },
  htmlLink: "https://calendar.google.com/x",
  ...over,
});

describe("writeCalendarEvent · his calendar only", () => {
  it.each([
    { state: "not_connected" as const },
    { state: "shop_account" as const },
    { state: "expired" as const },
  ])("refuses on $state and makes no Google call", async (account) => {
    const { d, calls } = deps(account, () => ({ status: 200 }));
    const r = await writeCalendarEvent({ kind: "create", title: "Dentist", start: "2026-11-02T19:00:00Z", end: "2026-11-02T20:00:00Z" }, d);
    expect(r).toMatchObject({ ok: false, reason: account.state });
    expect(calls).toHaveLength(0);
  });
});

describe("writeCalendarEvent · create", () => {
  let created: ReturnType<typeof ev>;
  beforeEach(() => {
    created = ev();
  });

  it("creates on his primary calendar, invites nobody, then reads it back identical", async () => {
    const { d, calls } = deps(MINE, (c) => (c.method === "POST" ? { status: 200, json: created } : { status: 200, json: created }));
    const r = await writeCalendarEvent({ kind: "create", title: "Dentist", start: "2026-11-02T19:00:00Z", end: "2026-11-02T20:00:00Z" }, d);
    expect(r).toMatchObject({ ok: true, kind: "create", eventId: "e1", readBack: "match" });
    expect(calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual([
      "POST /calendars/primary/events",
      "GET /calendars/primary/events/e1",
    ]);
    expect(calls.every((c) => c.accountKey === "personal")).toBe(true);
    expect(calls[0].path).toContain("sendUpdates=none");
    expect(calls[0].body).not.toHaveProperty("attendees");
  });

  it("a time with no zone is his Eastern wall time, not the server's UTC", async () => {
    const { d, calls } = deps(MINE, () => ({ status: 200, json: created }));
    await writeCalendarEvent({ kind: "create", title: "Dentist", start: "2026-11-02T14:00", end: "2026-11-02T15:00" }, d);
    const body = calls[0].body as { start: { dateTime: string; timeZone: string } };
    expect(body.start.dateTime).toBe("2026-11-02T19:00:00.000Z"); // 2 PM EST
    expect(body.start.timeZone).toBe("America/New_York");
  });

  it("a read-back that differs is a failure naming the event, never a success", async () => {
    const { d } = deps(MINE, (c) =>
      c.method === "POST" ? { status: 200, json: created } : { status: 200, json: ev({ start: { dateTime: "2026-11-02T20:00:00Z" } }) },
    );
    const r = await writeCalendarEvent({ kind: "create", title: "Dentist", start: "2026-11-02T19:00:00Z", end: "2026-11-02T20:00:00Z" }, d);
    expect(r).toMatchObject({ ok: false, reason: "read_back_mismatch", eventId: "e1" });
  });

  it("a refused write says so and reads nothing back", async () => {
    const { d, calls } = deps(MINE, () => ({ status: 403, json: { error: { message: "forbidden" } } }));
    const r = await writeCalendarEvent({ kind: "create", title: "Dentist", start: "2026-11-02T19:00:00Z", end: "2026-11-02T20:00:00Z" }, d);
    expect(r).toMatchObject({ ok: false, reason: "write_failed" });
    expect(calls).toHaveLength(1);
  });

  it("an end before the start is refused before any Google call", async () => {
    const { d, calls } = deps(MINE, () => ({ status: 200, json: created }));
    const r = await writeCalendarEvent({ kind: "create", title: "Dentist", start: "2026-11-02T20:00:00Z", end: "2026-11-02T19:00:00Z" }, d);
    expect(r).toMatchObject({ ok: false, reason: "invalid_time" });
    expect(calls).toHaveLength(0);
  });
});

describe("writeCalendarEvent · move and delete", () => {
  it("a move patches only the times and reads the new times back", async () => {
    const moved = ev({ start: { dateTime: "2026-11-03T19:00:00Z" }, end: { dateTime: "2026-11-03T20:00:00Z" } });
    const { d, calls } = deps(MINE, () => ({ status: 200, json: moved }));
    const r = await writeCalendarEvent({ kind: "move", eventId: "e1", start: "2026-11-03T19:00:00Z", end: "2026-11-03T20:00:00Z" }, d);
    expect(r).toMatchObject({ ok: true, kind: "move", readBack: "match" });
    expect(calls[0].method).toBe("PATCH");
    expect(Object.keys(calls[0].body ?? {}).sort()).toEqual(["end", "start"]);
  });

  it("a delete is proven by the read-back: gone (410) or cancelled", async () => {
    const gone = deps(MINE, (c) => (c.method === "DELETE" ? { status: 204 } : { status: 410 }));
    expect(await writeCalendarEvent({ kind: "delete", eventId: "e1" }, gone.d)).toMatchObject({ ok: true, readBack: "match" });
    const cancelled = deps(MINE, (c) => (c.method === "DELETE" ? { status: 204 } : { status: 200, json: ev({ status: "cancelled" }) }));
    expect(await writeCalendarEvent({ kind: "delete", eventId: "e1" }, cancelled.d)).toMatchObject({ ok: true });
  });

  it("a delete whose read-back still shows the event is a failure", async () => {
    const { d } = deps(MINE, (c) => (c.method === "DELETE" ? { status: 204 } : { status: 200, json: ev() }));
    expect(await writeCalendarEvent({ kind: "delete", eventId: "e1" }, d)).toMatchObject({ ok: false, reason: "read_back_mismatch" });
  });
});
