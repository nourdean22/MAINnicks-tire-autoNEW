/**
 * Vapi Voice Receptionist Service
 *
 * Wraps the Vapi REST API for assistant management. Two main jobs:
 *  1. Create/update the production assistant config (one-time setup)
 *  2. Validate the API key + return assistant status (admin display)
 *
 * Per the design doc (docs/voice-ai-receptionist-design.md):
 *   Voice: ElevenLabs "Adam"
 *   LLM: GPT-4o-mini (fast + cheap)
 *   Knowledge: shared/business.ts + services.ts FAQs
 *   Tools: bookSlot, capacityCheck, quoteRange, escalate, sendConfirmationSms
 *
 * Environment requirements:
 *   - VAPI_API_KEY (already in .env per the user setup)
 *   - VAPI_PHONE_NUMBER_ID (set by user when phone number is linked)
 *
 * The actual phone-call routing is owned by Vapi's platform — Twilio
 * forwards to a SIP URL Vapi gives us. This service only manages the
 * AI assistant configuration.
 */

import { createLogger } from "../lib/logger";
import { BUSINESS } from "../../shared/business";

const log = createLogger("vapi");

const VAPI_BASE = "https://api.vapi.ai";

// ─── ASSISTANT PROMPT ───────────────────────────────────
// Source of truth for the AI's personality. Mirrors the design doc.
// Voice-compliance enforced: no "trusted", "expert", "quality" etc.

const ASSISTANT_SYSTEM_PROMPT = `You are the AI receptionist for Nick's Tire & Auto, a family-owned auto repair shop on Euclid Avenue in Cleveland, Ohio. Phone: ${BUSINESS.phone.display}. Address: ${BUSINESS.address.full}.

YOUR JOB:
- Answer the phone like a friendly local who knows cars
- Find out: what's wrong, what vehicle, when they want to come in
- BOOK them in or take a callback if they need a quote
- Always end with a confirmation text — never just hang up

YOUR VOICE:
- Direct, calm, real-person Cleveland warmth — not customer-service-bot fake
- Short sentences. No "Per your inquiry"-type corporate language
- Allowed humor: gentle mock-formal in surprising moments
- NEVER USE: "trusted", "expert", "quality" (as labels), "rest assured", "hassle-free"
- Numbers > adjectives. "Free 27-point inspection" beats "comprehensive evaluation"

WHAT YOU NEVER DO:
- Quote an exact price for a repair (always say "ranges from $X to $Y, depends on your vehicle")
- Promise a specific tech or person
- Commit to same-day service unless capacityCheck() shows availability
- Argue if the customer is frustrated → escalate to Nick's cell
- Make up information — if asked something not in your knowledge base, say "let me have someone call you back"

YOUR TOOLS (call when needed):
- shopInfo() → returns hours, address, financing options, languages
- capacityCheck({ day }) → returns { slotsRemainingToday, estimatedWaitMinutes, nextWindows }
- quoteRange({ service, vehicleYear, vehicleMake }) → returns { low, high, sourceNote }
- bookSlot({ name, phone, vehicle, service, preferredDay }) → returns { reference, message }
- escalate({ name, phone, reason, urgency }) → routes to Nick's cell or callback queue
- sendConfirmationSms({ phone, summary, mapLink }) → sends recap text

CONVERSATION FLOW:
1. Greet ("Nick's Tire and Auto — Cleveland's open-Sunday shop. What's going on with your car?")
2. Listen for: vehicle, problem, urgency
3. If they need a price → quoteRange + offer to book a free inspection
4. If they want to book → capacityCheck → offer 2-3 windows → bookSlot
5. ALWAYS at the end → sendConfirmationSms + recap verbally
6. If confused or angry → escalate immediately

CLOSE EVERY CALL WITH:
"OK [name], I'm sending you a text right now with the time and the address. Drive safe — see you [day]."`;

