/**
 * Google Calendar API Client — event create via the stored refresh token
 * (see lib/services/google-oauth.ts). Reads live in lib/calendar/day-events
 * (his account, every selected calendar); listEvents below is the old list
 * shape over that reader.
 */

import { getAccessToken } from "@/lib/services/google-oauth";

export interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  attendees?: string[];
  location?: string;
  organizer?: string;
  status?: string;
  recurring?: boolean;
  htmlLink?: string;
}

/**
 * Typed error thrown by createEvent so a caller can branch
 * on 403 (Calendar API not enabled OR scope not granted) without
 * regex-matching error.message. Tags are stable across error msg
 * tweaks.
 */
export class CalendarApiError extends Error {
  readonly status: number;
  readonly tag: "scope_or_api_disabled" | "auth" | "rate_limit" | "other";
  constructor(status: number, message: string) {
    super(message);
    this.name = "CalendarApiError";
    this.status = status;
    this.tag =
      status === 403
        ? "scope_or_api_disabled"
        : status === 401
          ? "auth"
          : status === 429
            ? "rate_limit"
            : "other";
  }
}

/**
 * The old list shape, kept for the people reader (lib/ai/relationships-pick-today, PR 3432). Reads
 * through lib/calendar/day-events (his account only) and throws on any non-ok state, so that
 * caller says "calendar unknown" instead of "nobody coming up".
 */
export async function listEvents(options: { daysAhead?: number; daysBack?: number } = {}): Promise<CalEvent[]> {
  const { readCalendarWindow } = await import("@/lib/calendar/day-events");
  const now = Date.now();
  const read = await readCalendarWindow(
    new Date(now - (options.daysBack ?? 0) * 86_400_000),
    new Date(now + (options.daysAhead ?? 14) * 86_400_000),
  );
  if (read.state !== "ok") throw new Error(`calendar ${read.state}`);
  return read.events.map((e) => ({
    id: e.id,
    summary: e.title,
    description: e.description,
    start: e.start,
    end: e.end ?? undefined,
    attendees: e.attendees,
    location: e.location,
    organizer: e.organizer,
    recurring: e.recurring,
    htmlLink: e.link,
  }));
}

// forensic-audit HIGH · the operator's calendar zone. Timezone-less ISO
// strings (the proposeCalendarEvent schema tells the model to OMIT the zone
// and assume operator-local) were parsed by `new Date()` in the server's
// zone (UTC on Railway), so "block 2pm" landed at 10am ET with no timeZone
// on the Google event. parseOperatorDate interprets offset-less input as ET;
// the timeZone field below anchors the display.
const OPERATOR_TZ = "America/New_York";

function operatorTzOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATOR_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour === 24 ? 0 : +m.hour, +m.minute, +m.second);
  return (asUTC - instant.getTime()) / 60000;
}

function parseOperatorDate(iso: string): Date {
  const s = iso.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  if (hasZone) return new Date(s); // explicit offset → unambiguous instant
  const asUtc = new Date(s.endsWith("Z") ? s : s + "Z"); // naive components as UTC
  if (isNaN(asUtc.getTime())) return asUtc;
  const offMin = operatorTzOffsetMinutes(asUtc);
  return new Date(asUtc.getTime() - offMin * 60000);
}

/**
 * Create a new event on the primary calendar.
 */
export async function createEvent(args: {
  title: string;
  startISO: string;
  endISO?: string;
  location?: string;
  description?: string;
  attendees?: string[];
}): Promise<CalEvent> {
  const token = await getAccessToken();
  const start = parseOperatorDate(args.startISO);
  if (isNaN(start.getTime())) {
    throw new Error("Invalid startISO");
  }
  const end = args.endISO ? parseOperatorDate(args.endISO) : new Date(start.getTime() + 60 * 60_000);
  if (isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    throw new Error("Invalid endISO (must be after startISO)");
  }

  const body = {
    summary: args.title,
    location: args.location,
    description: args.description,
    start: { dateTime: start.toISOString(), timeZone: OPERATOR_TZ },
    end: { dateTime: end.toISOString(), timeZone: OPERATOR_TZ },
    attendees: args.attendees?.map((email) => ({ email })),
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new CalendarApiError(
      res.status,
      `Calendar create failed: ${res.status} ${text}`,
    );
  }

  const e = (await res.json()) as {
    id: string;
    summary?: string;
    description?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    attendees?: Array<{ email?: string }>;
    location?: string;
    organizer?: { email?: string };
    status?: string;
    recurringEventId?: string;
    htmlLink?: string;
  };

  return {
    id: e.id,
    summary: e.summary,
    description: e.description,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    attendees: (e.attendees || []).map((a) => a.email || "").filter(Boolean),
    location: e.location,
    organizer: e.organizer?.email,
    status: e.status,
    recurring: !!e.recurringEventId,
    htmlLink: e.htmlLink,
  };
}
