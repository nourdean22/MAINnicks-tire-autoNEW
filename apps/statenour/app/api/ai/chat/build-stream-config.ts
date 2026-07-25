/**
 * app/api/ai/chat/build-stream-config.ts — chat-route decomposition
 * slice (2026-07-25). The streamWithFallback `buildConfig` closure body
 * moved VERBATIM from route.ts. This is the per-attempt streamText
 * config: for each fallback model it wires
 *
 *   · Gemini safety-off providerOptions (ignored by other providers)
 *   · the v10.0.446 Anthropic cacheControl system-in-messages fold
 *     (Venice/Ollama/OpenAI keep the legacy system+messages split)
 *   · pruned tools + hallucinated-tool-name repair
 *   · smoothStream perceived-latency word chunking
 *   · step caps (standard 3 / deep 5)
 *   · the prepareStep toolChoice ladder — python-execute step-0 pin →
 *     web-search step-0 pin → generic action "required" → default —
 *     each with the 2026-07-15 final-step text forcing, and the READ
 *     actionPermission suppression of mutating forces
 *   · onChunk TTFT capture + partial-text accumulation
 *   · onError (stream-error-handler factory)
 *   · onFinish (persist-assistant-turn factory via persistBase +
 *     per-attempt provider/modelId/model + onWorkComplete)
 *
 * The factory captures the SAME refs the inline closure did
 * (firstTokenRef / partialRef are shared objects; resolveOnFinish is
 * the route's onFinishPromise resolver) — behavior is byte-identical.
 */

import type { streamText } from "ai";
import { smoothStream } from "ai";
import { stepCountIs } from "ai";
import { GEMINI_SAFETY_OFF, type ProviderName } from "@/lib/ai/provider";
import { inferProviderName } from "@/lib/ai/stream-with-fallback";
import { buildRepairToolCall } from "@/lib/ai/chat/repair-tool-call";
import { buildStreamErrorHandler } from "@/lib/services/chat/stream-error-handler";
import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";
import type { PersistBase } from "./alternate-paths";
import type { classifyTurn } from "@/lib/ai/turn-intelligence";
import type { detectActionIntent } from "@/lib/ai/chat/action-intent-detector";
import type { ChatMode } from "@/lib/ai/chat-mode";
import type { logger as rootLogger } from "@/lib/logger";

type Logger = ReturnType<typeof rootLogger.withSurface>;

