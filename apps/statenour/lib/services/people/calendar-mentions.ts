/**
 * People W4 S1 (2026-10-30): who Nour is about to see, from his calendar. Pure: the
 * events arrive from lib/services/calendar-api.ts listEvents (read-only; W4 never
 * creates events).
 *
 * A person is matched by their exact name in the event title (the W1 nameMatcher:
 * Unicode word boundaries, case-insensitive), never by attendee email: the schema
 * marks PersonProfile.email "NOT a match key". shortcut: a short first name ("Ana")
 * can match a different person with the same name; the W4 kill criterion watches
 * for that.
 */
import { nameMatcher } from "./backfill-plan";
import { toDateString } from "@/lib/utils/datetime";

export interface TitledEvent {
  summary?: string;
  /** RFC 3339 date-time, or YYYY-MM-DD for an all-day event (Google's shape). */
  start?: string;
}

const ALL_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** personId -> start of the earliest upcoming event that names them. */
export function nextEventByPerson(
  events: readonly TitledEvent[],
  people: ReadonlyArray<{ id: string; name: string }>,
  now: Date,
): Map<string, Date> {
  const todayKey = toDateString(now);
  const matchers = people.map((p) => ({ id: p.id, re: nameMatcher(p.name) }));
  const out = new Map<string, Date>();
  for (const e of events) {
    if (!e.summary || !e.start) continue;
    // An all-day date counts for its whole New York day; noon UTC lands on that same date there.
    const allDay = ALL_DAY.test(e.start);
    const at = allDay ? new Date(`${e.start}T12:00:00Z`) : new Date(e.start);
    if (!Number.isFinite(at.getTime())) continue;
    if (allDay ? e.start < todayKey : at < now) continue;
    for (const m of matchers) {
      if (!m.re.test(e.summary)) continue;
      const prev = out.get(m.id);
      if (!prev || at < prev) out.set(m.id, at);
    }
  }
  return out;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/New_York" });

/** "today", "tomorrow", or the New York weekday name. */
export function seeingLabel(at: Date, now: Date): string {
  const days = Math.round((Date.parse(toDateString(at)) - Date.parse(toDateString(now))) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return WEEKDAY.format(at);
}
