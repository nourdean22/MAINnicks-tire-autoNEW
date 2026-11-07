/**
 * Post-call text cooldown (2026-11-07 audit: 63 phones got the forwarded-call
 * follow-up 2+ times in a month). One send per phone per 14 days, and none while
 * the customer's own text is waiting on us. America/New_York stated; the rule is
 * elapsed time, so DST must not move the boundary. The db is a fake that returns
 * the aggregate row the hold query would; no real database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadForwardedFollowupHold } from "./forwardedFollowupHold";

const NOW = new Date("2026-11-07T10:00:00-05:00"); // Saturday, America/New_York (EST, after the Nov 1 DST end)
const DAY = 86_400_000;
const daysAgo = (d: number, extraMs = 0) => new Date(NOW.getTime() - d * DAY - extraMs);

const seen: unknown[] = [];
const dbWith = (row: Record<string, unknown> | undefined) => ({
  execute: async (q: unknown) => { seen.push(q); return [row ? [row] : [], []]; },
});
const hold = (row: Record<string, unknown> | undefined) => loadForwardedFollowupHold(dbWith(row), "+1 (216) 555-0147", new Date());

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); seen.length = 0; });
afterEach(() => vi.useRealTimers());

describe("loadForwardedFollowupHold", () => {
  it("positive control: no conversation for the phone -> send (null), and the query ran", async () => {
    expect(await hold(undefined)).toBeNull();
    expect(await hold({ anyOpen: null, lastSendAt: null, lastInboundAt: null, lastOutboundAt: null })).toBeNull();
    expect(seen).toHaveLength(2);
  });

  it("a follow-up 13 days ago holds; exactly 14 days holds; 14 days and 1 ms does not", async () => {
    expect(await hold({ lastSendAt: daysAgo(13) })).toBe("cooldown_14d");
    expect(await hold({ lastSendAt: daysAgo(14) })).toBe("cooldown_14d");
    expect(await hold({ lastSendAt: daysAgo(14, 1) })).toBeNull();
  });

  it("the window spans the 2026-11-01 DST change by elapsed time, not wall clock", async () => {
    // 14 x 24 h before 10:00 EST is 11:00 EDT on 2026-10-24.
    expect(await hold({ lastSendAt: new Date("2026-10-24T11:00:00-04:00") })).toBe("cooldown_14d");
    expect(await hold({ lastSendAt: new Date("2026-10-24T10:59:59-04:00") })).toBeNull();
  });

  it("reads a DB timestamp string as well as a Date", async () => {
    expect(await hold({ lastSendAt: daysAgo(2).toISOString() })).toBe("cooldown_14d");
  });

  it("open conversation with an inbound newer than our last outbound -> awaiting_reply", async () => {
    expect(await hold({ anyOpen: 1, lastInboundAt: daysAgo(0, 3_600_000), lastOutboundAt: daysAgo(1) })).toBe("awaiting_reply");
    expect(await hold({ anyOpen: 1, lastInboundAt: daysAgo(2), lastOutboundAt: null })).toBe("awaiting_reply");
  });

  it("we already answered, or the conversation is closed -> no awaiting hold", async () => {
    expect(await hold({ anyOpen: 1, lastInboundAt: daysAgo(2), lastOutboundAt: daysAgo(1) })).toBeNull();
    expect(await hold({ anyOpen: 0, lastInboundAt: daysAgo(0, 60_000), lastOutboundAt: daysAgo(1) })).toBeNull();
  });

  it("a failed read or no db holds (fails closed); a phone without 10 digits is not looked up", async () => {
    const broken = { execute: async () => { throw new Error("ER_CON_COUNT_ERROR"); } };
    expect(await loadForwardedFollowupHold(broken, "2165550147")).toBe("hold_read_failed");
    expect(await loadForwardedFollowupHold(null, "2165550147")).toBe("hold_read_failed");
    expect(await loadForwardedFollowupHold(dbWith(undefined), "12345")).toBeNull();
    expect(seen).toHaveLength(0);
  });
});
