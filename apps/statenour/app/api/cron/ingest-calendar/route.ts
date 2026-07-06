import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import {
  listEvents,
  type CalEvent,
  CalendarApiError,
} from "@/lib/services/calendar-api";
import { getGoogleOauthStatus } from "@/lib/services/google-oauth";

export const maxDuration = 120;

/**
 * GET /api/cron/ingest-calendar
 *
 * Headless Google Calendar ingest. Runs daily at 8:15am per
 * vercel.json. Pulls:
 *
 *   • Past 7 days of events  → calendar_past   (what happened recently)
 *   • Next 14 days of events → calendar_upcoming (what's coming up)
 *
 * Each memory uses the Google event ID as its key so re-runs
 * reinforce rather than duplicate. Nick can surface upcoming events
 * via the context-recall layer when Nour asks "what do I have
 * coming up" or "did I meet with X last week".
 *
 * Exits gracefully with "not_configured" if the one-time OAuth
 * consent flow hasn't been completed yet.
 */
export const GET = cronHandler(async () => {
  // Pre-flight OAuth health gate. isGoogleOauthConfigured() only checked
  // token PRESENCE, so a revoked/expired refresh token slipped through and
  // made listEvents() -> getAccessToken() throw invalid_grant on every run
  // (a hard `failed` CronJobLog row ~8x/day, non-actionable from a
  // dashboard). getGoogleOauthStatus() distinguishes "expired" (Google
  // rejected the last refresh) -> treat it like "missing": a graceful skip
  // with an actionable re-grant nudge instead of a stack-traced failure.
  // "stale"/"healthy" still run — running the cron is what un-stales it.
  const oauth = await getGoogleOauthStatus();
  if (oauth.state === "missing" || oauth.state === "expired") {
    return {
      skipped: true,
      reason:
        oauth.state === "expired"
          ? "google_oauth_expired"
          : "google_oauth_not_configured",
      hint:
        oauth.state === "expired"
          ? "Refresh token expired/revoked — re-grant at /api/oauth/google-data/start. If it dies ~weekly, PUBLISH the OAuth app in Google Cloud Console (Testing mode expires refresh tokens every 7 days)."
          : "Visit /api/oauth/google-data/start to grant Calendar read access",
    };
  }

  const t0 = Date.now();
  let pastStored = 0;
  let upcomingStored = 0;
  let skipped = 0;

  try {
    const events = await listEvents({ daysBack: 7, daysAhead: 14, maxResults: 150 });
    const now = Date.now();

    for (const ev of events) {
      if (!shouldIngest(ev)) {
        skipped++;
        continue;
      }

      const startMs = ev.start ? new Date(ev.start).getTime() : now;
      const category = startMs > now ? "calendar_upcoming" : "calendar_past";

      await brainMemory.remember(
        category,
        `calendar_${ev.id}`,
        buildEventContent(ev),
        "calendar_cron",
        {
          eventId: ev.id,
          start: ev.start,
          recurring: !!ev.recurring,
          attendees: ev.attendees,
        }
      );

      if (startMs > now) upcomingStored++;
      else pastStored++;
    }
  } catch (err) {
    // 403 specifically means the OAuth grant works but the Calendar
    // scope wasn't granted OR the Calendar API isn't enabled in the
    // Google Cloud project. That's a CONFIG issue, not a runtime
    // failure — skip gracefully so the operator sees an actionable
    // brain-insight nudge instead of a stack-traced "1 error 24h"
    // entry that they can't fix from a dashboard.
    if (err instanceof CalendarApiError && err.tag === "scope_or_api_disabled") {
      await prisma.auditEvent
        .create({
          data: {
            actor: "calendar_ingest_cron",
            eventType: "calendar_ingest_skipped",
            detail:
              "Calendar 403 — re-grant access OR enable Calendar API in Google Cloud Console",
            payload: { error: err.message, status: err.status },
          },
        })
        .catch(() => {});
      return {
        skipped: true,
        reason: "calendar_scope_or_api_disabled",
        hint: "Re-grant at /api/oauth/google-data/start (ensures calendar.readonly scope) AND verify Calendar API is enabled at https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
      };
    }
    await prisma.auditEvent
      .create({
        data: {
          actor: "calendar_ingest_cron",
          eventType: "calendar_ingest_failed",
          detail: (err as Error).message,
          payload: { error: (err as Error).message },
        },
      })
      .catch(() => {});
    throw err;
  }

  const durationMs = Date.now() - t0;
  await prisma.auditEvent
    .create({
      data: {
        actor: "calendar_ingest_cron",
        eventType: "calendar_events_ingested",
        detail: `Ingested ${pastStored} past + ${upcomingStored} upcoming calendar events`,
        payload: { pastStored, upcomingStored, skipped, durationMs },
      },
    })
    .catch(() => {});

  return { pastStored, upcomingStored, skipped, durationMs };
});

function shouldIngest(e: CalEvent): boolean {
  if (!e.summary || e.summary.trim().length === 0) return false;
  if (e.status === "cancelled" || e.status === "declined") return false;
  if (/^out of office|\boff\b|holiday|birthday|focus time|lunch$/i.test(e.summary)) {
    return false;
  }
  return true;
}

function buildEventContent(e: CalEvent): string {
  const parts: string[] = [];
  parts.push(`Event: ${e.summary}`);
  if (e.start) parts.push(`When: ${e.start.slice(0, 16).replace("T", " ")}`);
  if (e.location) parts.push(`Where: ${e.location}`);
  if (e.organizer) parts.push(`Organizer: ${e.organizer}`);
  if (e.attendees && e.attendees.length > 0) {
    parts.push(`Attendees: ${e.attendees.slice(0, 5).join(", ")}`);
  }
  if (e.description) {
    const d = e.description.trim();
    parts.push("");
    parts.push(d.length > 1200 ? d.slice(0, 1200) + "..." : d);
  }
  return parts.join("\n");
}
