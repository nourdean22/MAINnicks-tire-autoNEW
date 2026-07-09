import { streamText, stepCountIs } from "ai";
import { getModel, getActiveProviderInfo, isRuntimeProvider, GEMINI_SAFETY_OFF, type ProviderName, type TaskType } from "@/lib/ai/provider";
import { buildSystemPrompt, detectTopicTier } from "@/lib/ai/system-prompt";
import { detectQueryShape } from "@/lib/ai/query-shape";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { buildResponseContract } from "@/lib/ai/response-contract";
import { rerankContextBlocks, formatRerankSummary } from "@/lib/ai/context-reranker";
import { getCachedPrompt, setCachedPrompt } from "@/lib/ai/system-prompt-cache";
import { detectChatMode, pruneTools, describeMode, type ChatMode } from "@/lib/ai/chat-mode";
import { prefetchIntents, formatPrefetchContext } from "@/lib/ai/predictive-prefetch";
import { compressConversation } from "@/lib/ai/conversation-compress";
import {
  embedUserMessage,
  warmToolEmbeddings,
  isToolEmbeddingCacheWarm,
} from "@/lib/ai/tool-embeddings";
import { prisma } from "@/lib/prisma";
import { ACTION_CATALOG } from "@/lib/ai/nick-agent";
import { nourTools } from "@/lib/ai/tools";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { recordError } from "@/lib/errors/record-error";
import { getAiConfig } from "@/lib/settings/ai-config";
import { withHeartbeat } from "@/lib/streaming/heartbeat";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { logger as rootLogger } from "@/lib/logger";
import { buildStreamErrorHandler } from "@/lib/services/chat/stream-error-handler";
import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";
import { getFlag, loadFeatureFlagOverrides } from "@/lib/feature-flags";
// hooks-lib REST→tRPC slice (2026-05-22) · the conversation-list read ·
// also called by the new `chat.list` tRPC procedure · drift impossible.
import { listConversations } from "@/lib/services/chat-conversation-read";

const log = rootLogger.withSurface("api/ai/chat");

export const maxDuration = 120; // Pro plan: up to 300s

export async function POST(req: Request) {
  // Preload DB overrides before running the chat turn
  await loadFeatureFlagOverrides().catch(() => {});

  await requireSession(req);
  // v9.1.19 · AI rate-limit gate. The chat route is session-gated so
  // only Nour can hit it, but a runaway client (e.g. a polling loop
  // gone wild, or auto-fire chains) could still bomb the AI provider
  // bills. 10 req/min/IP is generous for normal use and catastrophic
  // for a runaway. Returns 429 cleanly without entering the heavy
  // streaming pipeline.
  const limited = checkAiRateLimit(req);
  if (limited) return limited;

  // v7.8 · Apr 29 · Universal audit. Anything written from this
  // route — AutonomousAction triggers, BrainMemory persists from
  // importance-scorer, Mission/Task creates from chat tool calls —
  // gets tagged with actor "nick" so the audit trail distinguishes
  // AI mutations from user-direct ones.
  const { withActor } = await import("@/lib/db/actor");
  return withActor("nick", () => chatPostInner(req));
}

