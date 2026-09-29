/**
 * capacityCheck answers for the day the caller asked about, in Cleveland time
 * (audit 2026-09-29).
 *
 * The Vapi tool tells the model to send `day` as "YYYY-MM-DD", "today" or
 * "tomorrow". The procedure parsed it with `new Date(day)`:
 *   - "tomorrow" is not a date, so it answered for TODAY. A caller on a
 *     Saturday who asked about tomorrow heard Saturday's 8-to-6, and the shop
 *     opens at 9 on Sunday.
 *   - "2026-10-05" parses as UTC midnight, which is the evening before in
 *     Cleveland, so every date was named as the day before.
 *   - The hours were then chosen with getDay() in the SERVER's timezone (UTC on
 *     Railway), which disagrees with Cleveland from 8 PM to midnight, and they
 *     were typed into the code instead of read from BUSINESS.hours.structured.
 *
 * Every expectation here holds whatever timezone the test process runs in.
 * The red run on origin/main was in UTC, which is how Railway runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { BUSINESS } from "../../shared/business";

function createVoiceContext(): TrpcContext {
  return {
    user: null,
    isVoiceAgentInternal: true,
    req: { protocol: "https", headers: {} } as never,
    res: { clearCookie: () => {} } as never,
  };
}

const capacityCheck = (day?: string) =>
  appRouter.createCaller(createVoiceContext()).voiceAgent.capacityCheck(day === undefined ? {} : { day }) as Promise<{
    walkIn: boolean;
    openThatDay: boolean;
    hours: string | null;
    message: string;
  }>;

// Saturday 2026-10-03 in Cleveland (EDT, UTC-4).
const SAT_1000_ET = new Date("2026-10-03T14:00:00.000Z");
const SAT_2100_ET = new Date("2026-10-04T01:00:00.000Z"); // already Sunday in UTC
// Daylight time ends at 02:00 on Sunday 2026-11-01.
const SUN_0030_EDT = new Date("2026-11-01T04:30:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("capacityCheck · the day the caller asked about", () => {
  it("CONTROL: Saturday morning, no day given: Saturday, 8 to 6", async () => {
    vi.setSystemTime(SAT_1000_ET);
    const res = await capacityCheck();
    expect(res.message).toMatch(/^Saturday — we're open 8 to 6\./);
    expect(res.hours).toBe("8-6");
  });

  it("Saturday at 9 PM, no day given: still Saturday's hours, not Sunday's", async () => {
    vi.setSystemTime(SAT_2100_ET);
    const res = await capacityCheck();
    expect(res.message).toMatch(/^Saturday — we're open 8 to 6\./);
    expect(res.hours).toBe("8-6");
    await expect(capacityCheck("today")).resolves.toMatchObject({ hours: "8-6" });
  });

  it("'tomorrow' on a Saturday evening is Sunday, 9 to 4", async () => {
    vi.setSystemTime(SAT_2100_ET);
    const res = await capacityCheck("tomorrow");
    expect(res.message).toMatch(/^Sunday — we're open 9 to 4\./);
    expect(res.hours).toBe("9-4");
  });

  it("a YYYY-MM-DD date is named as that date, not the day before", async () => {
    vi.setSystemTime(SAT_1000_ET);
    await expect(capacityCheck("2026-10-05")).resolves.toMatchObject({ hours: "8-6" });
    expect((await capacityCheck("2026-10-05")).message).toMatch(/^Monday — /);
    expect((await capacityCheck("2026-10-04")).message).toMatch(/^Sunday — we're open 9 to 4\./);
  });

  it("a weekday name is taken as given", async () => {
    vi.setSystemTime(SAT_1000_ET);
    expect((await capacityCheck("Sunday")).message).toMatch(/^Sunday — we're open 9 to 4\./);
  });

  it("across the end of daylight time: just after midnight on Sunday 11-01 is Sunday, and tomorrow is Monday", async () => {
    vi.setSystemTime(SUN_0030_EDT);
    expect((await capacityCheck()).message).toMatch(/^Sunday — we're open 9 to 4\./);
    expect((await capacityCheck("tomorrow")).message).toMatch(/^Monday — we're open 8 to 6\./);
  });

  it("an impossible date or an unknown word falls back to today, never 'Invalid Date'", async () => {
    vi.setSystemTime(SAT_1000_ET);
    for (const day of ["2026-02-30", "not-a-date", "next week"]) {
      const res = await capacityCheck(day);
      expect(res.message).toMatch(/^Saturday — we're open 8 to 6\./);
      expect(res.message).not.toContain("Invalid Date");
    }
  });

  it("reads the hours from BUSINESS.hours.structured, the source the site renders", async () => {
    vi.setSystemTime(SAT_1000_ET);
    const hours = BUSINESS.hours.structured as Record<string, string>;
    const saturday = hours.saturday;
    try {
      hours.saturday = "09:00-15:30";
      const res = await capacityCheck();
      expect(res.message).toMatch(/^Saturday — we're open 9 to 3:30\./);
      expect(res.hours).toBe("9-3:30");
    } finally {
      hours.saturday = saturday;
    }
  });

  it("a day with no hours is reported closed, with the week's hours instead", async () => {
    vi.setSystemTime(SAT_1000_ET);
    const hours = BUSINESS.hours.structured as Record<string, string | undefined>;
    const sunday = hours.sunday;
    try {
      delete hours.sunday;
      const res = await capacityCheck("Sunday");
      expect(res.openThatDay).toBe(false);
      expect(res.hours).toBeNull();
      expect(res.message).toMatch(/^Sunday — we're closed\./);
      expect(res.message).toContain("Monday through Saturday 8 to 6");
    } finally {
      hours.sunday = sunday;
    }
  });
});
