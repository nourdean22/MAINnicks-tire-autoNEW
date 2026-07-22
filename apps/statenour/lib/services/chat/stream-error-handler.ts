/**
 * buildStreamErrorHandler · May 02 · chat-route extract chunk 4
 *
 * Lifted verbatim from app/api/ai/chat/route.ts (the streamText
 * `onError` callback at lines 914-1031). Factory function — returns
 * an onError callback configured with the deps it needs.
 *
 * Why a factory instead of a free function: the original closure
 * captured ~6 outer-scope vars (model, convId, traceId, provider,
 * modelId, startedAt, log, partial-text-ref). Passing them as a deps
 * object via the factory keeps the contract explicit and makes the
 * handler testable in isolation.
 *
 * The partial-text accumulator is the trickiest piece. It's mutated
 * by the onChunk handler as text-delta chunks land, and read by this
 * onError when a mid-stream failure fires. We pass it as a small ref
 * `{ text: "" }` so both sides share the same reference without
 * resorting to a module-level variable.
 *
 * Owns these side effects on stream interruption:
 *   1. Mark the failing provider as recently failed (60s rehab) so
 *      the NEXT turn rotates off the dead provider.
 *   2. Persist a graceful-degradation ChatMessage with the partial
 *      text + error annotation, so reload doesn't vanish what the
 *      user already saw on screen. Falls back to a pure-error stub
 *      when partial < 20 chars (true cold failure).
 *   3. Write an agent-trace error row (errorClass: "stream_interrupted").
 *   4. Append to ErrorLog for the operator dashboard.
 *
 * Behavior preserved exactly. Outer try/catch swallow stays — onError
 * MUST NOT throw or it crashes the stream lifecycle.
 */

import { prisma } from "@/lib/prisma";
import type { ProviderName } from "@/lib/ai/provider";
import type { TraceStartInput, TraceFinishInput } from "@/lib/ai/agent-trace";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
}

/**
 * Mutable partial-text reference shared with onChunk. onChunk pushes
 * text-delta chunks into `.text`; this onError reads `.text` when the
 * stream interrupts.
 */
export interface PartialTextRef {
  text: string;
}

export interface BuildStreamErrorHandlerInput {
  /** Private Lab: skip the errored-turn chatMessage.create — convId is the
   *  "private" sentinel (truthy), so the write would otherwise persist the
   *  partial reply's content (self-review high #6). Provider-marking + trace
   *  carry no user content and still run. */
  privateMode?: boolean;
  /** Convo id resolved from dbWritePromise. May be null pre-resolve. */
  convId: string | null | undefined;
  /** Original client-supplied conversationId (may differ from convId for first turn). */
  conversationId: string | null | undefined;
  /** AI-SDK model object — used to extract modelId for provider markFailed. */
  model: unknown;
  traceId: string;
  provider: ProviderName;
  modelId: string;
  /** Date.now() at chat-turn start — used for trace duration. */
  startedAt: number;
  /** Shared partial-text ref; mutated by onChunk, read here. */
  partial: PartialTextRef;
  log: ChatLogger;
  /**
   * The recordTrace function from @/lib/ai/agent-trace. Passed via deps
   * because route.ts already imports + binds it to the per-turn traceId.
   */
  recordTrace: (start: TraceStartInput, finalize: TraceFinishInput) => Promise<void> | void;
}

