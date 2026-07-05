/**
 * stream-with-fallback · v10 Track B.5 · Apr 30.
 *
 * Consolidated and upgraded to support Vercel AI SDK ToolLoopAgent,
 * dynamic think-tag stripping, and strict execution budget racing.
 *
 * v11 · Jun 30 · CRITICAL FIX · PR #403 introduced a custom
 * ReadableStream<object> filter that enqueued JS objects (not bytes).
 * When sse-stream.ts called Buffer.from(value) on these objects it
 * threw "Received an instance of Object", crashing EVERY chat message
 * that hit the main streamWithFallback path. Fixed by returning the
 * original AI SDK StreamTextResult whose toUIMessageStreamResponse()
 * properly serializes to the SSE data protocol.
 *
 * Think-tag stripping is now handled by the onChunk callback in the
 * chat route (__partialRef accumulator) — Gemini (current provider)
 * does not emit <think> tags, so the server-side filter was a no-op.
 * If a future provider emits think tags, add an experimental_transform
 * or strip them client-side.
 */

import { streamText, stepCountIs, type LanguageModel } from "ai";
import {
  getModel,
  markProviderFailed,
  type TaskType,
  type ProviderName,
} from "./provider";

export function inferProviderName(model: LanguageModel | unknown): ProviderName | null {
  const modelId =
    typeof model === "object" && model && "modelId" in model
      ? String((model as { modelId?: unknown }).modelId)
      : "";
  // 2026-07-04 (audit P2) · OpenRouter FIRST: its model ids are
  // vendor-prefixed ("google/gemini-2.5-flash", "openai/gpt-4o"). Without
  // this branch, "google/gemini-*" fell through to the gemini check below,
  // so a failing OpenRouter was never failure-marked (re-picked forever)
  // while the HEALTHY native gemini lane got banned in its place.
  // Prefix exceptions that are NOT OpenRouter: "models/" (Google's native
  // id form) and provider-name prefixes "gemini/"/"ollama/" (telemetry/
  // fixture shapes handled by the branches below). "openai/"/"anthropic/"/
  // "google/" prefixes ARE OpenRouter — native OpenAI/Anthropic SDK ids
  // are never slash-prefixed ("gpt-4o", "claude-3-5-sonnet").
  const slashIdx = modelId.indexOf("/");
  if (slashIdx > 0) {
    const prefix = modelId.slice(0, slashIdx).toLowerCase();
    if (!["models", "gemini", "ollama"].includes(prefix)) return "openrouter";
  }
  if (modelId.includes("gemini") || modelId.includes("google") || modelId.includes("Google")) return "gemini";
  if (modelId.includes("ollama") || modelId.includes("Ollama")) return "ollama";
  // 2026-07-05 (audit P3) · ollama's native id form is "name:tag"
  // ("gpt-oss:120b" — the deployed OLLAMA default — "llama3.1:8b",
  // "qwen3:14b"). Pre-P3 the startsWith("gpt-") branch below claimed
  // "gpt-oss:120b" for openai, so ollama failures banned the HEALTHY
  // openai lane and the (since-removed) ollama budget gate never fired.
  // No other provider uses colon-tag ids: OpenRouter ids are
  // slash-prefixed (caught above); native OpenAI/Anthropic/Gemini ids
  // never contain ":".
  if (/^[\w.-]+:[\w.-]+$/.test(modelId)) return "ollama";
  if (modelId.startsWith("gpt-") || modelId.includes("openai")) return "openai";
  if (modelId.includes("claude") || modelId.includes("anthropic")) return "anthropic";
  return null;
}

export interface StreamAttempt {
  attempt: number;
  provider: ProviderName | null;
  modelId: string;
  startedAt: string;
  failedAt: string | null;
  errorClass: string | null;
  errorMessage: string | null;
}

export interface StreamWithFallbackResult {
  result: {
    fullStream: ReadableStream;
    toUIMessageStreamResponse: () => Response;
    toolCalls: any;
  };
  model: LanguageModel;
  provider: ProviderName | null;
  attempts: StreamAttempt[];
}

