import { beforeEach, describe, expect, it, vi } from "vitest";

// listEvents is kept for the people reader (relationships-pick-today, PR 3432). It now reads
// through the one calendar reader (his account only, never the shop's) and throws on every
// non-ok state, so that caller's "calendar unknown" branch fires instead of "nobody coming up".

const h = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/calendar/day-events", () => ({ readCalendarWindow: h.read }));

import { listEvents } from "@/lib/services/calendar-api";

beforeEach(() => h.read.mockReset());

describe("calendar-api listEvents · adapter over the one reader", () => {
  it("returns the reader's events in the CalEvent shape over the asked window", async () => {
    h.read.mockResolvedValue({
      state: "ok",
      sources: { accounts: 1, calendars: 1 },
      failedAccounts: [],
      events: [{ id: "e1", title: "T", start: "2026-11-01T14:00:00Z", end: "2026-11-01T15:00:00Z", allDay: false, accountKey: "personal", attendees: [] }],
    });
    const before = Date.now();
    const events = await listEvents({ daysAhead: 3 });
    const [from, to] = h.read.mock.calls[0] as [Date, Date];
    expect(Math.abs(from.getTime() - before)).toBeLessThan(5_000);
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(3);
    expect(events).toEqual([expect.objectContaining({ id: "e1", summary: "T", start: "2026-11-01T14:00:00Z", end: "2026-11-01T15:00:00Z" })]);
  });

  it.each([
    { state: "not_connected" },
    { state: "not_connected", reason: "shop_account" },
    { state: "expired", accounts: ["personal"] },
    { state: "read_failed", reason: "x" },
  ])("throws on $state so a caller never reads an empty calendar", async (r) => {
    h.read.mockResolvedValue(r);
    await expect(listEvents({ daysAhead: 3 })).rejects.toThrow(/calendar/);
  });
});
