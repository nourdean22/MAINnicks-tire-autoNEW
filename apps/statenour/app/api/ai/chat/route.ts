import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { getModel, getActiveProviderInfo, type ProviderName, type TaskType } from "@/lib/ai/provider";
import { buildSystemPrompt, detectTopicTier } from "@/lib/ai/system-prompt";
import { detectQueryShape, toolFirstDirective } from "@/lib/ai/query-shape";
import { resolveMediaType } from "@/lib/ai/chat/message-fields";
import {
  classifyTurn,
  buildChainOfThoughtPrompt,
  buildOutputShapePrompt,
} from "@/lib/ai/turn-intelligence";
import { rerankContextBlocks, formatRerankSummary } from "@/lib/ai/context-reranker";
import { buildCitationPrompt } from "@/lib/ai/memory-citations";
import { buildNourVoicePrompt } from "@/lib/ai/nour-voice-profile";
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

const log = rootLogger.withSurface("api/ai/chat");

export const maxDuration = 120; // Pro plan: up to 300s

export async function POST(req: Request) {
  const user = await requireSession(req);
  // v9.1.19 · AI rate-limit gate. The chat route is session-gated so
  // only Nour can hit it, but a runaway client (e.g. a polling loop
  // gone wild, or auto-fire chains) could still bomb the AI provider
  // bills. 10 req/min/IP is generous for normal use and catastrophic
  // for a runaway. Returns 429 cleanly without entering the heavy
  // streaming pipeline.
  const limited = checkAiRateLimit(req);
  if (limited) return limited;

  // ── WAVE-200 Phase 1.5 · AGENT_V2 cutover gate ──────────────────
  // When the operator flips AGENT_V2=true in Railway env, this
  // route delegates to the Mastra `nick` agent via handleChatStream
  // instead of running the 1800-LOC legacy pipeline below.
  //
  // Cutover semantics:
  //   · OFF (default) · legacy streamText pipeline · unchanged
  //   · ON · Mastra agent + nourTools + auto-injected skill recall
  //     (Phase 2 verified · already inherited by the Mastra agent)
  //
  // Rollback · flip the env back to false · zero code change · the
  // legacy pipeline stays warm.
  //
  // Why early-exit instead of branching mid-pipeline · the legacy
  // pipeline does its own prompt assembly + memory recall + tool
  // dispatch · Mastra does ALL of that internally. Branching mid-way
  // would duplicate state with no benefit. Early-exit means "this
  // request runs on Mastra · everything that follows is the legacy
  // path".
  //
  // See: docs/adr/0001-mastra-adoption.md · WAVE-200-PLAN Phase 1.5
  const { AGENT_V2_ENABLED } = await import("@/src/mastra/agents/nick");

  // ── Phase W (2026-05-18 PM) · X-Force-Agent header override ──────
  // Owner-only per-request override of the AGENT_V2 env gate. Enables
  // the judge-eval corpus-building workflow · the operator (or a
  // future shadow-execute cron) can POST `x-force-agent: v1` to fire
  // the same prompt through the legacy pipeline AND `x-force-agent:
  // v2` to fire through Mastra, regardless of the deploy-wide flag.
  //
  // Safe because:
  //   · requireSession() already ran above · only the operator can
  //     set this header
  //   · It doesn't bypass auth, rate-limit, or budget gates · those
  //     all run later in the legacy branch and apply to V1 too
  //   · Default behavior (no header) is unchanged · env flag wins
  //
  // See: docs/migrations/agent-v1-to-v2.md · Phase 0 corpus-building
  const forceAgent = (req.headers.get("x-force-agent") ?? "").trim().toLowerCase();
  const useV2 =
    forceAgent === "v1" ? false : forceAgent === "v2" ? true : AGENT_V2_ENABLED;

  if (useV2) {
    // 2026-05-17 follow-up · code-reviewer + silent-failure-hunter both
    // flagged the original V2 branch as missing the error scaffolding
    // the legacy path has. Wrapping with try/catch + recordError +
    // sanitizeError so a Mastra construction failure (provider chain
    // exhausted · Braintrust wrap throw · missing env) lands the same
    // shape of error the client useChat() hook expects, and shows up
    // in /system/errors instead of vanishing as an unhandled crash.
    try {
      const { handleChatStream } = await import("@mastra/ai-sdk");
      const { createUIMessageStreamResponse } = await import("ai");
      const { getMastra } = await import("@/src/mastra");
      const params = await req.json();
      // 2026-05-17 follow-up · Phase 1.2 memory wiring fix · without
      // explicit thread + resource IDs, Mastra creates a new memory
      // context per request and the Phase 1.2 working-memory + last-N
      // message window silently no-op. Per AgentMemoryOption shape:
      //   thread → conversationId · resource → operator user.id
      // The legacy pipeline reads body.conversationId · we mirror
      // that lookup so legacy → V2 cutover preserves conversation
      // continuity for the operator.
      const conversationId =
        typeof params?.conversationId === "string" && params.conversationId.length > 0
          ? params.conversationId
          : typeof params?.id === "string" && params.id.length > 0
            ? params.id
            : typeof params?.chatId === "string" && params.chatId.length > 0
              ? params.chatId
              : `default-${user.id}`;
      const paramsWithMemory = {
        ...params,
        memory: {
          thread: conversationId,
          resource: user.id,
        },
      };
      // getMastra() returns a promise (race-safe singleton · 2026-05-17 follow-up)
      const mastra = await getMastra();
      const stream = await handleChatStream({
        mastra: mastra as never,
        agentId: "nick",
        params: paramsWithMemory,
        version: "v6",
      });
      return createUIMessageStreamResponse({ stream: stream as never });
    } catch (err) {
      const message = sanitizeError(err);
      log.error("agent_v2_failed", {
        message,
        stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
      });
      recordError("chat:stream", err, { surface: "agent_v2", agentV2: true });
      // Return JSON 500 with a structured shape · the AI SDK v6 client
      // surfaces this via the onError callback rather than hanging
      // forever waiting for a stream that never arrives.
      return new Response(
        JSON.stringify({ error: "agent_v2_failed", message }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      );
    }
  }
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
    messages,
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

  let convId = conversationId;
  void body; // body kept for downstream interceptors that read raw fields
  const lastUserMsg = messages[messages.length - 1] as Record<string, unknown> & {
    role?: string;
  };

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
  const { sanitizeMessageHistory } = await import(
    "@/lib/ai/chat/sanitize-history"
  );
  sanitizeMessageHistory(messages as Parameters<typeof sanitizeMessageHistory>[0]);

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
  // Provider override is tracked for logging + future provider switcher.
  void providerOverride;

  // ═══ PERF: Chat mode detection (with overrides) ═══
  // Three-layer priority for mode:
  //   1. Per-request override from the chat control bar (client body)
  //   2. Global default from the AI config (Settings page)
  //   3. Automatic detection via detectChatMode
  const aiConfig = await getAiConfig().catch((): null => null);
  const mode: ChatMode =
    modeOverride || aiConfig?.defaultMode || detectChatMode(userContent, messages.length);
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

  let model: ReturnType<typeof getModel>;
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
    model = getModel(finalTaskType, {
      preferLargeContext: finalPreferLargeContext,
      ...(__pythonExecuteIntent ? { forceProviderFirst: "ollama" as const } : {}),
    });
    if (__pythonExecuteIntent) {
      log.info("python_execute_provider_override", { forced: "ollama" });
    }
  } catch (err) {
    recordError("chat:request", err, { reason: "no_provider" });
    return Response.json(
      { error: "Nick AI is not available right now. No AI provider configured. Set VENICE_API_KEY, OLLAMA_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY." },
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
    : buildSystemPrompt(topicTier, userContent)
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
  const auxPromise: Promise<[string | null, string | null, import("@/lib/ai/predictive-prefetch").PrefetchResult[]]> =
    userContent.length > 10 || forceRecall
      ? Promise.all([
          import("@/lib/brain/conversation-memory")
            .then((m) => m.detectCrossSessionThread(userContent))
            .catch((): null => null),
          import("@/lib/brain/contextual-recall")
            .then((m) =>
              m.getContextualMemories([userContent], mode === "deep" ? 10 : 5)
            )
            .catch((): null => null),
          prefetchIntents(userContent).catch(() => [] as import("@/lib/ai/predictive-prefetch").PrefetchResult[]),
        ])
      : Promise.resolve([null, null, []]);

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

  // v10.0.92 · Hybrid memory recall — pipes user-embedding through
  // the recall lib so we avoid a second Venice call. Runs in parallel
  // with the prompt build + aux + compression. Wall-clock cost is
  // ~max(KNN query, 50ms) since the embedding is already in flight.
  // Skips on greetings (<10 chars) — same pattern as auxPromise.
  type RecallBlock = { promptBlock: string; hitCount: number; ms: number };
  const recallPromise: Promise<RecallBlock | null> =
    userContent.length > 10
      ? userEmbeddingPromise.then(async (emb) => {
          if (!emb || emb.length === 0) return null;
          try {
            const { recallMemoriesForQuery, formatRecallForPrompt } =
              await import("@/lib/brain/memory-recall");
            const report = await recallMemoriesForQuery(userContent, {
              embedding: emb,
              limit: mode === "deep" ? 8 : 5,
            });
            if (report.hits.length === 0) return null;
            return {
              promptBlock: formatRecallForPrompt(report.hits),
              hitCount: report.hits.length,
              ms: report.durationMs,
            };
          } catch (err) {
            recordError("chat:recall", err, { stage: "hybrid-recall" });
            return null;
          }
        })
      : Promise.resolve(null);

  // Await the parallel work — max of the six pipelines.
  // (DB write + user embedding + memory recall are folded in so
  // their latency is hidden inside the max.)
  const [
    { systemPrompt: rawSystemPrompt, fromCache },
    aux,
    compression,
    resolvedConvId,
    userEmbedding,
    recallBlock,
  ] = await Promise.all([
    promptPromise,
    auxPromise,
    compressPromise,
    dbWritePromise,
    userEmbeddingPromise,
    recallPromise,
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

  let systemPrompt = rawSystemPrompt;

  // v10.0.529.94 · Wave 38 · NEW-CONVERSATION FALLBACK ANCHOR.
  // When the operator opens a fresh chat and says "snooze it" / "do it"
  // with no prior anchor wiring (no contextRoute, no suggestion tap,
  // no PageContextBridge state), the system prompt previously had
  // nothing to resolve "it" against and Nick had to fuzzy-match.
  // Pre-seed lastTaskId from the top-priority active task when ALL
  // anchors are missing AND this is the first turn. ~5ms cost · zero
  // impact on later turns (anchors already set).
  let effectiveLastTaskId = lastTaskId;
  let effectiveLastGoalId = lastGoalId;
  let effectiveLastJournalEntryId = lastJournalEntryId;
  let effectiveLastDecisionId = lastDecisionId;
  let effectiveLastPinId = lastPinId;
  let effectiveLastReflectionId = lastReflectionId;
  let effectiveLastMissionId = lastMissionId;
  const noAnchors =
    !lastTaskId &&
    !lastGoalId &&
    !lastJournalEntryId &&
    !lastDecisionId &&
    !lastPinId &&
    !lastReflectionId &&
    !lastMissionId &&
    !lastSuggestionId;
  if (noAnchors) {
    // v10.0.529.98 · Wave 42 · cross-device continuity. Anchors live in
    // client-side React state + localStorage · operator switching from
    // desktop to phone loses them. We persist the LATEST anchors to a
    // single BrainMemory row (cross_device_anchors / latest) on every
    // chat turn (further down in route.ts) · here we READ them as the
    // first fallback when no client-side anchors arrived. 2-hour cap
    // so stale context doesn't bleed into a fresh session next morning.
    try {
      const crossDevice = await prisma.brainMemory
        .findFirst({
          where: {
            category: "cross_device_anchors",
            key: "latest",
            deletedAt: null,
            updatedAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          },
          select: { content: true },
        })
        .catch(() => null);
      if (crossDevice?.content) {
        try {
          const stored = JSON.parse(crossDevice.content) as {
            lastTaskId?: string;
            lastGoalId?: string;
            lastJournalEntryId?: string;
            lastDecisionId?: string;
            lastPinId?: string;
            lastReflectionId?: string;
            lastMissionId?: string;
          };
          effectiveLastTaskId = effectiveLastTaskId ?? stored.lastTaskId;
          effectiveLastGoalId = effectiveLastGoalId ?? stored.lastGoalId;
          effectiveLastJournalEntryId =
            effectiveLastJournalEntryId ?? stored.lastJournalEntryId;
          effectiveLastDecisionId = effectiveLastDecisionId ?? stored.lastDecisionId;
          effectiveLastPinId = effectiveLastPinId ?? stored.lastPinId;
          effectiveLastReflectionId =
            effectiveLastReflectionId ?? stored.lastReflectionId;
          effectiveLastMissionId = effectiveLastMissionId ?? stored.lastMissionId;
        } catch {
          // ignore malformed JSON
        }
      }
    } catch {
      // silent · cross-device fallback is best-effort
    }

    // Fall back to top-priority active task ONLY if cross-device read
    // also produced nothing AND this is the first turn (Wave 38 logic).
    if (!effectiveLastTaskId && messages.length === 1) {
      try {
        const topTask = await prisma.task
          .findFirst({
            where: { status: { in: ["DOING", "READY"] }, deletedAt: null },
            orderBy: [
              { status: "asc" }, // DOING ranks before READY alphabetically · semantically correct
              { autoPriority: "desc" },
              { lastTouchedAt: "desc" },
            ],
            select: { id: true },
          })
          .catch(() => null);
        if (topTask?.id) {
          effectiveLastTaskId = topTask.id;
        }
      } catch {
        // silent · fallback anchor is best-effort
      }
    }
  }

  // v10.0.529.98 · Wave 42 · WRITE current anchors back to cross-device
  // storage. Fire-and-forget · doesn't block the chat path. Skip when
  // every anchor is empty (don't pollute storage with noise rows).
  // Uses upsert so we keep one canonical "latest" row that gets updated
  // in place · prevents unbounded growth.
  const anyAnchorPresent = !!(
    lastTaskId ||
    lastGoalId ||
    lastJournalEntryId ||
    lastDecisionId ||
    lastPinId ||
    lastReflectionId ||
    lastMissionId
  );
  if (anyAnchorPresent) {
    void prisma.brainMemory
      .upsert({
        where: { id: "cross_device_anchors_latest" },
        create: {
          id: "cross_device_anchors_latest",
          category: "cross_device_anchors",
          key: "latest",
          content: JSON.stringify({
            lastTaskId,
            lastGoalId,
            lastJournalEntryId,
            lastDecisionId,
            lastPinId,
            lastReflectionId,
            lastMissionId,
          }),
          source: "chat-turn",
          confidence: 1.0,
          createdBy: "system",
        },
        update: {
          content: JSON.stringify({
            lastTaskId,
            lastGoalId,
            lastJournalEntryId,
            lastDecisionId,
            lastPinId,
            lastReflectionId,
            lastMissionId,
          }),
          updatedAt: new Date(),
          deletedAt: null, // un-soft-delete if it was cleared
        },
      })
      .catch(() => null);
  }

  // v10.0.529.86 · Wave 30 · live context hints. Tells the model
  // what page the operator is currently on, which task/goal they
  // last touched, and whether they tapped a NickSuggestions chip.
  // Resolves "this task" / "do that" / "yes go ahead" without
  // fuzzy-title gymnastics. Cheap · always ≤ 200 chars. Appended
  // AFTER the cached base prompt so it doesn't poison the cache.
  const contextHints: string[] = [];
  if (contextRoute) {
    contextHints.push(`The operator is currently on \`${contextRoute}\`.`);
    // v10.0.529.92 · Wave 36 · surface-aware tool biasing. When the
    // operator's request is ambiguous between two tool families,
    // prefer the one that matches the route they're sitting on. Cuts
    // hallucinated tool calls (e.g. createTask firing when the operator
    // on /journal really meant journalDecision). Mapping is intentionally
    // small · only the cases where two tools could plausibly fire.
    const TOOL_BIAS: Record<string, string> = {
      "/tasks": "createTask · completeTask · snoozeTask · setTaskPriority · updateTask",
      "/journal": "logSituation · journalDecision · classifyThought · reviewDecisionReplay",
      "/pins": "pinMemory · searchMemories",
      "/knowledge": "syncKnowledge · searchColdMemory · searchSkills",
      "/mastery": "updateMasteryScore · setLifeGoal · logGoalProgress",
      "/life": "setLifeGoal · logGoalProgress · archiveGoal · getCommitments",
      "/plan": "createMissionPlan · setOKRs · setWeeklyTargets · suggestMIT",
      "/brain": "pinMemory · searchMemories · getBlindSpots · buildArchitectureMemory",
      "/system": "getCronStatus · toolHealth · getBrainHealth",
      "/financial": "getFinancialSnapshot · getProjections · compareLiveRevenue",
      "/body": "getBodyData",
      "/decisions": "journalDecision · reviewDecisionReplay · getDecisionReplays",
    };
    const biasKey = Object.keys(TOOL_BIAS).find((k) => contextRoute.startsWith(k));
    if (biasKey) {
      contextHints.push(
        `Surface-aware tool bias · prefer these tools for ambiguous requests on this route: ${TOOL_BIAS[biasKey]}.`,
      );
    } else {
      // v10.0.529.93 · Wave 37 · route-miss fallback. Audit found
      // 5 routes lacked a TOOL_BIAS entry (/photo-improver /social /
      // content /cockpit /knowledge sub-paths). Generic fallback so
      // the model still gets behavioral direction instead of just
      // a route name. Strips leading "/" and uses the first segment.
      const surface = contextRoute.split("/").filter(Boolean)[0] ?? "";
      if (surface) {
        contextHints.push(
          `For ambiguous requests on this route, prefer tools whose names match "${surface}" or are read-oriented over write-oriented.`,
        );
      }
    }
  }
  if (effectiveLastTaskId) {
    // Wave 38 · effectiveLastTaskId falls back to the top active task
    // for new conversations with no anchors · the original lastTaskId
    // wins when set explicitly via PageContextBridge or suggestion tap.
    const anchorSource = lastTaskId
      ? "operator's last touch"
      : "current top-priority active task (auto-seeded · low confidence · confirm before destructive moves)";
    contextHints.push(`Their most-recently-touched taskId is \`${effectiveLastTaskId}\` (${anchorSource}) — use it directly when they say "this task" / "snooze this" / "complete it".`);
  }
  // v10.0.529.98 · Wave 42 · all 7 entity hints now use `effective*`
  // values so cross-device fallback flows through. When the value
  // arrived via fallback (not client-side), annotate the source so
  // Nick treats it as lower-confidence + confirms before destructive
  // actions. Same pattern as Wave 38's task fallback annotation.
  if (effectiveLastGoalId) {
    const src = lastGoalId ? "" : " (cross-device · confirm before destructive moves)";
    contextHints.push(`Their most-recently-touched goalId is \`${effectiveLastGoalId}\`${src} — use it for "this goal" / "log progress on it".`);
  }
  if (lastSuggestionKind && lastSuggestionId) {
    contextHints.push(`They just tapped a Nick proactive suggestion (kind="${lastSuggestionKind}", id="${lastSuggestionId}"). "Yes" / "do that" / "go ahead" means proceed with this suggestion's intent.`);
  }
  // v10.0.529.90 · Wave 34 · expanded entity anchors. The chat client
  // extracts entity IDs from suggestion chip IDs (e.g. broken-promise-
  // <taskId>) AND from /journal#bd-<id> deep-links so Nick can resolve
  // "this reflection" / "grade this decision" / "unpin this" / "act
  // on it" without guessing.
  if (effectiveLastJournalEntryId) {
    const src = lastJournalEntryId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched journalEntryId is \`${effectiveLastJournalEntryId}\`${src} — use it for "this entry" / "this brain dump".`);
  }
  if (effectiveLastDecisionId) {
    const src = lastDecisionId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched decisionId is \`${effectiveLastDecisionId}\`${src} — use it for "this decision" / "grade it" / "review that".`);
  }
  if (effectiveLastPinId) {
    const src = lastPinId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched pinId is \`${effectiveLastPinId}\`${src} — use it for "this pin" / "unpin it" / "refresh that".`);
  }
  if (effectiveLastReflectionId) {
    const src = lastReflectionId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched reflectionId is \`${effectiveLastReflectionId}\`${src} — use it for "this reflection" / "act on it" / "convert to a task".`);
  }
  if (effectiveLastMissionId) {
    const src = lastMissionId ? "" : " (cross-device · confirm)";
    contextHints.push(`Their most-recently-touched missionId is \`${effectiveLastMissionId}\`${src} — use it for "this mission" / "this project".`);
  }
  if (contextHints.length > 0) {
    systemPrompt += `\n\n# OPERATOR CONTEXT (live)\n${contextHints.join("\n")}`;
  }

  const [threadContext, contextMemories, prefetchResults] = aux;

  if (threadContext) {
    systemPrompt += `\n\n# CROSS-SESSION THREAD\n${threadContext.slice(0, 1000)}`;
  }
  if (contextMemories) {
    systemPrompt += `\n\n# CONTEXT MEMORIES\n${contextMemories.slice(0, mode === "deep" ? 2000 : 1000)}`;
  }

  // v10.0.163 · Entity truth-grounding. Pre-fetch DB state for any
  // project/mission named in the recent turns and inject it as
  // ground truth so the model can't claim a different count.
  // Composes with the L1 prompt rule + L2 rewrite + L3 history
  // neutralization to close the fabrication loop end-to-end.
  // Best-effort — failure here just means no grounding block, the
  // chat path stays unaffected.
  try {
    const { buildTruthGroundingBlock } = await import(
      "@/lib/ai/chat/truth-grounding"
    );
    const groundingBlock = await buildTruthGroundingBlock(messages as never);
    if (groundingBlock) {
      systemPrompt += `\n\n${groundingBlock}`;
      log.info("truth_grounding_injected", {
        blockLength: groundingBlock.length,
      });
    }
  } catch (err) {
    log.warn("truth_grounding_failed", {
      error: sanitizeError(err),
    });
  }

  // v10.0.526 · Arc B Feature 5 · Proactive Contradiction Surfacing.
  // The contradiction-surfacer detects contradictions on the WRITE
  // path (importance-scorer post-hook). This call is the READ path:
  // when the operator's CURRENT message semantically overlaps an
  // unresolved contradiction from the last 60d, inject a soft nudge
  // so Nick asks "which is current?" without short-circuiting the
  // actual answer. Idempotent per (conversation, day, contradiction)
  // — re-surfacing the same alert every turn would burn trust.
  try {
    const { findRelevantContradictions, buildContradictionAlertBlock } = await import(
      "@/lib/brain/contradiction-injector"
    );
    const hit = await findRelevantContradictions({
      userMessage: userContent,
      conversationId: convId,
    });
    if (hit) {
      systemPrompt += `\n\n${buildContradictionAlertBlock(hit)}`;
      log.info("contradiction_alert_injected", {
        contradictionKey: hit.key,
        similarity: Number(hit.similarity.toFixed(3)),
        daysApart: hit.daysApart,
        signal: hit.signal,
      });
    }
  } catch (err) {
    log.warn("contradiction_alert_failed", {
      error: sanitizeError(err),
    });
  }

  // v10.0.92 · Hybrid memory recall block — runs alongside contextual-
  // recall (which uses keyword + recency). The hybrid version uses
  // KNN cosine on embedding_vec_1536 + recency boost + confidence
  // weighting + category whitelist. The two compose: contextual-recall
  // catches keyword-perfect matches; hybrid catches semantically-
  // related-but-different-wording memories. Both can fire on the same
  // turn without overlap because the prompt sections are distinct.
  if (recallBlock?.promptBlock) {
    systemPrompt += `\n\n# ${recallBlock.promptBlock}`;
    log.info("hybrid_recall_injected", {
      hits: recallBlock.hitCount,
      ms: recallBlock.ms,
    });
  }

  // v10.0.235 · Strategic Frameworks injection · when the user message
  // matches any business / money / strategy / pricing / marketing
  // intent, we inject a "STRATEGIC LENS" block listing 1-3 relevant
  // frameworks (Business Model Canvas, JTBD, Launch Strategy,
  // Monetization, Pricing, Growth Engine, Awareness Stages, Competitive
  // Landscape, Kotler Macro). Nick reasons through the framework and
  // surfaces the lens by name so Nour gets depth instead of hot-take.
  // The registry is extensible — add a new framework file to grow Nick
  // into more of a business genius over time.
  // v10.0.242 · expanded telemetry · log which lenses fired + scores so
  // we can audit which frameworks Nick is actually using vs lens-injection
  // dead-weight. pickFrameworks runs again here (cheap · ~44 regex tests)
  // for visibility into the picker's decision.
  // v10.0.264 · centralized lens-fire telemetry via recordLensFire.
  // Pre-fix this was inline log.info · 8 surfaces had the same pattern
  // duplicated. Now each writes to the SystemMetric table for the
  // /admin/lens-stats dashboard alongside the existing log line.
  try {
    const { pickFrameworks, composeStrategicLensBlock } = await import(
      "@/lib/ai/strategic-frameworks"
    );
    const { recordLensFire } = await import(
      "@/lib/ai/strategic-frameworks/record-lens-fire"
    );
    const lensBlock = composeStrategicLensBlock(userContent);
    if (lensBlock) {
      systemPrompt += `\n\n${lensBlock}`;
      const matches = pickFrameworks(userContent);
      recordLensFire({ surface: "chat", matches, lensBlockLength: lensBlock.length });
    }
  } catch (err) {
    log.warn("strategic_lens_failed", {
      error: sanitizeError(err),
    });
  }

  // May 02 · chat-route extract chunk 3 · brain-context assembly
  // (parallel-load 7 brain modules with 3s timeouts, rerank by user-
  // embedding similarity, deeper-context telemetry, prefetch append)
  // moved verbatim to lib/services/chat/brain-context.ts. Returns the
  // addendum + fire-flags + deeper-context counts; route appends the
  // addendum to systemPrompt and surfaces the rest on the response.
  const { buildBrainContext } = await import("@/lib/services/chat/brain-context");
  const brainCtx = await buildBrainContext({
    userContent,
    mode,
    userEmbedding,
    contextMemories,
    prefetchResults,
    log,
  });
  systemPrompt += brainCtx.systemPromptAddendum;
  const contextBlocksFired = brainCtx.contextBlocksFired;
  const deeperContextCount = brainCtx.deeperContextCount;
  const deeperContextTypes = brainCtx.deeperContextTypes;

  // Context window limits per provider
  // Venice GLM-4.7-flash: 128K total. Budget split (Apr 15 refactor):
  //   - System prompt: 65K (raised from 50K after the cold memory +
  //     engine cap work. The trimmed builder sits around 65K with
  //     breathing room. Anything beyond that reaches Nick via the
  //     searchColdMemory tool, so inline truncation is no longer the
  //     bottleneck it was.)
  //   - Tools + pruned catalog: ~8K typical, ~45K in full deep mode
  //     (pruning keeps standard mode lean)
  //   - Messages + conversation: 10-25K
  //   - Tool results: 5-15K
  //   - Output tokens: 2-8K
  //   Total worst case: 65 + 45 + 25 + 15 + 8 = 158K — OVER 128K.
  //   Deep mode IS the risk — but deep mode is rare and the model
  //   handles 128K context gracefully by dropping oldest messages.
  // Anthropic Claude Sonnet 4.6: ~200K, system prompt can take 120K.
  const MAX_SYSTEM_CHARS = provider === "anthropic" ? 120000 : 65000;
  if (systemPrompt.length > MAX_SYSTEM_CHARS) {
    log.info("system_prompt_truncated", { from: systemPrompt.length, to: MAX_SYSTEM_CHARS, provider });
    systemPrompt = systemPrompt.slice(0, MAX_SYSTEM_CHARS) + "\n\n[System prompt truncated for model context limits]";
  }

  // Load Greene strategic law library for context — skip for smaller models
  const strategicLaws = provider === "anthropic" ? await prisma.strategicLaw.findMany({
    select: { book: true, number: true, shortTitle: true, essence: true, shopApplication: true, nourApplication: true },
    orderBy: [{ book: "asc" }, { number: "asc" }],
  }).catch((): never[] => []) : [];
  const greeneSummary = strategicLaws.length > 0
    ? strategicLaws.map(l => `[${l.book} #${l.number}] ${l.shortTitle}: ${l.essence}`).join("\n")
    : "";

  // ── Personality mode injection ──
  // Appended LAST so it's the closest instruction to the conversation,
  // meaning the model weights it most heavily. Each personality changes
  // Nick's behavior without touching the data sections above.
  const personalityPrompts: Record<string, string> = {
    master: `[ACTIVE MODE: MASTER]
You are in Master mode — Nour's operator + strategist.
- Default: terse, actionable, 40-60 words. Sales floor focus — "close the deal", not "call the lead."
- When Nour asks for analysis: go deeper with data, pros/cons, second-order effects. Up to 150 words.
- Always cite a specific number from his data. Always end with ONE next move.
- No ALL-CAPS headings. No sections. No bullets unless asked. Just answer.`,

    builder: `[ACTIVE MODE: BUILDER]
You are in Builder mode — Nour's technical partner.
- Focus on code, architecture, deployment. Show file paths. Explain WHY not just WHAT.
- Use githubReadMultiple to read the actual files before asserting.
- Can be longer (up to 300 words) when explaining architecture decisions.
- Connect code to business outcomes.
- When Nour describes a feature, break it into steps and estimate effort.`,

    friend: `[ACTIVE MODE: FRIEND]
You are in Friend mode — just Nour's friend Nick.
- Casual. Warm but honest. No data, no metrics, no business unless he asks.
- Match his vibe. If he's joking, joke back. If he's venting, listen then respond like a real friend would.
- No "strategic layers", no "next actions", no tools unless asked.
- Keep it natural. Talk like a person, not a system.
- Still honest — friends tell the truth. But with warmth.`,
  };

  const personalityBlock = personalityPrompts[personality] || personalityPrompts.master;
  systemPrompt += `\n\n${personalityBlock}`;

  // ═══ Apr 19 · Turn-aware prompt scaffolds ═══
  // Chain-of-thought fires on complex/analytical/decision/reflective turns.
  // Output-shape fires when Nour asked for a specific form (email / SMS /
  // proposal / code / JSON / table / list / summary). Both are appended
  // AFTER personality so they're the closest instructions to the
  // conversation — the model weights them most heavily. Pure overhead is
  // a few hundred tokens on turns that benefit; zero tokens on casual chat.
  if (turnSignal.useChainOfThought) {
    systemPrompt += `\n\n${buildChainOfThoughtPrompt()}`;
  }
  const shapePrompt = buildOutputShapePrompt(turnSignal.outputShape);
  if (shapePrompt) {
    systemPrompt += `\n\n${shapePrompt}`;
  }

  // Apr 19 · Citation protocol — added on turns where any brain block
  // fired. Tells the model it MAY cite sources with [brain:TAG]. We
  // skip the directive on casual turns to save tokens.
  const anyBrainBlockFired =
    contextBlocksFired.recall ||
    contextBlocksFired.skills ||
    contextBlocksFired.identity ||
    contextBlocksFired.ghost ||
    contextBlocksFired.qualitative ||
    contextBlocksFired.beliefs ||
    contextBlocksFired.nudges ||
    contextBlocksFired.contradictions;
  if (anyBrainBlockFired && turnSignal.intent !== "casual") {
    systemPrompt += `\n\n${buildCitationPrompt()}`;
  }

  // Apr 19 · Nour voice guardrails. Appended on turns where voice
  // matters most (analytical / decision / creative / reflective /
  // emotional). Casual / factual turns skip it — short pragmatic
  // replies naturally avoid the corporate-speak we're guarding against
  // and the extra tokens would crowd out content.
  const voiceGuardIntents = new Set<typeof turnSignal.intent>([
    "analytical",
    "decision",
    "creative",
    "reflective",
    "emotional",
    "instructional",
  ]);
  if (voiceGuardIntents.has(turnSignal.intent)) {
    systemPrompt += `\n\n${buildNourVoicePrompt()}`;
  }

  // Brevity enforcement (except builder which needs length for code explanations)
  if (mode !== "deep" && personality !== "builder") {
    systemPrompt += `\nRemember: under 60 words unless analyzing. Nour is on his phone.`;
  }

  // ── FORBIDDEN PHRASES — universal voice guard ──
  // Prevention layer for Nick's distinct voice. Without this, Venice
  // slipped into generic-LLM filler ("Certainly!", "I hope this helps")
  // on standard + deep. Paired with lib/ai/output-sanitizer.ts which
  // scrubs the saved history as a cure layer.
  systemPrompt += `\n\nFORBIDDEN PHRASES — never emit:
- Pleasantries: "Certainly!" / "Of course!" / "Absolutely!" / "Great question!" / "Sure thing!"
- Help filler: "I hope this helps" / "Let me know if..." / "Happy to help" / "Feel free to ask"
- AI disclaimers: "As an AI" / "As a language model" / "I don't have real-time access"
- Hedges: "It seems like" / "It appears that" / "I think that" / "Based on my analysis"
- Self-reference: "In this response" / "In my answer"
- Sentences starting with: However / Additionally / Furthermore / Moreover / In summary / In conclusion
Speak as Nour's operator. Direct, specific, grounded in his data.`;

  // ── TOOL-FIRST DIRECTIVE (injected only when query is factual) ──
  // When the user asks a data question Nick has tools for, force the
  // tool call before the answer. Prevents hallucinated numbers.
  const toolFirstPrompt = toolFirstDirective(queryShape);
  if (toolFirstPrompt) {
    systemPrompt += `\n\n${toolFirstPrompt}`;
  }

  let result;
  try {
  // For Venice (small context), use just the truncated system prompt — it already has Nick's identity
  // For Anthropic (large context), append the full chat-layer identity + Greene laws
  const chatLayerPrompt = provider === "venice" ? systemPrompt : `${systemPrompt}

# NICK — Chief of Staff, NOUR OS (Chat Layer)

${greeneSummary ? `## Greene Strategic Law Library (${strategicLaws.length} laws loaded)
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
      // Prepend the hard directive so the model treats it as a top-
      // priority constraint over the rest of the system prompt.
      finalSystemPrompt = `${REGEN_SYSTEM_PREFIX}\n\n${finalSystemPrompt}`;
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
  const customerShapeRegex = {
    phone: /\b(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/,
    nameWithAction: /\b(?:tell me about|show me|look up|find|search for|how (?:much|many|long)|what (?:about|did|does|has)|when (?:did|was|will)|customer named|customer called|client named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,
    // v10.0.503 fix · "does <Name>" wasn't matching · `[A-Z]\b`
    // required the cap letter to be the whole word. Use `[A-Z][a-z]+`
    // to anchor on a proper-name token. Also widened to "did", "has",
    // "was" forms since they imply customer-inquiry too.
    ownershipPhrasing: /\b(?:(?:does|did|has|was|will)\s+[A-Z][a-z]+|[A-Z][a-z]+'s\s+(?:car|truck|vehicle|visits?|history|account|estimates?|invoices?|spend|plate))\b/,
    plateLookup: /\b(?:plate|tag)\s+(?:number\s+)?[A-Z0-9]{4,8}\b/i,
  };
  const userTextSlice = userContent.slice(0, 1500);
  const customerSignals: string[] = [];
  if (customerShapeRegex.phone.test(userTextSlice)) customerSignals.push("phone-digits");
  if (customerShapeRegex.nameWithAction.test(userTextSlice)) customerSignals.push("name-with-action");
  if (customerShapeRegex.ownershipPhrasing.test(userTextSlice)) customerSignals.push("ownership-phrase");
  if (customerShapeRegex.plateLookup.test(userTextSlice)) customerSignals.push("plate");
  if (customerSignals.length > 0) {
    finalSystemPrompt = `## CUSTOMER QUERY DETECTED · signals: ${customerSignals.join(" + ")}\nYour user appears to be asking about a SPECIFIC customer. You MUST call the \`findCustomer\` tool FIRST with the name or phone digits before asserting any facts about that person (visits, estimates, spend, segment, vehicle, plate). If findCustomer returns no match, tell the user "no customer matched <term>" instead of fabricating details. Do NOT skip this step even if you think you remember the customer from earlier in the conversation · always re-look-up.\n\n${finalSystemPrompt}`;
    log.info("customer_shape_detected", { signals: customerSignals });
  }

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
  const SEO_QUERY_REGEX =
    /\b(seo|gsc|google search console|search console|impressions?|clicks|ctr|rankings?|search performance|organic|traffic|keywords?|nickstire\.org|autonicks\.com|search ranks?|website performance|aeo)\b/i;
  if (SEO_QUERY_REGEX.test(userTextSlice)) {
    try {
      const { queryNick } = await import("@/lib/nickstire/query");
      // Date range parsing: pull "yesterday" / "today" / "last 7 days"
      // from user content · default 30 days.
      const today = new Date().toISOString().slice(0, 10);
      const lower = userTextSlice.toLowerCase();
      let from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      let to = today;
      let windowLabel = "last 30 days";
      if (/\byesterday\b/.test(lower)) {
        from = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
        to = from;
        windowLabel = "yesterday";
      } else if (/\btoday\b/.test(lower)) {
        from = today;
        to = today;
        windowLabel = "today";
      } else if (/\blast\s*7\s*days?\b|\bthis\s*week\b/.test(lower)) {
        from = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
        windowLabel = "last 7 days";
      }
      const gscStart = Date.now();
      const res = await queryNick<{ totalClicks?: number; totalImpressions?: number; avgCtr?: number; avgPosition?: number; daysCovered?: number } | { error: string }>(
        "gsc_summary",
        { from, to },
      );
      const gscMs = Date.now() - gscStart;
      log.info("gsc_prefetch", { windowLabel, from, to, ms: gscMs, ok: "data" in res });
      if ("data" in res && res.data) {
        const d = res.data as { totalClicks?: number; totalImpressions?: number; avgCtr?: number; avgPosition?: number; daysCovered?: number };
        const hasNumbers = (d.totalClicks ?? 0) > 0 || (d.totalImpressions ?? 0) > 0;
        if (hasNumbers) {
          finalSystemPrompt = `# 🚨 LIVE GSC DATA INJECTED · ${windowLabel} (${from} to ${to}) · YOU MUST CITE THESE NUMBERS 🚨\n\nThe operator just asked about SEO / search performance. The nickstire bridge was queried LIVE BEFORE you started typing this reply. The actual data is here:\n\n\`\`\`json\n${JSON.stringify(d, null, 2)}\n\`\`\`\n\n## HARD RULES (violations are failures):\n\n- **DO NOT START YOUR REPLY WITH** "I cannot" / "Sorry" / "Unfortunately" / "I'm unable" / "I don't have access" — THE DATA IS RIGHT ABOVE. Saying you don't have it is FALSE.\n- **DO NOT FABRICATE** "Google logging errors", "data discrepancies", "outages between 2025 and 2026", or any narrative explaining away the numbers. The numbers ARE the truth.\n- **OPEN YOUR REPLY** by stating the actual numbers. Example shape: "${windowLabel} on nickstire.org: ${d.totalClicks ?? 0} clicks, ${d.totalImpressions ?? 0} impressions${typeof d.avgCtr === "number" ? `, ${(d.avgCtr * 100).toFixed(2)}% CTR` : ""}${typeof d.avgPosition === "number" ? `, avg position ${d.avgPosition.toFixed(1)}` : ""}."
- If a number is ZERO, that means LITERALLY ZERO · acknowledge that directly: "no clicks captured for that window."
- If the operator asks for top queries, you can additionally call \`getGscTopQueries\` for the same date range.
- Voice: concrete · direct · no hedging. Nour wants the numbers, not a tour.

${finalSystemPrompt}`;
          log.info("gsc_data_injected", { windowLabel, hasNumbers });
        } else {
          finalSystemPrompt = `# 🚨 GSC DATA · ${windowLabel} (${from} to ${to}) · ZERO TRAFFIC CAPTURED 🚨\n\nThe nickstire bridge was queried LIVE for the requested window and returned zero clicks AND zero impressions. This is the actual state · not an unavailable bridge.\n\n## HARD RULES:\n\n- **DO NOT FABRICATE** "Google logging errors", "outages", or any narrative. The pipeline ran · the data is genuinely zero.\n- **DO NOT SAY** "I cannot provide information" / "Sorry, unable to" / "I don't have access" — you DO have the data. The data is "zero captured."
- **OPEN YOUR REPLY** with: "No GSC data captured for ${windowLabel}." Then explain the two likely reasons (pipeline runs nightly so today's data may not be populated yet, OR the period had genuinely no search traffic). Suggest a wider window (e.g. last 7 days) as the next move.
- Voice: direct · brief · helpful. Don't apologize · just report and offer next step.

${finalSystemPrompt}`;
          log.info("gsc_no_data", { windowLabel });
        }
      } else {
        const errText = "error" in res ? res.error : "unknown";
        finalSystemPrompt = `# 🚨 GSC BRIDGE FAILED · ${windowLabel} 🚨\n\nThe pre-fetch attempt errored: \`${errText}\`. The bridge is unavailable right now.\n\n## HARD RULES:\n\n- **DO NOT FABRICATE** numbers or "logging error" narratives.
- **OPEN YOUR REPLY** with: "GSC bridge isn't responding right now (${errText}). Try again in a few minutes."
- Voice: brief · operator wants to know it's a transient · not a deep apology.

${finalSystemPrompt}`;
        log.warn("gsc_prefetch_failed", { errText, windowLabel });
      }
    } catch (err) {
      log.warn("gsc_prefetch_exception", { err: sanitizeError(err) });
      // Non-fatal · fall through to existing path · model still has
      // getGscSummary available in toolset (v10.0.510 pruner expansion)
    }
  }

  // v10.0.526 · Arc B · F6 · anticipated-question injection.
  //
  // Cron `/api/cron/anticipate` (folded into mega-evening) drafts the
  // 3 questions the operator is most likely to ask next + precomputes
  // answers via this same pipeline. When the operator's actual query
  // matches one of today's anticipated questions at cosine >= 0.85,
  // we inject the cached take as a system-prompt addendum.
  //
  // CRITICAL: this DOES NOT short-circuit the response. The model
  // still generates a fresh reply tuned to the operator's exact
  // phrasing. The cached take is context · "you anticipated this · here's
  // your earlier take · use it but adapt." Per the spec: "DO NOT short-
  // circuit · just inject the precompute as context."
  //
  // Guarded against re-entry · the precompute runner sets the
  // x-anticipate-precompute header, which we honor here to skip the
  // lookup. (Otherwise the precompute itself would match its own
  // question with sim=1.0 and recurse.)
  //
  // Cost · 1 embed of user query + 3 question embeds + cosine math
  // ≈ ~150ms total · runs in parallel with prefetch upstream.
  const isAnticipatePrecompute =
    req.headers.get("x-anticipate-precompute") === "1";
  if (!isAnticipatePrecompute) {
    try {
      const { findAnticipated } = await import("@/lib/brain/anticipated-questions");
      const match = await findAnticipated(userContent);
      if (match) {
        finalSystemPrompt = `# ANTICIPATED-QUESTION HIT · sim ${(match.similarity * 100).toFixed(1)}% · age ${match.ageHours.toFixed(1)}h\n\nYou predicted this morning that the operator would ask: "${match.question}". You already drafted a take below. Use it as your starting point, but adapt to the operator's EXACT phrasing of the question and any new context that's surfaced since you drafted. Don't parrot — refine. If the cached take is materially wrong given fresh signal, override it.\n\n## Cached take (drafted ${match.ageHours.toFixed(1)}h ago):\n\n${match.answer.slice(0, 3000)}\n\n## After the cached take, the operator asked:\n\n"${userContent.slice(0, 600)}"\n\n${finalSystemPrompt}`;
        log.info("anticipated_question_injected", {
          sim: Math.round(match.similarity * 1000) / 1000,
          ageHours: Math.round(match.ageHours * 10) / 10,
          fresh: match.fresh,
          matchedQ: match.question.slice(0, 80),
          answerChars: match.answer.length,
        });
      }
    } catch (err) {
      log.warn("anticipated_question_lookup_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      // Non-fatal · fall through to normal pipeline
    }
  }

  // Venice params (web search, scraping, no safety prompt, think strip) are injected
  // via custom fetch wrapper in provider.ts — NOT providerOptions (AI SDK ignores custom fields).

  // ═══ PERF: Prune tools by mode ═══
  // Quick mode → zero tools. Standard → ~15-30 relevant. Deep → all 159.
  // Cuts Venice first-token latency from 10-30s → 2-5s for conversational
  // messages without removing any capability from data-heavy queries.
  let prunedTools = pruneTools(
    mode,
    nourTools as unknown as Record<string, unknown>,
    userContent,
    userEmbedding
  ) as typeof nourTools;

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

  // Use compressed messages if the conversation hit the compression
  // threshold. For short conversations this is the original message
  // array unchanged.
  const modelMessages = compression.compressed
    ? compression.messages
    : await convertToModelMessages(
        messages as unknown as Parameters<typeof convertToModelMessages>[0],
      ).catch((err) => {
        log.error("convert_to_model_messages_failed", { err: sanitizeError(err) });
        return messages.map((m: any) => {
          const parts = m.parts || [];
          const hasImages = parts.some((p: any) => p?.type === "image" || p?.type === "file");
          if (hasImages) {
            const content: any[] = [];
            for (const part of parts) {
              if (part?.type === "text" && part?.text) {
                content.push({ type: "text", text: part.text });
                continue;
              }
              // AI SDK v6 UIMessage shape — { type: "file", mediaType, url }.
              // `url` is a data-URL (data:image/png;base64,...) or http(s).
              // Images and other files both use the same part type in v6.
              if (part?.type === "file") {
                // v10.0.185 · always resolve mediaType (never undef).
                // Pre-fix this branch let `mediaType: undefined`
                // through to streamText, triggering the AI SDK's
                // "'file part media type ' functionality not
                // supported" error every time. resolveMediaType()
                // tries part.mediaType → part.mimeType → data-URL
                // prefix → "application/octet-stream" as last resort.
                const url: string | undefined = part.url;
                const media = resolveMediaType(part, url);
                if (url && media.startsWith("image/")) {
                  content.push({ type: "image", image: url, mediaType: media });
                } else if (url) {
                  content.push({ type: "file", data: url, mediaType: media });
                } else if (part.data) {
                  // v4/v5 legacy shape — kept for any queued messages
                  // that predate the v6 upgrade.
                  content.push({ type: "file", data: part.data, mediaType: media });
                }
                continue;
              }
              // v4/v5 "image" part type — still seen in older persisted
              // conversations. Translate to v6 content shape.
              if (part?.type === "image" && part?.image) {
                content.push({
                  type: "image",
                  image: part.image,
                  mediaType: resolveMediaType(part, part.image),
                });
              }
            }
            return { role: m.role as "user" | "assistant", content };
          }
          return {
            role: m.role as "user" | "assistant",
            content:
              typeof m.content === "string"
                ? m.content
                : Array.isArray(parts)
                  ? parts.filter((p: any) => p?.type === "text").map((p: any) => p.text).join(" ")
                  : JSON.stringify(m.content ?? parts ?? ""),
          };
        });
      });

  // v10.0.529.58 · ITEM_REFERENCE SANITIZER · 43 failed assistant
  // replies in 24h with 'input[N]: unknown input item type:
  // "item_reference"' against Ollama Cloud's /v1/chat/completions.
  // Root cause: AI SDK v6's convertToModelMessages emits item_reference
  // parts for tool-call continuations in multi-step flows · OpenAI's
  // Responses API accepts these · Chat Completions endpoints (Venice ·
  // Ollama · OpenAI chat-compat) reject them as unknown types.
  // Fix: walk modelMessages · strip part objects whose .type is not
  // in the chat-completions-safe whitelist. Preserves text · image ·
  // file · tool-call · tool-result · drops item_reference (and any
  // future unknown types). Idempotent · adds <1ms per turn.
  const CHAT_COMPLETIONS_SAFE_TYPES = new Set([
    "text",
    "image",
    "file",
    "tool-call",
    "tool-result",
    "reasoning",
  ]);
  const sanitizedModelMessages = (() => {
    const src = modelMessages as Array<{ role?: string; content?: unknown }>;
    if (!Array.isArray(src)) return modelMessages;
    return src.map((msg) => {
      if (!msg || typeof msg !== "object") return msg;
      const content = msg.content;
      if (!Array.isArray(content)) return msg;
      const filtered = content.filter((part: unknown) => {
        if (!part || typeof part !== "object") return true;
        const t = (part as { type?: string }).type;
        return typeof t !== "string" || CHAT_COMPLETIONS_SAFE_TYPES.has(t);
      });
      if (filtered.length === content.length) return msg;
      // Drop messages whose content array got fully filtered out · they
      // were 100% item_reference and have no body left to send. Otherwise
      // the provider would 400 on an empty user/assistant turn.
      if (filtered.length === 0) {
        return { ...msg, content: [{ type: "text", text: "" }] };
      }
      return { ...msg, content: filtered };
    });
  })();

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
  const { streamWithFallback, inferProviderName } = await import("@/lib/ai/stream-with-fallback");
  const __sameTurnFallback = streamWithFallback({
    taskType: finalTaskType,
    preferLargeContext: finalPreferLargeContext,
    buildConfig: (__fbModel) => (({
      model: __fbModel,
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
      // Python-execute · most specific gate, checked first.
      if (
        /\b(run|execute|invoke)\s+(?:this\s+)?python\b|\bpython\s+(?:to\s+|and\s+)?(?:compute|calculate|run|execute)\b|\buse\s+(?:the\s+)?runPython\b|\brun\s+(?:this\s+)?code\b/i.test(
          userContent,
        )
      ) {
        log.info("python_execute_intent_detected", { surface: "chat" });
        return {
          toolChoice: {
            type: "tool" as const,
            toolName: "runPython" as const,
          },
        };
      }

      const intent = (() => {
        try {
          // Lazy import — keeps the chat hot path lean when the
          // user message has no action verb.
          const { detectActionIntent } = require("@/lib/ai/chat/action-intent-detector") as
            typeof import("@/lib/ai/chat/action-intent-detector");
          return detectActionIntent(userContent);
        } catch {
          return null;
        }
      })();
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
      model,
      traceId: __traceId,
      provider,
      modelId,
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
    }) as Parameters<typeof streamText>[0]["onFinish"],
  }) as never),
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
  });
}

export async function GET(req: Request) {
  // v10.0.183 · CRITICAL fix · pre-fix this lister was unauthenticated.
  // Anyone could enumerate the operator's full conversation list
  // (50 most recent titles + IDs + timestamps). The new sensitive-
  // GET gate caught it.
  await requireSession(req);
  // v10.0.186 · pagination · pre-fix the sidebar took 50 with no
  // pagination and no UI signal that older convos existed. Heavy
  // sessions (>50 convs) silently lost access to history. Now:
  // accepts ?cursor=<convId> + ?take=<N> (default 75, max 200) so
  // the drawer can lazy-load older pages, and returns a hasMore
  // flag derived from peeking one extra row.
  const url = new URL(req.url);
  const requestedTake = Number.parseInt(url.searchParams.get("take") ?? "75", 10);
  const take = Number.isFinite(requestedTake)
    ? Math.min(Math.max(requestedTake, 1), 200)
    : 75;
  const cursor = url.searchParams.get("cursor") || undefined;
  // P7 · v8.30 · ChatConversation uses `archivedAt` as the soft-delete
  // semantic (decided 2026-04-30). Sidebar filters it out by default;
  // archived convos still searchable via /api/chat/search.
  const fetched = await prisma.chatConversation.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: take + 1, // peek for hasMore
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      // v10.0.529.59 · audit Wave 8 follow-up · expose conversation
      // flag timestamps so ConversationDrawer rows can render star /
      // mute state without an N-fan-out fetch. archivedAt is always
      // null in the list response (already filtered above), so it's
      // not selected.
      starredAt: true,
      mutedAt: true,
      _count: { select: { messages: true } },
    },
  });
  const hasMore = fetched.length > take;
  const conversations = hasMore ? fetched.slice(0, take) : fetched;
  const nextCursor = hasMore && conversations.length > 0
    ? conversations[conversations.length - 1].id
    : null;

  return Response.json({ conversations, hasMore, nextCursor });
}