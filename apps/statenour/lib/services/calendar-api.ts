/**
 * Google Calendar API Client — the old call shapes over the calendar r2 modules: reads live in
 * lib/calendar/day-events, writes in lib/calendar/write (his account only, both).
 */

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


/**
 * Create an event on HIS calendar (calendar r2 W3). Delegates to lib/calendar/write: his slot
 * only (refuses the shop's account, an expired grant or none), no attendees and no invites, and
 * the event is read back before this returns. Throws CalendarApiError when it did not land, so
 * both callers (Nick's proposeCalendarEvent, the agent's google.proposeEvent) keep their shape.
 * `attendees` is accepted and ignored: an invite is a send.
 */
export async function createEvent(args: {
  title: string;
  startISO: string;
  endISO?: string;
  location?: string;
  description?: string;
  attendees?: string[];
}): Promise<CalEvent> {
  const { writeCalendarEvent, parseOperatorDate } = await import("@/lib/calendar/write");
  const start = parseOperatorDate(args.startISO);
  const end = args.endISO ? args.endISO : new Date(start.getTime() + 60 * 60_000).toISOString();
  const r = await writeCalendarEvent({
    kind: "create",
    title: args.title,
    start: args.startISO,
    end,
    location: args.location,
    description: args.description,
  });
  if (!r.ok) throw new CalendarApiError(r.reason === "write_failed" ? 502 : 409, `Calendar create refused: ${r.reason}`);
  return { id: r.eventId, summary: args.title, start: start.toISOString(), end, htmlLink: r.link };
}