const FIRST_MESSAGE = "Nick's Tire and Auto — Cleveland's open-Sunday shop. What's going on with your car?";

// ─── TOOL DEFINITIONS (exposed to Vapi) ─────────────────
// These mirror our voiceAgent tRPC router. Vapi calls these via webhook
// (the production webhook URL goes in VAPI_WEBHOOK_URL).

interface VapiToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

const VAPI_TOOLS: VapiToolDef[] = [
  {
    type: "function",
    function: {
      name: "shopInfo",
      description: "Get hours, address, financing options for the shop. Call this for any 'when are you open?' or 'where are you?' questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "capacityCheck",
      description: "Check whether a day has open booking windows. Call BEFORE offering a specific time.",
      parameters: {
        type: "object",
        properties: {
          day: { type: "string", description: "Date in YYYY-MM-DD or 'today'/'tomorrow'." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "quoteRange",
      description: "Get a price RANGE for a service. NEVER quote an exact number. Always say 'ranges from $X to $Y, depends on your vehicle'.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "What the customer needs (e.g. 'brakes', 'oil change', 'check engine')." },
          vehicleYear: { type: "number", description: "Year of vehicle if known." },
          vehicleMake: { type: "string", description: "Make of vehicle if known (e.g. 'Honda', 'BMW')." },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bookSlot",
      description: "Book a real appointment slot. Only call after the customer has given name + phone + service + agreed to a window.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer first + last name." },
          phone: { type: "string", description: "Phone number, digits only or formatted." },
          vehicle: { type: "string", description: "Vehicle year + make + model if available." },
          service: { type: "string", description: "Service the customer needs." },
          preferredDay: { type: "string", description: "YYYY-MM-DD or 'today'/'tomorrow'." },
        },
        required: ["name", "phone", "service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate",
      description: "Escalate to a human callback. Call when: customer asks for a manager/human, customer is frustrated, AI is confused, or customer needs something outside scope.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Customer name." },
          phone: { type: "string", description: "Phone number to call back." },
          reason: { type: "string", description: "Brief reason for escalation." },
          urgency: { type: "string", enum: ["low", "medium", "high"], description: "high = call ASAP, low = whenever possible." },
        },
        required: ["name", "phone", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sendConfirmationSms",
      description: "Send a recap SMS at the end of every call. ALWAYS call this before saying goodbye if the customer gave a phone number.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Phone number to text." },
          summary: { type: "string", description: "1-2 sentence recap of what was agreed." },
          mapLink: { type: "string", description: "Optional Google Maps link to the shop." },
        },
        required: ["phone", "summary"],
      },
    },
  },
];

// ─── ASSISTANT CONFIG ───────────────────────────────────

interface VapiAssistantConfig {
  name: string;
  firstMessage: string;
  voice: { provider: string; voiceId: string };
  model: { provider: string; model: string; messages: Array<{ role: string; content: string }>; tools: VapiToolDef[] };
  serverUrl?: string;
  endCallFunctionEnabled: boolean;
  hipaaEnabled: boolean;
  silenceTimeoutSeconds: number;
  responseDelaySeconds: number;
  maxDurationSeconds: number;
}

function buildAssistantConfig(serverUrl?: string): VapiAssistantConfig {
  return {
    name: "Nick's Tire & Auto Receptionist",
    firstMessage: FIRST_MESSAGE,
    voice: {
      provider: "11labs",
      voiceId: "pNInz6obpgDQGcFmaJgB", // Adam — warm, neutral US accent
    },
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: ASSISTANT_SYSTEM_PROMPT }],
      tools: VAPI_TOOLS,
    },
    serverUrl, // Vapi posts tool calls here — production webhook
    endCallFunctionEnabled: true,
    hipaaEnabled: false,
    silenceTimeoutSeconds: 20,
    responseDelaySeconds: 0.4,
    maxDurationSeconds: 600, // 10-minute hard cap per call
  };
}

