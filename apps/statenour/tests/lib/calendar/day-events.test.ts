import { describe, expect, it } from "vitest";
import {
  readCalendarWindow,
  summarizeDay,
  type CalendarDeps,
  type DayEvent,
} from "@/lib/calendar/day-events";

// The 2026-10-30 probe found the shipped reader green and empty for 30 days: it read only the
// primary calendar of the one account that holds nothing. These tests pin the reader that
// replaces it: every connected account, every selected calendar, and an honest state for each
// way the read can come back with no events.

const FROM = new Date("2026-10-30T04:00:00Z"); // midnight ET
const TO = new Date("2026-10-31T04:00:00Z");

function deps(over: Partial<CalendarDeps> = {}): CalendarDeps {
  return {
    listAccounts: async () => [{ accountKey: "primary", state: "healthy" }],
    listCalendars: async () => [{ id: "primary", primary: true }],
    listEvents: async () => [],
    ...over,
  };
}

const ev = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id,
  iCalUID: `${id}@google.com`,
  summary: `event ${id}`,
  status: "confirmed",
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});

describe("readCalendarWindow", () => {
  it("says not_connected when no Google account holds a grant", async () => {
    const r = await readCalendarWindow(FROM, TO, deps({ listAccounts: async () => [] }));
    expect(r.state).toBe("not_connected");
  });

  it("says expired, not empty, when every grant is dead", async () => {
    const r = await readCalendarWindow(
      FROM,
      TO,
      deps({ listAccounts: async () => [{ accountKey: "personal", state: "expired" }] }),
    );
    expect(r.state).toBe("expired");
  });

  it("reads every selected calendar on every live account, not just primary", async () => {
    const seen: string[] = [];
    const r = await readCalendarWindow(
      FROM,
      TO,
      deps({
        listAccounts: async () => [
          { accountKey: "primary", state: "healthy" },
          { accountKey: "personal", state: "healthy" },
        ],
        listCalendars: async (acct) => [
          { id: `${acct}-main`, primary: true },
          { id: `${acct}-shared` },
          { id: `${acct}-hidden`, hidden: true },
          { id: "en.usa#holiday@group.v.calendar.google.com" },
        ],
        listEvents: async (acct, cal) => {
          seen.push(`${acct}/${cal}`);
          return cal.endsWith("shared") ? [ev(`${acct}1`, "2026-10-30T14:00:00Z", "2026-10-30T15:00:00Z")] : [];
        },
      }),
    );
    expect(seen.sort()).toEqual(["personal/personal-main", "personal/personal-shared", "primary/primary-main", "primary/primary-shared"]);
    expect(r.state).toBe("ok");
    if (r.state !== "ok") return;
    expect(r.events.map((e) => e.id)).toEqual(["primary1", "personal1"].sort());
    expect(r.sources).toEqual({ accounts: 2, calendars: 4 });
  });

  it("drops cancelled events and events Nour declined, and dedupes a shared event seen twice", async () => {
    const r = await readCalendarWindow(
      FROM,
      TO,
      deps({
        listCalendars: async () => [{ id: "a", primary: true }, { id: "b" }],
        listEvents: async (_acct, cal) => [
          ev("same", "2026-10-30T13:00:00Z", "2026-10-30T14:00:00Z"),
          ...(cal === "a"
            ? [
                ev("gone", "2026-10-30T15:00:00Z", "2026-10-30T16:00:00Z", { status: "cancelled" }),
                ev("no", "2026-10-30T17:00:00Z", "2026-10-30T18:00:00Z", {
                  attendees: [{ self: true, responseStatus: "declined" }],
                }),
              ]
            : []),
        ],
      }),
    );
    expect(r.state === "ok" && r.events.map((e) => e.id)).toEqual(["same"]);
  });

  it("marks all-day events and sorts by start", async () => {
    const r = await readCalendarWindow(
      FROM,
      TO,
      deps({
        listEvents: async () => [
          ev("late", "2026-10-30T20:00:00Z", "2026-10-30T21:00:00Z"),
          { id: "day", summary: "all day", status: "confirmed", start: { date: "2026-10-30" }, end: { date: "2026-10-31" } },
          ev("early", "2026-10-30T12:00:00Z", "2026-10-30T12:30:00Z"),
        ],
      }),
    );
    if (r.state !== "ok") throw new Error(r.state);
    expect(r.events.map((e) => [e.id, e.allDay])).toEqual([
      ["day", true],
      ["early", false],
      ["late", false],
    ]);
  });

  it("keeps the events it could read and names the account that failed", async () => {
    const r = await readCalendarWindow(
      FROM,
      TO,
      deps({
        listAccounts: async () => [
          { accountKey: "primary", state: "healthy" },
          { accountKey: "personal", state: "healthy" },
        ],
        listEvents: async (acct) => {
          if (acct === "personal") throw new Error("403");
          return [ev("ok1", "2026-10-30T14:00:00Z", "2026-10-30T15:00:00Z")];
        },
      }),
    );
    expect(r.state).toBe("ok");
    if (r.state !== "ok") return;
    expect(r.events).toHaveLength(1);
    expect(r.failedAccounts).toEqual(["personal"]);
  });

  it("says read_failed, never ok-and-empty, when every account read throws", async () => {
    const r = await readCalendarWindow(
      FROM,
      TO,
      deps({ listCalendars: async () => { throw new Error("network"); } }),
    );
    expect(r.state).toBe("read_failed");
  });

  it("says read_failed when the account list itself cannot be read", async () => {
    const r = await readCalendarWindow(FROM, TO, deps({ listAccounts: async () => { throw new Error("db"); } }));
    expect(r.state).toBe("read_failed");
  });
});

