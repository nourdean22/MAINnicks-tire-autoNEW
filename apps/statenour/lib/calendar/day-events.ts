/**
 * One calendar reader for every surface (Home, the day view, the morning brief, plan-day, Nick).
 *
 * Why it exists (2026-10-30 probe, counts only): the ingest cron ran green 30 of 30 days and
 * stored 0 events, because `listEvents` read only `calendars/primary` of the one account
 * connected, and that calendar is empty. A zero from that read looked exactly like a calm day.
 * This reader reads every selected calendar on Nour's own account (CALENDAR_ACCOUNT_KEY; the
 * shop's account in the primary slot is never his calendar), and returns a STATE beside the
 * events so a caller can tell "nothing today" from "not connected", "grant expired" and
 * "read failed".
 *
 * Read-only. Nothing here writes to Google.
 */

import {
  CALENDAR_ACCOUNT_KEY,
  getAccessToken,
  getGoogleOauthAccountsStatus,
  listConfiguredAccounts,
  type GoogleOauthStatus,
} from "@/lib/services/google-oauth";
import { endOfDayET, startOfDayET } from "@/lib/utils/datetime";

export interface DayEvent {
  id: string;
  title: string;
  /** ISO instant for timed events; `YYYY-MM-DD` for all-day ones. */
  start: string;
  end: string | null;
  allDay: boolean;
  accountKey: string;
  /** Detail the ingest cron and Nick's tool keep; the timeline never shows these. */
  location?: string;
  organizer?: string;
  attendees?: string[];
  description?: string;
  recurring?: boolean;
  link?: string;
}

export type CalendarRead =
  /** `shop_account`: his slot was granted with the shop's Google account, so nothing is read. */
  | { state: "not_connected"; reason?: "shop_account" }
  | { state: "expired"; accounts: string[] }
  | { state: "read_failed"; reason: string }
  | {
      state: "ok";
      events: DayEvent[];
      sources: { accounts: number; calendars: number };
      /** Accounts whose read threw this time; their events are missing from `events`. */
      failedAccounts: string[];
    };

interface RawCalendar {
  id: string;
  primary?: boolean;
  hidden?: boolean;
  selected?: boolean;
  deleted?: boolean;
}

interface RawEvent {
  id: string;
  iCalUID?: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string; email?: string }>;
  location?: string;
  organizer?: { email?: string };
  description?: string;
  recurringEventId?: string;
  htmlLink?: string;
}

export interface CalendarDeps {
  /** `shopAccount`: the slot holds the shop's Google account; it is never read. */
  listAccounts(): Promise<Array<{ accountKey: string; state: GoogleOauthStatus["state"]; shopAccount?: boolean }>>;
  listCalendars(accountKey: string): Promise<RawCalendar[]>;
  listEvents(accountKey: string, calendarId: string, from: Date, to: Date): Promise<RawEvent[]>;
}

// Public calendars Google adds on its own (holidays, contacts' birthdays). They carry no plan.
const PUBLIC_CALENDAR = /@group\.v\.calendar\.google\.com$/;

export async function readCalendarWindow(from: Date, to: Date, deps: CalendarDeps = googleDeps): Promise<CalendarRead> {
  let listed: Awaited<ReturnType<CalendarDeps["listAccounts"]>>;
  try {
    listed = await deps.listAccounts();
  } catch (err) {
    return { state: "read_failed", reason: `account list unreadable: ${(err as Error).message}` };
  }
  const accounts = listed.filter((a) => !a.shopAccount);
  if (accounts.length === 0) {
    return listed.length > 0 ? { state: "not_connected", reason: "shop_account" } : { state: "not_connected" };
  }
  const live = accounts.filter((a) => a.state !== "expired" && a.state !== "missing");
  if (live.length === 0) return { state: "expired", accounts: accounts.map((a) => a.accountKey) };

  const failedAccounts: string[] = [];
  let calendars = 0;
  const byKey = new Map<string, DayEvent>();

  await Promise.all(
    live.map(async ({ accountKey }) => {
      try {
        const cals = (await deps.listCalendars(accountKey)).filter(
          (c) => !c.hidden && !c.deleted && c.selected !== false && !PUBLIC_CALENDAR.test(c.id),
        );
        calendars += cals.length;
        const lists = await Promise.all(cals.map((c) => deps.listEvents(accountKey, c.id, from, to)));
        for (const raw of lists.flat()) {
          const e = toDayEvent(raw, accountKey);
          if (!e) continue;
          // A calendar shared into a second connected account returns the same event twice.
          const key = `${raw.iCalUID ?? raw.id}|${e.start}`;
          if (!byKey.has(key)) byKey.set(key, e);
        }
      } catch {
        failedAccounts.push(accountKey);
      }
    }),
  );

  if (failedAccounts.length === live.length) {
    return { state: "read_failed", reason: `every account read failed (${failedAccounts.sort().join(", ")})` };
  }
  const events = [...byKey.values()].sort((a, b) => startMs(a) - startMs(b) || a.id.localeCompare(b.id));
  return { state: "ok", events, sources: { accounts: live.length, calendars }, failedAccounts: failedAccounts.sort() };
}

