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

/**
 * Minutes-since-midnight open/close for a weekday, or null when that day has
 * no usable range. Canon is 7-day right now, but a future `sunday: "Closed"`
 * must not silently become `NaN` and then a due date of `Invalid Date`.
 */
const hoursFor = (day: number): { open: number; close: number } | null => {
  const raw = BUSINESS.hours.structured[DAYS[day]] as string | undefined;
  if (typeof raw !== "string") return null;
  const [open, close] = raw.split("-");
  if (!open || !close) return null;
  const o = toMinutes(open);
  const c = toMinutes(close);
  return Number.isFinite(o) && Number.isFinite(c) && c > o ? { open: o, close: c } : null;
};

/** Legacy shape for getOpenStatus — preserves the pre-2026-09-16 NaN behaviour exactly. */
const rangeFor = (day: number) => hoursFor(day) ?? { open: NaN, close: NaN };

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

/* ─────────── Business-calendar due times ───────────
 *
 * Added 2026-09-16 because the Promises panel's quick-picks were pure
 * duration arithmetic wearing business-semantic labels: "End of day" was
 * `now + 6h` and "Tomorrow" was `now + 24h`. A promise logged at 9:10 AM came
 * due at 3:10 PM — nearly three hours BEFORE the shop shuts — and one logged
 * at 4:30 PM came due at 10:30 PM, four and a half hours AFTER. Neither is
 * end of day, so the ledger's overdue colour was measuring the wrong instant.
 * "Tomorrow" had the same defect: +24h from a 5 PM promise is 5 PM, not the
 * next morning anyone could act on it.
 *
 * The clock lives here because this file already owns the shop's Eastern
 * calendar and reads the hours from canon; a second implementation is how the
 * hard-coded 8/18/9/16 drift of 2026-09-08 happened in the first place.
 */

/** Eastern calendar date + weekday + minutes-since-midnight for an instant. */
function easternParts(now: Date): { year: number; month: number; date: number; day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = WEEKDAY_SHORT.indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24; // some ICU builds print "24" at midnight
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    date: Number(get("day")),
    day: day < 0 ? now.getDay() : day,
    minutes: hour * 60 + Number(get("minute")),
  };
}

/** How far Eastern wall-clock sits from UTC at an instant, in minutes (negative west of UTC). */
function easternOffsetMinutes(at: Date): number {
  const p = easternParts(at);
  const wallAsIfUTC = Date.UTC(p.year, p.month - 1, p.date, Math.floor(p.minutes / 60), p.minutes % 60);
  const atMinute = Math.floor(at.getTime() / 60_000) * 60_000;
  return (wallAsIfUTC - atMinute) / 60_000;
}

/**
 * The instant at which Cleveland's wall clock reads the given date and minute.
 *
 * Two passes, because the offset at the naive guess can differ from the offset
 * at the answer: the guess sits 4–5h before the answer, so a transition inside
 * that window would put the first result an hour out.
 *
 * NOT EXERCISED BY THE TESTS, AND SAY SO RATHER THAN IMPLY COVERAGE. The
 * passes only diverge when the target wall clock lands roughly in 02:00–07:00,
 * and canon's earliest hour is 08:00 (Sunday 09:00), so every real open/close
 * settles on the first pass — the DST canaries in shopHours.test.ts prove the
 * conversion is right, not that this branch ran. It is kept as a guard for a
 * future early-morning schedule; if hours ever move before ~07:00, add a test
 * that reaches it instead of trusting this comment.
 */
function easternWallClockToInstant(year: number, month: number, date: number, minutes: number): Date {
  const naiveUTC = Date.UTC(year, month - 1, date, Math.floor(minutes / 60), minutes % 60);
  const guessed = easternOffsetMinutes(new Date(naiveUTC));
  const first = new Date(naiveUTC - guessed * 60_000);
  const settled = easternOffsetMinutes(first);
  return settled === guessed ? first : new Date(naiveUTC - settled * 60_000);
}

/** Calendar-only day arithmetic on Eastern date fields (no timezone involved). */
function addEasternDays(p: { year: number; month: number; date: number }, n: number) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.date + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate(), day: d.getUTCDay() };
}

/** The quick-picks the Promises panel offers. Ids, not hour counts — that was the bug. */
export type DuePickId = "in_2h" | "end_of_day" | "next_open";

export interface DueResolution {
  dueAt: Date;
  /**
   * What the pick actually resolved to, in the operator's words — rendered
   * next to the picker so "End of day" can never again mean something the
   * label does not say.
   */
  detail: string;
}

export const DUE_PICK_LABELS: Record<DuePickId, string> = {
  in_2h: "In 2h",
  end_of_day: "End of day",
  next_open: "Tomorrow",
};

/**
 * Resolve a quick-pick to a real instant on the shop's calendar.
 *
 * - `in_2h` stays a duration, because "in 2 hours" genuinely means that.
 * - `end_of_day` is today's closing time, or the next day the shop shuts if
 *   we are already past it.
 * - `next_open` is the next day's OPENING time — the first moment anyone
 *   could actually do the thing that was promised.
 */
export function resolveDueAt(pick: DuePickId, now: Date = new Date()): DueResolution {
  if (pick === "in_2h") {
    return { dueAt: new Date(now.getTime() + 2 * 3_600_000), detail: "2 hours from now" };
  }

  const here = easternParts(now);

  if (pick === "end_of_day") {
    const today = hoursFor(here.day);
    if (today && here.minutes < today.close) {
      return {
        dueAt: easternWallClockToInstant(here.year, here.month, here.date, today.close),
        detail: `today at close · ${clock(today.close)}`,
      };
    }
  }

  // Past close (or an unusable today), and every `next_open`: walk forward to
  // the next day that actually has hours.
  const wantOpen = pick === "next_open";
  for (let i = 1; i <= 7; i += 1) {
    const cand = addEasternDays(here, i);
    const hours = hoursFor(cand.day);
    if (!hours) continue;
    const minute = wantOpen ? hours.open : hours.close;
    return {
      dueAt: easternWallClockToInstant(cand.year, cand.month, cand.date, minute),
      detail: `${WEEKDAY_SHORT[cand.day]} at ${wantOpen ? "open" : "close"} · ${clock(minute)}`,
    };
  }

  // Unreachable while canon has any open day. Fail loud rather than return a
  // silently-wrong instant that would land in the ledger as a real due date.
  throw new Error("resolveDueAt: BUSINESS.hours.structured has no day with usable hours");
}
