/**
 * Multi-Provider AI Router — routes queries to the best provider.
 *
 * RENAMED from lib/ai/multi-model.ts on Apr 15. This is NOT a shadow
 * path — it's a SUPERSET of provider.ts that adds Grok + Perplexity
 * as additional providers for research + realtime tasks.
 *
 * Fallback chains by task type:
 *   research → Perplexity (citations) → Grok → provider.ts (Venice)
 *   realtime → Grok (real-time data) → Perplexity → provider.ts
 *   fast → provider.ts (Venice) → Grok
 *   analysis → Grok → provider.ts → Perplexity
 *   general → provider.ts → Grok → Perplexity
 *
 * The "local" provider in this file = provider.ts canonical chain
 * (Venice primary, with OpenAI/Anthropic fallbacks built in).
 *
 * Used by: integrations/copy (askAny), integrations/research (routeQuery).
 * Any route that needs Grok for real-time news or Perplexity for
 * citations should use this. For plain chat, use provider.ts directly.
 */

// v10.0.64 · AgentTrace coverage.
import { type TaskType } from "./provider";
import { makeTracedAiChat } from "./traced-aichat";
const aiChat = makeTracedAiChat("ai-router", "tool");
import { chatWithGrok } from "@/lib/integrations/grok";
import { askPerplexity } from "@/lib/integrations/perplexity";

export type ModelProvider = "local" | "grok" | "perplexity";

interface MultiModelResponse {
  content: string;
  provider: ModelProvider;
  model: string;
  fallbackUsed: boolean;
}

/**
 * Determine which providers are available based on env vars.
 */
function getAvailableProviders(): ModelProvider[] {
  const available: ModelProvider[] = ["local"]; // Always available (Venice via provider.ts)
  if (process.env.XAI_API_KEY) available.push("grok");
  if (process.env.PERPLEXITY_API_KEY) available.push("perplexity");
  return available;
}

/**
 * Route a query to the best model for the task.
 *
 * Task routing logic:
 * - "research" → Perplexity (has citations) → Grok → local
 * - "realtime" → Grok (real-time data) → Perplexity → local
 * - "fast" → local (Venice, fast) → Grok
 * - "analysis" → Grok → local → Perplexity
 * - default → local → Grok → Perplexity
 */
export async function routeQuery(
  prompt: string,
  taskType: "research" | "realtime" | "fast" | "analysis" | "general" = "general",
  systemPrompt?: string
): Promise<MultiModelResponse> {
  const available = getAvailableProviders();

  const priorities: Record<string, ModelProvider[]> = {
    research: ["perplexity", "grok", "local"],
    realtime: ["grok", "perplexity", "local"],
    fast: ["local", "grok"],
    analysis: ["grok", "local", "perplexity"],
    general: ["local", "grok", "perplexity"],
  };

  const ordered = priorities[taskType].filter((p) => available.includes(p));
  if (ordered.length === 0) ordered.push("local"); // Always have local

  let lastError: Error | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const provider = ordered[i];
    try {
      const result = await callProvider(provider, prompt, systemPrompt);
      return {
        ...result,
        provider,
        fallbackUsed: i > 0,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Continue to next provider
    }
  }

  throw lastError || new Error("No AI providers available");
}

async function callProvider(
  provider: ModelProvider,
  prompt: string,
  systemPrompt?: string
): Promise<{ content: string; model: string }> {
  switch (provider) {
    case "local": {
      const taskType: TaskType = "fast";
      const messages: { role: "system" | "user"; content: string }[] = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: prompt });
      const result = await aiChat(messages, taskType);
      return { content: result.content, model: result.model };
    }
    case "grok": {
      const messages: { role: "system" | "user"; content: string }[] = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: prompt });
      const result = await chatWithGrok(messages);
      return { content: result.content, model: result.model };
    }
    case "perplexity": {
      // v10.0.358 · askPerplexity signature changed to (question, opts) ·
      // wrap legacy systemPrompt string in an opts object.
      const result = await askPerplexity(prompt, systemPrompt ? { systemPrompt } : {});
      return { content: result.content, model: result.model };
    }
  }
}

/**
 * Quick helper — ask any available AI model.
 */
export async function askAny(prompt: string, systemPrompt?: string): Promise<string> {
  const result = await routeQuery(prompt, "general", systemPrompt);
  return result.content;
}

/**
 * Research with citations (prefers Perplexity).
 */
export async function research(query: string): Promise<MultiModelResponse> {
  return routeQuery(query, "research");
}

/**
 * Get real-time analysis (prefers Grok).
 */
export async function realtime(query: string): Promise<MultiModelResponse> {
  return routeQuery(query, "realtime");
}
