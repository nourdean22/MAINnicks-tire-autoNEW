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
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertNotesBridgeAuth, type NotesBridgeIdentity } from "./auth";
import { auditBridgeCall, auditBridgeRejection, classifyBridgeFailure } from "./audit";

export const PHONE_NOTE_KIND = "agent_bridge_note";
export const PHONE_NOTE_UNREAD = "bridge_unread";
export const PHONE_NOTE_READ = "bridge_read";
export const PHONE_NOTE_MAX_CHARS = 4000;
export const PHONE_NOTES_PAGE = 20;

/**
 * Auth for the notes routes: AGENT_BRIDGE_ENABLED plus the dedicated
 * AGENT_BRIDGE_TOKEN_NOTES (assertNotesBridgeAuth). The read, tasks and legacy
 * bridge tokens get 403: the notes are Nour's private phone text. An unset notes
 * slot is 503 (fail closed). Statuses match app/api/mcp/route.ts, and so does
 * the audit: a refusal goes through classifyBridgeFailure + auditBridgeRejection.
 */
export async function requireBridgeAuth(req: Request, op: PhoneNotesOp): Promise<NotesBridgeIdentity | NextResponse> {
  try {
    return assertNotesBridgeAuth(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = classifyBridgeFailure(message);
    if (reason) await auditBridgeRejection({ protocol: "notes", reason, req, externalName: op });
    if (message === "Unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (message === "Forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ error: "agent bridge unavailable" }, { status: 503 });
  }
}

export type PhoneNotesOp = "phone_notes_read" | "phone_notes_ack";

/** One bridge_call_logs row per authenticated notes call (the hardening doc's audit rule). */
export function auditNotesCall(
  auth: NotesBridgeIdentity,
  op: PhoneNotesOp,
  startedAt: number,
  inputRaw: string,
  outcome: { status: "success" | "error"; resultSize?: number; errorCode?: string },
): Promise<void> {
  return auditBridgeCall({
    requestId: randomUUID(),
    protocol: "notes",
    toolName: op,
    externalName: op,
    status: outcome.status,
    latencyMs: Date.now() - startedAt,
    inputRaw,
    resultSize: outcome.resultSize,
    riskClass: op === "phone_notes_read" ? "read" : "write",
    errorCode: outcome.errorCode,
    clientId: auth.clientId,
    scope: auth.scope,
  });
}
