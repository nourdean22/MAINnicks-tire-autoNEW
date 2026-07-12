export const AI_PROVIDER_COOLDOWN_MS = 2 * 60_000;

export type RuntimeProviderName = "ollama" | "gemini" | "openai" | "anthropic" | "openrouter";

export type TaskType =
  | "fast"
  | "reason"
  | "deep"
  | "vision"
  | "embed"
  | "code"
  | "sql"
  | "math"
  | "creative"
  | "summary"
  | "classify"
  | "extract";

export interface ProviderConfig {
  id: RuntimeProviderName;
  apiKeyEnv: string[];
  modelEnv: string;
  defaultModel: string;
  cooldownMs: number;
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
  visionModelEnv?: string;
  defaultVisionModel?: string;
  modelSubstrings: string[];
}

export const PROVIDERS_REGISTRY: Record<RuntimeProviderName, ProviderConfig> = {
  ollama: {
    id: "ollama",
    apiKeyEnv: ["OLLAMA_API_KEY"],
    modelEnv: "OLLAMA_MODEL",
    // 2026-07-12 · least-restricted tool-reliable model on the Ollama Cloud
    // key (verified: emits valid tool_calls via the OpenAI-compat endpoint).
    // deepseek-v3.1:671b has the lightest content filtering of the tool-capable
    // models offered; the ~7s latency is the user-facing reason/chat lane's
    // cost. Fast internal lanes use OLLAMA_FAST_MODEL (glm-5.2, ~1s). Override
    // both via Railway env.
    defaultModel: "deepseek-v3.1:671b",
    baseUrlEnv: "OLLAMA_BASE_URL",
    defaultBaseUrl: "https://ollama.com",
    visionModelEnv: "OLLAMA_VISION_MODEL",
    defaultVisionModel: "qwen3-vl:235b-instruct",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["glm-5", "glm-5.2", "qwen3", "qwen3.5", "deepseek-v3", "deepseek-v4", "kimi", "minimax", "mistral-large", "gpt-oss"],
  },
  gemini: {
    id: "gemini",
    apiKeyEnv: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-3.5-flash",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["gemini"],
  },
  openai: {
    id: "openai",
    apiKeyEnv: ["OPENAI_API_KEY"],
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4o",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["gpt", "o1", "o3", "o4"],
  },
  anthropic: {
    id: "anthropic",
    apiKeyEnv: ["ANTHROPIC_API_KEY"],
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-3-5-sonnet-latest",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["claude"],
  },
  openrouter: {
    id: "openrouter",
    apiKeyEnv: ["OPENROUTER_API_KEY"],
    modelEnv: "OPENROUTER_MODEL",
    // 2026-07-06 · uncensored chat model. OpenRouter is the PRIMARY chat
    // provider (TASK_ROUTING_PREFERENCES puts it first), so this id is what
    // actually serves most turns. Switched off google/gemini-2.5-flash — whose
    // safety filters can't be disabled through OpenRouter's OpenAI-compat API
    // and were truncating/restricting replies — to x-ai/grok, a strong,
    // tool-reliable model with lighter default filtering than Gemini.
    // (That's a judgment from hands-on testing, NOT a measured
    // filter-strength benchmark; the OS runs on tool calls like createTask,
    // so tool reliability is the hard constraint.) Fully-zero-filter models (euryale, dolphin)
    // are RP-tuned and weak at agentic tool-use, which would break the OS.
    // Override anytime via OPENROUTER_MODEL — e.g. sao10k/l3.1-euryale-70b for
    // zero-filter at the cost of weaker tool-calling.
    defaultModel: "x-ai/grok-4.3",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["gemini", "claude", "gpt", "grok"],
  },
};

// 2026-07-12 · OLLAMA CLOUD FIRST for every task (operator directive). Ollama
// Cloud (ollama.com) serves large, lightly-filtered models on a flat un-metered
// key — no per-token spend cap to hang like Gemini did, and the least-restricted
// tool-reliable models available to this deployment (deepseek-v3.1:671b for the
// user-facing reason/chat lane, glm-5.2 for the fast internal lane — see
// resolveProviderModel + OLLAMA_MODEL / OLLAMA_FAST_MODEL). OpenRouter (grok)
// stays as the 2nd hop so a cooldown never dead-ends a turn; gemini drops to a
// late fallback since its key is spend-capped. Order is preference only — the
// runtime still skips any provider whose key is missing or in cooldown.
export const TASK_ROUTING_PREFERENCES: Record<TaskType, RuntimeProviderName[]> = {
  fast: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  sql: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  summary: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  classify: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  extract: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  reason: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  vision: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  deep: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  code: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  math: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  creative: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
  embed: ["ollama", "openrouter", "gemini", "openai", "anthropic"],
};
