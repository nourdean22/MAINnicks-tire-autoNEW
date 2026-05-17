/**
 * Ingest Google Calendar — reads a JSON export of calendar events and
 * stores each as a BrainMemory entry so past meetings surface in
 * /brain + semantic search, and upcoming ones inform Nick's context.
 *
 * Input file shape (.tmp/calendar-export.json):
 *   [
 *     {
 *       "id": "abc123",
 *       "summary": "Meeting with Cameron @ Global Cleveland",
 *       "description": "Discuss $600/year partner membership",
 *       "start": "2026-04-20T14:00:00-04:00",
 *       "end": "2026-04-20T15:00:00-04:00",
 *       "attendees": ["cameron@globalcleveland.org", "nourdean22@gmail.com"],
 *       "location": "Zoom",
 *       "organizer": "nourdean22@gmail.com",
 *       "status": "confirmed",
 *       "recurring": false
 *     },
 *     ...
 *   ]
 *
 * Categories:
 *   calendar_upcoming  — events in the future (next 14 days)
 *   calendar_past      — events within the last 30 days (already happened)
 *   calendar_recurring — events that repeat (handled separately because
 *                        they're really commitments, not one-shots)
 *
 * Dedupe: event ID → memory key (stable across re-runs).
 *
 * Skip: declined events, canceled events, anything with empty summary.
 *
 * Run with: npx tsx scripts/ingest-calendar.ts [path-to-json]
 */

import * as fs from "fs";
import * as path from "path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  const raw = fs.readFileSync(envLocal, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.+?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  const raw = fs.readFileSync(envFile, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.+?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";

interface CalEvent {
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
}

function isWorthIngesting(e: CalEvent): boolean {
  if (!e.summary || e.summary.trim().length === 0) return false;
  if (e.status === "cancelled" || e.status === "declined") return false;
  // Skip obvious automated/noise events
  if (/^out of office|\boff\b|holiday|birthday|focus time|lunch$/i.test(e.summary)) {
    return false;
  }
  return true;
}

function deriveCategory(e: CalEvent): string {
  if (e.recurring) return "calendar_recurring";
  if (!e.start) return "calendar_past";
  const startMs = new Date(e.start).getTime();
  const now = Date.now();
  return startMs > now ? "calendar_upcoming" : "calendar_past";
}

function buildContent(e: CalEvent): string {
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

async function main() {
  const inputPath =
    process.argv[2] || path.resolve(process.cwd(), ".tmp", "calendar-export.json");

  console.log("=== CALENDAR INGEST ===\n");

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    console.error("Harvest Google Calendar first (MCP needs authentication)");
    console.error("and write the JSON export to that path before re-running.");
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf-8");
  let events: CalEvent[] = [];
  try {
    events = JSON.parse(raw);
  } catch (err) {
    console.error("Invalid JSON:", (err as Error).message);
    process.exit(1);
  }
  if (!Array.isArray(events)) {
    console.error("Input must be a JSON array of events");
    process.exit(1);
  }

  console.log(`Loaded ${events.length} events from ${inputPath}`);
  const worthy = events.filter(isWorthIngesting);
  console.log(`${worthy.length} worth ingesting (after filter)`);

  let stored = 0;
  let skipped = 0;
  const categoryCounts: Record<string, number> = {};

  for (const ev of worthy) {
    try {
      const category = deriveCategory(ev);
      const key = `calendar_${ev.id}`;
      const content = buildContent(ev);
      await brainMemory.remember(category, key, content, "calendar_ingest", {
        eventId: ev.id,
        start: ev.start,
        recurring: !!ev.recurring,
        attendees: ev.attendees,
      });
      stored++;
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    } catch (err) {
      skipped++;
      console.error(`  [skip] ${ev.id}: ${(err as Error).message}`);
    }
  }

  console.log(`\n→ ${stored} stored, ${skipped} skipped`);
  for (const [cat, n] of Object.entries(categoryCounts)) {
    console.log(`  ${cat.padEnd(22)} ${n}`);
  }

  await prisma.auditEvent
    .create({
      data: {
        actor: "calendar_ingest",
        eventType: "calendar_events_ingested",
        detail: `Ingested ${stored} calendar events from ${inputPath}`,
        payload: { total: events.length, worthy: worthy.length, stored, skipped, categoryCounts },
      },
    })
    .catch(() => {});

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("CALENDAR INGEST FAILED:", e);
  process.exit(1);
});
