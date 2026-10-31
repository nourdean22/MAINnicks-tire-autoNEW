/**
 * The words each surface says about today's calendar, from one `CalendarRead`.
 * Every state gets its own sentence, so a failed or misconnected read never reads as a calm day.
 */

import { summarizeDay, type CalendarRead, type DayEvent } from "@/lib/calendar/day-events";

const ET = "America/New_York";

export function etTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function hoursLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * One line for the morning brief. `wide` is the same read over the last 7 / next 14 days,
 * fetched only when today is empty, so a connected-but-unused calendar is named as such.
 */
export function briefCalendarLine(today: CalendarRead, wide: CalendarRead | null, now: Date = new Date()): string {
  if (today.state === "read_failed") return "Calendar: unknown (read failed)";
  if (today.state === "not_connected") {
    return today.reason === "shop_account"
      ? "Calendar: not connected (the linked Google account is the shop's; connect nourdean22)"
      : "Calendar: not connected";
  }
  if (today.state === "expired") return `Calendar: Google grant expired (${today.accounts.join(", ")}), re-grant to read it`;

  const partial = today.failedAccounts.length ? ` (${today.failedAccounts.join(", ")} unreadable)` : "";
  if (today.events.length === 0) {
    if (wide?.state === "ok" && wide.events.length === 0 && wide.failedAccounts.length === 0) {
      return "Calendar: connected, but 0 events in the last 7 and next 14 days. Is the calendar you use connected?";
    }
    return `Calendar: nothing booked today${partial}`;
  }

  const s = summarizeDay(today.events, now);
  const firstTimed = today.events.find((e) => !e.allDay);
  const parts = [`Calendar: ${plural(today.events.length, "event")}`];
  if (firstTimed) parts.push(`first ${etTime(firstTimed.start)}`);
  if (s.longestFree && s.longestFree.minutes >= 30) {
    parts.push(`longest free ${etTime(s.longestFree.start)}-${etTime(s.longestFree.end)}`);
  }
  return parts.join(" · ") + partial;
}

const NICK_EVENT_CAP = 12;

/** The calendar block inside Nick's TODAY section. Titles stay inside the prompt, never in logs. */
export function nickCalendarBlock(read: CalendarRead, now: Date = new Date()): string {
  if (read.state === "read_failed") {
    return "### CALENDAR TODAY: unreadable right now. His schedule is unknown, not empty; say so if he asks.";
  }
  if (read.state === "not_connected") {
    return read.reason === "shop_account"
      ? "### CALENDAR TODAY: his own calendar is not connected (the linked account is the shop's Google account, which is not his calendar). His schedule is unknown; if he asks, say so and point him to connect nourdean22."
      : "### CALENDAR TODAY: no Google calendar is connected. If he asks about his schedule, say so.";
  }
  if (read.state === "expired") {
    return `### CALENDAR TODAY: the Google grant expired (${read.accounts.join(", ")}). His schedule is unknown until he re-grants.`;
  }
  const partial = read.failedAccounts.length ? ` ${read.failedAccounts.join(", ")} could not be read.` : "";
  if (read.events.length === 0) {
    return `### CALENDAR TODAY: no events on the connected calendars. Do not invent meetings.${partial}`;
  }

  const s = summarizeDay(read.events, now);
  const lines = [`### CALENDAR TODAY (live, ${plural(read.events.length, "event")})`];
  for (const e of read.events.slice(0, NICK_EVENT_CAP)) lines.push(`- ${eventSpan(e)} ${e.title}`);
  if (read.events.length > NICK_EVENT_CAP) lines.push(`- ...and ${read.events.length - NICK_EVENT_CAP} more`);
  const status: string[] = [];
  if (s.current) status.push(`Now: ${s.current.title} (until ${etTime(s.current.end as string)})`);
  if (s.next) status.push(`Next: ${s.next.title} at ${etTime(s.next.start)}`);
  if (s.longestFree) {
    status.push(
      `Longest free block left: ${etTime(s.longestFree.start)}-${etTime(s.longestFree.end)} (${hoursLabel(s.longestFree.minutes)})`,
    );
  }
  if (status.length) lines.push(status.join(" | "));
  lines.push("Plan around these real events; never move or create one unless he asks." + partial);
  return lines.join("\n");
}

function eventSpan(e: DayEvent): string {
  if (e.allDay) return "all day";
  return e.end ? `${etTime(e.start)}-${etTime(e.end)}` : etTime(e.start);
}