export interface StreamWithFallbackOptions {
  buildConfig: (model: LanguageModel) => any;
  taskType: TaskType;
  preferLargeContext?: boolean;
  forceProviderFirst?: ProviderName;
  maxAttempts?: number;
  /**
   * 2026-07-05 (audit P3 · b) · how long the first-chunk probe waits
   * for a decisive stream part before committing to the attempt.
   * Default 10s. See probeFirstChunk below.
   */
  firstChunkTimeoutMs?: number;
}

/**
 * Stream parts the probe skips as "not decisive": they're emitted by
 * the SDK before the provider has produced anything, so they prove
 * neither life nor death. Everything else decides the attempt:
 * `error` → FAIL (rotate provider) · any other part → COMMIT.
 */
const PRE_CONTENT_PART_TYPES = new Set(["start", "start-step"]);

type ProbeOutcome =
  | { kind: "content" | "ended" | "timeout" }
  | { kind: "error-part"; message: string };

function extractPartErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    const json = JSON.stringify(err);
    return json && json !== "{}" ? json.slice(0, 300) : String(err);
  } catch {
    return String(err);
  }
}

/**
 * 2026-07-05 (audit P3 · b) · first-chunk probe. streamText NEVER
 * rejects on provider HTTP errors — it returns synchronously and the
 * failure surfaces later as a stream `error` part. Pre-P3 the fallback
 * loop judged an attempt only by whether the call threw, so same-turn
 * failover never engaged for a real provider failure.
 *
 * The probe reads a tee of `result.fullStream` (each `.fullStream`
 * access tees the base stream — verified in ai@6.0.162 — so the
 * route's later toUIMessageStreamResponse() still sees EVERY part from
 * the start; no re-emit needed). It waits up to `timeoutMs` for the
 * first decisive part:
 *   · `error` before any content → attempt FAILED (rotate provider)
 *   · any content part           → COMMIT
 *   · stream ended / timeout     → COMMIT (a slow provider is not a
 *     dead provider; mid-stream onError still covers late failures —
 *     never make the turn worse than the pre-probe status quo)
 * The probe reader is cancelled on settle (its tee branch stops
 * buffering); cancelling one tee branch does not cancel the source.
 */
async function probeFirstChunk(
  fullStream: ReadableStream,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const reader = fullStream.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProbeOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const read = (async (): Promise<ProbeOutcome> => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { kind: "ended" };
        const type =
          value && typeof value === "object" && "type" in value
            ? String((value as { type?: unknown }).type)
            : "";
        if (type === "error") {
          return {
            kind: "error-part",
            message: extractPartErrorMessage((value as { error?: unknown }).error),
          };
        }
        if (!PRE_CONTENT_PART_TYPES.has(type)) return { kind: "content" };
      }
    } catch {
      // Reader failure (e.g. cancelled under us) — treat as ended so
      // the attempt commits; the stream's own error handling owns it.
      return { kind: "ended" };
    }
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }
}