function toDayEvent(raw: RawEvent, accountKey: string): DayEvent | null {
  if (raw.status === "cancelled") return null;
  if (raw.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const start = raw.start?.dateTime ?? raw.start?.date;
  if (!start) return null;
  return {
    id: raw.id,
    title: raw.summary?.trim() || "(no title)",
    start,
    end: raw.end?.dateTime ?? raw.end?.date ?? null,
    allDay: !raw.start?.dateTime,
    accountKey,
    location: raw.location,
    organizer: raw.organizer?.email,
    attendees: (raw.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    description: raw.description,
    recurring: !!raw.recurringEventId,
    link: raw.htmlLink,
  };
}

/** All-day events sort first (their date string parses to midnight UTC, before any ET event). */
function startMs(e: DayEvent): number {
  return new Date(e.start).getTime();
}

// ── Day summary: what the brief, Nick and Home say about today ─────────────────────────────

export interface DaySummary {
  count: number;
  allDay: number;
  current: DayEvent | null;
  next: DayEvent | null;
  /** Booked minutes between now and the end of the waking window, overlaps merged. */
  busyMinutesLeft: number;
  longestFree: { start: string; end: string; minutes: number } | null;
}

/** Waking window in ET hours; free time is only measured inside it. */
export const DAY_WINDOW = { startHour: 7, endHour: 21 } as const;

export function summarizeDay(events: DayEvent[], now: Date = new Date()): DaySummary {
  const { windowStart, windowEnd } = etWindow(now);
  const from = Math.max(now.getTime(), windowStart);
  const timed = events
    .filter((e) => !e.allDay && e.end)
    .map((e) => ({ e, s: new Date(e.start).getTime(), t: new Date(e.end as string).getTime() }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.t) && x.t > x.s)
    .sort((a, b) => a.s - b.s);

  const nowMs = now.getTime();
  const current = timed.find((x) => x.s <= nowMs && x.t > nowMs)?.e ?? null;
  const next = timed.find((x) => x.s > nowMs)?.e ?? null;

  // Merge busy intervals clipped to [from, windowEnd].
  const merged: Array<[number, number]> = [];
  for (const x of timed) {
    const s = Math.max(x.s, from);
    const t = Math.min(x.t, windowEnd);
    if (t <= s) continue;
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], t);
    else merged.push([s, t]);
  }
  const busy = merged.reduce((sum, [s, t]) => sum + (t - s), 0);

  let longestFree: DaySummary["longestFree"] = null;
  let cursor = from;
  for (const gap of [...merged, [windowEnd, windowEnd] as [number, number]]) {
    if (gap[0] > cursor) {
      const minutes = Math.round((gap[0] - cursor) / 60000);
      if (!longestFree || minutes > longestFree.minutes) {
        longestFree = { start: new Date(cursor).toISOString(), end: new Date(gap[0]).toISOString(), minutes };
      }
    }
    cursor = Math.max(cursor, gap[1]);
  }

  return {
    count: events.length,
    allDay: events.filter((e) => e.allDay).length,
    current,
    next,
    busyMinutesLeft: Math.round(busy / 60000),
    longestFree,
  };
}

/** The ET waking window for the ET day containing `now`, as UTC epoch ms (DST-correct). */
function etWindow(now: Date): { windowStart: number; windowEnd: number } {
  const midnightEt = startOfDayET(now).getTime();
  return {
    windowStart: midnightEt + DAY_WINDOW.startHour * 3600_000,
    windowEnd: midnightEt + DAY_WINDOW.endHour * 3600_000,
  };
}

// ── Live Google wiring (default deps) ─────────────────────────────────────────────────────

const GCAL = "https://www.googleapis.com/calendar/v3";

const googleDeps: CalendarDeps = {
  async listAccounts() {
    const [status, configured] = await Promise.all([
      getGoogleOauthAccountsStatus(),
      listConfiguredAccounts({ includeDeadShopCopies: true }),
    ]);
    if (status.probeFailed) throw new Error(status.reason);
    const mine = status.accounts.find((a) => a.key === CALENDAR_ACCOUNT_KEY);
    if (!mine || mine.state === "missing") return [];
    // His slot granted with the same Google account as the shop's primary slot is the shop's
    // calendar, whatever the slot is called (the June grant picked the wrong account).
    const email = (key: string) => configured.find((c) => c.accountKey === key)?.email?.trim().toLowerCase() || null;
    const shopEmail = email("primary");
    const shopAccount = shopEmail !== null && email(CALENDAR_ACCOUNT_KEY) === shopEmail;
    return [{ accountKey: mine.key, state: mine.state, shopAccount }];
  },
  async listCalendars(accountKey) {
    const body = await gget<{ items?: RawCalendar[] }>(accountKey, `${GCAL}/users/me/calendarList?maxResults=100`);
    return body.items ?? [];
  },
  async listEvents(accountKey, calendarId, from, to) {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    // W2: page to the end. A cut-short list would read as deleted events to the ingest's cleanup,
    // so a calendar still paging after the cap throws (that account reads as failed, never ok).
    const items: RawEvent[] = [];
    for (let page = 0; page < MAX_EVENT_PAGES; page++) {
      const body = await gget<{ items?: RawEvent[]; nextPageToken?: string }>(
        accountKey,
        `${GCAL}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      );
      items.push(...(body.items ?? []));
      if (!body.nextPageToken) return items;
      params.set("pageToken", body.nextPageToken);
    }
    throw new Error(`Google Calendar still paging after ${MAX_EVENT_PAGES} pages`);
  },
};

const MAX_EVENT_PAGES = 10;

async function gget<T>(accountKey: string, url: string): Promise<T> {
  const token = await getAccessToken(accountKey);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}`);
  return (await res.json()) as T;
}

// ── Cached day read for request paths (Home, Nick, the day view) ──────────────────────────

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<CalendarRead> }>();

/** Today's events (ET day), cached 5 minutes. A failed read is not cached. */
export function readCalendarDay(day: Date = new Date()): Promise<CalendarRead> {
  const from = startOfDayET(day);
  const key = String(from.getTime());
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = readCalendarWindow(from, endOfDayET(day)).then((r) => {
    if (r.state === "read_failed") cache.delete(key);
    return r;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}
