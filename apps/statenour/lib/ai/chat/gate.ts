/**
 * Chat pipeline · GATE stage
 *
 * Runs at the top of every chat request. Cheap checks BEFORE doing
 * any expensive work — order-sensitive:
 *
 *   1. Rate limit by IP    (in-memory token bucket)
 *   2. AI budget cap       (power-panel daily $ cap + strict mode)
 *   3. Body parse + shape  (must be array of 1-200 messages)
 *   4. Override extraction (client mode / provider / persona pills)
 *   5. Persona inference   (when no explicit override)
 *
 * Returns either a `block` (for the route to short-circuit-return)
 * or a `pass` carrying the parsed body + overrides + last-user text.
 *
 * Pure-ish: rate-limit + budget read shared singletons (in-memory
 * Map + BrainMemory cached value), but the function itself is
 * straight-line and terminates fast.
 */

import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { checkAiBudget } from "@/lib/services/power-panel";
import { inferPersona } from "@/lib/ai/intent-classifier";
import type { ChatMode } from "@/lib/ai/chat-mode";
import type { ProviderName, TaskType } from "@/lib/ai/provider";

export interface GateBlock {
  kind: "block";
  response: Response;
}

export interface GatePass {
  kind: "pass";
  body: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  conversationId: string | undefined;
  modeOverride: ChatMode | undefined;
  providerOverride: ProviderName | undefined;
  taskTypeOverride: TaskType | undefined;
  personality: string;
  userContent: string;
  // v10.0.529.86 · Wave 30 · pronoun-resolution context hints. All
  // optional · the system prompt + tool fuzzy-lookup paths prefer
  // these when present but fall back to existing behavior when
  // absent. Set client-side by the chat page based on usePathname()
  // + last-touched task/goal + last-tapped suggestion meta.
  contextRoute?: string;
  lastTaskId?: string;
  lastGoalId?: string;
  lastSuggestionKind?: string;
  lastSuggestionId?: string;
  // v10.0.529.90 · Wave 34 · 5 new entity anchors from the surfaces
  // wired in Waves 30-33. Suggestion-id extractor in chat/page.tsx
  // populates these directly from chip taps · also set by future
  // page-context-bridge hooks when operator opens a journal entry
  // / decision detail / pin detail.
  lastJournalEntryId?: string;
  lastDecisionId?: string;
  lastPinId?: string;
  lastReflectionId?: string;
  lastMissionId?: string;
}

export type GateResult = GateBlock | GatePass;

/**
 * Extract plain text from a UIMessage. Handles both legacy string
 * content + v6 parts arrays. Tolerant of malformed input.
 */
export function extractText(msg: Record<string, unknown>): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.parts)) {
    const textParts = (msg.parts as Array<Record<string, unknown>>)
      .filter((p) => p?.type === "text" && typeof p?.text === "string")
      .map((p) => p.text as string);
    if (textParts.length > 0) return textParts.join(" ");
  }
  if (msg.content != null) return JSON.stringify(msg.content);
  return "";
}

export async function runGate(req: Request): Promise<GateResult> {
  // 1. Rate limit
  const rl = checkRateLimit(`ai-chat:${getClientIp(req)}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return {
      kind: "block",
      response: new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      }),
    };
  }

  // 2. AI budget cap (power-panel)
  // 2026-07-16 audit · this passed `2` as the spend estimate purely to
  // satisfy a `> 10` strict-mode threshold that then never fired. The
  // threshold is gone (power-panel.ts); the estimate stays 0 because the
  // real per-turn cost is unknown pre-flight and the daily-cap branch
  // compares `spent + estimate` — a fabricated 2¢ only skewed that.
  //
  // Still fails OPEN on a DB error: a chat outage is worse than an
  // overspend, and lib/ai/budget.ts's assertWithinBudget re-checks the
  // hard cap downstream. Now logged instead of silently swallowed, so a
  // persistently-open gate is visible in /system/logs.
  const budget = await checkAiBudget(0).catch((err) => {
    void import("@/lib/errors/record-error").then(({ recordError }) =>
      recordError("chat:request", err, { stage: "checkAiBudget", failedOpen: true }),
    );
    return { allowed: true } as const;
  });
  if (!budget.allowed) {
    return {
      kind: "block",
      response: new Response(
        JSON.stringify({
          error: "Nick paused by power panel",
          reason: (budget as { reason?: string }).reason,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  // 3. Body parse + shape check
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return {
      kind: "block",
      response: Response.json({ error: "Invalid JSON" }, { status: 400 }),
    };
  }

  const messages = (body.messages ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) {
    return {
      kind: "block",
      response: Response.json({ error: "Invalid messages" }, { status: 400 }),
    };
  }

  // 4. Override extraction
  const conversationId = body.conversationId as string | undefined;
  const modeOverride = body.modeOverride as ChatMode | undefined;
  const providerOverride = body.providerOverride as ProviderName | undefined;
  const taskTypeOverride = body.taskTypeOverride as TaskType | undefined;
  const explicitPersonality = body.personality as string | undefined;

  // 5. Persona inference (when no explicit override)
  const lastUserMsg = messages[messages.length - 1];
  const userContent =
    lastUserMsg?.role === "user" ? extractText(lastUserMsg) : "";
  const inferredPersonality =
    messages.length > 0
      ? inferPersona(userContent, { useOverride: false }).persona
      : "master";
  const personality = explicitPersonality || inferredPersonality;

  // v10.0.529.86 · Wave 30 · pronoun context hints
  const contextRoute = body.contextRoute as string | undefined;
  const lastTaskId = body.lastTaskId as string | undefined;
  const lastGoalId = body.lastGoalId as string | undefined;
  const lastSuggestionKind = body.lastSuggestionKind as string | undefined;
  const lastSuggestionId = body.lastSuggestionId as string | undefined;
  // v10.0.529.90 · Wave 34 · expanded entity anchors.
  const lastJournalEntryId = body.lastJournalEntryId as string | undefined;
  const lastDecisionId = body.lastDecisionId as string | undefined;
  const lastPinId = body.lastPinId as string | undefined;
  const lastReflectionId = body.lastReflectionId as string | undefined;
  const lastMissionId = body.lastMissionId as string | undefined;

  return {
    kind: "pass",
    body,
    messages,
    conversationId,
    modeOverride,
    providerOverride,
    taskTypeOverride,
    personality,
    userContent,
    contextRoute,
    lastTaskId,
    lastGoalId,
    lastSuggestionKind,
    lastSuggestionId,
    lastJournalEntryId,
    lastDecisionId,
    lastPinId,
    lastReflectionId,
    lastMissionId,
  };
}
