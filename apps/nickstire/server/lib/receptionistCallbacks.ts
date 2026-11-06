/**
 * The voice receptionist's retired callback rows (2026-11-06: the receptionist makes no callback
 * obligations). escalate and scheduleCallback wrote callback_requests rows with a fixed signature;
 * every actionable reader (Today, the morning brief, the control center, Nick's intelligence) leaves
 * those rows out through this one predicate. They stay in the Callbacks list for history.
 *
 * The COMPLETE signature is required: the public callback form stores utm and sourcePage from the
 * request, so any one field is forgeable and a real website request must never be hidden.
 */
import { sql } from "drizzle-orm";
import { callbackRequests } from "../../drizzle/schema";

interface CallbackProvenance {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  sourcePage?: string | null;
  context?: string | null;
}

/** escalate: utm voice-agent / phone / vapi-receptionist + "[VOICE-AGENT · ". scheduleCallback: sourcePage + "[VOICE-AGENT CALLBACK]". */
export function isReceptionistCallback(row: CallbackProvenance): boolean {
  const context = row.context ?? "";
  const escalateRow = row.utmSource === "voice-agent" && row.utmMedium === "phone"
    && row.utmCampaign === "vapi-receptionist" && context.startsWith("[VOICE-AGENT · ");
  const scheduleRow = row.sourcePage === "vapi-voice-agent" && context.startsWith("[VOICE-AGENT CALLBACK]");
  return escalateRow || scheduleRow;
}

/** SQL twin of isReceptionistCallback, negated and null-safe, for a callback_requests WHERE. */
export function notReceptionistCallbackSql() {
  const c = callbackRequests;
  return sql`NOT (
    (COALESCE(${c.utmSource}, '') = 'voice-agent' AND COALESCE(${c.utmMedium}, '') = 'phone'
      AND COALESCE(${c.utmCampaign}, '') = 'vapi-receptionist' AND COALESCE(${c.context}, '') LIKE '[VOICE-AGENT · %')
    OR (COALESCE(${c.sourcePage}, '') = 'vapi-voice-agent' AND COALESCE(${c.context}, '') LIKE '[VOICE-AGENT CALLBACK]%')
  )`;
}
