/**
 * stream-with-fallback · v10 Track B.5 · Apr 30.
 *
 * Same-turn provider fallback for streamText. v9.1.27 shipped
 * cross-request rotation (markProviderFailed + 60s sticky window).
 * This module adds same-turn fallback for the SYNCHRONOUS-throw
 * path: if streamText() throws before any token is emitted (bad
 * config, auth failure, immediate connection error), we retry with
 * the next provider before returning the user-facing Response.
 *
 * Out of scope (v10.1):
 *   - Post-first-token mid-stream recovery. Once SSE headers are
 *     sent, you can't switch providers without breaking the stream.
 *     v9.1.22's onError handler persists a stub message in that
 *     case; full recovery needs a streamText pipeline refactor.
 *
 * Trace: every attempt is logged to `prompt.same_turn_fallback`
 * SystemMetric so the operator dashboard can show
 *   - how often pre-first-token failures occur
 *   - which providers are flaky
 *   - whether fallback succeeds or all providers fail
 */

import { streamText, type LanguageModel } from "ai";
import {
  getModel,
  markProviderFailed,
  type TaskType,
  type ProviderName,
} from "./provider";

/**
 * Provider-name extraction from a model object's modelId. Mirrors
 * the heuristic in app/api/ai/chat/route.ts onError handler.
 *
 * v10.0.446 · exported so the chat route's streamText buildConfig
 * can attach Anthropic cacheControl ephemeral when Anthropic is the
 * active fallback provider (90% token discount on the system prompt).
 */
export function inferProviderName(model: LanguageModel | unknown): ProviderName | null {
  const modelId =
    typeof model === "object" && model && "modelId" in model
      ? String((model as { modelId?: unknown }).modelId)
      : "";
  if (modelId.includes("gemini") || modelId.includes("google") || modelId.includes("Google")) return "gemini";
  if (modelId.includes("ollama") || modelId.includes("Ollama")) return "ollama";
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
  /** The successful streamText result. */
  result: ReturnType<typeof streamText>;
  /** The model that ultimately served the request. */
  model: LanguageModel;
  /** Provider name that won. */
  provider: ProviderName | null;
  /** Trace of every attempt, including the successful one. */
  attempts: StreamAttempt[];
}

export interface StreamWithFallbackOptions {
  /**
   * Builder that produces the streamText config given the chosen
   * model. Called fresh on each attempt so onError handlers etc.
   * always reference the model that's actually serving.
   */
  buildConfig: (model: LanguageModel) => Parameters<typeof streamText>[0];
  /** TaskType passed to getModel() on each attempt. */
  taskType: TaskType;
  /** Whether to prefer the large-context provider chain. */
  preferLargeContext?: boolean;
  /**
   * v10.0.512 · Force a specific provider to the head of the chain
   * for this turn. Used on factual/customer/SEO queries to escalate
   * to Anthropic Claude (more compliant with tool/system directives).
   * Falls back to the normal chain if the forced provider is
   * unavailable or fails.
   */
  forceProviderFirst?: ProviderName;
  /** Max attempts before giving up. Default: number of available providers. */
  maxAttempts?: number;
}

/**
 * Wraps streamText with same-turn provider fallback.
 *
 * Behavior:
 *   1. Get a model via getModel() (skips recently-failed providers)
 *   2. Try streamText with that model
 *   3. If streamText throws synchronously (bad config, auth fail),
 *      mark the provider failed, get the next model, retry
 *   4. Repeat up to maxAttempts times
 *   5. If ALL attempts fail, throw the last error so the caller's
 *      outer try/catch returns 500
 *
 * The successful streamText result is returned; the caller passes
 * it to .toUIMessageStreamResponse() as before.
 *
 * Note: this does NOT catch async/post-stream errors. Those still
 * fire onError on the streamText result and the v9.1.22 stub-
 * message logic handles them. Same-turn pre-first-token recovery
 * is the v10 scope; mid-stream recovery is v10.1.
 */
export function streamWithFallback(
  opts: StreamWithFallbackOptions,
): StreamWithFallbackResult {
  const maxAttempts = opts.maxAttempts ?? 4; // 4 = venice, ollama, openai, anthropic
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
        // v10.0.512 · only pin on the FIRST attempt; if Anthropic
        // fails, subsequent attempts fall through to the normal
        // chain (Venice/Ollama/OpenAI) for graceful degradation.
        forceProviderFirst: attempt === 1 ? opts.forceProviderFirst : undefined,
      });
      provider = inferProviderName(model);
      modelId =
        typeof model === "object" && model && "modelId" in model
          ? String((model as { modelId?: unknown }).modelId)
          : "unknown";
    } catch (err) {
      // getModel itself threw — no providers available at all.
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
      // streamText doesn't throw async on its own — async failures
      // fire onError on the returned result. The throws we catch
      // here are SYNC: bad config, missing API key after available()
      // pass, malformed model, etc.
      const config = opts.buildConfig(model);
      const result = streamText(config);
      attempts.push({
        attempt,
        provider,
        modelId,
        startedAt,
        failedAt: null,
        errorClass: null,
        errorMessage: null,
      });
      return { result, model, provider, attempts };
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
      // Mark the provider failed so the next getModel() call skips it.
      if (provider) {
        markProviderFailed(provider);
      }
      // Continue to next attempt — getModel() will pick a different
      // provider on the next iteration since we just marked the
      // current one as failed.
    }
  }

  // All attempts exhausted. Throw an error that wraps the last
  // failure for the caller's outer try/catch.
  const summary = attempts
    .map((a) => `${a.provider ?? "?"}:${a.errorClass ?? "ok"}`)
    .join(" → ");
  const wrapped = new Error(
    `[stream-with-fallback] all ${attempts.length} provider attempts failed (${summary}). Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
  // Attach attempts so callers can persist the trace.
  (wrapped as Error & { attempts: StreamAttempt[] }).attempts = attempts;
  throw wrapped;
}
