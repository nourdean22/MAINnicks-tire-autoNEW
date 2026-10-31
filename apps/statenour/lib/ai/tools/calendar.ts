/**
 * Calendar tools — Google Calendar read + event proposal.
 *
 * Includes: getTodaySchedule · proposeCalendarEvent.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";

/**
 * Today plus `daysAhead` days from every connected account and selected calendar
 * (lib/calendar/day-events). Shared by the getTodaySchedule tool and the agent's
 * google.getSchedule action so both answer from the same read.
 */
export async function readSchedule(daysAhead: number) {
  const { readCalendarWindow } = await import("@/lib/calendar/day-events");
  const { startOfDayET, endOfDayET } = await import("@/lib/utils/datetime");
  const now = new Date();
  const read = await readCalendarWindow(startOfDayET(now), endOfDayET(new Date(now.getTime() + daysAhead * 86_400_000)));
  if (read.state === "not_connected") {
    return {
      ok: false as const,
      code: "not_connected",
      error:
        read.reason === "shop_account"
          ? "His own calendar is not connected: the linked Google account is the shop's. Connect nourdean22 via /api/oauth/google-data/start?account=personal."
          : "His calendar is not connected. Connect nourdean22 via /api/oauth/google-data/start?account=personal.",
    };
  }
  if (read.state === "expired") {
    return {
      ok: false as const,
      code: "auth",
      error: `Google grant expired (${read.accounts.join(", ")}). Reconnect via /api/oauth/google-data/start?account=personal.`,
    };
  }
  if (read.state === "read_failed") {
    return { ok: false as const, code: "unknown", error: `Calendar read failed: ${read.reason}` };
  }
  return {
    ok: true as const,
    count: read.events.length,
    // An empty list from a connected calendar is real; an account that failed is named.
    unreadableAccounts: read.failedAccounts,
    events: read.events.map((e) => ({
      id: e.id,
      summary: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location ?? null,
      attendees: e.attendees ?? [],
      link: e.link ?? null,
    })),
  };
}

/** What Nick says when a calendar write did not happen; never a success. */
function writeRefusalText(reason: string): string {
  switch (reason) {
    case "not_connected":
      return "His calendar is not connected, so nothing changed. Connect nourdean22 via /api/oauth/google-data/start?account=personal.";
    case "shop_account":
      return "The linked Google account is the shop's, not his calendar, so nothing changed. Connect nourdean22.";
    case "expired":
      return "The Google grant for his calendar expired, so nothing changed. Re-grant via /api/oauth/google-data/start?account=personal.";
    case "read_back_mismatch":
      return "Google answered but the event reads back different. Check it in Google Calendar; do not say it changed as asked.";
    case "invalid_time":
      return "The end time must be after the start time. Nothing changed.";
    default:
      return "Google refused the change. Nothing changed.";
  }
}

