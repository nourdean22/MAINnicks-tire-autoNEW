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
import { extractText } from "./extract-text";

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
  /** Older messages the client left out of `messages` (04-F15); 0 = none. */
  historyOffset: number;
  // 2026-07-22 · Authority-kernel controls (audit Waves 1+7). All optional,
  // defaulted by parseChatControls so absent fields = today's behavior.
  //   privateMode      — Private Lab: the turn writes ONE content-free cost
  //                      row (ai_generations: model, provider, token counts,
  //                      duration; no conversation id, no text) so its spend
  //                      counts toward the daily budget, and nothing else. No
  //                      message rows, no BrainMemory / AuditEvent /
  //                      system_metrics / image rows, no embeddings stored, no
  //                      learning, no Langfuse spans, no user text in logs, and
  //                      no mutating tool (stripped in prepare-tools, denied in
  //                      tool-policy).
  //   ephemeral        — transcript NOT kept (no conversation / message rows,
  //                      no post-turn pipeline) but otherwise a normal turn:
  //                      tools and memory writes stay on. Home's command line
  //                      (/task, /capture) sends this. 2026-10-10 split: one
  //                      flag used to mean both, so Private Lab could not be
  //                      tightened without breaking /capture.
  //   posture        — execute = suppress unsolicited opposition ·
  //                      spar = force the adversarial dialectic ·
  //                      counsel = balanced (default behavior) · auto = infer.
  //   actionPermission — read = no mutating tools · draft = stage, don't fire
  //                      irreversible/outward actions · execute = allowed.
  //
  //   READ-MODE CONTRACT (decided 2026-09-07, audit D15): "read" means
  //   NO AUTONOMOUS CHANGES — the model cannot run a mutating tool
  //   (stripMutatingTools removes them from the request) — while a typed command
  //   from the operator (`/save …`, "remember that …") is the operator's own
  //   authority and executes regardless of the mode. It is NOT "read-only": the
  //   interceptor fast paths are permission-blind by design and only the
  //   operator's own last message reaches them; quoted or retrieved text is
  //   never a command. Pinned by tests/security/read-mode-typed-commands.test.ts;
  //   change the label, this comment and that test together or not at all.
  privateMode: boolean;
  ephemeral: boolean;
  posture: ChatPosture;
  actionPermission: ChatActionPermission;
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

export type ChatPosture = "auto" | "execute" | "counsel" | "spar";
export type ChatActionPermission = "read" | "draft" | "execute";

const POSTURES: readonly ChatPosture[] = ["auto", "execute", "counsel", "spar"];
const PERMISSIONS: readonly ChatActionPermission[] = ["read", "draft", "execute"];

/**
 * Parse the authority-kernel control fields off the request body. Pure +
 * defensive: anything malformed degrades to the safe default (no private mode,
 * auto posture, draft permission) instead of throwing. One exception: a
 * permission that is PRESENT but unrecognised ("READ", " read") is a
 * restriction the client tried to state, so it falls to "read" rather than
 * widening to draft. Absent or null stays draft. Exported for tests.
 */
export function parseChatControls(body: Record<string, unknown>): {
  privateMode: boolean;
  posture: ChatPosture;
  actionPermission: ChatActionPermission;
} {
  const privateMode = body.privateMode === true;
  const posture = POSTURES.includes(body.posture as ChatPosture)
    ? (body.posture as ChatPosture)
    : "auto";
  const actionPermission = PERMISSIONS.includes(body.actionPermission as ChatActionPermission)
    ? (body.actionPermission as ChatActionPermission)
    : body.actionPermission == null
      ? "draft"
      : "read";
  return { privateMode, posture, actionPermission };
}

/**
 * How many older messages the client left out of `messages` (it sends its
 * last 150, audit 04-F15). A client claim: anything but a non-negative
 * integer is 0, which is the unwindowed behaviour. Exported for tests.
 */
export function parseHistoryOffset(body: Record<string, unknown>): number {
  const v = body.historyOffset;
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : 0;
}

export { extractText };

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

  let messages = (body.messages ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) {
    return {
      kind: "block",
      response: Response.json({ error: "Invalid messages" }, { status: 400 }),
    };
  }

  // 3b. U5 · inline (data:) files count only on the newest user message: older turns lose their
  // bytes here as well as in the client transport, which a modified client skips. Then the newest
  // message is capped at 10 files and ~18 MB (413).
  const { attachmentCapProblem, newestUserIndex, withoutOlderInlineFiles } = await import("@/lib/ai/chat/attachment-cap");
  messages = withoutOlderInlineFiles(messages);
  body.messages = messages;
  // The newest USER message keeps its bytes, so it is the one capped (a regenerate ends on an assistant).
  const capProblem = attachmentCapProblem(messages[newestUserIndex(messages)]);
  if (capProblem) {
    return { kind: "block", response: Response.json({ error: capProblem }, { status: 413 }) };
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
    historyOffset: parseHistoryOffset(body),
    ...parseChatControls(body),
    // Strict boolean like privateMode: a truthy string is not a request.
    ephemeral: body.ephemeral === true,
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
