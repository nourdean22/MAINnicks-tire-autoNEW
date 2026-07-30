/**
 * app/api/ai/chat/derive-turn-signals.ts — chat-route decomposition
 * slice (2026-07-25). The per-turn signal derivation moved VERBATIM
 * from route.ts: chat-mode resolution (override → config → classify),
 * task-type mapping, query-shape, turn-intelligence classifier,
 * response contract, domain routing (incl. the v8.6 image-attachment
 * peek), and the three tool-mandatory intent detections
 * (python-execute / action / web-search).
 *
 * One typed input → one typed result; the only I/O is getAiConfig +
 * classifyIntent (both already best-effort/bounded upstream of this
 * move). The classify stage-timer stays wrapped tightly around
 * classifyIntent exactly as before, via the injected stageTracker.
 *
 * Everything else is pure (<2ms) derivation from user text — see the
 * original block comments preserved inline below.
 */

import { getAiConfig } from "@/lib/settings/ai-config";
import { detectQueryShape } from "@/lib/ai/query-shape";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { buildResponseContract } from "@/lib/ai/response-contract";
import type { ChatMode } from "@/lib/ai/chat-mode";
import type { TaskType } from "@/lib/ai/provider";
import type { createStageTracker } from "@/lib/ai/chat/timing";
import type { logger as rootLogger } from "@/lib/logger";

type Logger = ReturnType<typeof rootLogger.withSurface>;
type StageTracker = ReturnType<typeof createStageTracker>;

export interface TurnSignals {
  aiConfig: Awaited<ReturnType<typeof getAiConfig>> | null;
  classification: Awaited<
    ReturnType<typeof import("@/lib/ai/runtime/intent-router").classifyIntent>
  >;
  mode: ChatMode;
  taskTypeForMode: TaskType;
  queryShape: ReturnType<typeof detectQueryShape>;
  turnSignal: ReturnType<typeof classifyTurn>;
  responseContract: ReturnType<typeof buildResponseContract>;
  finalTaskType: TaskType;
  finalPreferLargeContext: boolean;
  pythonExecuteIntent: boolean;
  actionIntent: ReturnType<
    typeof import("@/lib/ai/chat/action-intent-detector").detectActionIntent
  > | null;
  webSearchIntent: boolean;
  /** Weaker sibling: recency-phrased ask → search tools INCLUDED, never forced. */
  webSearchRecency: boolean;
}

