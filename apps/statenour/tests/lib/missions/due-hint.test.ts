/**
 * Mission task due hint · bug hunt 2026-10-22.
 *
 * A task's due date comes from a `type="date"` input and is stored as UTC
 * midnight (lib/validators/shared.ts z.coerce.date()). The old hint divided the
 * raw millisecond gap, so in America/New_York a task due Oct 23 read "today" on
 * the evening of the 22nd and "1d late" on the 23rd itself, and dates a week+
 * out printed the previous day. The hint now compares calendar days.
 *
 * Zone-independent: `now` is built from LOCAL components, the way the helper
 * reads it, so these pass in any process TZ (CI runs UTC; a dev box may run
 * America/New_York). The old day math fails 4 of 5 in both zones; dropping
 * `timeZone: "UTC"` from the label shows only in a zone west of UTC.
 */
import { describe, expect, it } from "vitest";
import { formatDueHint } from "@/lib/missions/due-hint";

// 14:00 local time on Oct 23, whatever the process zone is.
const NOW = new Date(2026, 9, 23, 14, 0);

describe("formatDueHint · calendar days, not a millisecond gap", () => {
  it("a task due today says today on its due day (was '1d late')", () => {
    expect(formatDueHint("2026-10-23T00:00:00.000Z", NOW)).toBe("today");
  });

  it("the evening before, a task due tomorrow says tomorrow (was 'today')", () => {
    expect(formatDueHint("2026-10-23T00:00:00.000Z", new Date(2026, 9, 22, 21, 0))).toBe("tomorrow");
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
