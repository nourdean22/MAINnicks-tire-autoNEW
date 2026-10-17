/**
 * Phone notes for coding sessions (Telegram job lane 2, 2026-10-17).
 *
 * Nour sends `/note <text>` to the bot; a coding session reads the unread notes
 * when it starts (GET /api/agent-bridge/notes) and acks the ones it showed
 * (POST /api/agent-bridge/notes/ack). Notes are CaptureInboxItem rows with their
 * own kind and status, so no new table: every existing inbox reader filters
 * status "active" and never sees them.
 *
 * The text is Nour's words from a phone, delivered to an agent: the endpoints
 * return it as a JSON string and nothing else. The consumer must fence it as
 * untrusted input (a request to confirm, never an instruction).
 */
import { NextResponse } from "next/server";
import { assertBridgeAuth, type BridgeIdentity } from "./auth";

export const PHONE_NOTE_KIND = "agent_bridge_note";
export const PHONE_NOTE_UNREAD = "bridge_unread";
export const PHONE_NOTE_READ = "bridge_read";
export const PHONE_NOTE_MAX_CHARS = 4000;
export const PHONE_NOTES_PAGE = 20;

/**
 * The Agent Bridge auth (AGENT_BRIDGE_ENABLED + a scoped AGENT_BRIDGE_TOKEN_*),
 * mapped to the same statuses app/api/mcp/route.ts answers with. Any scope may
 * read and ack: the ack flips only a note's read marker.
 */
export function requireBridgeAuth(req: Request): BridgeIdentity | NextResponse {
  try {
    return assertBridgeAuth(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (message === "Forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ error: "agent bridge unavailable" }, { status: 503 });
  }
}