export const calendarTools = {
  getTodaySchedule: tool({
    description:
      "Get the operator's Google Calendar events for today and the next few days. Returns event titles, times, locations, attendees. Use when answering 'what's on my schedule', 'when is X meeting', or reasoning about availability.",
    inputSchema: z.object({
      daysAhead: z
        .number()
        .int()
        .min(0)
        .max(14)
        .optional()
        .describe("How many days forward to fetch. Default 1 (today + tomorrow)."),
    }),
    execute: async ({ daysAhead }) => readSchedule(daysAhead ?? 1),
  }),

  // v10.0.524 · #10 Anti-pattern surfacing tool. The operator's
  // brain already auto-promotes D/F decisions to anti-patterns
  // (lib/brain/anti-pattern-auto-promote.ts) but they only show
  // in /system/anti-patterns. Surface them in-chat so Nick can
  // proactively warn ("you said X two weeks ago and broke it").
  proposeCalendarEvent: tool({
    description:
      "Create or propose a new Google Calendar event. If Google Calendar API is configured, writes the event directly to the calendar via the Google Calendar API. If not configured, returns a 'create event' URL with all fields pre-filled for the operator to click and create. Use when Nour wants to schedule something concrete (a focus block, a meeting, a follow-up).",
    inputSchema: z.object({
      title: z.string().min(2).max(120).describe("Event title."),
      startISO: z
        .string()
        .describe(
          "Event start in ISO 8601 (e.g. '2026-05-13T14:00:00-04:00'). If timezone omitted, operator's local zone is assumed.",
        ),
      endISO: z
        .string()
        .optional()
        .describe("Event end in ISO 8601. If omitted, defaults to startISO + 60 minutes."),
      location: z.string().max(200).optional().describe("Physical or virtual location."),
      description: z
        .string()
        .max(1000)
        .optional()
        .describe("Event description / agenda / notes."),
      attendees: z
        .array(z.string().email())
        .max(20)
        .optional()
        .describe("Attendee email addresses."),
    }),
    execute: async ({ title, startISO, endISO, location, description, attendees }) => {
      try {
        const { parseOperatorDate } = await import("@/lib/calendar/write");
        const start = parseOperatorDate(startISO);
        if (isNaN(start.getTime())) {
          return { ok: false, error: "Invalid startISO" };
        }
        const end = endISO ? parseOperatorDate(endISO) : new Date(start.getTime() + 60 * 60_000);
        if (isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
          return { ok: false, error: "Invalid endISO (must be after startISO)" };
        }

        // Calendar r2 W3: his calendar only, read back before "created" is claimed. Attendees are
        // never invited (an invite is a send); a refused slot falls back to the compose link.
        void attendees;
        const { writeCalendarEvent } = await import("@/lib/calendar/write");
        const written = await writeCalendarEvent({
          kind: "create",
          title,
          start: startISO,
          end: endISO ?? end.toISOString(),
          location,
          description,
        });
        if (written.ok) {
          return {
            ok: true,
            created: true,
            eventId: written.eventId,
            readBack: written.readBack,
            composeUrl: written.link,
            summary: title,
            start: start.toISOString(),
            end: end.toISOString(),
            instructions: "Render the composeUrl (event link) in the reply as 'View Event in Google Calendar →'.",
          };
        }
        if (written.reason === "write_failed" || written.reason === "read_back_mismatch") {
          return {
            ok: false,
            created: false,
            eventId: written.eventId ?? null,
            error:
              written.reason === "read_back_mismatch"
                ? "Google took the event but it read back different. Check it in Google Calendar; do not say it was added as asked."
                : `Google refused the event (${written.detail ?? "write failed"}). It was NOT added.`,
          };
        }

        // Google Calendar event-compose URL format fallback. dates= uses
        // the YYYYMMDDTHHmmssZ form in UTC.
        const fmt = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
        const params = new URLSearchParams({
          action: "TEMPLATE",
          text: title,
          dates: `${fmt(start)}/${fmt(end)}`,
        });
        if (location) params.set("location", location);
        if (description) params.set("details", description);
        if (attendees && attendees.length > 0) {
          params.set("add", attendees.join(","));
        }
        const composeUrl = `https://calendar.google.com/calendar/render?${params.toString()}`;
        return {
          ok: true,
          created: false,
          // Why it was not written: his calendar is not connected, holds the shop's account, or expired.
          notWrittenBecause: written.reason,
          composeUrl,
          summary: title,
          start: start.toISOString(),
          end: end.toISOString(),
          // Nick should render the composeUrl as a button in his
          // reply: "Open in Google Calendar →". Operator clicks
          // once to confirm and the event is created.
          instructions:
            "Render the composeUrl as a clickable 'Add to Calendar' link in the reply.",
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }),

  // Calendar r2 W3 · move and delete an event on HIS calendar (never the shop's), each read back
  // from Google before it is claimed. The eventId comes from getTodaySchedule. In the first week
  // both wait for his approval in System > Actions (lib/tools/two-key.ts).
  moveCalendarEvent: tool({
    description:
      "Move an existing event on Nour's own Google Calendar to a new start and end time. Use the eventId from getTodaySchedule. Use when he asks to move, reschedule or push back one of his events. Never for shop jobs or customer appointments.",
    inputSchema: z.object({
      eventId: z.string().min(1).describe("The event id from getTodaySchedule."),
      startISO: z.string().describe("New start in ISO 8601. If the zone is omitted, his Eastern time is assumed."),
      endISO: z.string().describe("New end in ISO 8601. If the zone is omitted, his Eastern time is assumed."),
    }),
    execute: async ({ eventId, startISO, endISO }) => {
      const { writeCalendarEvent } = await import("@/lib/calendar/write");
      const r = await writeCalendarEvent({ kind: "move", eventId, start: startISO, end: endISO });
      return r.ok
        ? { ok: true, moved: true, eventId: r.eventId, readBack: r.readBack, link: r.link ?? null }
        : { ok: false, moved: false, reason: r.reason, error: writeRefusalText(r.reason) };
    },
  }),

  deleteCalendarEvent: tool({
    description:
      "Delete an event from Nour's own Google Calendar. Use the eventId from getTodaySchedule. Use when he asks to cancel, delete or remove one of his events. Never for shop jobs or customer appointments.",
    inputSchema: z.object({
      eventId: z.string().min(1).describe("The event id from getTodaySchedule."),
    }),
    execute: async ({ eventId }) => {
      const { writeCalendarEvent } = await import("@/lib/calendar/write");
      const r = await writeCalendarEvent({ kind: "delete", eventId });
      return r.ok
        ? { ok: true, deleted: true, eventId: r.eventId, readBack: r.readBack }
        : { ok: false, deleted: false, reason: r.reason, error: writeRefusalText(r.reason) };
    },
  }),

  // 2026-07-06 · manual ingest trigger. The Google OAuth callback page tells
  // the operator to "say 'sync my calendar' in chat", but no tool existed —
  // only getTodaySchedule (live read) + the scheduled ingest cron. This makes
  // that promise real: it calls the same ingest cron on-demand (Bearer),
  // pulling past-7d + next-14d events into BrainMemory. Auto-attaches via the
  // existing calendar keyword family (tool name contains "Calendar").
  syncCalendar: tool({
    description:
      "Manually trigger a Google Calendar ingest — pulls the past 7 days + next 14 days of events into BrainMemory (long-term recall) right now instead of waiting for the scheduled cron. Use when Nour says 'sync my calendar', 'refresh my calendar', or 'pull my latest events'. Returns ingest stats; if OAuth is expired it returns an actionable re-grant hint.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const base =
          process.env.NEXT_PUBLIC_SITE_URL ||
          process.env.APP_BASE_URL ||
          "http://localhost:3000";
        const res = await fetch(`${base}/api/cron/ingest-calendar`, {
          method: "GET",
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
          return { ok: false, error: `Calendar sync failed with HTTP ${res.status}` };
        }
        const json = (await res.json()) as { data?: Record<string, unknown> };
        const data = json.data ?? (json as Record<string, unknown>);
        // The cron reuses `skipped` as BOTH a boolean (OAuth skip path) and a
        // count (events filtered on the success path) — disambiguate strictly.
        if (data.skipped === true) {
          return {
            ok: false,
            skipped: true,
            reason: data.reason ?? "calendar ingest skipped",
            hint: data.hint,
          };
        }
        const past = Number(data.pastStored ?? 0);
        const upcoming = Number(data.upcomingStored ?? 0);
        return {
          ok: true,
          pastStored: past,
          upcomingStored: upcoming,
          hint:
            past + upcoming > 0
              ? `Ingested ${past + upcoming} calendar events (${past} past, ${upcoming} upcoming). Ask about your schedule to reach them.`
              : "Calendar already up to date — no new events to ingest.",
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown calendar sync error",
        };
      }
    },
  }),

};
