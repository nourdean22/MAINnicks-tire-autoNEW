import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { intakeExternalMemory } from "@/lib/brain/external-memory-intake";
import { readCalendarWindow, type DayEvent } from "@/lib/calendar/day-events";
import { listConfiguredAccounts } from "@/lib/services/google-oauth";

export const maxDuration = 120;

/**
 * GET /api/cron/ingest-calendar
 *
 * Headless Google Calendar ingest. Runs daily at 09:00 UTC via the
 * mega-morning fan-out (config/crons.ts). Pulls, from every connected
 * account and every selected calendar:
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
  // 2026-10-30 · one reader for every surface (lib/calendar/day-events): every connected
  // account, every selected calendar. The old path read only `calendars/primary` of the
  // primary account; that calendar is empty, so this cron ran green 30 of 30 days storing 0.
  const t0 = Date.now();
  const now = Date.now();
  const read = await readCalendarWindow(new Date(now - 7 * 86_400_000), new Date(now + 14 * 86_400_000));

  if (read.state === "not_connected" || read.state === "expired") {
    return {
      skipped: true,
      reason: read.state === "expired" ? "google_oauth_expired" : "google_oauth_not_configured",
      hint:
        read.state === "expired"
          ? `Refresh token expired/revoked (${read.accounts.join(", ")}) — re-grant at /api/oauth/google-data/start?account=personal. If it dies ~weekly, PUBLISH the OAuth app in Google Cloud Console (Testing mode expires refresh tokens every 7 days).`
          : read.reason === "shop_account"
            ? "The calendar slot holds the shop's Google account. Visit /api/oauth/google-data/start?account=personal and pick nourdean22"
            : "Visit /api/oauth/google-data/start?account=personal to grant Calendar read access",
    };
  }
  if (read.state === "read_failed") {
    // A database or Google failure is actionable: throw so the run is recorded as failed.
    await prisma.auditEvent
      .create({
        data: {
          actor: "calendar_ingest_cron",
          eventType: "calendar_ingest_failed",
          detail: read.reason,
          payload: { error: read.reason },
        },
      })
      .catch(() => {});
    throw new Error(`Calendar ingest read failed — ${read.reason}`);
  }

  // "Own" means organised by the account the event came FROM (NEW-05); unknown email fails closed.
  const ownEmail = new Map(
    (await listConfiguredAccounts().catch(() => [])).map((a) => [a.accountKey, a.email?.trim().toLowerCase() || null]),
  );
  let pastStored = 0;
  let upcomingStored = 0;
  let quarantined = 0;
  let skipped = 0;

  for (const ev of read.events) {
    if (!shouldIngest(ev)) {
      skipped++;
      continue;
    }

    const startMs = new Date(ev.start).getTime();
    const category = startMs > now ? "calendar_upcoming" : "calendar_past";
    const own = ownEmail.get(ev.accountKey) ?? null;

    const outcome = await intakeExternalMemory({
      category,
      key: `calendar_${ev.id}`,
      content: buildEventContent(ev),
      // Someone else's event is their text (NEW-05); fail closed when the account email is unknown.
      source: own && ev.organizer?.trim().toLowerCase() === own ? "calendar_cron" : "calendar:external",
      sourceType: "calendar_ingest",
      sourceUrl: `gcal://${ev.id}`,
      metadata: {
        eventId: ev.id,
        start: ev.start,
        end: ev.end,
        allDay: ev.allDay,
        accountKey: ev.accountKey,
        recurring: !!ev.recurring,
        attendees: ev.attendees,
      },
    });

    if (outcome.outcome === "quarantined") {
      quarantined++;
      continue;
    }
    if (startMs > now) upcomingStored++;
    else pastStored++;
  }

  const durationMs = Date.now() - t0;
  const { accounts, calendars } = read.sources;
  // A connected calendar that held nothing for three weeks is the silent zero this cron used to
  // file as a calm success. Say it in the run result and the audit row.
  const emptyWindow = read.events.length === 0;
  const warning = emptyWindow
    ? `0 events across ${calendars} calendars on ${accounts} account${accounts === 1 ? "" : "s"} in the last 7 / next 14 days — the calendar Nour uses may not be connected`
    : read.failedAccounts.length
      ? `could not read: ${read.failedAccounts.join(", ")}`
      : undefined;
  await prisma.auditEvent
    .create({
      data: {
        actor: "calendar_ingest_cron",
        eventType: "calendar_events_ingested",
        detail:
          warning ??
          `Ingested ${pastStored} past + ${upcomingStored} upcoming calendar events · ${quarantined} quarantined for review`,
        payload: { pastStored, upcomingStored, quarantined, skipped, durationMs, accounts, calendars, emptyWindow },
      },
    })
    .catch(() => {});

  return {
    pastStored,
    upcomingStored,
    quarantined,
    skipped,
    accounts,
    calendars,
    failedAccounts: read.failedAccounts,
    emptyWindow,
    ...(warning ? { warning } : {}),
    durationMs,
  };
});

function shouldIngest(e: DayEvent): boolean {
  // Cancelled and declined events are already dropped by the reader.
  if (e.title === "(no title)") return false;
  if (/^out of office|\boff\b|holiday|birthday|focus time|lunch$/i.test(e.title)) {
    return false;
  }
  return true;
}

function buildEventContent(e: DayEvent): string {
  const parts: string[] = [];
  parts.push(`Event: ${e.title}`);
  parts.push(`When: ${e.start.slice(0, 16).replace("T", " ")}`);
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
