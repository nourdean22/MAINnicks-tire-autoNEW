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

import { ToolLoopAgent, stepCountIs, type LanguageModel, type StreamTextResult, type ToolSet } from "ai";
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
      
      // 1. Build ToolLoopAgent config
      const systemPrompt = config.system || (config.messages?.[0]?.role === "system" ? config.messages[0].content : "");
      const messages = config.system ? config.messages : config.messages?.slice(1) || [];

      const agent = new ToolLoopAgent({
        model,
        tools: config.tools,
        instructions: systemPrompt,
        stopWhen: config.stopWhen ?? stepCountIs(5),
        temperature: config.temperature,
        onFinish: config.onFinish,
        onStepFinish: config.onStepFinish,
      });

      const abortController = new AbortController();

      // 2. Budget timeout (3.5s for local Ollama models)
      const isOllama = provider === "ollama";
      const thinkingBudgetMs = 3500;
      
      const budgetTimeout = isOllama
        ? new Promise<never>((_, reject) => {
            setTimeout(() => {
              abortController.abort();
              reject(new Error("THINKING_BUDGET_EXCEEDED"));
            }, thinkingBudgetMs);
          })
        : null;

      const agentStreamPromise = agent.stream({
        messages,
        abortSignal: abortController.signal,
        experimental_transform: config.experimental_transform,
      });

      const result = budgetTimeout
        ? await Promise.race([agentStreamPromise, budgetTimeout])
        : await agentStreamPromise;

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
