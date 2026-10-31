import { afterEach, describe, expect, it, vi } from "vitest";

// Calendar r2 W1 acceptance: ONE fixture event on his Google calendar, read through the real
// reader (only Google's HTTP and the token store are faked), reaches the brief line, Nick's TODAY
// block, Nick's schedule tool and the people reader. The same read failing says "unknown" on each.

const h = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/services/google-oauth", () => ({
  CALENDAR_ACCOUNT_KEY: "personal",
  getGoogleOauthAccountsStatus: async () => ({ probeFailed: false, accounts: [{ key: "primary", state: "healthy" }, { key: "personal", state: "healthy" }] }),
  listConfiguredAccounts: async () => [
    { accountKey: "primary", integrationName: "google_oauth", email: "shop@example.com" },
    { accountKey: "personal", integrationName: "google_oauth_personal", email: "owner@example.com" },
  ],
  getAccessToken: async (k: string) => `tok-${k}`,
}));

import { readCalendarWindow } from "@/lib/calendar/day-events";
import { briefCalendarLine, nickCalendarBlock } from "@/lib/calendar/day-lines";
import { readSchedule } from "@/lib/ai/tools/calendar";
import { listEvents } from "@/lib/services/calendar-api";

const inAnHour = () => new Date(Date.now() + 3_600_000);

function stubGoogle() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (h.fail) return new Response("{}", { status: 500 });
    if (url.includes("/calendarList")) return new Response(JSON.stringify({ items: [{ id: "primary", primary: true }] }), { status: 200 });
    const s = inAnHour();
    const e = new Date(s.getTime() + 1_800_000);
    return new Response(
      JSON.stringify({ items: [{ id: "fx-1", status: "confirmed", summary: "Fixture event", start: { dateTime: s.toISOString() }, end: { dateTime: e.toISOString() } }] }),
      { status: 200 },
    );
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  h.fail = false;
});

describe("one Google event reaches every planning surface", () => {
  it("brief, Nick, the schedule tool and the people reader all see it", async () => {
    stubGoogle();
    const from = new Date(Date.now() - 60_000);
    const read = await readCalendarWindow(from, new Date(Date.now() + 86_400_000));
    expect(read.state).toBe("ok");

    expect(briefCalendarLine(read, null)).toMatch(/^Calendar: 1 event/);
    expect(nickCalendarBlock(read)).toContain("Fixture event");

    const tool = await readSchedule(1);
    expect(tool).toMatchObject({ ok: true, count: 1 });

    const people = await listEvents({ daysAhead: 3 });
    expect(people.map((e) => e.id)).toEqual(["fx-1"]);
  });

  it("the same read failing says unknown on each, never an empty day", async () => {
    stubGoogle();
    h.fail = true;
    const read = await readCalendarWindow(new Date(), new Date(Date.now() + 86_400_000));
    expect(read.state).toBe("read_failed");
    expect(briefCalendarLine(read, null)).toBe("Calendar: unknown (read failed)");
    expect(nickCalendarBlock(read)).toMatch(/unknown, not empty/);
    expect(await readSchedule(1)).toMatchObject({ ok: false, code: "unknown" });
    await expect(listEvents({ daysAhead: 3 })).rejects.toThrow(/calendar read_failed/);
  });
});
