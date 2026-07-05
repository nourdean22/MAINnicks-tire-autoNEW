/**
 * POST /api/realtime/session · v10.0.359
 *
 * Mints an ephemeral OpenAI Realtime session token for the browser
 * to establish a WebRTC peer connection. The actual API key never
 * leaves the server.
 *
 * Why ephemeral: browser code with the long-lived OPENAI_API_KEY
 * would be a credential exfiltration risk. Ephemeral session tokens
 * scope to a single Realtime session and expire fast.
 *
 * Flow:
 *   1. Browser POSTs to this route (authenticated via session cookie)
 *   2. Server requests an ephemeral session from OpenAI with brain
 *      context baked into `instructions`
 *   3. Returns { client_secret: { value, expires_at }, session: {...} }
 *      that the browser uses to establish the WebRTC connection
 *
 * Body:
 *   { model?, voice?, brainContext? }
 *
 * Returns: OpenAI's session creation response, untouched.
 *
 * Per /voice-agents skill · semantic_vad for natural turn-taking,
 * sub-500ms target end-to-end via direct speech-to-speech.
 */

import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { aiRouteError } from "@/lib/utils/http-parse";
import { withGuardian } from "@/lib/tools/guardian";

export const maxDuration = 30;

// v10.0.529.100 · Wave 44 · tool definitions exposed to the Realtime
// session. Operator speaking "Hey Nick, add a task to call my supplier
// monday morning" triggers a function_call_arguments event on the data
// channel · client POSTs to /api/realtime/tool-call which dispatches
// to the canonical createTask service.
//
// Start MINIMAL · just createTask. snoozeTask + completeTask + pinMemory
// can be added in a follow-up wave once the wire-up is verified in prod.
const REALTIME_TOOLS = [
  {
    type: "function",
    name: "createTask",
    description:
      "Capture a task into the operator's Inbox. Use whenever Nour says 'add a task', 'remind me to', 'I need to', 'don't let me forget', or otherwise asks you to record an action item. Title should be the action phrase, not a sentence. Pass dueDate ISO when they mention a day or date.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short action phrase, e.g. 'call mike about brakes'" },
        nextPhysicalAction: { type: "string", description: "First concrete physical step. Default to title if unclear." },
        effort: { type: "string", enum: ["M5", "M15", "M30", "H1", "H2PLUS"], description: "Estimated effort band. Default M15." },
        context: { type: "string", enum: ["DESK", "PHONE", "SHOP", "CAR", "HOME", "ANYWHERE"], description: "Where the task will be done. Default ANYWHERE." },
        dueDate: { type: "string", description: "ISO date when task is due. Omit if no deadline mentioned." },
        loopKind: { type: "string", enum: ["ONCE", "DAILY", "PROMISE"], description: "ONCE for normal tasks · DAILY for habits · PROMISE for commitments to someone." },
        promiseTo: { type: "string", description: "Who Nour is promising to (only for PROMISE). 'self', 'dania', a customer name." },
      },
      required: ["title"],
    },
  },
  // v10.0.529.101 · Wave 45 · 3 more voice tools · same wire-up as
  // createTask · routes through canonical service via tool-call dispatch.
  {
    type: "function",
    name: "snoozeTask",
    description:
      "Push a task into WAITING status until a future date. Use when Nour says 'snooze that until tomorrow / friday / next week / 3 days' or 'not now · remind me later'. Use taskId from OPERATOR CONTEXT when available; otherwise fall back to titleQuery (a fuzzy substring of the task title).",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Preferred · the task id (often available in OPERATOR CONTEXT as 'lastTaskId')." },
        titleQuery: { type: "string", description: "Fuzzy substring of the task title · used when taskId is unknown." },
        days: { type: "integer", minimum: 1, maximum: 365, description: "Days from now until resurface. 1=tomorrow · 7=next week · 30=next month." },
      },
      required: ["days"],
    },
  },
  {
    type: "function",
    name: "completeTask",
    description:
      "Mark a task as done. DAILY tasks bump streak + stay READY for tomorrow. ONCE/PROMISE flip to DONE permanently. Use when Nour says 'done · check that off · I finished X · mark it complete'. Use taskId from OPERATOR CONTEXT when available; otherwise titleQuery.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Preferred · the task id (often in OPERATOR CONTEXT as 'lastTaskId')." },
        titleQuery: { type: "string", description: "Fuzzy substring of the task title · used when taskId is unknown." },
      },
    },
  },
  {
    type: "function",
    name: "pinMemory",
    description:
      "Permanently pin a fact / preference / rule into Nour's brain so it appears in every future system prompt. Use when Nour says 'remember this · pin this · always · never · from now on · the rule is'. Content should be a short imperative sentence, NOT a story. Cap ~280 chars.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact / rule / preference to pin. Short imperative. e.g. 'never schedule meetings before 9am' or 'dania prefers texts over calls'." },
        label: { type: "string", description: "Optional short tag for the pin · e.g. 'meetings' or 'comms'." },
      },
      required: ["content"],
    },
  },
];

const REALTIME_DEFAULTS = {
  model: "gpt-4o-realtime-preview-2024-12-17",
  voice: "alloy", // alloy, echo, fable, onyx, nova, shimmer
  modalities: ["text", "audio"] as const,
  input_audio_format: "pcm16",
  output_audio_format: "pcm16",
  input_audio_transcription: { model: "whisper-1" },
  turn_detection: {
    type: "semantic_vad",
    eagerness: "auto",
  },
  tools: REALTIME_TOOLS,
  tool_choice: "auto" as const,
};

