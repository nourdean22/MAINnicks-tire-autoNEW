/**
 * The after-hours text names the day it opens, not "tomorrow" (issue #2579,
 * post-merge audit 2026-09-23 item D).
 *
 * after_hours_capture is a marketing-class text, so sendSms holds it through
 * quiet hours (8 PM-8 AM ET) and the queue drains it after 8 AM the next day.
 * {nextOpen} is filled when the form arrives, though. A form at 9 PM Tuesday
 * said "open again at 8:00 AM tomorrow" and was read Wednesday morning. A
 * weekday name is true whenever the text is read.
 */
import { describe, expect, it } from "vitest";
import { nextOpeningLabel } from "./shopState";
import { BUSINESS } from "./business";

const label = (iso: string) => nextOpeningLabel(new Date(iso), BUSINESS.timezone, BUSINESS.hours.structured);

describe("nextOpeningLabel", () => {
  it("Tue 21:00 ET (Wed 01:00 UTC) -> 8:00 AM Wednesday", () => {
    expect(label("2026-09-22T21:00:00-04:00")).toBe("8:00 AM Wednesday");
  });

  it("Sun 21:00 ET -> 8:00 AM Monday", () => {
    expect(label("2026-09-20T21:00:00-04:00")).toBe("8:00 AM Monday");
  });

  it("Sat 21:00 ET -> 9:00 AM Sunday (Sunday's own hours)", () => {
    expect(label("2026-09-19T21:00:00-04:00")).toBe("9:00 AM Sunday");
  });

  it("before opening names today by its weekday: Wed 03:00 ET -> 8:00 AM Wednesday", () => {
    expect(label("2026-09-23T03:00:00-04:00")).toBe("8:00 AM Wednesday");
  });

  it("DST ends overnight: Sat 2026-10-31 21:00 EDT -> 9:00 AM Sunday", () => {
    expect(label("2026-10-31T21:00:00-04:00")).toBe("9:00 AM Sunday");
  });

  it("inside the repeated hour: Sun 2026-11-01 01:30 EST -> 9:00 AM Sunday", () => {
    expect(label("2026-11-01T01:30:00-05:00")).toBe("9:00 AM Sunday");
  });

  it("DST starts overnight: Sat 2027-03-13 21:00 EST -> 9:00 AM Sunday", () => {
    expect(label("2027-03-13T21:00:00-05:00")).toBe("9:00 AM Sunday");
  });

  it("never says today or tomorrow", () => {
    for (let h = 0; h < 24 * 7; h++) {
      const l = label(new Date(Date.parse("2026-09-20T00:00:00-04:00") + h * 3_600_000).toISOString());
      expect(l).toMatch(/^\d{1,2}:\d{2} (AM|PM) (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/);
    }
  });

  it("returns null rather than inventing a time when no hours are configured", () => {
    expect(nextOpeningLabel(new Date(), BUSINESS.timezone, {})).toBeNull();
  });
});
