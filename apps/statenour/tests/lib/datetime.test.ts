import {
  today,
  daysAgo,
  isStale,
  formatDuration,
  relativeTime,
  toDateString,
} from "@/lib/utils/datetime";

describe("today", () => {
  it("returns YYYY-MM-DD format", () => {
    const result = today();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("daysAgo", () => {
  it("daysAgo(0) returns today", () => {
    const result = daysAgo(0);
    const now = new Date();
    expect(result.getDate()).toBe(now.getDate());
    expect(result.getMonth()).toBe(now.getMonth());
    expect(result.getFullYear()).toBe(now.getFullYear());
  });

  it("daysAgo(7) returns a Date 7 days ago", () => {
    const result = daysAgo(7);
    const expected = new Date();
    expected.setDate(expected.getDate() - 7);
    // Compare date portions only
    expect(result.toDateString()).toBe(expected.toDateString());
  });
});

describe("isStale", () => {
  it("returns true for null", () => {
    expect(isStale(null, 5)).toBe(true);
  });

  it("returns false for a fresh date", () => {
    expect(isStale(new Date(), 5)).toBe(false);
  });

  it("returns true for a date older than threshold", () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    expect(isStale(oldDate, 5)).toBe(true);
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(2500)).toBe("2.5s");
  });
});

describe("relativeTime", () => {
  it('returns "just now" for current date', () => {
    expect(relativeTime(new Date())).toBe("just now");
  });
});

describe("toDateString", () => {
  it("returns YYYY-MM-DD in ET for a Date object", () => {
    // toDateString intentionally formats in America/New_York. Use noon UTC
    // (08:00 ET) so both EDT (UTC-4) and EST (UTC-5) land on the same
    // calendar day regardless of DST status.
    const date = new Date("2026-03-26T12:00:00.000Z");
    expect(toDateString(date)).toBe("2026-03-26");
  });
});
