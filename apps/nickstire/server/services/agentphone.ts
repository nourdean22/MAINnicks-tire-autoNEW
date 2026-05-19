/**
 * AgentPhone API client · wave-181.84
 *
 * Thin wrapper over the AgentPhone REST API (https://api.agentphone.to/v1).
 * Used for the Confirmation Bot · outbound calls 24h before each booking
 * to verbally confirm or reschedule.
 *
 * Security · AGENTPHONE_API_KEY is read from env at every call. Never
 * sent to any URL other than api.agentphone.to (per the skill's security
 * rule). If the env is missing, every call returns `{ success: false,
 * error: "not_configured" }` instead of throwing · cron continues.
 *
 * Cost model · ~$0.05-0.10 per call. Cron is capped at 20 calls/run.
 * Daily ceiling = 20 calls = $1-2/day = $30-60/mo.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:agentphone");

const BASE_URL = "https://api.agentphone.to/v1";

function getApiKey(): string | null {
  const key = process.env.AGENTPHONE_API_KEY;
  if (!key || key.length < 10) return null;
  return key;
}

function authHeaders(): Record<string, string> | null {
  const key = getApiKey();
  if (!key) return null;
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/**
 * Place an outbound call via AgentPhone in `hosted` voice mode · the
 * built-in LLM handles the conversation using systemPrompt + initialGreeting
 * autonomously. No webhook required for the conversation itself · we
 * receive a `call.ended` event with the transcript when done.
 *
 * Returns the call ID on success · null on failure (caller decides
 * whether to retry).
 */
export interface PlaceCallParams {
  /** AgentPhone agent ID (created via dashboard or one-shot script) */
  agentId: string;
  /** Customer phone in E.164 format · e.g. "+12168620005" */
  toNumber: string;
  /** First thing the AI says when the call connects */
  initialGreeting: string;
  /** LLM system prompt that drives the conversation */
  systemPrompt: string;
}

export interface PlaceCallResult {
  success: boolean;
  callId?: string;
  error?: string;
}

export async function placeCall(params: PlaceCallParams): Promise<PlaceCallResult> {
  const headers = authHeaders();
  if (!headers) {
    return { success: false, error: "AGENTPHONE_API_KEY not configured" };
  }

  if (!/^\+\d{10,15}$/.test(params.toNumber)) {
    return { success: false, error: `Invalid toNumber: ${params.toNumber}` };
  }

  try {
    const res = await fetch(`${BASE_URL}/calls`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentId: params.agentId,
        toNumber: params.toNumber,
        initialGreeting: params.initialGreeting,
        systemPrompt: params.systemPrompt,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.warn("[agentphone] placeCall non-OK", { status: res.status, error: errText.slice(0, 200) });
      return { success: false, error: `agentphone returned ${res.status}: ${errText.slice(0, 100)}` };
    }

    const data = (await res.json()) as { id?: string };
    if (!data.id) {
      return { success: false, error: "agentphone response missing call id" };
    }

    log.info("[agentphone] call placed", { callId: data.id, to: params.toNumber.slice(-4) });
    return { success: true, callId: data.id };
  } catch (err) {
    log.warn("[agentphone] placeCall threw", { error: err instanceof Error ? err.message : String(err) });
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get the transcript of a completed call. Returns the array of transcript
 * lines (interleaved customer/agent turns) or null if the call isn't
 * complete yet or the lookup failed.
 */
export interface TranscriptLine {
  transcript: string;
  response: string | null;
}

export async function getCallTranscript(callId: string): Promise<TranscriptLine[] | null> {
  const headers = authHeaders();
  if (!headers) return null;

  try {
    const res = await fetch(`${BASE_URL}/calls/${encodeURIComponent(callId)}/transcript`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: TranscriptLine[] };
    return data.data ?? null;
  } catch (err) {
    log.warn("[agentphone] getCallTranscript threw", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Determine if AgentPhone is configured AND the feature flag is on.
 * Used by the cron to skip cleanly when not in production-ready state.
 */
export function isAgentPhoneEnabled(): boolean {
  return getApiKey() !== null && process.env.FEATURE_CONFIRMATION_CALLS === "1";
}

/**
 * Operator-tunable system prompt for the confirmation bot. Designed to:
 *   - keep the call SHORT (60-90 sec target · customers hate long calls)
 *   - confirm or reschedule on a SINGLE question
 *   - never sound robotic · uses Nick's voice from .claude/brand-voice-guidelines.md
 *   - handle voicemail by leaving a brief specific message
 *   - end the call after one round-trip on confirmation OR reschedule
 */
export function buildConfirmationSystemPrompt(params: {
  customerName: string;
  service: string;
  preferredDay: string;
  vehicleRef?: string;
}): string {
  const vehicleClause = params.vehicleRef ? `your ${params.vehicleRef}` : "your vehicle";
  return [
    `You are calling on behalf of Nick's Tire & Auto in Cleveland, OH to confirm a service appointment.`,
    `Customer: ${params.customerName}`,
    `Service: ${params.service}`,
    `Scheduled for: ${params.preferredDay}`,
    `Vehicle: ${vehicleClause}`,
    ``,
    `RULES:`,
    `1. Be warm but BRIEF · 60-90 seconds total · operator's time is valuable.`,
    `2. Open by confirming you reached ${params.customerName} · then state the appointment details.`,
    `3. ASK: "Does that still work for you?" — wait for response.`,
    `4. If YES: thank them · remind them we're at 17625 Euclid Ave · end the call.`,
    `5. If NO or they need to reschedule: ask what day works better · acknowledge it ·`,
    `   tell them an operator will call back to confirm the new time · end the call.`,
    `6. If they're confused or need more info: tell them to call (216) 862-0005 · end the call.`,
    `7. Use natural human language · NOT robotic · NEVER say "I am an AI" unless asked directly.`,
    `8. Voicemail detection · if you hear a beep or "leave a message", leave this exactly:`,
    `   "Hi ${params.customerName}, this is Nick's Tire & Auto calling to confirm your`,
    `   ${params.service} appointment ${params.preferredDay}. If anything changes, call us`,
    `   at (216) 862-0005. See you then."`,
    `   Then end the call.`,
  ].join("\n");
}
