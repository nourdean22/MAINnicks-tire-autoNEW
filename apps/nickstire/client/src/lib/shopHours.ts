/**
 * shopHours — single source of truth for "is the shop open right now".
 *
 * Extracted from StickyTrustBar (2026-07-04, conversion-finisher wave) so
 * time-aware CTAs (diagnose "get down here" card, emissions "come get a
 * scan" hint, the ShopStrip) share it instead of re-deriving the schedule.
 *
 * 2026-09-08 · two defects fixed here:
 *   1. The clock was the VISITOR's local time. The shop is in Cleveland; a
 *      customer whose phone is on Central time (or a crawler in UTC) was told
 *      the wrong state for hours a day. Now America/New_York, always.
 *   2. The hours were hard-coded (8/18/9/16) in a second place, so a change
 *      to BUSINESS.hours.structured would not have reached this file. Now
 *      derived from canon, like useBusinessHours already was.
 * `now` is injectable for tests; production callers omit it.
 */
import { BUSINESS } from "@shared/business";

export interface OpenStatus {
  isOpen: boolean;
  /** Legacy label kept for existing consumers: "Open Now" · "Opens at 8 AM". */
  label: string;
  /** Strip copy: "Closes 6 PM" · "Opens 8 AM" · "Opens tomorrow 9 AM". */
  until: string;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** 480 → "8 AM" · 990 → "4:30 PM" · 1080 → "6 PM" */
const clock = (minutes: number): string => {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 || 12;
  const ampm = h24 >= 12 ? "PM" : "AM";
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
};

const rangeFor = (day: number) => {
  const [open, close] = BUSINESS.hours.structured[DAYS[day]].split("-");
  return { open: toMinutes(open), close: toMinutes(close) };
};

/** Day-of-week and minutes-since-midnight in Cleveland, whatever the device clock says. */
function easternDayAndMinutes(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = WEEKDAY_SHORT.indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24; // some ICU builds print "24" at midnight
  return { day: day < 0 ? now.getDay() : day, minutes: hour * 60 + Number(get("minute")) };
}

export function getOpenStatus(now: Date = new Date()): OpenStatus {
  const { day, minutes } = easternDayAndMinutes(now);
  const today = rangeFor(day);

  if (minutes >= today.open && minutes < today.close) {
    return { isOpen: true, label: "Open Now", until: `Closes ${clock(today.close)}` };
  }
  if (minutes < today.open) {
    return { isOpen: false, label: `Opens at ${clock(today.open)}`, until: `Opens ${clock(today.open)}` };
  }
  const tomorrow = rangeFor((day + 1) % 7);
  return {
    isOpen: false,
    label: `Opens at ${clock(tomorrow.open)}`,
    until: `Opens tomorrow ${clock(tomorrow.open)}`,
  };
}
