/**
 * Structured AI Response — JSON-schema generation helper.
 *
 * RENAMED from lib/ai/openai.ts on Apr 15 for clarity. The old name
 * implied it was OpenAI-specific which was WRONG — this file uses
 * getModel() from provider.ts, which routes through the full Venice
 * → Venice retry → OpenAI → Anthropic chain. Every structured call
 * benefits from the same fallback + task-type handling as plain chat.
 *
 * Exports:
 *   - createStructuredAiResponse<T>({ systemPrompt, userPrompt, schema })
 *   - probeAiHealth({ warm })
 *   - AiUnavailableError class
 *
 * Used by: next-move, clarify-mission, ai-health routes. Any route
 * that needs a JSON object back from the AI should use this instead
 * of manually parsing text from aiChat().
 */

import { generateText } from "ai";
import { getModel, getActiveProviderInfo } from "./provider";

export class AiUnavailableError extends Error {
  code: string;

  constructor(message = "AI unavailable", code = "unavailable") {
    super(message);
    this.name = "AiUnavailableError";
    this.code = code;
  }
}

type StructuredPrompt = {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

/**
 * Parse JSON from AI text response, handling markdown code blocks.
 */
function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  // Handle ```json ... ``` blocks
  if (trimmed.startsWith("```")) {
    const cleaned = trimmed.replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(cleaned);
  }
  // Extract first JSON object
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  return JSON.parse(trimmed);
}

/**
 * Generate a structured AI response using the main provider chain.
 * Uses prompt-based JSON extraction (works with all providers including Venice).
 */
export async function createStructuredAiResponse<T>(prompt: StructuredPrompt): Promise<T> {
  try {
    const model = getModel();

    const result = await generateText({
      model,
      system: prompt.systemPrompt,
      prompt: `${prompt.userPrompt}\n\nRespond with ONLY valid JSON matching this schema. No commentary, no markdown, no extra text:\n${JSON.stringify(prompt.schema, null, 2)}`,
    });

    if (!result.text?.trim()) {
      throw new AiUnavailableError("AI unavailable", "empty_response");
    }

    return parseJsonFromText(result.text) as T;
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    console.error("[ai/openai] structured response failed:", error);
    throw new AiUnavailableError("AI unavailable", "generation_failed");
  }
}

/**
 * Probe AI health — checks if the active provider is reachable.
 */
export async function probeAiHealth({ warm = false }: { warm?: boolean } = {}) {
  try {
    const { provider, modelId } = getActiveProviderInfo();
    const startedAt = performance.now();

    if (warm) {
      const model = getModel();
      await generateText({ model, prompt: "ready" });
    }

    return {
      status: "ready" as const,
      provider,
      model: modelId,
      detail: warm ? "Provider is warm and responding." : "Provider is configured.",
      warm,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    throw new AiUnavailableError(
      "AI unavailable",
      error instanceof Error ? error.message : "unknown"
    );
  }
}
