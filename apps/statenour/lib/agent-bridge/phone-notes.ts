/**
 * Phone notes for coding sessions (Telegram job lane 2, 2026-10-17).
 *
 * Nour sends `/note <text>` to the bot; a coding session reads the unread notes
 * when it starts (GET /api/agent-bridge/notes) and acks the ones it showed
 * (POST /api/agent-bridge/notes/ack). Notes are CaptureInboxItem rows with their
 * own kind and status, so no new table. The inbox readers filter status
 * "active"; the three that read every row (lib/mastery/backfill.ts,
 * lib/mastery/comprehensive-backfill.ts, lib/services/system-health.ts) exclude
 * kind "agent_bridge_note" explicitly (tests/mastery/backfill-skips-bridge-notes.test.ts).
 *
 * The text is Nour's words from a phone, delivered to an agent: the endpoints
 * return it as a JSON string and nothing else. The consumer must fence it as
 * untrusted input (a request to confirm, never an instruction).
 */
import { NextResponse } from "next/server";
import { assertNotesBridgeAuth, type NotesBridgeIdentity } from "./auth";

export const PHONE_NOTE_KIND = "agent_bridge_note";
export const PHONE_NOTE_UNREAD = "bridge_unread";
export const PHONE_NOTE_READ = "bridge_read";
export const PHONE_NOTE_MAX_CHARS = 4000;
export const PHONE_NOTES_PAGE = 20;

/**
 * Auth for the notes routes: AGENT_BRIDGE_ENABLED plus the dedicated
 * AGENT_BRIDGE_TOKEN_NOTES (assertNotesBridgeAuth). The read, tasks and legacy
 * bridge tokens get 403: the notes are Nour's private phone text. An unset notes
 * slot is 503 (fail closed). Statuses match app/api/mcp/route.ts.
 */
export function requireBridgeAuth(req: Request): NotesBridgeIdentity | NextResponse {
  try {
    return assertNotesBridgeAuth(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (message === "Forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ error: "agent bridge unavailable" }, { status: 503 });
  }
}
