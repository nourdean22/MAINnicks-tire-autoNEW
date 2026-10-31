import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { forgetMemoryById } from "@/lib/services/brain-memories";
import { intakeExternalMemory } from "@/lib/brain/external-memory-intake";
import { readCalendarWindow, type CalendarRead, type DayEvent } from "@/lib/calendar/day-events";
import { CALENDAR_ACCOUNT_KEY, listConfiguredAccounts } from "@/lib/services/google-oauth";

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
  const windowFrom = now - 7 * 86_400_000;
  const windowTo = now + 14 * 86_400_000;
  const read = await readCalendarWindow(new Date(windowFrom), new Date(windowTo));

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

  const { removed, removalSkipped } = await removeGoneEvents(read, windowFrom, windowTo);

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
        payload: { pastStored, upcomingStored, quarantined, skipped, removed, removalSkipped, durationMs, accounts, calendars, emptyWindow },
      },
    })
    .catch(() => {});

  return {
    pastStored,
    upcomingStored,
    quarantined,
    skipped,
    removed,
    ...(removalSkipped ? { removalSkipped } : {}),
    accounts,
    calendars,
    failedAccounts: read.failedAccounts,
    emptyWindow,
    ...(warning ? { warning } : {}),
    durationMs,
  };
});

/**
 * Calendar r2 W2: soft-delete the stored copy of every event that is gone from Google. Only after a
 * COMPLETE read (no account failed; the reader throws on a page cap, so a truncated list never
 * gets here as ok), only rows from his own account, and only rows whose start lies
 * inside the window just read. An event still in Google keeps its copy even when the ingest filter
 * skips it now. A failed read of the stored rows throws: the run is recorded as failed.
 */
async function removeGoneEvents(
  read: Extract<CalendarRead, { state: "ok" }>,
  windowFrom: number,
  windowTo: number,
): Promise<{ removed: number; removalSkipped?: "empty_read" }> {
  if (read.failedAccounts.length > 0) return { removed: 0 };
  const present = new Set(read.events.map((e) => `calendar_${e.id}`));
  const stored = await prisma.brainMemory.findMany({
    where: { category: { in: ["calendar_upcoming", "calendar_past"] }, key: { startsWith: "calendar_" }, deletedAt: null },
    select: { id: true, key: true, metadata: true },
  });
  const gone = stored
    .filter((r) => {
      const m = (r.metadata ?? {}) as { accountKey?: unknown; start?: unknown };
      if (m.accountKey !== CALENDAR_ACCOUNT_KEY) return false;
      const startMs = typeof m.start === "string" ? new Date(m.start).getTime() : NaN;
      // Google's timeMax is exclusive: an event starting exactly at windowTo was never in the read.
      if (!Number.isFinite(startMs) || startMs < windowFrom || startMs >= windowTo) return false;
      return !present.has(r.key);
    })
    .map((r) => r.id);
  if (gone.length === 0) return { removed: 0 };
  // A 200 with no items is the empty-vs-error shape: one empty read never wipes the brain copy.
  // Only a second empty read in a row (this run and the last) may (manager reader on #3471).
  if (present.size === 0) {
    const last = await prisma.auditEvent.findFirst({
      where: { eventType: "calendar_events_ingested" },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    if ((last?.payload as { emptyWindow?: unknown } | null)?.emptyWindow !== true) {
      console.info(`[ingest-calendar] empty read, removal of ${gone.length} skipped until a second empty read`);
      return { removed: 0, removalSkipped: "empty_read" };
    }
  }
  // The sanctioned forget: tombstone plus the vector_embeddings copy (it carries the event text too).
  let removed = 0;
  for (const id of gone) if ((await forgetMemoryById(id)).deleted) removed++;
  return { removed };
}

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