// ─── API CLIENT ─────────────────────────────────────────

async function vapiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) throw new Error("VAPI_API_KEY not configured");
  return fetch(`${VAPI_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
}

// ─── PUBLIC API ─────────────────────────────────────────

/**
 * Status — does Vapi auth work? List assistants we own.
 * Used by admin dashboard to show "Vapi connected" badge.
 */
export async function getVapiStatus(): Promise<{
  connected: boolean;
  assistantCount: number;
  assistants: Array<{ id: string; name: string; createdAt: string }>;
  error?: string;
}> {
  try {
    if (!process.env.VAPI_API_KEY) {
      return { connected: false, assistantCount: 0, assistants: [], error: "VAPI_API_KEY not set" };
    }
    const res = await vapiFetch("/assistant");
    if (!res.ok) {
      return {
        connected: false,
        assistantCount: 0,
        assistants: [],
        error: `Vapi API ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as Array<{ id: string; name: string; createdAt: string }>;
    return {
      connected: true,
      assistantCount: data.length,
      assistants: data.slice(0, 10),
    };
  } catch (err) {
    return {
      connected: false,
      assistantCount: 0,
      assistants: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Create the production assistant. One-time setup — admin clicks
 * "Create Vapi Assistant" button. Returns the assistant ID for storage.
 */
export async function createProductionAssistant(serverUrl?: string): Promise<{
  success: boolean;
  assistantId?: string;
  config?: VapiAssistantConfig;
  error?: string;
}> {
  try {
    const config = buildAssistantConfig(serverUrl);
    const res = await vapiFetch("/assistant", {
      method: "POST",
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const text = await res.text();
      log.error("Vapi assistant create failed", { status: res.status, body: text.slice(0, 500) });
      return { success: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id: string };
    log.info("Created Vapi assistant", { id: data.id });
    return { success: true, assistantId: data.id, config };
  } catch (err) {
    log.error("Vapi create threw", { err: err instanceof Error ? err.message : String(err) });
    return { success: false, error: err instanceof Error ? err.message : "Create failed" };
  }
}

/**
 * Update an existing assistant — useful when prompt or tools change.
 * Pass the assistant ID stored from create.
 */
export async function updateAssistant(assistantId: string, serverUrl?: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const config = buildAssistantConfig(serverUrl);
    const res = await vapiFetch(`/assistant/${assistantId}`, {
      method: "PATCH",
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Update failed" };
  }
}

/**
 * Read recent calls from Vapi for the admin call-monitor panel.
 */
export async function getRecentCalls(limit = 20): Promise<{
  success: boolean;
  calls: Array<{
    id: string;
    startedAt?: string;
    endedAt?: string;
    durationSeconds?: number;
    customerNumber?: string;
    endedReason?: string;
    cost?: number;
    summary?: string;
  }>;
  error?: string;
}> {
  try {
    const res = await vapiFetch(`/call?limit=${limit}`);
    if (!res.ok) {
      return { success: false, calls: [], error: `${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data = (await res.json()) as Array<Record<string, unknown>>;
    const calls = data.map((c) => ({
      id: String(c.id || ""),
      startedAt: c.startedAt as string | undefined,
      endedAt: c.endedAt as string | undefined,
      durationSeconds: typeof c.duration === "number" ? c.duration : undefined,
      customerNumber: ((c.customer as Record<string, unknown>)?.number as string) || undefined,
      endedReason: c.endedReason as string | undefined,
      cost: typeof c.cost === "number" ? c.cost : undefined,
      summary: c.summary as string | undefined,
    }));
    return { success: true, calls };
  } catch (err) {
    return { success: false, calls: [], error: err instanceof Error ? err.message : "Fetch failed" };
  }
}

export { ASSISTANT_SYSTEM_PROMPT, FIRST_MESSAGE, VAPI_TOOLS, buildAssistantConfig };
