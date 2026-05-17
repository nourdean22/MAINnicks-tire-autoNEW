/**
 * Google Calendar API Client — headless read via the stored refresh
 * token (see lib/services/google-oauth.ts).
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
 * Typed error thrown by listEvents so the cron handler can branch
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
 * List events on the primary calendar within a time window.
 * Defaults to next 14 days. Pass negative days for past events.
 */
export async function listEvents(options: {
  daysAhead?: number;
  daysBack?: number;
  maxResults?: number;
} = {}): Promise<CalEvent[]> {
  const token = await getAccessToken();
  const now = Date.now();
  const daysAhead = options.daysAhead ?? 14;
  const daysBack = options.daysBack ?? 0;
  const timeMin = new Date(now - daysBack * 86400000).toISOString();
  const timeMax = new Date(now + daysAhead * 86400000).toISOString();

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(options.maxResults ?? 100),
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    // 403 = Calendar API disabled OR calendar.readonly scope was
    // dropped during a re-consent. Throw the typed error so the cron
    // can branch + write a brain insight + mark the integration
    // partial-config instead of dumping a stack trace into errors-24h.
    throw new CalendarApiError(
      res.status,
      `Calendar list failed: ${res.status}`,
    );
  }

  const data = (await res.json()) as {
    items?: Array<{
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
    }>;
  };

  return (data.items || []).map((e) => ({
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
  }));
}
