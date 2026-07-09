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
    execute: async ({ daysAhead }) => {
      try {
        const { listEvents, CalendarApiError } = await import(
          "@/lib/services/calendar-api"
        );
        const events = await listEvents({
          daysAhead: daysAhead ?? 1,
          maxResults: 50,
        });
        return {
          ok: true,
          count: events.length,
          events: events.map((e) => ({
            id: e.id,
            summary: e.summary ?? "(no title)",
            start: e.start ?? null,
            end: e.end ?? null,
            location: e.location ?? null,
            attendees: e.attendees ?? [],
            link: e.htmlLink ?? null,
          })),
        };
      } catch (err) {
        // Typed error from calendar-api distinguishes scope/auth issues.
        const e = err as { tag?: string; status?: number; message?: string };
        if (e?.tag === "scope_or_api_disabled") {
          return {
            ok: false,
            code: "scope_missing",
            error:
              "Calendar access not granted. Reconnect Google with calendar.readonly scope via /api/oauth/google-data/start.",
          };
        }
        if (e?.tag === "auth") {
          return {
            ok: false,
            code: "auth",
            error: "Google OAuth token invalid. Reconnect via /api/oauth/google-data/start.",
          };
        }
        return {
          ok: false,
          code: "unknown",
          error: e?.message ?? "Calendar fetch failed.",
        };
      }
    },
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
        const start = new Date(startISO);
        if (isNaN(start.getTime())) {
          return { ok: false, error: "Invalid startISO" };
        }
        const end = endISO ? new Date(endISO) : new Date(start.getTime() + 60 * 60_000);
        if (isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
          return { ok: false, error: "Invalid endISO (must be after startISO)" };
        }

        const { isGoogleOauthConfigured } = await import(
          "@/lib/services/google-oauth"
        );
        const { createEvent } = await import(
          "@/lib/services/calendar-api"
        );
        const configured = await isGoogleOauthConfigured();

        if (configured) {
          try {
            const created = await createEvent({
              title,
              startISO,
              endISO,
              location,
              description,
              attendees,
            });
            return {
              ok: true,
              created: true,
              eventId: created.id,
              composeUrl: created.htmlLink,
              summary: title,
              start: start.toISOString(),
              end: end.toISOString(),
              instructions: "Render the composeUrl (event link) in the reply as 'View Event in Google Calendar →'.",
            };
          } catch (err) {
            void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.calendar", err, { fn: "proposeCalendarEvent.createEvent" }, "warn"));
          }
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