describe("summarizeDay", () => {
  const timed = (id: string, start: string, end: string): DayEvent => ({
    id, title: id, start, end, allDay: false, accountKey: "primary",
  });
  // 2026-10-30 ET; window 07:00-21:00 ET = 11:00Z-01:00Z
  const day = new Date("2026-10-30T16:00:00Z");

  it("finds the next event and the longest free block left today", () => {
    const s = summarizeDay(
      [
        timed("a", "2026-10-30T13:00:00Z", "2026-10-30T14:00:00Z"), // 9-10 ET, past
        timed("b", "2026-10-30T18:00:00Z", "2026-10-30T19:00:00Z"), // 2-3 ET
        timed("c", "2026-10-30T23:00:00Z", "2026-10-30T23:30:00Z"), // 7-7:30 ET
      ],
      day,
    );
    expect(s.count).toBe(3);
    expect(s.next?.id).toBe("b");
    // free from now (12 ET) to 2 ET = 120 min, 3-7 ET = 240 min, 7:30-9 ET = 90 min
    expect(s.longestFree).toEqual({ start: "2026-10-30T19:00:00.000Z", end: "2026-10-30T23:00:00.000Z", minutes: 240 });
    expect(s.busyMinutesLeft).toBe(90);
  });

  it("treats an event happening now as the current block, not the next one", () => {
    const s = summarizeDay([timed("now", "2026-10-30T15:30:00Z", "2026-10-30T16:30:00Z")], day);
    expect(s.current?.id).toBe("now");
    expect(s.next).toBeNull();
  });

  it("merges overlapping events before measuring free time", () => {
    const s = summarizeDay(
      [
        timed("x", "2026-10-30T17:00:00Z", "2026-10-30T19:00:00Z"),
        timed("y", "2026-10-30T18:00:00Z", "2026-10-30T20:00:00Z"),
      ],
      day,
    );
    expect(s.busyMinutesLeft).toBe(180);
  });

  it("does not put all-day events on the clock", () => {
    const s = summarizeDay([{ id: "d", title: "d", start: "2026-10-30", end: "2026-10-31", allDay: true, accountKey: "primary" }], day);
    expect(s.count).toBe(1);
    expect(s.allDay).toBe(1);
    expect(s.busyMinutesLeft).toBe(0);
    expect(s.longestFree?.minutes).toBe(540); // 12 ET to 9 ET
  });
});