export async function streamWithFallback(
  opts: StreamWithFallbackOptions,
): Promise<StreamWithFallbackResult> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const attempts: StreamAttempt[] = [];
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = new Date().toISOString();
    let model: LanguageModel | null = null;
    let provider: ProviderName | null = null;
    let modelId = "";

    try {
      model = getModel(opts.taskType, {
        preferLargeContext: opts.preferLargeContext,
        forceProviderFirst: attempt === 1 ? opts.forceProviderFirst : undefined,
      });
      provider = inferProviderName(model);
      modelId =
        typeof model === "object" && model && "modelId" in model
          ? String((model as { modelId?: unknown }).modelId)
          : "unknown";
    } catch (err) {
      attempts.push({
        attempt,
        provider: null,
        modelId: "unavailable",
        startedAt,
        failedAt: new Date().toISOString(),
        errorClass: "no_provider_available",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      lastError = err;
      break;
    }

    try {
      const config = opts.buildConfig(model);

      // 2026-07-05 (audit P3 · a) · FULL config pass-through via plain
      // streamText. The previous ToolLoopAgent construction forwarded
      // only {model, tools, instructions, stopWhen, temperature,
      // onFinish, onStepFinish} and its stream() call had no slots for
      // onError/onChunk — silently dropping four route-built production
      // mechanisms: the graceful-degradation onError handler, the
      // TTFT/partial-text onChunk accumulator, the maxOutputTokens
      // budget, and forced toolChoice. Verified against the installed
      // ai@6.0.162 types: ToolLoopAgentSettings accepts maxOutputTokens
      // + toolChoice, but AgentStreamParameters has NO onChunk/onError —
      // so the agent wrapper is replaced with streamText, which accepts
      // the entire config (tools + stopWhen work identically; the agent
      // added nothing on this path).
      //
      // The 3.5s ollama "thinking budget" Promise.race is GONE: it raced
      // agent.stream()'s promise, but streamText returns synchronously so
      // there is nothing to race. It was latent anyway — the setTimeout
      // was never cleared on success, and its `provider === "ollama"`
      // gate never matched the deployed ollama ids ("gpt-oss:120b"
      // classifies as openai via startsWith("gpt-")).
      const abortController = new AbortController();

      // 2026-07-05 (audit P3 · b) · onError gate. With onError now
      // actually wired (P3 · a), a pre-first-token provider failure
      // would fire the route's graceful-degradation handler (persisting
      // a "stream interrupted" stub row) EVEN THOUGH the probe below
      // rotates to a healthy provider and the turn recovers. Gate the
      // callback on the probe's verdict:
      //   · undecided → buffer the event
      //   · committed → forward (and flush anything buffered — the tee
      //     preserves part order, so an error the probe classified as
      //     mid-stream is always forwarded exactly once)
      //   · failed    → drop; rotation owns the failure (attempt row +
      //     markProviderFailed), no stub row for a recovered turn
      let probeVerdict: "committed" | "failed" | null = null;
      const pendingErrors: Array<{ error: unknown }> = [];
      const routeOnError = config.onError as
        | ((event: { error: unknown }) => unknown)
        | undefined;
      const result = streamText({
        ...config,
        model,
        stopWhen: config.stopWhen ?? stepCountIs(5),
        abortSignal: abortController.signal,
        onError: (event: { error: unknown }) => {
          if (probeVerdict === "committed") {
            routeOnError?.(event);
            return;
          }
          if (probeVerdict === "failed") return;
          pendingErrors.push(event);
        },
      });

      const probeOutcome = await probeFirstChunk(
        result.fullStream as ReadableStream,
        opts.firstChunkTimeoutMs ?? 10_000,
      );
      if (probeOutcome.kind === "error-part") {
        probeVerdict = "failed";
        pendingErrors.length = 0;
        abortController.abort();
        attempts.push({
          attempt,
          provider,
          modelId,
          startedAt,
          failedAt: new Date().toISOString(),
          errorClass: "first_chunk_error_part",
          errorMessage: probeOutcome.message,
        });
        lastError = new Error(probeOutcome.message);
        if (provider) {
          markProviderFailed(provider);
        }
        continue;
      }
      probeVerdict = "committed";
      for (const event of pendingErrors.splice(0)) {
        routeOnError?.(event);
      }

      // Return the original AI SDK result directly. Its built-in
      // toUIMessageStreamResponse() properly serializes fullStream
      // chunks to the SSE data protocol (Uint8Array bytes), which is
      // what sse-stream.ts and use-chat-transport.ts expect.
      //
      // The previous code wrapped fullStream in a custom ReadableStream
      // that emitted JS objects and then wrapped THAT in new Response() —
      // sse-stream.ts called Buffer.from(objectChunk) which crashed with
      // "Received an instance of Object".

      attempts.push({
        attempt,
        provider,
        modelId,
        startedAt,
        failedAt: null,
        errorClass: null,
        errorMessage: null,
      });

      return {
        result: result as unknown as StreamWithFallbackResult["result"],
        model,
        provider,
        attempts,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      attempts.push({
        attempt,
        provider,
        modelId,
        startedAt,
        failedAt: new Date().toISOString(),
        errorClass: "stream_text_sync_throw",
        errorMessage: errMsg,
      });
      lastError = err;
      if (provider) {
        markProviderFailed(provider);
      }
    }
  }

  const summary = attempts
    .map((a) => `${a.provider ?? "?"}:${a.errorClass ?? "ok"}`)
    .join(" → ");
  const wrapped = new Error(
    `[stream-with-fallback] all ${attempts.length} provider attempts failed (${summary}). Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
  (wrapped as any).attempts = attempts;
  throw wrapped;
}