export function buildStreamConfigFactory(deps: {
  persistBase: PersistBase;
  provider: ProviderName;
  modelId: string;
  finalSystemPrompt: string;
  sanitizedModelMessages: unknown;
  prunedTools: unknown;
  mode: ChatMode;
  maxOutputTokens: number;
  turnSignal: ReturnType<typeof classifyTurn>;
  pythonExecuteIntent: boolean;
  webSearchIntent: boolean;
  actionIntent: ReturnType<typeof detectActionIntent> | null;
  actionPermission: string | undefined;
  privateMode: boolean;
  convId: string | undefined;
  conversationId: string | undefined;
  traceId: string;
  startedAt: number;
  firstTokenRef: { value: number | null };
  partialRef: { text: string };
  recordTrace: PersistBase["recordTrace"];
  resolveOnFinish: () => void;
  log: Logger;
}) {
  const {
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
  } = deps;

  return (__fbModel: Parameters<typeof streamText>[0]["model"]) => {
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
      // 2026-07-12 · remap hallucinated tool names (e.g. dotted forms like
      // `memory.remember` / `person.update`) onto the real tool when one
      // exists in the active set — otherwise the model wastes a 7-8s step
      // and shows a phantom tool card. Only remaps to tools present in
      // prunedTools; returns null (SDK graceful path) when unmappable.
      experimental_repairToolCall: buildRepairToolCall(
        prunedTools as unknown as import("ai").ToolSet,
      ),
      // Smooth the token stream for perceived-speed. See note above.
      experimental_transform: smoothStream({ delayInMs: 10, chunking: "word" }),
      // Standard allows 3 tool-call steps; deep allows 5 for agentic
      // workflows. Keep step counts tight so a confused tool chain can't
      // blow through the whole context budget.
      stopWhen: stepCountIs(mode === "deep" ? 5 : 3),
      // Context-aware brevity cap — see prepare-tools.ts.
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
        // hoisted `__pythonExecuteIntent` (computed once in
        // derive-turn-signals for the provider force) so the detection
        // regex lives in exactly one place — the two can never drift
        // apart on a future edit.
        // 2026-07-12 · Force the tool on the FIRST step ONLY, then hand
        // control back (toolChoice:"auto") so the model emits a final text
        // reply AFTER the tools run. Forcing "required" across ALL steps
        // (pre-fix) meant an action turn ended with only tool cards and NO
        // prose — "it runs the tool but never responds; I have to ask what
        // happened." prepareStep scopes the force to step 0, keeping the
        // anti-fabrication guarantee (can't narrate-without-acting) while
        // restoring the closing summary. stepCountIs stops the loop as soon
        // as a step emits text with no tool call.
        //
        // 2026-07-15 · silent-tool-turn fix (final-step text forcing).
        // With stopWhen(stepCountIs(N)), a turn whose EVERY step emitted
        // tool calls ends with finishReason "tool-calls" and zero prose —
        // the tool cards render but Nick never "responds" (operator nudged
        // with "?" to get an answer). Force toolChoice:"none" on the last
        // allowed step so the loop always ends with a step that can only
        // produce text. Applies to all three branches, including the
        // previously-prepareStep-less default.
        const lastStep = (mode === "deep" ? 5 : 3) - 1;
        // READ permission (composer selector) must not be contradicted by
        // structural tool forcing — a forced runPython / toolChoice:"required"
        // makes the "observe and describe, don't act" directive impossible
        // (self-review high #5). Skip the mutating forces; fall through to the
        // unforced default so the READ prompt directive governs the turn.
        if (__pythonExecuteIntent && actionPermission !== "read") {
          log.info("python_execute_intent_detected", { surface: "chat" });
          return {
            prepareStep: ({ stepNumber }: { stepNumber: number }) =>
              stepNumber === 0
                ? { toolChoice: { type: "tool" as const, toolName: "runPython" as const } }
                : stepNumber >= lastStep
                  ? { toolChoice: "none" as const }
                  : { toolChoice: "auto" as const },
          };
        }

        // 2026-07-15 · explicit web-search ask → force the web tool on
        // step 0 (checked before the generic action intent — more
        // specific wins). deepseek-v4-pro honors strict tool_choice
        // via Ollama's OpenAI-compat endpoint (probed live).
        if (__webSearchIntent) {
          log.info("web_search_intent_detected", { surface: "chat" });
          return {
            prepareStep: ({ stepNumber }: { stepNumber: number }) =>
              stepNumber === 0
                ? { toolChoice: { type: "tool" as const, toolName: "arsenalWebSearch" as const } }
                : stepNumber >= lastStep
                  ? { toolChoice: "none" as const }
                  : { toolChoice: "auto" as const },
          };
        }

        // Reuse the hoisted detection (computed in derive-turn-signals
        // for the provider force) — one detectActionIntent call drives
        // both the provider pick AND toolChoice, so the two can never
        // disagree.
        const intent = __actionIntent;
        if (intent && actionPermission !== "read") {
          log.info("action_intent_detected", {
            intent: intent.intent,
            expectedTool: intent.expectedTool,
          });
          return {
            prepareStep: ({ stepNumber }: { stepNumber: number }) =>
              stepNumber === 0
                ? { toolChoice: "required" as const }
                : stepNumber >= lastStep
                  ? { toolChoice: "none" as const }
                  : { toolChoice: "auto" as const },
          };
        }
        return {
          prepareStep: ({ stepNumber }: { stepNumber: number }) =>
            stepNumber >= lastStep ? { toolChoice: "none" as const } : {},
        };
      })(),
      // v10.0.446 · `messages:` (and `system:` for non-Anthropic) are
      // set by the conditional spread above. The Anthropic branch
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
        privateMode,
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
        ...persistBase,
        provider: fbProvider,
        modelId: fbModelId,
        model: __fbModel,
        onWorkComplete: resolveOnFinish,
      }) as Parameters<typeof streamText>[0]["onFinish"],
    } as never);
  };
}
