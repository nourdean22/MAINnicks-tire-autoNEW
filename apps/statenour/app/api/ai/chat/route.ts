import { streamText } from "ai";  // (stepCountIs moved into the extracted pipeline modules, 2026-07-25)
import { getModel, getActiveProviderInfo, isRuntimeProvider, type ProviderName, type TaskType } from "@/lib/ai/provider";  // (GEMINI_SAFETY_OFF moved into ./build-stream-config.ts, 2026-07-25)
import { buildSystemPrompt, detectTopicTier, computePromptVariant } from "@/lib/ai/system-prompt";
// (query-shape / turn-intelligence / response-contract imports moved
// into ./derive-turn-signals.ts with the derivation stack, 2026-07-25)
// (context-reranker + predictive-prefetch + heartbeat imports were DEAD —
// imported but never referenced in the route body; removed 2026-07-25)
import { getCachedPrompt, setCachedPrompt } from "@/lib/ai/system-prompt-cache";
// (chat-mode imports moved into ./derive-turn-signals.ts +
// ./prepare-tools.ts, 2026-07-25. detectChatMode itself had been an
// unused import here since the three-layer mode priority landed.)
import { compressConversation } from "@/lib/ai/conversation-compress";
import {
  embedUserMessage,
  warmToolEmbeddings,
  isToolEmbeddingCacheWarm,
} from "@/lib/ai/tool-embeddings";
import { prisma } from "@/lib/prisma";
// (ACTION_CATALOG import moved into ./augment-final-prompt.ts, 2026-07-25)
// (nourTools import moved into ./prepare-tools.ts, 2026-07-25)
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { recordError } from "@/lib/errors/record-error";
// (getAiConfig import moved into ./derive-turn-signals.ts, 2026-07-25 —
// the aiConfig result still flows back to the tool-pruning block below)
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { logger as rootLogger } from "@/lib/logger";
// (repair-tool-call / stream-error-handler / persist-assistant-turn imports
// moved into ./build-stream-config.ts + ./alternate-paths.ts, 2026-07-25)
// (getFlag moved into ./alternate-paths.ts with the flag-gated block, 2026-07-25)
import { loadFeatureFlagOverrides } from "@/lib/feature-flags";
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
    conversationId: gateConversationId,
    modeOverride,
    providerOverride,
    taskTypeOverride,
    personality,
    userContent,
    // 2026-07-22 · authority-kernel controls (privateMode / posture / permission)
    privateMode,
    posture,
    actionPermission,
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

  // Private Lab: detach the turn from ANY conversation server-side (belt — the
  // client also omits it). No conversationId → the objection/contradiction
  // injector paths and conversation-scoped writes structurally no-op.
  const conversationId = privateMode ? undefined : gateConversationId;

  const { sanitizeMessageHistory } = await import(
    "@/lib/ai/chat/sanitize-history"
  );
  const messages = sanitizeMessageHistory(rawMessages as Parameters<typeof sanitizeMessageHistory>[0]);

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
  // Private Lab: SKIP the interceptor fast-paths entirely. They fork off
  // BEFORE the main pipeline's privateMode gate and persist verbatim — F5
  // commands / brain-dumps / decisions / /save create a titled conversation +
  // user row + BrainMemory/Decision rows (self-review blocker #1). Falling
  // through routes the turn to the model pipeline, which is private-safe.
  if (!privateMode) {
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
  }

  // ── Specialist Sub-Agent Routing ──
  // chat-route decomposition (2026-07-25) · the whole block (AG-42
  // ordering guards, budget check, shadow-mode metrics, dispatch +
  // persist + fast-stream) moved verbatim to ./specialist-routing.ts.
  // Ordering preserved: runs AFTER the interceptors (deterministic
  // intents win) and BEFORE the user-turn persist kickoff below.
  // Private Lab: skip specialist routing entirely — it records
  // content-derived route metrics (self-review #7) and its
  // buildFastStream persists the reply.
  if (!privateMode) {
    const { runSpecialistRouting } = await import("./specialist-routing");
    const specialist = await runSpecialistRouting({
      messages: messages as unknown as Array<Record<string, unknown>>,
      privateMode,
      convId,
      lastUserMsg,
      userContent,
      log,
      recordError,
    });
    if (specialist.kind === "handled") return specialist.response;
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
  const { withTimeout } = await import("@/lib/utils/with-timeout");
  // Bound the write · prisma has no query timeout, so a hung Neon pool
  // connection would stall the Promise.all below (and brainCtxPromise,
  // which chains on this) with zero bytes to the client. persistUserTurn
  // never rejects on its own (internal catch → "temp"), so the only
  // rejection here is the timeout — fall back to the same "temp"
  // contract as its error path. The detached write may still land.
  // Private Lab: the user turn persists NOTHING (no chatMessage row, no
  // conversation row, no persistIfImportant BrainMemory auto-write).
  const dbWritePromise: Promise<string> = privateMode
    ? Promise.resolve(convId || "private")
    : withTimeout(
        persistUserTurn({
          convId,
          lastUserMsg,
          userContent,
          log,
          recordError,
        }),
        5_000,
        "persist-user-turn",
      ).catch(() => {
        log.warn("persist_user_turn_timeout", { convId: convId ?? null });
        return convId || "temp";
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

  // chat-route decomposition (2026-07-25) · the per-turn signal
  // derivation stack (mode resolution → task-type mapping → query
  // shape → turn-intelligence → response contract → domain routing →
  // the three tool-mandatory intent detections) moved VERBATIM to
  // ./derive-turn-signals.ts. One typed input → one typed result; the
  // classify stage-timer is threaded through and wraps classifyIntent
  // exactly as before. The three pure intent regexes now evaluate
  // BEFORE the budget gate below (they ran after it inline) — zero
  // side effects, zero I/O, so ordering is unobservable.
  const { deriveTurnSignals } = await import("./derive-turn-signals");
  const {
    aiConfig,
    classification,
    mode,
    taskTypeForMode,
    queryShape,
    turnSignal,
    responseContract,
    finalTaskType,
    finalPreferLargeContext,
    pythonExecuteIntent: __pythonExecuteIntent,
    actionIntent: __actionIntent,
    webSearchIntent: __webSearchIntent,
  } = await deriveTurnSignals({
    userContent,
    messages: messages as unknown as Array<Record<string, unknown>>,
    modeOverride,
    taskTypeOverride,
    contentMode,
    traceId: __traceId,
    stageTracker,
    log,
  });
  // t0 anchors the prompt_built buildMs log metric. It previously sat
  // between the classify call and the pure derivations; the ~2-5ms of
  // sync derivation time now falls outside it (log-metric-only drift).
  const t0 = Date.now();

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

  // (python-execute / action / web-search intent detections moved into
  // deriveTurnSignals above — destructured as __pythonExecuteIntent /
  // __actionIntent / __webSearchIntent to keep every downstream
  // reference byte-identical.)

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

    // 2026-07-15 · action-force repoint. The force pinned GEMINI for
    // ordinary action intents — but the Gemini key has been hard-dead
    // on its monthly spending cap (verbatim: "project has exceeded its
    // monthly spending cap", provider smoke), so every action turn
    // burned a doomed Gemini attempt and survived only via the stream
    // fallback. Ollama Cloud is the live primary AND honors strict
    // tool_choice (deepseek-v4-pro probed live: forced tool_calls fire
    // reliably). High-stakes mutations keep the Anthropic pin as the
    // declared preference — ANTHROPIC_API_KEY is currently UNSET so
    // getModel degrades it to the normal chain today, and it becomes
    // meaningful again the moment the key is configured.
    const toolMandatoryForce =
      __pythonExecuteIntent || __actionIntent
        ? isHighStakesMutation
          ? ("anthropic" as const)
          : ("ollama" as const)
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
  // 2026-07-12 review · key the fast-path cache on the SAME variant
  // (slot + content format) buildSystemPrompt uses for its inner key, so
  // the two layers can't disagree. The old content-mode boolean collapsed
  // deep/sms/stitch and every content format into two buckets → wrong
  // prompt served for up to 45s.
  const { variant: promptVariant } = await computePromptVariant(userContent);
  log.info("topic_tier_detected", {
    tier: topicTier,
    contentMode,
    variant: promptVariant,
    msgPreview: userContent.slice(0, 40),
  });

  // Cache lookup MUST happen after topic-tier detection — Apr 26 the
  // key was broadened to include tier so we don't silently serve a
  // "full" prompt to a "core" tier turn (which would defeat the
  // engine-pruning that makes casual greetings fast).
  const cachedPrompt = getCachedPrompt(provider, topicTier, promptVariant);

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
          setCachedPrompt(provider, topicTier, p, promptVariant);
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
          posture,
          log,
        }),
      ),
  );

  // Await the parallel work — max of the pipelines. (DB write + user
  // embedding + context-hints + brain recall are folded in so their latency
  // is hidden inside the max.)
  const prefetchTimer = stageTracker.start("prefetch");
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
  prefetchTimer.end();
  stageTracker.cacheHit("prefetch", fromCache);
  // Everything from here to streamWithFallback (finalize-system-prompt,
  // GSC prefetch, tool pruning, message sanitization) is the last
  // pre-stream span · timed as "stream-config" so a hang there is
  // visible in the chat-pipeline log line.
  const streamConfigTimer = stageTracker.start("stream-config");
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
    posture,
    actionPermission,
    log,
  });
  systemPrompt = __finalized.systemPrompt;
  const greeneSummary = __finalized.greeneSummary;
  const strategicLawCount = __finalized.strategicLawCount;

  let result;
  let resolveOnFinish: () => void = () => {};
  let onFinishPromise: Promise<void> = Promise.resolve();
  try {
  // NL interceptors moved to the top of the POST handler — see the
  // "NL INTERCEPTOR FAST PATH" block above. By the time we get here
  // we're in the normal streamText path and the message is NOT an
  // image/decision/brain-dump intent.
  //
  // chat-route decomposition (2026-07-25) · the final-prompt
  // augmentation stack (chat-layer prompt w/ Greene laws +
  // ACTION_CATALOG → multi-output addendum → content-feedback recall →
  // NICK_HIGH_SPEC_GATE directive → customer-shape hint → GSC
  // pre-fetch) moved VERBATIM to ./augment-final-prompt.ts, exact
  // append order preserved. Error semantics unchanged: only the
  // content-feedback step swallows its own errors; anything else
  // throwing lands in this route's catch → 500, as before.
  const { augmentFinalPrompt } = await import("./augment-final-prompt");
  const finalSystemPrompt = await augmentFinalPrompt({
    systemPrompt,
    provider,
    greeneSummary,
    strategicLawCount,
    userContent,
    contentMode,
    turnSignal,
    log,
  });

  // Venice params (web search, scraping, no safety prompt, think strip) are injected
  // via custom fetch wrapper in provider.ts — NOT providerOptions (AI SDK ignores custom fields).

  // chat-route decomposition (2026-07-25) · the tool-pruning + token-
  // budget block (conversation-tail assembly, pruneTools, disabledTools
  // blocklist, alwaysOnTools, action-intent + web-search coherence
  // forcing, maxOutputTokens derivation) moved VERBATIM to
  // ./prepare-tools.ts — same order, same blocklist precedence.
  const { prepareTools } = await import("./prepare-tools");
  const { prunedTools, maxOutputTokens } = await prepareTools({
    mode,
    messages: messages as unknown as Parameters<typeof prepareTools>[0]["messages"],
    userContent,
    userEmbedding,
    aiConfig,
    actionIntent: __actionIntent,
    webSearchIntent: __webSearchIntent,
    queryShape,
    finalSystemPromptLength: finalSystemPrompt.length,
    // WP-14 · read-mode hard enforcement (strips mutating tools LAST)
    actionPermission,
    log,
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

  // chat-route decomposition (2026-07-25) · ONE base bundle for the
  // buildOnFinish persist deps. This exact bundle used to be duplicated
  // THREE times (deep alt path, winner alt path, main onFinish) — three
  // copies that had to stay manually in sync, a live drift hazard.
  // Built ONCE here, after the last finalSystemPrompt / systemPrompt
  // mutation, so every call site captures identical values; per-site
  // overrides are only provider/modelId/model (+ onWorkComplete on the
  // main stream path).
  const persistBase = {
    log,
    privateMode,
    posture,
    convId,
    conversationId,
    mode,
    modeOverride,
    personality,
    contentMode,
    finalSystemPrompt,
    systemPrompt,
    finalTaskType,
    userContent,
    turnSignal,
    responseContract,
    contextBlocksFired,
    deeperContextCount,
    deeperContextTypes,
    startedAt,
    firstTokenRef: __firstTokenRef,
    traceId: __traceId,
    recordTrace,
    messages,
    topicTier,
  };

  // ═══ v-truth · PRE-STREAM ALTERNATE PATHS (flag-gated · DEFAULT OFF) ═══
  // chat-route decomposition (2026-07-25) · the whole flag-gated block
  // (multi-agent auto-decompose / deep reasoning w/ mega-cap + live
  // snapshot / verified regen / self-consistency, incl. the v10.0.534
  // action-intent suppression and the catch-all fallthrough) moved
  // VERBATIM to ./alternate-paths.ts. Returns a Response when an
  // alternate path handled the turn; null falls through to the
  // untouched streamText path below. Flags off = zero change.
  {
    const { runAlternatePaths } = await import("./alternate-paths");
    const altResponse = await runAlternatePaths({
      persistBase,
      provider,
      modelId,
      model,
      sanitizedModelMessages,
      prunedTools,
      mode,
      maxOutputTokens,
      userContent,
      finalSystemPrompt,
      turnSignal,
      actionIntent: __actionIntent,
      convId,
      traceId: __traceId,
      modeOverride,
      personality,
      classification,
      recalledHits,
      detectedContradictions,
      deeperContextCount,
      deeperContextTypes,
      contextBlocksFired,
      log,
    });
    if (altResponse) return altResponse;
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
  // (smoothStream now imported inside ./build-stream-config.ts)

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

  streamConfigTimer.end();
  // chat-route decomposition (2026-07-25) · the entire per-attempt
  // streamText config (Gemini safety-off, Anthropic cacheControl fold,
  // pruned tools + repair, smoothStream, step caps, the prepareStep
  // toolChoice ladder with READ-permission suppression, onChunk TTFT +
  // partial capture, onError, onFinish) moved VERBATIM to
  // ./build-stream-config.ts as a factory over the same shared refs.
  const { streamWithFallback } = await import("@/lib/ai/stream-with-fallback");
  const { buildStreamConfigFactory } = await import("./build-stream-config");
  const __sameTurnFallback = await streamWithFallback({
    taskType: finalTaskType,
    preferLargeContext: finalPreferLargeContext,
    forceProviderFirst: effectiveForce,
    buildConfig: buildStreamConfigFactory({
      persistBase,
      provider,
      modelId,
      finalSystemPrompt,
      sanitizedModelMessages,
      prunedTools,
      mode,
      maxOutputTokens,
      turnSignal,
      pythonExecuteIntent: __pythonExecuteIntent,
      webSearchIntent: __webSearchIntent,
      actionIntent: __actionIntent,
      actionPermission,
      privateMode,
      convId,
      conversationId,
      traceId: __traceId,
      startedAt,
      firstTokenRef: __firstTokenRef,
      partialRef: __partialRef,
      recordTrace,
      resolveOnFinish,
      log,
    }),
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
  // Emit the per-stage pre-stream breakdown · this is the line that
  // answers "where did the 90s go" when a turn hangs before the first
  // token. Stages: gate · interceptors · classify · prefetch ·
  // stream-config. (Streaming itself happens after this return, so it
  // is intentionally not part of this summary.)
  log.info("chat_pipeline_stages", {
    line: formatStageLog(reqId, mode, stageTracker.summary()),
  });

  const { buildChatResponse } = await import("@/lib/services/chat/response-shape");
  // 2026-07-25 · onError closes the SSE-side gap in the v10.0.111 no-echo
  // policy above: ai@6's default forwards error.message VERBATIM into the
  // client-visible {type:"error"} part (auth failures can embed API keys).
  // Server-side detail is already persisted by buildStreamErrorHandler.
  const { clientSafeStreamErrorText } = await import(
    "@/lib/services/chat/stream-error-handler"
  );
  return buildChatResponse({
    streamResponse: result.toUIMessageStreamResponse({
      onError: clientSafeStreamErrorText,
    }),
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