export async function deriveTurnSignals(args: {
  userContent: string;
  messages: Array<Record<string, unknown>>;
  modeOverride: ChatMode | undefined;
  taskTypeOverride: TaskType | undefined;
  contentMode: boolean;
  traceId: string;
  stageTracker: StageTracker;
  log: Logger;
}): Promise<TurnSignals> {
  const {
    userContent,
    messages,
    modeOverride,
    taskTypeOverride,
    contentMode,
    traceId,
    stageTracker,
    log,
  } = args;

  // ═══ PERF: Chat mode detection (with overrides) ═══
  // Three-layer priority for mode:
  //   1. Per-request override from the chat control bar (client body)
  //   2. Global default from the AI config (Settings page)
  //   3. Automatic detection via detectChatMode
  const aiConfig = await getAiConfig().catch((): null => null);
  const { classifyIntent } = await import("@/lib/ai/runtime/intent-router");
  const classifyTimer = stageTracker.start("classify");
  const classification = await classifyIntent(userContent, traceId);
  classifyTimer.end();
  const mode: ChatMode =
    modeOverride ||
    aiConfig?.defaultMode ||
    (classification.mode === "engineer" || classification.mode === "operator" ? "deep" : "standard");

  // ═══ CRITICAL FIX: map chat mode → Venice task type ═══
  // Previously getModel() was called BEFORE mode detection and always
  // used the "reason" task type (reasoning_effort: "high"). That meant
  // for QUICK mode casual messages like "hi" the model would think
  // heavily, strip_thinking_response would remove all the reasoning,
  // and the assistant response came back EMPTY. Nick's chat went dead
  // on every short message.
  //
  // Now mode drives task type:
  //   standard → "reason"  (medium reasoning, temp 0.7, balanced, sub-3s)
  //   deep     → "deep"    (wide tools, temp 0.3, strategic, up to 4000 tokens)
  // Quick mode was removed Apr 17 — standard + query-shape adaptation
  // handles casual greetings just as fast without a second code path.
  // Client task-type override still wins when explicitly set.
  const taskTypeForMode: TaskType =
    taskTypeOverride ||
    (mode === "deep" ? "deep" : "reason");

  // ═══ Query-shape detection (used by both the prompt assembly AND
  // the maxOutputTokens cap). Pure function, no I/O. ═══
  const queryShape = detectQueryShape(userContent);

  // ═══ Apr 19 · Turn intelligence classifier ═══
  // Single-pass heuristic that drives four downstream choices:
  //   • temperature  (factual=tight, creative=warm)
  //   • chain-of-thought scratchpad (complex / analytical / decision / reflective)
  //   • output-shape template (email/SMS/proposal/code/json/list/summary)
  //   • two-pass critique (high-stakes decisions only)
  // Zero AI cost, <2ms. Pure function of user text. Turns every
  // downstream slow path into "only fires when it matters" instead
  // of "always on, burn the budget". See lib/ai/turn-intelligence.ts.
  const turnSignal = classifyTurn(userContent);
  log.info("turn_signal", {
    complexity: turnSignal.complexity,
    intent: turnSignal.intent,
    shape: turnSignal.outputShape,
    urgency: turnSignal.urgency,
    domain: turnSignal.domain,
    temp: turnSignal.temperature,
    cot: turnSignal.useChainOfThought,
    critique: turnSignal.useTwoPassCritique,
  });

  // AG-11 · Response contract. Pure (<1ms) derivation of the turn's
  // output obligations (answerMode incl. 'brainstorm', exact rank counts,
  // no-clarifying-question, must-not-claim-actions...). Existed fully
  // tested but was never built on the live path — the module header's
  // claim that it fed the system prompt was false until this wire.
  // buildContractDirective() returns "" for plain turns, so casual chat
  // pays zero tokens. Injection happens in finalizeSystemPrompt.
  const responseContract = buildResponseContract(userContent, turnSignal, queryShape.shape);
  if (responseContract.reasons.length > 0) {
    log.info("response_contract", {
      answerMode: responseContract.answerMode,
      length: responseContract.length,
      rankCount: responseContract.rankCount,
      askOk: responseContract.shouldAskClarifying,
      reasons: responseContract.reasons.slice(0, 6),
    });
  }

  // v6 · BATCH 3 · Apr 28 — Domain-routed model selection.
  // detectDomain() reads the message and picks the best taskType +
  // preferLargeContext combo. Code asks → ollama qwen3-coder. Vision →
  // qwen3-vl. Strategy → deepseek-v4-pro. Marketing → venice-uncensored
  // for brand voice. Fast classify → cheap fast Venice. Falls through to
  // mode-driven defaults when no specific domain matches.
  const { detectDomain } = await import("@/lib/ai/domain-routing");
  // v8.6 BATCH 34 — peek at the LAST user message's parts to detect
  // image attachments. If found, route to qwen3-vl regardless of text
  // (closes the "user uploads photo and just types '?'" gap).
  const lastMsg = messages[messages.length - 1] as unknown as {
    parts?: Array<{ type?: string; mediaType?: string; mimeType?: string }>;
  };
  const hasImageAttachments = Array.isArray(lastMsg?.parts)
    ? lastMsg.parts.some((p) => {
        if (!p) return false;
        if (p.type === "image") return true;
        if (p.type === "file") {
          const m = p.mediaType ?? p.mimeType;
          return typeof m === "string" && m.startsWith("image/");
        }
        return false;
      })
    : false;
  const domainRoute = detectDomain(userContent, { hasImageAttachments });
  const finalTaskType = (taskTypeOverride
    ? taskTypeForMode
    : domainRoute.domain !== "general"
      ? domainRoute.taskType
      : taskTypeForMode) as TaskType;
  const finalPreferLargeContext =
    contentMode || domainRoute.preferLargeContext;
  log.info("domain_route", {
    label: domainRoute.label,
    taskType: finalTaskType,
    largeContext: finalPreferLargeContext,
  });

  // v10.0.521 · Python-execute intent detection ALSO drives the
  // provider pick. Venice-uncensored has documented loose tool_choice
  // adherence (v10.0.520 set { type:"tool", toolName:"runPython" }
  // and the smoke test still showed TOOLS=0 · model wrote code text
  // instead of calling). Anthropic + OpenAI honor strict tool_choice.
  // Route python-execute intent through Anthropic to guarantee the
  // tool actually fires.
  const pythonExecuteIntent =
    /\b(run|execute|invoke)\s+(?:this\s+)?python\b|\bpython\s+(?:to\s+|and\s+)?(?:compute|calculate|run|execute)\b|\buse\s+(?:the\s+)?runPython\b|\brun\s+(?:this\s+)?code\b/i.test(
      userContent,
    );

  // v-truth · Generic action intent ("add this task", "remember this",
  // "send the email") ALSO drives the provider pick. toolChoice:
  // "required" is set for these turns, but forcing only EXECUTES
  // on a provider that honors strict tool_choice. Ollama qwen3 does
  // (and is the live primary · provider.ts PROVIDERS[0]); Venice strips
  // tool_choice, so a forced action landing on the Venice fallback gets
  // narrated, never run. Mirror the python pattern so a genuine action
  // routes to the lane that actually fires the tool. Detected ONCE
  // and reused for both the provider force and toolChoice.
  // Degrades safely: if Ollama is unavailable, getModel falls through.
  const actionIntent = pythonExecuteIntent
    ? null
    : (() => {
        try {
          const { detectActionIntent } =
            require("@/lib/ai/chat/action-intent-detector") as typeof import("@/lib/ai/chat/action-intent-detector");
          return detectActionIntent(userContent);
        } catch {
          return null;
        }
      })();

  // 2026-07-15 · explicit web-search intent. Telemetry showed turns
  // where the operator explicitly asked to "search the web" and the
  // model either couldn't reach a web tool (pruner follow-up gap,
  // fixed via conversationTail) or narrated "no web search available"
  // WITHOUT attempting the attached tool (persona-framed reasoning
  // model). Mirror the python-execute pattern: when the ask is
  // explicit, force arsenalWebSearch on step 0 so unavailability can't
  // be narrated — the only choice left is the query string. Detection
  // stays tight (explicit phrasings only) so ordinary questions keep
  // toolChoice auto.
  const webSearchIntent =
    !pythonExecuteIntent &&
    /\b(search (the )?(web|internet|net|online)|google (it|for|me|this|that)|web ?search|look (it |this |that |them )?up online|(find|pull|get) (me )?(the )?(latest|current|live|breaking|newest|hottest) .{0,40}\b(online|on the web|from the web|news|trends?)\b)\b/i.test(
      userContent,
    );

  // 2026-07-29 · recency AVAILABILITY (weaker sibling of the force
  // above). Telemetry from tonight: "Best top rated movies n shows …
  // right now" carries no explicit search phrasing, the semantic pruner
  // ranked the search family out, and the model either narrated "I
  // don't have web search available this turn" or answered from priors
  // and invented specifics (three unverified percentages in one reply).
  // A time-anchored ask needs the tool IN THE SET; it does not need
  // step-0 forcing. This signal only widens prepare-tools' include set —
  // toolChoice forcing stays on the tight explicit regex above, exactly
  // per its "detection stays tight" design note.
  const webSearchRecency =
    !pythonExecuteIntent &&
    !webSearchIntent &&
    /\b(right now|trending|what'?s (hot|new|popular)|(top|best)[- ]rated|(latest|newest|current|breaking) (news|movies?|shows?|series|releases?|trends?|prices?|models?)|this (week|month))\b/i.test(
      userContent,
    );

  return {
    aiConfig,
    classification,
    mode,
    taskTypeForMode,
    queryShape,
    turnSignal,
    responseContract,
    finalTaskType,
    finalPreferLargeContext,
    pythonExecuteIntent,
    actionIntent,
    webSearchIntent,
    webSearchRecency,
  };
}
