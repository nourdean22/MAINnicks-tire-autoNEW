/**
 * Mission task due hint · bug hunt 2026-10-22.
 *
 * A task's due date comes from a `type="date"` input and is stored as UTC
 * midnight (lib/validators/shared.ts z.coerce.date()). The old hint divided the
 * raw millisecond gap, so in America/New_York a task due Oct 23 read "today" on
 * the evening of the 22nd and "1d late" on the 23rd itself, and dates a week+
 * out printed the previous day. The hint now compares calendar days.
 */
import { describe, expect, it } from "vitest";
import { formatDueHint } from "@/lib/missions/due-hint";

// 14:00 in New York on Oct 23, the same calendar day in UTC.
const NOW = new Date("2026-10-23T18:00:00.000Z");

describe("formatDueHint · calendar days, not a millisecond gap", () => {
  it("the test process runs in a zone west of UTC (vitest.setup.ts pins America/New_York)", () => {
    // Without this the label tests below cannot see the off-by-one at all.
    expect(new Date("2026-10-23T00:00:00.000Z").getDate()).toBe(22);
  });

  it("a task due today says today on its due day (was '1d late')", () => {
    expect(formatDueHint("2026-10-23T00:00:00.000Z", NOW)).toBe("today");
  });

  it("due tomorrow says tomorrow; due yesterday says 1d late", () => {
    expect(formatDueHint("2026-10-24T00:00:00.000Z", NOW)).toBe("tomorrow");
    expect(formatDueHint("2026-10-22T00:00:00.000Z", NOW)).toBe("1d late");
  });

  it("a week out prints that date, not the day before", () => {
    expect(formatDueHint("2026-10-30T00:00:00.000Z", NOW)).toBe("Oct 30");
    expect(formatDueHint("2026-11-15T00:00:00.000Z", NOW)).toBe("Nov 15");
  });

  it("CONTROL: empty and unparseable dates still give no hint", () => {
    expect(formatDueHint(null, NOW)).toBeNull();
    expect(formatDueHint("not a date", NOW)).toBeNull();
  });
});
