/**
 * The shop's regular weekly hours, the ONE statenour copy.
 *
 * Source of truth: apps/nickstire/shared/business.ts `BUSINESS.hours.structured` (+ `timezone`).
 * statenour cannot import it (separate app and image), so tests/lib/nickstire-shop-hours.test.ts
 * reads that file's text and fails when the two disagree. Change both, or the test goes red.
 *
 * Why it exists: the chat rule sends shop hours and open/closed to a tool result, and no tool
 * returned hours, so "is the shop open Sunday?" could only end in "can't confirm". dailyPulse
 * carries `shopHoursView()` now.
 */

export const SHOP_TIMEZONE = "America/New_York";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type ShopWeekday = (typeof WEEKDAYS)[number];

/** "HH:MM-HH:MM" in SHOP_TIMEZONE wall-clock. Close is exclusive: at 18:00 the shop is closed. */
export const SHOP_HOURS: Readonly<Record<ShopWeekday, string>> = {
  monday: "08:00-18:00",
  tuesday: "08:00-18:00",
  wednesday: "08:00-18:00",
  thursday: "08:00-18:00",
  friday: "08:00-18:00",
  saturday: "08:00-18:00",
  sunday: "09:00-16:00",
};

const h12 = (hhmm: string) => String(Number(hhmm.slice(0, 2)) % 12 || 12);
const [monOpen, monClose] = SHOP_HOURS.monday.split("-");
const [sunOpen, sunClose] = SHOP_HOURS.sunday.split("-");
/** The short form the SMS voice prompt uses, derived so it cannot drift from SHOP_HOURS. */
export const SHOP_HOURS_COMPACT = `Mon-Sat ${h12(monOpen)}-${h12(monClose)} / Sun ${h12(sunOpen)}-${h12(sunClose)}`;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export interface ShopHoursView {
  timezone: string;
  weekly: Readonly<Record<ShopWeekday, string>>;
  today: { weekday: ShopWeekday; hours: string };
  openNow: boolean;
  /** What openNow is computed from, so a holiday closure is never read as a measured fact. */
  basis: string;
  asOf: string;
}

/** Weekly hours plus whether the shop is open at `now`, on the ET wall clock (DST-safe: Intl, no fixed offset). */
export function shopHoursView(now: Date = new Date()): ShopHoursView {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIMEZONE,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday").toLowerCase() as ShopWeekday;
  const nowMin = (Number(get("hour")) % 24) * 60 + Number(get("minute")); // some engines emit "24" at midnight
  const hours = SHOP_HOURS[weekday];
  const [open, close] = hours.split("-");
  return {
    timezone: SHOP_TIMEZONE,
    weekly: SHOP_HOURS,
    today: { weekday, hours },
    openNow: nowMin >= minutes(open) && nowMin < minutes(close),
    basis: "regular weekly hours; holiday closures are not modelled",
    asOf: now.toISOString(),
  };
}