async function chatPostInner(req: Request) {
  // ── Pipeline timing ──────────────────────────────────────────
  const { createStageTracker, formatStageLog } = await import("@/lib/ai/chat/timing");
  const stageTracker = createStageTracker();
  const reqId = Math.random().toString(36).slice(2, 9);

  // ── GATE: rate limit, budget, body parse, overrides, persona ──
  // Extracted to lib/ai/chat/gate.ts so the cheap-check sequence
  // is testable + reusable. Returns either a Response (block) or a
  // parsed pass with all overrides + last-user text.
  const gateTimer = stageTracker.start("gate");
  const { runGate } = await import("@/lib/ai/chat/gate");
  const gate = await runGate(req);
  gateTimer.end();
  if (gate.kind === "block") return gate.response;

  const {
    body,
    messages: rawMessages,
    conversationId,
    modeOverride,
    providerOverride,
    taskTypeOverride,
    personality,
    userContent,
    // v10.0.529.86 · Wave 30 · pronoun-resolution context
    contextRoute,
    lastTaskId,
    lastGoalId,
    lastSuggestionKind,
    lastSuggestionId,
    // v10.0.529.90 · Wave 34 · expanded entity anchors.
    lastJournalEntryId,
    lastDecisionId,
    lastPinId,
    lastReflectionId,
    lastMissionId,
  } = gate;

  const { sanitizeMessageHistory } = await import(
    "@/lib/ai/chat/sanitize-history"
  );
  const messages = sanitizeMessageHistory(rawMessages as Parameters<typeof sanitizeMessageHistory>[0]);

  let convId = conversationId;
  void body; // body kept for downstream interceptors that read raw fields
  const lastUserMsg = messages[messages.length - 1] as Record<string, unknown> & {
    role?: string;
  };

  // ── Specialist Sub-Agent Routing ──
  const { isSpecialistRoutingEnabled } = await import("@/lib/ai/agents/types");
  if (isSpecialistRoutingEnabled()) {
    const mappedMessages = messages.map(m => {
      const msg = m as any;
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (msg.parts && Array.isArray(msg.parts)) {
        content = msg.parts
          .map((p: any) => (p && typeof p.text === "string" ? p.text : ""))
          .filter(Boolean)
          .join(" ");
      }
      const role = (msg.role === "user" || msg.role === "assistant" || msg.role === "system")
        ? (msg.role as "user" | "assistant" | "system")
        : ("user" as const);
      return { role, content };
    }).filter(m => m.content.length > 0);

    const { routeMessage } = await import("@/lib/ai/agents/router");
    const decision = await routeMessage({ messages: mappedMessages });
    
    if (decision.route === "marketing-director") {
      log.info("specialist_routing_match", { route: decision.route, reason: decision.reason });
      const { runMarketingDirector } = await import("@/lib/ai/agents/specialists/marketing-director");
      const specResult = await runMarketingDirector({ messages: mappedMessages });
      
      if (specResult.handBack) {
        log.info("specialist_handback", { route: decision.route, reason: specResult.reason });
      } else {
        const { persistUserTurn } = await import("@/lib/services/chat/persist-user-turn");
        const resolvedConvId = await persistUserTurn({
          convId,
          lastUserMsg,
          userContent,
          log,
          recordError,
        });

        const { buildFastStream } = await import("@/lib/ai/chat/handlers/shared");
        return buildFastStream(
          resolvedConvId,
          specResult.content,
          "specialist_marketing",
          specResult.provider || "reason"
        );
      }
    }
  }

  // Apr 28 · Content-mode detection runs early so it can drive both
  // (a) provider selection — Ollama Cloud (1M context) gets promoted
  //     when content-mode fires, since the v5.0 engine inflates the
  //     system prompt past Venice's 65k limit.
  // (b) cache key — content-mode prompts get a separate slot so they
  //     don't collide with default-business prompts.
  const { detectContentIntent: _detectContentIntent } = await import("@/lib/ai/business-knowledge");
  const contentMode = _detectContentIntent(userContent);

  // ═══ NL INTERCEPTOR FAST PATH ═══
  //
  // Three deterministic intents bypass the entire model pipeline:
  // image generation, decision log, brain-dump capture. Detection +
  // handling lives in lib/ai/chat/interceptors.ts so the route here
  // is just a single call — no inline regex, no inline DB writes,
  // no inline SSE protocol building.
  //
  // Routing here at the TOP (before prefetch/embeddings) is the
  // critical bit: when Venice rate-limits embedding calls, the rest
  // of the prefetch can stall 30s+, even though "remember that I
  // decided to X" doesn't need any of that work. Fast-path returns
  // in ~200ms regardless.
  const interceptorTimer = stageTracker.start("interceptors");
  const { runInterceptors } = await import("@/lib/ai/chat/interceptors");
  const interceptResult = await runInterceptors({
    userContent,
    lastUserMsg,
    convId,
  });
  interceptorTimer.end();
  if (interceptResult.kind === "handled") {
    convId = interceptResult.convId;
    return interceptResult.response;
  }

  // ═══ HALLUCINATION PREVENTION ═══
  // Apr 28 · Strip image markdown from prior assistant turns before
  // the LLM sees the history. Without this, venice-uncensored sees
  // prior `![Generated Image](/api/images/<real-id>)` patterns,
  // pattern-matches, and emits NEW markdown with fabricated cuid IDs
  // that 404. The validator (lib/ai/image-ref-validator.ts) catches
  // ghosts on the way out, but the user still sees the broken image
  // mid-stream before the cleaned history reloads. Easier: don't show
  // the model the URL pattern at all. Replaces with `[image rendered]`
  // — preserves the semantic meaning, kills the pattern.

  // ═══ PERF: DB writes run IN PARALLEL with prompt building ═══
  // Previously we blocked on prisma.chatConversation.create +
  // prisma.chatMessage.create before the prompt building even started.
  // That added 200-800ms to every first-message request. Now the DB
  // work kicks off as a background promise that we await alongside
  // the prompt pipeline below.
  //
  // If DB writes fail we set convId to "temp" and continue — the chat
  // works even if persistence is down. Errors are captured via
  // recordError so we can see DB rot in the HUD.
  // May 02 · chat-route extract chunk 1 · the user-turn write path moved
  // verbatim to lib/services/chat/persist-user-turn.ts. Behavior
  // preserved exactly (idempotency check, full v7.6 field set, fire-
  // and-forget importance + task-completion detector). The route just
  // kicks the promise off and lets it run in parallel with prompt
  // assembly below — same shape as before.
  const { persistUserTurn } = await import("@/lib/services/chat/persist-user-turn");
  const dbWritePromise: Promise<string> = persistUserTurn({
    convId,
    lastUserMsg,
    userContent,
    log,
    recordError,
  });

  const { provider, modelId } = getActiveProviderInfo();
  const startedAt = Date.now();
  // v10 E.5 · agent-trace contract — mint a traceId at the top of the
  // chat turn so every downstream call (auto-rename, distillation,
  // tool invocations) can chain to it via parentId. Without a traceId
  // the operator dashboard can't answer "what did Nick do this turn".
  const { mintTraceId, recordTrace } = await import("@/lib/ai/agent-trace");
  const __traceId = mintTraceId();
  // v7.6 · Apr 29 · ChatMessage Batch A · C2 — first-token latency
  // (TTFT). Captured on the first onChunk fire; used as a perceived-
  // quality metric. `let` so onChunk can mutate it once.
  // May 02 · firstTokenAt switched from `let` to a shared ref so onChunk
  // (mutator) and the soon-to-be-extracted onFinish (reader) share the
  // same reference across module boundaries.
  const __firstTokenRef = { value: null as number | null };
  // v10.0.20 · mid-stream graceful degradation. Accumulate the streamed
  // text server-side so onError can persist the actual partial reply
  // (not just an error stub). Pre-v10.0.20 onError logged
  // "partial-len=0" always because the partial wasn't tracked here.
  // May 02 · partial-text accumulator switched from a `let string`
  // to a shared ref so the extracted stream-error-handler (and the
  // soon-to-be-extracted onFinish) can read AND write through the
  // same object reference.
  const __partialRef = { text: "" };
  let recalledHits: any[] = [];
  let detectedContradictions: any[] = [];
  // Validate the per-request provider override against the runtime list
  // (rejects retired `venice` + anything unsupported). A valid value is
  // honored at the getModel call below — UNLESS a tool-mandatory force
  // (python-execute / action intent) is active, which must win for
  // tool_choice correctness. See the getModel call site.
  const validatedProviderOverride = isRuntimeProvider(providerOverride)
    ? providerOverride
    : undefined;
  if (providerOverride && !validatedProviderOverride) {
    log.warn("provider_override_rejected", { requested: providerOverride });
  }

  // ═══ PERF: Chat mode detection (with overrides) ═══
  // Three-layer priority for mode:
  //   1. Per-request override from the chat control bar (client body)
  //   2. Global default from the AI config (Settings page)
  //   3. Automatic detection via detectChatMode
  const aiConfig = await getAiConfig().catch((): null => null);
  const { classifyIntent } = await import("@/lib/ai/runtime/intent-router");
  const classification = await classifyIntent(userContent, __traceId);
  const mode: ChatMode =
    modeOverride ||
    aiConfig?.defaultMode ||
    (classification.mode === "engineer" || classification.mode === "operator" ? "deep" : "standard");
  const t0 = Date.now();

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
  // the maxOutputTokens cap below). Pure function, no I/O. ═══
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

  // v10.0.208 · daily-budget gate. budget.ts is server-only, so we
  // dynamic-import it here to avoid pulling prisma into any client
  // bundle that transitively touches this route module. The gate
  // reads UserPreference("ai.dailyBudgetCents", default 500¢) and
  // sums today's AiGeneration costCents, cached 60s in-process. When
  // today's spend has crossed the cap we return a 402 JSON so the
  // chat UI can render the message inline instead of dying mid-stream.
  const { assertWithinBudget } = await import("@/lib/ai/budget");
  const budget = await assertWithinBudget().catch(() => null);
  if (budget && !budget.ok) {
    log.warn("budget_exceeded", {
      spentCents: budget.status.spent,
      limitCents: budget.status.limit,
      taskType: finalTaskType,
    });
    return Response.json(
      {
        error: `Daily AI budget reached ($${(budget.status.spent / 100).toFixed(2)} of $${(budget.status.limit / 100).toFixed(2)}). Raise the cap in Settings → AI to keep going.`,
        budgetExceeded: true,
        spent: budget.status.spent,
        limit: budget.status.limit,
      },
      { status: 402 },
    );
  }

  // v10.0.521 · Python-execute intent detection ALSO drives the
  // provider pick. Venice-uncensored has documented loose tool_choice
  // adherence (v10.0.520 set { type:"tool", toolName:"runPython" }
  // and the smoke test still showed TOOLS=0 · model wrote code text
  // instead of calling). Anthropic + OpenAI honor strict tool_choice.
  // Route python-execute intent through Anthropic to guarantee the
  // tool actually fires.
  const __pythonExecuteIntent =
    /\b(run|execute|invoke)\s+(?:this\s+)?python\b|\bpython\s+(?:to\s+|and\s+)?(?:compute|calculate|run|execute)\b|\buse\s+(?:the\s+)?runPython\b|\brun\s+(?:this\s+)?code\b/i.test(
      userContent,
    );

  // v-truth · Generic action intent ("add this task", "remember this",
  // "send the email") ALSO drives the provider pick. toolChoice:
  // "required" is set below for these turns, but forcing only EXECUTES
  // on a provider that honors strict tool_choice. Ollama qwen3 does
  // (and is the live primary · provider.ts PROVIDERS[0]); Venice strips
  // tool_choice, so a forced action landing on the Venice fallback gets
  // narrated, never run. Mirror the python pattern so a genuine action
  // routes to the lane that actually fires the tool. Hoisted here (was
  // recomputed inline in the streamText config) so it's detected ONCE
  // and reused for both the provider force and toolChoice below.
  // Degrades safely: if Ollama is unavailable, getModel falls through.
  const __actionIntent = __pythonExecuteIntent
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

  let model: ReturnType<typeof getModel>;
  let effectiveForce: ProviderName | undefined = undefined;
  try {
    // Apr 28 · Tag-team Venice + Ollama Cloud. When the prompt is in
    // content-mode (heavy v5.0 engine, ~70-100kc), prefer Ollama's
    // 1M-context models so we don't truncate at Venice's 65k limit.
    // Otherwise Venice keeps the top spot for fast TTFT.
    //
    // v10.0.521 · For python-execute turns, force Anthropic FIRST so
    // tool_choice forcing actually fires.
    //
    // v10.0.522 · Switched to "openai" because Anthropic wasn't
    // configured · gpt-4o-mini honors strict tool_choice.
    //
    // v10.0.523 · Operator's preferred path: Ollama Cloud Pro
    // (qwen3-vl:235b-instruct). OLLAMA_API_KEY was set on Vercel
    // this push, so the override now lands on ollama for python-
    // execute turns. Strict tool_choice + qwen3 = tool fires
    // reliably + free tier covers our usage + 1M context window.
    // Precedence: (1) tool-mandatory force (python-execute / action intent)
    // pins a text-reliable provider (gemini or anthropic for high-stakes) for strict tool_choice — ALWAYS wins;
    // (2) a validated per-request user override; (3) default task ordering.
    // toolMandatoryForce is forced when an intent is active, so `??` can never let the user override clobber the tool force.
    // Do NOT replace `??` with a naive merge.
    const HIGH_STAKES_MUTATIONS = new Set([
      "person.create",
      "person.delete",
      "person.remove",
      "gmail.sendDraft",
      "gmail.createDraft",
      "google.proposeEvent",
      "telegram.send",
      "shop.sendSms",
      "shop.updateLead"
    ]);

    const isHighStakesMutation =
      __actionIntent && HIGH_STAKES_MUTATIONS.has(__actionIntent.expectedTool || "");

    const toolMandatoryForce =
      __pythonExecuteIntent || __actionIntent
        ? isHighStakesMutation
          ? ("anthropic" as const)
          : ("gemini" as const)
        : undefined;

    effectiveForce = toolMandatoryForce ?? validatedProviderOverride;
    model = getModel(finalTaskType, {
      preferLargeContext: finalPreferLargeContext,
      ...(effectiveForce ? { forceProviderFirst: effectiveForce } : {}),
    });
    if (toolMandatoryForce) {
      log.info("tool_provider_override", {
        forced: toolMandatoryForce,
        reason: __pythonExecuteIntent ? "python_execute" : "action_intent",
        highStakes: isHighStakesMutation,
      });
    } else if (validatedProviderOverride) {
      log.info("user_provider_override", { forced: validatedProviderOverride });
    }
  } catch (err) {
    recordError("chat:request", err, { reason: "no_provider" });
    return Response.json(
      { error: "Nick AI is not available right now. No AI provider configured. Set OLLAMA_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY." },
      { status: 503 }
    );
  }

  // ═══ PARALLEL PREFETCH ═══
  // Instead of serializing system prompt → cross-session → contextual
  // recall → predictive prefetch → conversation compression, run
  // ALL of them at once with Promise.all. Total wall-clock time
  // becomes max(each_task) instead of sum(each_task). Shaves 1-3s
  // off standard + deep mode.
  //
  // Quick mode skips cross-session + contextual recall + prefetch
  // entirely to keep first-token latency under 3s for greetings and
  // one-off questions.

  type PromptFetchResult = { systemPrompt: string; fromCache: boolean };

  // ── Query-adaptive engine loading ──
  // Detect the topic tier from the user's message so the system prompt
  // only loads the engines relevant to this conversation. Cuts context
  // by ~60% on casual messages, improving response focus.
  const topicTier = detectTopicTier(userContent);
  // contentMode was detected at the top of the request (drives provider
  // selection too). Logged here for debugging the cache key.
  log.info("topic_tier_detected", {
    tier: topicTier,
    contentMode,
    msgPreview: userContent.slice(0, 40),
  });

  // Cache lookup MUST happen after topic-tier detection — Apr 26 the
  // key was broadened to include tier so we don't silently serve a
  // "full" prompt to a "core" tier turn (which would defeat the
  // engine-pruning that makes casual greetings fast).
  const cachedPrompt = getCachedPrompt(provider, topicTier, contentMode);

  // ═══ Single prompt path (Apr 17 — quick mode removed) ═══
  // Both standard and deep use the full tier-based system prompt from
  // buildSystemPrompt(). Short casual greetings ("hi", "thanks") are
  // kept fast by:
  //   - Prompt cache: first request builds the 50K prompt; subsequent
  //     requests hit the in-memory cache → ~0ms prompt step
  //   - Query-shape detector: routes yes_no/casual queries to a tiny
  //     token budget (80-150) instead of 1200
  //   - Venice prompt_cache_key: Venice serverside caches the 50K block
  //     for 24h so re-ingestion cost is amortized across sessions
  // If the build fails, we degrade to a minimal identity prompt so the
  // chat still works — just without grounded context.
  const promptPromise: Promise<PromptFetchResult> = cachedPrompt
    ? Promise.resolve({ systemPrompt: cachedPrompt, fromCache: true })
    : buildSystemPrompt(topicTier, userContent, convId)
        .then((p) => {
          setCachedPrompt(provider, topicTier, p, contentMode);
          return { systemPrompt: p, fromCache: false };
        })
        .catch((err): PromptFetchResult => {
          log.error("build_system_prompt_failed", { err: sanitizeError(err) });
          return {
            systemPrompt: `You are Nick, Nour's Chief of Staff AI. Today is ${new Date().toISOString().slice(0, 10)}. The full system prompt failed to load — answer based on general knowledge. Be concise and helpful.`,
            fromCache: false,
          };
        });

  // Cross-session threading + contextual recall + predictive prefetch
  // run for all non-trivial messages. Under-10-char greetings ("hi",
  // "thanks") skip to keep them snappy.
  //
  // v10.0.529.86 · Wave 30 · B1 fix · short command intents like
  //   "snooze it", "do that", "pin this", "yes go ahead" are EXACTLY
  //   the turns where brain recall + memory of recent context matter
  //   most. Force the recall pipeline when the message reads as a
  //   command pronoun even when it's ≤ 10 chars.
  const COMMAND_INTENT_PATTERN =
    /\b(snooze|archive|pin|complete|done|do (it|that|this)|go ahead|yes|reframe|update|move|log|drop|archive|delete)\b/i;
  const forceRecall = COMMAND_INTENT_PATTERN.test(userContent);

  // Conversation compression runs in parallel too — compress old
  // messages into a summary block if the history has grown past the
  // threshold. For short conversations this is a no-op.
  //
  // Apr 19 · Hard 4s timeout. If Venice doesn't summarize in time
  // we fall through to uncompressed — the model can handle the full
  // recent history within its context window, and the stream opens
  // without a 30s block that trips "Nick is stuck".
  const fallbackCompression = () => ({
    compressed: false,
    messages: messages.map((m: Record<string, unknown>) => ({
      role: m.role as string,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
    })),
    summary: null as string | null,
    compressedCount: 0,
  });
  const compressPromise = Promise.race([
    compressConversation(messages, convId).catch((err) => {
      recordError("chat:compression", err);
      return fallbackCompression();
    }),
    new Promise<ReturnType<typeof fallbackCompression>>((resolve) =>
      setTimeout(() => resolve(fallbackCompression()), 4000),
    ),
  ]);

  // ═══ SEMANTIC TOOL PRUNING (item 9) ═══
  // Kick off two things in parallel with everything else above:
  //   1. warmToolEmbeddings — embeds all 149 tool descriptions once
  //      per lambda instance. First request after cold start takes
  //      ~3-5s; subsequent requests return immediately.
  //   2. embedUserMessage — embeds the current user message so we
  //      can rank tools by cosine similarity against the cache.
  // Both are best-effort: on failure we fall back to the keyword
  // pruning path in chat-mode.ts.
  {
    // Fire-and-forget warm-up — doesn't block this request but the
    // next one benefits if this one was a cold start.
    warmToolEmbeddings().catch((err) =>
      recordError("ai:embedding", err, { stage: "warm" })
    );
  }
  const userEmbeddingPromise: Promise<number[]> =
    userContent.length > 10
      ? embedUserMessage(userContent).catch((): number[] => [])
      : Promise.resolve([]);



  // 2026-07-05 improvement · fold buildContextHints + buildBrainContext INTO
  // the parallel batch instead of running them serially AFTER it. Both only
  // APPEND to systemPrompt (neither reads it or the other's output — verified),
  // and both are guaranteed non-throwing (buildContextHints returns "" on
  // failure; buildBrainContext's top-level try/catch always falls through to a
  // valid object), so neither can reject the batch. buildContextHints depends
  // only on request-scoped ids → starts immediately; buildBrainContext needs
  // userEmbedding + convId → chained on those two so its ~recall latency
  // OVERLAPS the system-prompt build rather than being paid serially after it
  // (the dominant TTFT cost on warm turns — was ~6s of pure blocking). Append
  // order is preserved exactly below (context hints, then brain addendum).
  const contextHintsPromise = import("./context-hints").then((m) =>
    m.buildContextHints({
      messageCount: messages.length,
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
    }),
  );
  const brainCtxPromise = Promise.all([userEmbeddingPromise, dbWritePromise]).then(
    ([ue, cid]) =>
      import("@/lib/services/chat/brain-context").then((m) =>
        m.buildBrainContext({
          userContent,
          mode,
          userEmbedding: ue,
          forceRecall,
          messages: messages as Array<{ role: string; content: string }>,
          convId: cid,
          log,
        }),
      ),
  );

  // Await the parallel work — max of the pipelines. (DB write + user
  // embedding + context-hints + brain recall are folded in so their latency
  // is hidden inside the max.)
  const [
    { systemPrompt: rawSystemPrompt, fromCache },
    compression,
    resolvedConvId,
    userEmbedding,
    contextHintsBlock,
    brainCtx,
  ] = await Promise.all([
    promptPromise,
    compressPromise,
    dbWritePromise,
    userEmbeddingPromise,
    contextHintsPromise,
    brainCtxPromise,
  ]);
  convId = resolvedConvId;

  log.info("prompt_built", {
    cacheHit: fromCache,
    buildMs: fromCache ? null : Date.now() - t0,
    compressed: compression.compressed ? compression.compressedCount : null,
    mode,
    modeForced: !!modeOverride,
    taskType: taskTypeForMode,
    semantic: isToolEmbeddingCacheWarm() && userEmbedding.length > 0,
  });

  // Append order preserved: raw prompt → context hints → brain addendum.
  let systemPrompt = rawSystemPrompt + contextHintsBlock + brainCtx.systemPromptAddendum;
  const contextBlocksFired = brainCtx.contextBlocksFired;
  const deeperContextCount = brainCtx.deeperContextCount;
  const deeperContextTypes = brainCtx.deeperContextTypes;
  
  if (brainCtx.recalledHits) recalledHits = brainCtx.recalledHits;
  if (brainCtx.detectedContradictions) detectedContradictions = brainCtx.detectedContradictions;

  // chat-route extract (2026-05-31) · the system-prompt finalization
  // block (per-provider truncation, Greene-law load, personality
  // injection, turn-aware CoT/shape scaffolds, citation protocol, Nour
  // voice guardrails, brevity enforcement, forbidden-phrases guard,
  // tool-first directive) moved verbatim to
  // app/api/ai/chat/finalize-system-prompt.ts. Same ordering, same
  // gating, same I/O (the Greene-law DB read). Returns the finalized
  // prompt + greeneSummary + law count for the Anthropic chat-layer
  // prompt below.
  const { finalizeSystemPrompt } = await import("./finalize-system-prompt");
  const __finalized = await finalizeSystemPrompt({
    systemPrompt,
    provider,
    personality,
    userContent,
    turnSignal,
    contextBlocksFired,
    mode,
    queryShape,
    contract: responseContract,
    log,
  });
  systemPrompt = __finalized.systemPrompt;
  const greeneSummary = __finalized.greeneSummary;
  const strategicLawCount = __finalized.strategicLawCount;

  let result;
  let resolveOnFinish: () => void = () => {};
  let onFinishPromise: Promise<void> = Promise.resolve();
  try {
  // For Ollama/Gemini (small context), use just the truncated system prompt — it already has Nick's identity
  // For Anthropic (large context), append the full chat-layer identity + Greene laws
  const chatLayerPrompt = (provider === "ollama" || provider === "gemini") ? systemPrompt : `${systemPrompt}

# NICK — Chief of Staff, NOUR OS (Chat Layer)

${greeneSummary ? `## Greene Strategic Law Library (${strategicLawCount} laws loaded)
When analyzing patterns, decisions, or strategy, reference specific laws by [BOOK #NUMBER] format.
For business situations, apply the shopApplication. For personal situations, apply the nourApplication.
Be specific: not "consider Law 28" but "Law 28 (Enter Action with Boldness) — your 3 pending estimates need follow-up calls TODAY."

### Law Index:
${greeneSummary}` : ""}

## Business naming conventions
- **Auto Labor Guide** = the CRM at nickstire.org/admin (leads, estimates, invoices, scheduling, callbacks). Always call it by name.
- **Revenue pipeline**: Google Ads/walk-ins/calls → Auto Labor Guide estimates → invoices → revenue. #1 leak = unfollowed estimates.

## Action engine
${ACTION_CATALOG}

Reference Greene Laws ONLY on strategic decisions, not casual messages.`;



  // NL interceptors moved to the top of the POST handler — see the
  // "NL INTERCEPTOR FAST PATH" block above. By the time we get here
  // we're in the normal streamText path and the message is NOT an
  // image/decision/brain-dump intent.
  //
  // v6 · BATCH 3 · Apr 28 — Multi-output mode addendum.
  // Detect /all, /ab, /reformat, /twopass, /carousel slash commands and
  // append the matching shape template to the system prompt. The model
  // still produces a single stream, but it's structured so the chat
  // surface can render multiple cards from one response.
  const { detectMultiMode, buildMultiPromptAddendum } = await import("@/lib/ai/content-multi");
  const multiCtx = detectMultiMode(userContent);
  const multiAddendum = multiCtx ? buildMultiPromptAddendum(multiCtx) : "";
  let finalSystemPrompt = multiAddendum
    ? `${chatLayerPrompt}\n\n${multiAddendum}`
    : chatLayerPrompt;
  if (multiCtx) {
    log.info("multi_output_mode", { mode: multiCtx.mode, subject: multiCtx.subject.slice(0, 60) });
  }

  // AG-15 · content-feedback RECALL. detectContentFeedback has CAPTURED
  // Nour's reactions to generated content since Apr 28 (persist-assistant-
  // turn.ts), but the read half — recallRecentContentFeedback +
  // buildFeedbackPromptBlock — had zero call-sites: the "compounding
  // voice" loop was write-only. On content turns, his recent reactions
  // now ride into the prompt.
  if (contentMode) {
    try {
      const { recallRecentContentFeedback, buildFeedbackPromptBlock } = await import(
        "@/lib/ai/content-feedback"
      );
      const feedbackBlock = buildFeedbackPromptBlock(await recallRecentContentFeedback());
      if (feedbackBlock) {
        finalSystemPrompt += `\n\n${feedbackBlock}`;
        log.info("content_feedback_recalled", { chars: feedbackBlock.length });
      }
    } catch {
      // Supplementary voice context — never blocks the stream.
    }
  }

  // v10.0.499 · ADR-0011 Tier 2-lite · high-specificity gate.
  //
  // When NICK_HIGH_SPEC_GATE=on (env flag · default off · reversible),
  // factual/decision/instructional/procedural/analytical turns get a
  // preemptive specificity directive prepended to the system prompt.
  // This is the smaller-cost version of Tier 2 · no probe call, no
  // regen, no double LLM cost · just a harder prompt on the turns
  // that need specifics most.
  //
  // If the chat-quality dashboard shows spec axis rising from 50 →
  // 65+ over a 7-day window with this enabled, the full Tier 2
  // (with auto-regen winner-selection) is unnecessary. If it doesn't
  // move the needle · the full path with UI-stream-compat is
  // justified.
  //
  // Skill stance: prompt-engineering + error-handling-patterns +
  // kaizen (smallest reversible change that tests the hypothesis).
  if (process.env.NICK_HIGH_SPEC_GATE === "on") {
    const { shouldGateForIntent, REGEN_SYSTEM_PREFIX } = await import(
      "@/lib/ai/chat/pre-stream-regen"
    );
    const intent = turnSignal.intent as Parameters<typeof shouldGateForIntent>[0];
    if (shouldGateForIntent(intent)) {
      // Append the hard directive so the static system prompt prefix remains cached.
      finalSystemPrompt = `${finalSystemPrompt}\n\n${REGEN_SYSTEM_PREFIX}`;
      log.info("high_spec_gate_active", {
        intent,
        addedChars: REGEN_SYSTEM_PREFIX.length,
      });
    }
  }

  // v10.0.503 · ADR-0011 Tier 3 surfacing fix · customer-shape hint.
  // Even with the findCustomer tool registered, the model would
  // sometimes hallucinate customer details rather than calling the
  // tool · the description-clarity gap diagnosed at v10.0.494. This
  // detector recognizes customer-shaped user content (10-digit phone,
  // name patterns, ownership phrasing) and INJECTS a hard hint to
  // call findCustomer first.
  //
  // The detector is cheap (regex · zero AI cost · <1ms) and the hint
  // only fires on matches · non-customer turns stay unchanged.
  // Always-on (no env flag) because the cost of a wrong fabrication
  // is much higher than the cost of an extra tool call.
  //
  // Detector + hard-hint assembly moved verbatim to
  // app/api/ai/chat/customer-shape-hint.ts. The route just appends the
  // returned block; behavior is byte-identical.
  const userTextSlice = userContent.slice(0, 1500);
  const { buildCustomerShapeHint } = await import("./customer-shape-hint");
  const customerHint = buildCustomerShapeHint(userTextSlice);
  if (customerHint) finalSystemPrompt = finalSystemPrompt + "\n\n" + customerHint;

  // v10.0.511 · GSC pre-fetch + inject · the 2026-05-12 smoke tests
  // showed venice-uncensored consistently ignores the tool-call-first
  // directive on SEO queries even when getGscSummary is in the toolset
  // (post v10.0.510 pruner expansion). The model invents narratives
  // about "Google logging errors" instead of calling the tool.
  //
  // This pre-fetch bypasses the model's tool-call decision entirely:
  // when SEO/GSC regex matches the user content, we call queryNick
  // ourselves BEFORE streamText runs and inject the JSON result as a
  // system-prompt addendum. The model has the real numbers in its
  // context · fabrication becomes structurally impossible.
  //
  // If the call fails or returns no data, we inject a "NO DATA AVAILABLE"
  // block so the model says that instead of fabricating.
  //
  // Cost: 1 extra bridge call per matching turn (~200-500ms). Latency
  // hit is acceptable for the failure-mode it eliminates.
  //
  // Regex + bridge call + all 3 branches moved verbatim to
  // app/api/ai/chat/gsc-prefetch.ts. The route just appends the
  // returned block; behavior is byte-identical.
  const { buildGscPrefetch } = await import("./gsc-prefetch");
  const gscBlock = await buildGscPrefetch(userTextSlice);
  if (gscBlock) finalSystemPrompt = finalSystemPrompt + "\n\n" + gscBlock;

  // Venice params (web search, scraping, no safety prompt, think strip) are injected
  // via custom fetch wrapper in provider.ts — NOT providerOptions (AI SDK ignores custom fields).

  // ═══ PERF: Prune tools by mode ═══
  // Quick mode → zero tools. Standard → ~15-30 relevant. Deep → all 159.
  // Cuts Venice first-token latency from 10-30s → 2-5s for conversational
  // messages without removing any capability from data-heavy queries.
  let prunedTools = (await pruneTools(
    mode,
    nourTools as unknown as Record<string, unknown>,
    userContent,
    userEmbedding
  )) as typeof nourTools;

  // Apply the AI config's tool blocklist (#13). Tools in
  // ai_config.disabledTools are NEVER loaded regardless of mode —
  // used for disabling broken or unused tools without editing
  // nourTools.
  if (aiConfig?.disabledTools && aiConfig.disabledTools.length > 0) {
    const filtered = { ...prunedTools } as Record<string, unknown>;
    for (const blocked of aiConfig.disabledTools) {
      delete filtered[blocked];
    }
    prunedTools = filtered as unknown as typeof nourTools;
  }
  // Force the always-on tools to be included even when pruning would
  // have dropped them (quick mode, for example).
  if (aiConfig?.alwaysOnTools && aiConfig.alwaysOnTools.length > 0) {
    const forced = { ...prunedTools } as Record<string, unknown>;
    const all = nourTools as unknown as Record<string, unknown>;
    for (const name of aiConfig.alwaysOnTools) {
      if (all[name] && !forced[name]) forced[name] = all[name];
    }
    prunedTools = forced as unknown as typeof nourTools;
  }
  // 2026-07-06 bug fix · force the ACTION-INTENT's expected tool into the
  // pruned set. pruneTools attaches read-only CORE_TOOLS + keyword/semantic
  // families, but a keyword-less action turn ("add it", "do it") with a cold
  // embedding cache drops the write tool (e.g. createTask). The
  // toolChoice:"required" force below (action_intent_detected) then makes the
  // model act with ONLY read-only tools — so it fabricates "done" or admits
  // the tool is unavailable. Guarantee the expected tool is present so the
  // force is coherent. Respects the disabledTools blocklist above (never
  // re-add a tool the operator deliberately disabled). expectedTool may be a
  // "toolA|toolB" alternation (action-claim-detector), so split on "|".
  if (__actionIntent?.expectedTool) {
    const all = nourTools as unknown as Record<string, unknown>;
    const disabled = new Set(aiConfig?.disabledTools ?? []);
    const forced = { ...prunedTools } as Record<string, unknown>;
    for (const raw of __actionIntent.expectedTool.split("|")) {
      const name = raw.trim();
      if (all[name] && !forced[name] && !disabled.has(name)) forced[name] = all[name];
    }
    prunedTools = forced as unknown as typeof nourTools;
  }

  const toolCountAll = Object.keys(nourTools).length;
  const toolCountPruned = Object.keys(prunedTools).length;
  log.info("mode_description", {
    description: describeMode(mode, toolCountAll, toolCountPruned),
    promptChars: finalSystemPrompt.length,
  });

  // maxOutputTokens derived from mode default + query shape. queryShape
  // was detected earlier so the tool-first directive could also read it.
  // Standard mode uses 1200 default; query-shape drops it to 80-150 for
  // yes/no + casual, 700 for explain, 1600 for plan — making it feel
  // as fast as the old quick mode when the query calls for brevity.
  const modeDefaultTokens = mode === "deep" ? 4000 : 1200;
  const maxOutputTokens = queryShape.tokenBudget > 0
    ? queryShape.tokenBudget
    : modeDefaultTokens;
  log.info("query_shape", {
    shape: queryShape.shape,
    maxOutputTokens,
    modeDefaultTokens,
    toolFirst: queryShape.needsTool ? queryShape.factualHints : null,
  });

  // chat-route extract (2026-05-31) · the model-message preparation
  // (compression branch + convertToModelMessages with the v10.0.185
  // media-type fallback mapper + the v10.0.529.58 item_reference
  // sanitizer) moved verbatim to app/api/ai/chat/build-model-messages.ts.
  // Pure transform — same compression gate, same fallback, same
  // whitelist. Returns the sanitized array; the streamText call site
  // below casts it to the AI-SDK messages shape (unchanged).
  const { buildModelMessages } = await import("./build-model-messages");
  const sanitizedModelMessages = await buildModelMessages({
    compression,
    messages,
    log,
  });

  // ═══ v-truth · PRE-STREAM ALTERNATE PATHS (flag-gated · DEFAULT OFF) ═══
  // Two opt-in paths that generate the FULL reply up front, then ship it as a
  // simulated stream and persist via the SAME buildOnFinish pipeline (so
  // history/importance/action-parse all keep working):
  //   · NICK_DEEP_REASONING — hard turns (complex + decision/analytical) go
  //     through the decompose->plan->critique->refine reasoning engine.
  //   · NICK_VERIFIED_REGEN — factual/decision turns get a critic-gated
  //     best-of-2 (maybePreStreamRegen) before shipping.
  // SAFETY: strict env+turnSignal gate; the entire block is wrapped in
  // try/catch — on ANY error (or both flags off) it falls through to the
  // untouched streamText path below. Operator runtime-verifies by flipping the
  // flag on Railway (rollback = delete the env var). Flag-off = zero change.
  const __deepReasonFlag = getFlag("NICK_DEEP_REASONING")?.isOn ?? false;
  const __verifiedRegenFlag = getFlag("NICK_VERIFIED_REGEN")?.isOn ?? false;
  const __selfConsistencyFlag = getFlag("NICK_SELF_CONSISTENCY")?.isOn ?? false;
  const __multiAgentAutoFlag = getFlag("NICK_MULTI_AGENT_AUTO")?.isOn ?? false;
  if (
    __deepReasonFlag ||
    __verifiedRegenFlag ||
    __selfConsistencyFlag ||
    __multiAgentAutoFlag
  ) {
    try {
      const { shouldGateForIntent, maybePreStreamRegen } = await import(
        "@/lib/ai/chat/pre-stream-regen"
      );
      const { isMultiPartQuestion } = await import(
        "@/lib/ai/chat/multi-agent-detect"
      );
      // Mutually-exclusive gates · priority multi-agent > deep > regen > self-consistency.
      const multiAgentOn =
        __multiAgentAutoFlag && isMultiPartQuestion(userContent);
      const deepOn =
        !multiAgentOn &&
        __deepReasonFlag &&
        turnSignal.complexity === "complex" &&
        (turnSignal.intent === "decision" || turnSignal.intent === "analytical");
      const regenOn =
        !multiAgentOn &&
        !deepOn &&
        __verifiedRegenFlag &&
        shouldGateForIntent(
          turnSignal.intent as Parameters<typeof shouldGateForIntent>[0],
        );
      const selfConsistencyOn =
        !multiAgentOn &&
        !deepOn &&
        !regenOn &&
        __selfConsistencyFlag &&
        (turnSignal.intent === "factual" ||
          turnSignal.intent === "decision" ||
          turnSignal.intent === "analytical");

      // v10.0.534 · action requests must NEVER route to a reasoning path —
      // the deepOn branch CANNOT call tools (it pre-fetches a snapshot and
      // reasons over it), so an action like "sync my calendar" got NARRATED
      // ("Calendar sync complete") instead of actually calling syncCalendar.
      // A live agent_traces test (2026-07-06) proved it: the sync turn ran
      // deep → tool_calls=0, toolsCalled=[]. When detectActionIntent fires
      // (incl. python-execute), suppress ALL reasoning gates so the turn
      // falls through to the normal tool-FORCING streamText path below, where
      // toolChoice:"required" makes the model call the real tool.
      if (!__actionIntent && (deepOn || regenOn || selfConsistencyOn || multiAgentOn)) {
        let winner = "";
        // Shared generateText config for the regen + self-consistency
        // branches (identical shape) — hoisted so a new field is added
        // once, not in two places that could silently disagree.
        const genBase = {
          model,
          messages: sanitizedModelMessages as never,
          tools: prunedTools as never,
          stopWhen: stepCountIs(mode === "deep" ? 5 : 3),
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
        };

        if (multiAgentOn) {
          const { runAutoDecompose } = await import(
            "@/lib/ai/chat/multi-agent-detect"
          );
          winner = await runAutoDecompose(
            userContent,
            finalSystemPrompt.slice(0, 8000),
          );
          log.info("multi_agent_auto_path", { intent: turnSignal.intent });
        } else if (deepOn) {
          // v-truth · LIVE-DATA ACCESS for deep reasoning. The reasoning
          // engine can't call tools, so it would otherwise reason blind to
          // current numbers. Pre-fetch a compact real-business snapshot and
          // prepend it to the reasoning context so it works from real data,
          // not invented figures. Best-effort: skip on failure.
          let liveSnapshot = "";
          try {
            const { getDashboardSummary } = await import(
              "@/lib/services/business-intel"
            );
            const snap = await getDashboardSummary();
            liveSnapshot =
              `## LIVE DATA SNAPSHOT (real, as of this turn — reason from THESE numbers; do NOT invent figures)\n` +
              `${JSON.stringify(snap)}\n(snapshot captured ${new Date().toISOString()} — most figures are live, but review counts are cron-cached; call getReviewStats before quoting an exact review number)\n\n`;
          } catch {
            /* snapshot is best-effort — proceed without it */
          }

          const __altPersist = buildOnFinish({
            log,
            convId,
            conversationId,
            provider,
            modelId,
            model,
            mode,
            modeOverride,
            personality,
            contentMode,
            finalSystemPrompt,
            systemPrompt,
            finalTaskType,
            userContent,
            turnSignal,
            contextBlocksFired,
            deeperContextCount,
            deeperContextTypes,
            startedAt,
            firstTokenRef: __firstTokenRef,
            traceId: __traceId,
            recordTrace,
            messages,
            topicTier,
          });

          // 2026-07-05 audit HIGH · cost-safety cap. The chat deep path passed
          // the reasoning engine NO explicit tier, so its internal classifier
          // could land on 'mega' (~$0.20, fire-all-5) on natural phrasing — with
          // none of the confirmExpensive + reserveBudget gates that /reason
          // (reason/stream/route.ts) and the nick tRPC router enforce for mega.
          // The chat surface is interactive iOS-PWA (no window.confirm), so we
          // cap the auto-classified tier to 'deep' when the base classifier
          // returns 'mega' instead of forcing a confirm round-trip. The engine's
          // tuner only DEMOTES (never promotes), so a non-mega base can never
          // escalate to mega — leaving request.tier undefined for those turns
          // preserves the normal internal classify + tune behavior exactly.
          let deepTier: "deep" | undefined;
          try {
            const { classifyReasoning } = await import(
              "@/lib/ai/reasoning/classifier"
            );
            if (classifyReasoning(userContent).tier === "mega") {
              deepTier = "deep";
              log.info("deep_reasoning_mega_capped", { intent: turnSignal.intent });
            }
          } catch {
            /* classifier best-effort — fall through to engine auto-classify */
          }

          const { simulateReasoningStream } = await import(
            "@/lib/ai/chat/simulate-stream-from-text"
          );
          const { buildChatResponse } = await import(
            "@/lib/services/chat/response-shape"
          );

          const streamResponse = simulateReasoningStream({
            request: {
              question: userContent,
              brainContext: (liveSnapshot + finalSystemPrompt).slice(0, 24000),
              tier: deepTier,
            },
            chunkSize: 24,
            chunkDelayMs: 8,
            onComplete: (finalWinner) => {
              log.info("deep_reasoning_path_completed", { intent: turnSignal.intent, hadSnapshot: liveSnapshot.length > 0 });
              return __altPersist({ text: finalWinner, finishReason: "stop" });
            }
          });

          return buildChatResponse({
            streamResponse,
            convId: convId!,
            traceId: __traceId,
            mode,
            modeOverride,
            personality,
            turnSignal,
            deeperContextCount,
            deeperContextTypes,
            contextBlocksFired,
            classification,
            recalledMemories: recalledHits,
            contradictions: detectedContradictions,
            onFinishPromise: Promise.resolve(),
          });
        } else if (regenOn) {
          const { generateText } = await import("ai");
          const genOnce = async (sys: string, temp: number): Promise<string> => {
            const r = await generateText({
              ...genBase,
              system: sys,
              temperature: temp,
            } as Parameters<typeof generateText>[0]);
            return r.text;
          };
          const regen = await maybePreStreamRegen({
            intent: turnSignal.intent as Parameters<
              typeof maybePreStreamRegen
            >[0]["intent"],
            shape: turnSignal.outputShape,
            generateOnce: () => genOnce(finalSystemPrompt, turnSignal.temperature),
            regenOnce: ({ suggestedSystemPrefix }) =>
              genOnce(
                `${suggestedSystemPrefix}\n\n${finalSystemPrompt}`,
                Math.min(0.9, turnSignal.temperature + 0.1),
              ),
          });
          winner = regen.text;
          log.info("verified_regen_path", {
            regenFired: regen.regenFired,
            intent: turnSignal.intent,
          });
        } else if (selfConsistencyOn) {
          const { generateText } = await import("ai");
          const { selfConsistentAnswer } = await import(
            "@/lib/ai/chat/self-consistency"
          );
          const sc = await selfConsistentAnswer({
            samples: 3,
            generate: async () => {
              const r = await generateText({
                ...genBase,
                system: finalSystemPrompt,
                temperature: Math.min(0.9, turnSignal.temperature + 0.15),
              } as Parameters<typeof generateText>[0]);
              return r.text;
            },
          });
          winner = sc.answer;
          log.info("self_consistency_path", {
            agreed: sc.agreed,
            samples: sc.samples,
            intent: turnSignal.intent,
          });
        }

        if (winner && winner.trim().length > 0) {
          // Reuse the EXACT persist pipeline streamText would have run.
          const __altPersist = buildOnFinish({
            log,
            convId,
            conversationId,
            provider,
            modelId,
            model,
            mode,
            modeOverride,
            personality,
            contentMode,
            finalSystemPrompt,
            systemPrompt,
            finalTaskType,
            userContent,
            turnSignal,
            contextBlocksFired,
            deeperContextCount,
            deeperContextTypes,
            startedAt,
            firstTokenRef: __firstTokenRef,
            traceId: __traceId,
            recordTrace,
            messages,
            topicTier,
          });
          const { simulateStreamFromText } = await import(
            "@/lib/ai/chat/simulate-stream-from-text"
          );
          const { buildChatResponse } = await import(
            "@/lib/services/chat/response-shape"
          );
          const streamResponse = simulateStreamFromText({
            text: winner,
            chunkSize: 24,
            chunkDelayMs: 8,
            onComplete: () =>
              __altPersist({ text: winner, finishReason: "stop" }),
          });
          return buildChatResponse({
            streamResponse,
            convId: convId!,
            traceId: __traceId,
            mode,
            modeOverride,
            personality,
            turnSignal,
            deeperContextCount,
            deeperContextTypes,
            contextBlocksFired,
            classification,
            recalledMemories: recalledHits,
            contradictions: detectedContradictions,
            onFinishPromise: Promise.resolve(),
          });
        }
        // empty winner → fall through to the normal streamText path
      }
    } catch (altErr) {
      log.warn("prestream_alt_path_fallthrough", {
        error:
          altErr instanceof Error
            ? altErr.message.slice(0, 200)
            : String(altErr),
      });
      // fall through to the normal streamText path — the turn still works
    }
  }

  // v11.0 W7 strict · the AI SDK's streamText options type is extremely
  // narrow about the shape of tools + messages + onFinish combined.
  // Cast to never so the call compiles under strict null checks. The
  // runtime contract is exercised daily by every chat turn + covered
  // by live API tests.
  // ═══ PERCEIVED-LATENCY SMOOTHING ═══
  // smoothStream from AI SDK word-chunks the output and paces tokens
  // at ~10ms intervals so the client sees a smooth left-to-right
  // rendering instead of the bursty "80 chars arrive at once, 200ms
  // of silence, 80 chars arrive" pattern that providers emit when
  // the TCP pipe stalls briefly. Net: feels faster even when total
  // time is unchanged, because the first-word-visible latency drops
  // AND there's no perceived stall mid-reply. Only applied to chat
  // mode (streamText) — tool results still render as they complete.
  const { smoothStream } = await import("ai");

  // v10 B.5 · same-turn provider fallback. If streamText throws
  // synchronously (bad config, auth fail, immediate connection
  // error before any token is emitted), streamWithFallback marks
  // the provider failed and retries with the next provider in the
  // chain. v9.1.27's cross-request rotation handles the "next
  // request" case; this closes the same-turn pre-first-token gap.
  // TODO(post-v10.1): post-first-token mid-stream provider rotation.
  // Currently those errors fall through to onError + the v9.1.22
  // stub-message logic, which preserves the partial reply but doesn't
  // resume from a different provider mid-stream.
  onFinishPromise = new Promise<void>((resolve) => {
    resolveOnFinish = resolve;
  });

  const { streamWithFallback, inferProviderName } = await import("@/lib/ai/stream-with-fallback");
  const __sameTurnFallback = await streamWithFallback({
    taskType: finalTaskType,
    preferLargeContext: finalPreferLargeContext,
    forceProviderFirst: effectiveForce,
    buildConfig: (__fbModel) => {
      const fbProvider = inferProviderName(__fbModel) ?? provider;
      const fbModelId =
        typeof __fbModel === "object" && __fbModel && "modelId" in __fbModel
          ? String((__fbModel as { modelId?: unknown }).modelId)
          : modelId;

      return ({
        model: __fbModel,
        // 2026-07-06 · disable Gemini's default safety filters (per-call, via
        // providerOptions.google — the @ai-sdk/google v3 API). Ignored by
        // non-Google providers. Gemini's defaults can truncate a reply
        // mid-generation on flagged content (the likely "messages don't
        // finish" cause) and are an unwanted restriction on this owner-operated
        // OS. See GEMINI_SAFETY_OFF in lib/ai/provider.ts.
        providerOptions: { google: GEMINI_SAFETY_OFF },
        // v10.0.446 · prompt-quality audit fix #1 · cacheControl wiring.
        // When Anthropic is the active fallback provider, fold the
        // system prompt into messages with `cacheControl: ephemeral`
        // so the 8-12K-token system prompt gets the 90% Anthropic
        // prompt-cache discount. Mirrors lib/ai/provider.ts:1007-1027
        // (the aiChat path that judge + adversarial use). Venice /
        // Ollama / OpenAI keep the legacy `system: string` form —
        // Venice/Ollama have no server-side caching; OpenAI auto-
        // caches prefixes ≥1024 tokens regardless of message shape.
        ...(inferProviderName(__fbModel) === "anthropic"
          ? {
              messages: [
                {
                  role: "system" as const,
                  content: finalSystemPrompt,
                  providerOptions: {
                    anthropic: { cacheControl: { type: "ephemeral" } },
                  },
                },
                ...(sanitizedModelMessages as readonly unknown[]),
              ] as Parameters<typeof streamText>[0]["messages"],
            }
          : {
              system: finalSystemPrompt,
              // v10.0.529.58 · use sanitized messages · strips
              // item_reference parts that Ollama + Venice + OpenAI
              // chat-completions endpoints reject.
              messages: sanitizedModelMessages as Parameters<typeof streamText>[0]["messages"],
            }),
        // Tools enabled for ALL providers — Venice supports OpenAI-compatible function calling.
        // Pruned by chat-mode for speed — see lib/ai/chat-mode.ts.
        tools: prunedTools,
        // Smooth the token stream for perceived-speed. See note above.
        experimental_transform: smoothStream({ delayInMs: 10, chunking: "word" }),
        // Standard allows 3 tool-call steps; deep allows 5 for agentic
        // workflows. Keep step counts tight so a confused tool chain can't
        // blow through the whole context budget.
        stopWhen: stepCountIs(mode === "deep" ? 5 : 3),
        // Context-aware brevity cap — see block above.
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        // Apr 19 · Adaptive temperature from the turn classifier.
        // factual/procedural turns run tight (0.2-0.25), creative/emotional
        // warm (0.6-0.75), casual middle (0.5). Overrides the provider
        // default per request without touching provider config.
        temperature: turnSignal.temperature,
        // v10.0.175 · proactive tool forcing. Pre-classify the user's
        // message: if it's clearly an action request ("add this task",
        // "send the email", "schedule a follow-up"), pass toolChoice:
        // "required" to remove the option to narrate. The model must
        // call SOME tool — fabrication-by-narration becomes structurally
        // impossible. Questions ("what tasks do I have?") fall through
        // to the default `auto` so reads stay flexible.
        //
        // v10.0.520 · SPECIFIC tool forcing for python execution. The
        // 2026-05-12 Chrome smoke test showed venice-uncensored has a
        // strong training bias to WRITE python code text instead of
        // calling runPython · even with an imperative tool description.
        // When the user clearly asks to execute python, force the
        // model's hand with `toolChoice: { type: "tool", toolName:
        // "runPython" }`. This bypasses the model's discretion entirely
        // · the only choice left is what python code to pass.
        //
        // Same pattern available for any future "model declines to call
        // a tool we WANT called" case · add another regex+toolName
        // branch above the generic action-intent block.
        ...(() => {
          // Python-execute · most specific gate, checked first. Reuse the
          // hoisted `__pythonExecuteIntent` (computed once for the provider
          // force) so the detection regex lives in exactly one place — the
          // two can never drift apart on a future edit.
          if (__pythonExecuteIntent) {
            log.info("python_execute_intent_detected", { surface: "chat" });
            return {
              toolChoice: {
                type: "tool" as const,
                toolName: "runPython" as const,
              },
            };
          }

          // Reuse the hoisted detection (computed above for the provider
          // force) — one detectActionIntent call drives both the provider
          // pick AND toolChoice, so the two can never disagree.
          const intent = __actionIntent;
          if (intent) {
            log.info("action_intent_detected", {
              intent: intent.intent,
              expectedTool: intent.expectedTool,
            });
            return { toolChoice: "required" as const };
          }
          return {};
        })(),
        // v10.0.446 · `messages:` (and `system:` for non-Anthropic) are
        // now set by the conditional spread above. The Anthropic branch
        // folds the system prompt into messages[0] with cacheControl
        // ephemeral; the non-Anthropic branch keeps the legacy split
        // form (system + messages separately).
        // v7.6 · Apr 29 · ChatMessage Batch A · C2 — capture TTFT on the
        // first chunk. Cheap closure: only fires once, then noops.
        // v10.0.20 — also accumulate text into __partialRef.text so a
        // mid-stream onError can persist the actual partial reply.
        // v10.0.26 — narrowed to the actual AI SDK v6 TextStreamPart
        // shape: text-delta chunks expose `text: string` (not `textDelta`).
        // Verified against node_modules/ai/dist/index.d.ts:2601.
        // v10.0.27 (decision) — only accumulate text-delta, NOT
        // reasoning-delta. The graceful-degradation message should match
        // what the user saw on screen; reasoning streams render in a
        // separate collapsed UI region (or are hidden) so mixing it into
        // the assistant content would diverge from the user's view at
        // failure time.
        onChunk: ((chunk: unknown) => {
          if (__firstTokenRef.value === null) __firstTokenRef.value = Date.now();
          const c = chunk as { chunk?: { type?: string; text?: string } };
          const inner = c?.chunk;
          if (inner?.type === "text-delta" && typeof inner.text === "string") {
            __partialRef.text += inner.text;
          }
        }) as Parameters<typeof streamText>[0]["onChunk"],
        // v9.1.22 · onError handler. Without this, a mid-stream provider
        // error (Venice 5xx during streaming, Anthropic transient drop)
        // causes onFinish to NEVER fire — meaning the partial assistant
        // text streamed to the user's screen vanishes from history on
        // next reload. Now we capture the partial text + error and write
        // a placeholder ChatMessage so reload shows what happened.
        // May 02 · chat-route extract chunk 4 · onError handler moved
        // verbatim to lib/services/chat/stream-error-handler.ts. Factory
        // returns the callback wired with the deps it needs (convId,
        // model, traceId, partial-text ref, recordTrace).
        onError: buildStreamErrorHandler({
          convId,
          conversationId,
          model: __fbModel,
          traceId: __traceId,
          provider: fbProvider,
          modelId: fbModelId,
          startedAt,
          partial: __partialRef,
          log,
          recordTrace,
        }) as Parameters<typeof streamText>[0]["onError"],
        // May 02 · chat-route extract chunk 5 · onFinish moved to
        // lib/services/chat/persist-assistant-turn.ts. Factory pattern
        // returns the callback wired with all post-stream deps.
        onFinish: buildOnFinish({
          log,
          convId,
          conversationId,
          provider: fbProvider,
          modelId: fbModelId,
          model: __fbModel,
          mode,
          modeOverride,
          personality,
          contentMode,
          finalSystemPrompt,
          systemPrompt,
          finalTaskType,
          userContent,
          turnSignal,
          contextBlocksFired,
          deeperContextCount,
          deeperContextTypes,
          startedAt,
          firstTokenRef: __firstTokenRef,
          traceId: __traceId,
          recordTrace,
          messages,
          topicTier,
          onWorkComplete: resolveOnFinish,
        }) as Parameters<typeof streamText>[0]["onFinish"],
      } as never);
    },
  });
  result = __sameTurnFallback.result;
  // v10 B.5 · log fallback trace. If attempts.length > 1, a sync-
  // throw happened on the first provider and we recovered. Log
  // ONLY when there was a failure to keep noise low.
  if (__sameTurnFallback.attempts.length > 1) {
    const trace = __sameTurnFallback.attempts
      .map((a) => `${a.provider ?? "?"}:${a.errorClass ?? "ok"}`)
      .join(" → ");
    log.warn("same_turn_fallback_recovered", {
      attempts: __sameTurnFallback.attempts.length,
      trace,
    });
  }

  } catch (streamErr) {
    // v10.0.111 audit fix · do NOT echo provider error messages to
    // the client. Anthropic / OpenAI / Venice SDKs occasionally
    // include the API key in auth-failure messages (e.g.
    // "Invalid API key: sk-..."). recordError persists the full
    // detail server-side; the client sees a generic message.
    recordError("chat:stream", streamErr, {
      provider,
      modelId,
      mode,
      messageCount: messages.length,
    });
    return Response.json(
      { error: "Chat stream failed" },
      { status: 500 }
    );
  }

  // May 02 · chat-route extract chunk 2 · the response/headers/heartbeat
  // assembly moved verbatim to lib/services/chat/response-shape.ts.
  // Pure function — no I/O, no closures — easy to unit-test.
  const { buildChatResponse } = await import("@/lib/services/chat/response-shape");
  return buildChatResponse({
    streamResponse: result.toUIMessageStreamResponse(),
    convId: convId!,
    traceId: __traceId,
    mode,
    modeOverride,
    personality,
    turnSignal,
    deeperContextCount,
    deeperContextTypes,
    contextBlocksFired,
    classification,
    recalledMemories: recalledHits,
    contradictions: detectedContradictions,
    onFinishPromise,
  });
}

export async function GET(req: Request) {
  // v10.0.183 · CRITICAL fix · pre-fix this lister was unauthenticated.
  // Anyone could enumerate the operator's full conversation list
  // (50 most recent titles + IDs + timestamps). The new sensitive-
  // GET gate caught it.
  await requireSession(req);
  // hooks-lib REST→tRPC slice (2026-05-22) · the conversation-list
  // query (cursor pagination · archived filter · hasMore peek) moved
  // verbatim to `lib/services/chat-conversation-read.listConversations`
  // so this legacy REST consumer AND the new `chat.list` tRPC procedure
  // can't drift. `useConversations` now reads tRPC; this stays mounted
  // as the coexistence / rollback path.
  const url = new URL(req.url);
  const requestedTake = Number.parseInt(url.searchParams.get("take") ?? "75", 10);
  const cursor = url.searchParams.get("cursor") || undefined;
  return Response.json(
    await listConversations({
      take: Number.isFinite(requestedTake) ? requestedTake : undefined,
      cursor,
    }),
  );
}
