/**
 * stream-with-fallback · v10 Track B.5 · Apr 30.
 *
 * Consolidated and upgraded to support Vercel AI SDK ToolLoopAgent,
 * dynamic think-tag stripping, and strict execution budget racing.
 */

import { ToolLoopAgent, stepCountIs, type LanguageModel } from "ai";
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
      let hasCommittedStream = false;

      // 2. Budget timeout (3.5s for local Ollama models)
      const isOllama = provider === "ollama";
      const thinkingBudgetMs = 3500;
      
      const budgetTimeout = isOllama
        ? new Promise<never>((_, reject) => {
            setTimeout(() => {
              if (!hasCommittedStream) {
                abortController.abort();
                reject(new Error("THINKING_BUDGET_EXCEEDED"));
              }
            }, thinkingBudgetMs);
          })
        : null;

      const agentStreamPromise = agent.stream({
        messages,
        abortSignal: abortController.signal,
      });

      const result = budgetTimeout
        ? await Promise.race([agentStreamPromise, budgetTimeout])
        : await agentStreamPromise;

      const reader = result.fullStream.getReader();
      let textBuffer = "";
      let insideThinkBlock = false;
      let visibleTextAccumulated = "";

      // 3. Setup guarded stream filter
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                const hasTools = result.toolCalls && (await result.toolCalls).length > 0;
                if (visibleTextAccumulated.trim().length === 0 && !hasTools) {
                  controller.error(new Error("EMPTY_STRIPPED_OUTPUT"));
                } else {
                  controller.close();
                }
                break;
              }

              // Handle streaming think-tag removal
              if (value.type === "text-delta" && typeof (value as any).text === "string") {
                textBuffer += (value as any).text;

                while (textBuffer.length > 0) {
                  if (!insideThinkBlock) {
                    const thinkStart = textBuffer.indexOf("<think>");
                    if (thinkStart !== -1) {
                      const visiblePart = textBuffer.slice(0, thinkStart);
                      if (visiblePart.length > 0) {
                        visibleTextAccumulated += visiblePart;
                        hasCommittedStream = true;
                        controller.enqueue({ type: "text-delta", text: visiblePart });
                      }
                      insideThinkBlock = true;
                      textBuffer = textBuffer.slice(thinkStart + 7);
                    } else {
                      const lastOpenBracket = textBuffer.lastIndexOf("<");
                      if (lastOpenBracket !== -1 && "<think>".startsWith(textBuffer.slice(lastOpenBracket))) {
                        const visiblePart = textBuffer.slice(0, lastOpenBracket);
                        if (visiblePart.length > 0) {
                          visibleTextAccumulated += visiblePart;
                          hasCommittedStream = true;
                          controller.enqueue({ type: "text-delta", textDelta: visiblePart });
                        }
                        textBuffer = textBuffer.slice(lastOpenBracket);
                        break;
                      } else {
                        visibleTextAccumulated += textBuffer;
                        hasCommittedStream = true;
                        controller.enqueue(value);
                        textBuffer = "";
                      }
                    }
                  } else {
                    const thinkEnd = textBuffer.indexOf("</think>");
                    if (thinkEnd !== -1) {
                      insideThinkBlock = false;
                      textBuffer = textBuffer.slice(thinkEnd + 8);
                    } else {
                      const lastOpenBracket = textBuffer.lastIndexOf("<");
                      if (lastOpenBracket !== -1 && "</think>".startsWith(textBuffer.slice(lastOpenBracket))) {
                        textBuffer = textBuffer.slice(lastOpenBracket);
                        break;
                      } else {
                        textBuffer = "";
                      }
                    }
                  }
                }
              } else {
                controller.enqueue(value);
              }
            }
          } catch (err) {
            controller.error(err);
          }
        },
      });

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
        result: {
          fullStream: stream,
          toUIMessageStreamResponse: () => new Response(stream, {
            headers: { "Content-Type": "text/event-stream; charset=utf-8" }
          }),
          toolCalls: result.toolCalls,
        },
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