const NICK_INSTRUCTIONS_BASE = `You are Nick, Nour's personal operating system AI.

You speak as Nick directly · NOT "Nick says" · always first-person.

This is voice mode. Conversation rules:
- Keep responses under 30 words unless asked for detail
- Use natural speech: contractions, casual register
- Never use formatting (bullets, numbers, markdown) — they read terribly via TTS
- Spell out numbers and abbreviations
- End with a question or natural opening when conversation should continue
- If unclear, ask for clarification rather than guessing
- Never say "I'm an AI" unless explicitly asked

Personality: operator-grade. Direct, efficient, slightly dry. You know
the business (Nick's Tire & Auto · Cleveland), you know Nour, you carry
his wisdom. You don't waste his time.`;

// v10.0.529.96 · Wave 40 · operator context anchors for voice. Mirrors
// the 12-entity-anchor system used by the text-chat OPERATOR CONTEXT
// block in /api/ai/chat/route.ts so spoken pronouns ("snooze that" /
// "grade this decision") resolve the same way as text pronouns.
// Currently the Realtime API session doesn't yet expose tools · this
// only seeds the spoken-response context · operator can refer naturally
// to entities and Nick's spoken reply will reference them by name.
// Once we wire tools to Realtime sessions (future wave) these anchors
// will let voice-driven mutations land on the right entity.
interface OperatorVoiceContext {
  contextRoute?: string;
  lastTaskId?: string;
  lastGoalId?: string;
  lastJournalEntryId?: string;
  lastDecisionId?: string;
  lastPinId?: string;
  lastReflectionId?: string;
  lastMissionId?: string;
}

function buildVoiceContextBlock(ctx: OperatorVoiceContext): string {
  const lines: string[] = [];
  if (ctx.contextRoute) lines.push(`Operator is on ${ctx.contextRoute}.`);
  if (ctx.lastTaskId) lines.push(`Their last-touched taskId is ${ctx.lastTaskId} — say "this task" / "that one".`);
  if (ctx.lastGoalId) lines.push(`Their last-touched goalId is ${ctx.lastGoalId}.`);
  if (ctx.lastJournalEntryId) lines.push(`Their last-touched journal entry is ${ctx.lastJournalEntryId}.`);
  if (ctx.lastDecisionId) lines.push(`Their last-touched decision is ${ctx.lastDecisionId}.`);
  if (ctx.lastPinId) lines.push(`Their last-touched pin is ${ctx.lastPinId}.`);
  if (ctx.lastReflectionId) lines.push(`Their last-touched reflection is ${ctx.lastReflectionId}.`);
  if (ctx.lastMissionId) lines.push(`Their last-touched mission is ${ctx.lastMissionId}.`);
  if (lines.length === 0) return "";
  return `\n\n## Live operator context\n${lines.join("\n")}`;
}

async function mintRealtimeSession(args: {
  model?: string;
  voice?: string;
  brainContext?: string;
  operatorContext?: OperatorVoiceContext;
}): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err: Error & { status?: number } = new Error(
      "OPENAI_API_KEY not configured · cannot mint realtime session",
    );
    err.status = 503;
    throw err;
  }

  const contextBlock = args.operatorContext
    ? buildVoiceContextBlock(args.operatorContext)
    : "";
  let instructions = args.brainContext
    ? `${NICK_INSTRUCTIONS_BASE}\n\n## Current brain context\n${args.brainContext}`
    : NICK_INSTRUCTIONS_BASE;
  instructions += contextBlock;

  const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...REALTIME_DEFAULTS,
      model: args.model ?? REALTIME_DEFAULTS.model,
      voice: args.voice ?? REALTIME_DEFAULTS.voice,
      instructions,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: Error & { status?: number } = new Error(
      `OpenAI realtime session ${res.status}: ${body.slice(0, 200)}`,
    );
    err.status = res.status;
    throw err;
  }

  return res.json();
}

const guardedMint = withGuardian("openai-realtime-session", mintRealtimeSession, {
  timeoutMs: 15_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal server-side sub-op behind /api/realtime/session
});

export async function POST(req: NextRequest) {
  await requireSession(req);

  try {
    const body = await req
      .json()
      .catch(() => ({} as {
        model?: string;
        voice?: string;
        brainContext?: string;
        operatorContext?: OperatorVoiceContext;
      }));

    const session = await guardedMint({
      model: body.model,
      voice: body.voice,
      brainContext:
        typeof body.brainContext === "string" ? body.brainContext.slice(0, 4000) : undefined,
      // v10.0.529.96 · Wave 40 · forward operator anchors to instructions.
      // Server-side validates string-only · client can't smuggle objects.
      operatorContext: body.operatorContext && typeof body.operatorContext === "object"
        ? {
            contextRoute: typeof body.operatorContext.contextRoute === "string" ? body.operatorContext.contextRoute : undefined,
            lastTaskId: typeof body.operatorContext.lastTaskId === "string" ? body.operatorContext.lastTaskId : undefined,
            lastGoalId: typeof body.operatorContext.lastGoalId === "string" ? body.operatorContext.lastGoalId : undefined,
            lastJournalEntryId: typeof body.operatorContext.lastJournalEntryId === "string" ? body.operatorContext.lastJournalEntryId : undefined,
            lastDecisionId: typeof body.operatorContext.lastDecisionId === "string" ? body.operatorContext.lastDecisionId : undefined,
            lastPinId: typeof body.operatorContext.lastPinId === "string" ? body.operatorContext.lastPinId : undefined,
            lastReflectionId: typeof body.operatorContext.lastReflectionId === "string" ? body.operatorContext.lastReflectionId : undefined,
            lastMissionId: typeof body.operatorContext.lastMissionId === "string" ? body.operatorContext.lastMissionId : undefined,
          }
        : undefined,
    });

    return Response.json(session);
  } catch (err) {
    return aiRouteError(err, "realtime/session", "Failed to mint realtime session");
  }
}