export function buildStreamErrorHandler(deps: BuildStreamErrorHandlerInput) {
  const {
    convId,
    conversationId,
    model,
    traceId,
    provider,
    modelId,
    startedAt,
    partial,
    log,
    recordTrace,
  } = deps;

  return async (errorEvent: { error: unknown }): Promise<void> => {
    try {
      // v10.0.513 · don't let plain-object errors stringify as
      // "[object Object]". The 2026-05-12 smoke tests showed a
      // venice GLM-4.7 error fired this code path with a non-Error
      // object · operator saw "⚠️ Stream interrupted: [object Object]"
      // which is useless. Walk the common error shapes (message ·
      // error · statusText · code) before falling back to
      // JSON.stringify.
      const errMsg = (() => {
        const e = errorEvent.error;
        if (e instanceof Error) return e.message;
        if (typeof e === "string") return e;
        if (e && typeof e === "object") {
          const obj = e as Record<string, unknown>;
          if (typeof obj.message === "string" && obj.message.length > 0) return obj.message;
          if (typeof obj.error === "string" && obj.error.length > 0) return obj.error;
          if (typeof obj.statusText === "string" && obj.statusText.length > 0) {
            const status = obj.status ?? obj.statusCode ?? "?";
            return `HTTP ${status} · ${obj.statusText}`;
          }
          if (typeof obj.code === "string" && obj.code.length > 0) {
            return `${obj.code}${typeof obj.message === "string" ? `: ${obj.message}` : ""}`;
          }
          try {
            const json = JSON.stringify(e);
            return json && json !== "{}" ? json.slice(0, 500) : "Unknown error (empty object)";
          } catch {
            return "Unknown error (unserializable)";
          }
        }
        return String(e);
      })();
      // v10.0.20 — graceful-degradation log line uses the actual
      // accumulated partial length (was hard-coded 0 pre-v10).
      log.warn("stream_text_on_error_fired", {
        conversationId,
        partialLen: partial.text.length,
        errMsg: errMsg.slice(0, 200),
      });
      // v9.1.27 · mark the failing provider as recently failed so
      // the next request rotates to a different provider via
      // getModel()'s skip logic. We can't switch mid-stream after
      // headers, but we CAN protect the next turn from hitting the
      // same dead provider. Auto-rehab after ~60s.
      try {
        const modelInfo =
          typeof model === "object" && model && "modelId" in model
            ? String((model as { modelId?: unknown }).modelId)
            : "";
        // Heuristic: provider name appears in the modelId. Match
        // against the known provider names we manage in PROVIDERS.
        const { markProviderFailed, markProviderQuotaExhausted, classifyModelId, getTaggedModelProvider } =
          await import("@/lib/ai/provider");
        // 2026-07-04 (audit P2) · OpenRouter FIRST — vendor-prefixed ids
        // ("google/gemini-*") otherwise match the gemini branch below and
        // ban the healthy native lane instead of the failing OpenRouter.
        // Prefix exceptions (NOT OpenRouter): "models/" is Google's native
        // form; "gemini/"/"ollama/" name the provider outright and fall
        // through to their own branches. Mirrors inferProviderName in
        // lib/ai/stream-with-fallback.ts.
        // ONE canonical classifier (classifyModelId in provider.ts) — shared with
        // inferProviderName + modelToProvider so these three can't drift again.
        //
        // 2026-07-16 (chat audit) · ground-truth tag first, then string
        // inference, then deps.provider — the lane the route actually
        // selected at call time, KNOWN here all along but previously
        // ignored: an unclassifiable modelId made marking a silent no-op
        // and the dead lane was re-picked on every retry.
        const inferred = getTaggedModelProvider(model) ?? classifyModelId(modelInfo);
        if (!inferred) {
          log.warn("provider_marking_inference_failed_using_known_provider", {
            modelId: modelInfo,
            fallbackProvider: provider,
          });
        }
        const failed = inferred ?? provider;
        markProviderFailed(failed);
        // Quota/billing-class errors additionally trip the provider's
        // LONG circuit breaker. Pre-fix this was gemini-only — the
        // openai/anthropic breakers existed in provider.ts but were
        // unwired (mark never exported), so the 2026-07-15 outage
        // re-tried the dead paid lanes at ~29s per chat call.
        markProviderQuotaExhausted(failed, errMsg);
      } catch {
        /* swallow — don't let provider-marking crash onError */
      }
      // v10.0.20 · graceful degradation — persist the ACTUAL partial
      // text streamed before the error, not just an error stub. This
      // means the user's partial reply doesn't vanish from history
      // on next reload. If we have <20 chars of partial (true cold
      // failure pre-first-token), fall back to the old stub message.
      //
      // v10.0.111 audit fix · use convId (the DB-resolved value)
      // instead of conversationId (the raw client-supplied value
      // which is undefined for the very first message of a new
      // conversation). Pre-fix, first-message stream errors silently
      // skipped the persist step.
      // 2026-07-05 (audit P3 · c) · HONEST stub rows. Pre-P3 this
      // persisted with NO streamingState (schema default "complete"),
      // NO errorDetails, the error context buried in tokenUsage where
      // nothing reads it, and a "⚠️ Stream interrupted: …" annotation
      // baked into `content` — which hydration replayed to the model
      // as genuine assistant speech on every later turn. Now:
      //   · content = the bare partial text the user actually saw
      //     ("" on a cold pre-first-token failure — no error sentence)
      //   · streamingState = "errored" → MessageStatusBadge renders
      //     the red error chip + retry affordance on reload
      //   · errorDetails = the structured { code, message, provider,
      //     retryable } column DESIGNED for this (see schema.prisma)
      //   · sanitize-history.ts neutralizes errored turns before they
      //     replay to the model (verifier-style note)
      if (convId && !deps.privateMode) {
        const hasMeaningfulPartial = partial.text.trim().length >= 20;
        await prisma.chatMessage
          .create({
            data: {
              conversationId: convId,
              role: "assistant",
              content: hasMeaningfulPartial ? partial.text.trim() : "",
              model:
                typeof model === "object" && model && "modelId" in model
                  ? String((model as { modelId?: unknown }).modelId).slice(0, 60)
                  : "unknown",
              streamingState: "errored",
              errorDetails: {
                code: "stream_interrupted",
                message: errMsg.slice(0, 500),
                provider,
                retryable: true,
                occurredAt: new Date().toISOString(),
                partialChars: partial.text.length,
              },
            },
          })
          .catch(() => {});
      }
      // v10.0.20 · agent-trace error row — surface this in
      // /system/agent-traces with errorClass + the partial output
      // size so the operator can audit mid-stream failure rates.
      void recordTrace(
        {
          traceId,
          source: "chat",
          label: "chat-turn",
          provider,
          model: modelId,
          metadata: {
            streamError: true,
            partialChars: partial.text.length,
            conversationId,
          },
        },
        {
          durationMs: Date.now() - startedAt,
          outputChars: partial.text.length,
          errorClass: "stream_interrupted",
          errorMessage: errMsg,
        },
      );
      // Also write to ErrorLog for the operator dashboard.
      await prisma.errorLog
        .create({
          data: {
            level: "error",
            message: `[ai/chat] stream error: ${errMsg.slice(0, 200)}`,
            context: {
              conversationId,
              source: "streamText.onError",
              partialChars: partial.text.length,
            },
          },
        })
        .catch(() => {});
    } catch {
      /* swallow — onError must not throw */
    }
  };
}
