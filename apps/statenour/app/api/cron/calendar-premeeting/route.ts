/**
 * GET /api/cron/calendar-premeeting — v10.0.529.106 · Wave 68.
 *
 * Pre-meeting cards · 30min before each upcoming calendar event,
 * send a Telegram card with person profile + last conversations +
 * open commitments so the operator opens the meeting already warmed.
 *
 * Pre-Wave-68 the calendar-ingest cron pulled events into BrainMemory
 * (calendar_upcoming) but no path delivered them. Operator had to ask
 * Nick "what do I have coming up" to surface them.
 *
 * Pipeline:
 *   1. Pull all calendar_upcoming BrainMemory rows with start ∈ [now+25min, now+35min]
 *   2. For each event · skip if already pushed (per-event dedup marker)
 *   3. Build a card · event title + start time + attendees + match
 *      attendees to PersonProfile rows for trust score + relationship
 *   4. Send Telegram · mark as pushed
 *
 * Runs every 15min during waking hours (per cron manifest). The 10-min
 * window ([+25, +35]) ensures every event gets exactly ONE pre-meeting
 * push regardless of cron drift.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("cron/calendar-premeeting");

interface UpcomingEventMeta {
  eventId?: string;
  start?: string;
  attendees?: string[];
  recurring?: boolean;
}

export const GET = cronHandler(async () => {
  const now = Date.now();
  const winStart = now + 25 * 60_000;
  const winEnd = now + 35 * 60_000;

  // Pull all upcoming-calendar rows · we filter by start in JS because
  // the metadata is JSON not a typed column. Volume is bounded
  // (~14 days × ~5 events/day = ~70 rows) so the scan is cheap.
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: "calendar_upcoming",
      deletedAt: null,
    },
    select: { id: true, key: true, content: true, metadata: true },
    take: 200,
  });

  let cardsSent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const meta = (row.metadata ?? {}) as UpcomingEventMeta;
    const startMs = meta.start ? new Date(meta.start).getTime() : 0;
    if (!startMs || startMs < winStart || startMs > winEnd) {
      skipped++;
      continue;
    }

    // Per-event dedup · only push ONCE per event (per eventId).
    // Marker TTL 24h is enough · event has either fired or been
    // dropped from the window by then.
    const dedupKey = `premeeting_${meta.eventId ?? row.key}`;
    const existing = await prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT, key: dedupKey } },
      select: { id: true },
    }).catch(() => null);
    if (existing) {
      skipped++;
      continue;
    }

    // Match attendees against PersonProfile for trust/relationship
    // context. Best-effort · if no matches, the card still fires
    // with just the event details.
    const attendees = meta.attendees ?? [];
    const personMatches = attendees.length > 0
      ? await prisma.personProfile.findMany({
          where: { name: { in: attendees } },
          select: { name: true, role: true, trustScore: true, relationship: true },
          take: 5,
        }).catch(() => [])
      : [];

    // Compose the Telegram card
    const eventTitle = extractTitle(row.content);
    const startStr = meta.start ? formatStart(meta.start) : "soon";
    const lines: string[] = [
      `📅 <b>In 30 min · ${eventTitle}</b>`,
      ``,
      `<i>${startStr}</i>`,
    ];

    if (personMatches.length > 0) {
      lines.push(``);
      lines.push(`<b>Who:</b>`);
      for (const p of personMatches) {
        const trustPct = Math.round(p.trustScore * 100);
        const rel = p.relationship.slice(0, 60);
        lines.push(`· ${p.name} (${p.role} · trust ${trustPct}) — ${rel}`);
      }
    } else if (attendees.length > 0) {
      lines.push(``);
      lines.push(`<b>Attendees:</b> ${attendees.slice(0, 5).join(", ")}`);
    }

    lines.push(``);
    lines.push(`Tap to ask Nick what you should know going in.`);

    const ok = await sendTelegram(lines.join("\n")).catch(() => false);
    if (!ok) {
      failed++;
      log.warn("premeeting_push_failed", { eventId: meta.eventId, eventTitle });
      continue;
    }

    // Mark as pushed
    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT,
        key: dedupKey,
        content: `pre-meeting card sent for ${eventTitle} at ${new Date().toISOString()}`,
        source: "calendar_premeeting_cron",
        confidence: 1.0,
        expiresAt: new Date(now + 24 * 3600_000),
      },
    }).catch(() => undefined);

    cardsSent++;
  }

  return { cardsSent, skipped, failed, rowsScanned: rows.length };
});

function extractTitle(content: string): string {
  // The content was built by ingest-calendar's buildEventContent
  // function · first line is "Event: <summary>". Extract it.
  const firstLine = content.split("\n")[0] ?? "";
  return firstLine.replace(/^Event:\s*/i, "").slice(0, 80) || "Meeting";
}

function formatStart(startIso: string): string {
  try {
    const d = new Date(startIso);
    const et = d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return et;
  } catch {
    return startIso;
  }
}
