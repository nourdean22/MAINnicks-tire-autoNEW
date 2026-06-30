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
    defaultModel: "gpt-oss:120b",
    baseUrlEnv: "OLLAMA_BASE_URL",
    defaultBaseUrl: "https://ollama.com",
    visionModelEnv: "OLLAMA_VISION_MODEL",
    defaultVisionModel: "qwen3-vl:235b-instruct",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["glm-5", "glm-5.2", "qwen3", "deepseek-v4", "kimi", "gpt-oss"],
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
    defaultModel: "google/gemini-2.5-flash",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["gemini", "claude", "gpt"],
  },
};

export const TASK_ROUTING_PREFERENCES: Record<TaskType, RuntimeProviderName[]> = {
  fast: ["openrouter", "gemini", "ollama", "openai", "anthropic"],
  sql: ["openrouter", "ollama", "gemini", "openai", "anthropic"],
  summary: ["openrouter", "gemini", "ollama", "openai", "anthropic"],
  classify: ["openrouter", "gemini", "ollama", "openai", "anthropic"],
  extract: ["openrouter", "gemini", "ollama", "openai", "anthropic"],
  reason: ["openrouter", "ollama", "gemini", "openai", "anthropic"],
  vision: ["openrouter", "gemini", "ollama", "openai", "anthropic"],
  deep: ["openrouter", "ollama", "gemini", "openai", "anthropic"],
  code: ["openrouter", "ollama", "gemini", "openai", "anthropic"],
  math: ["openrouter", "ollama", "gemini", "openai", "anthropic"],
  creative: ["openrouter", "ollama", "gemini", "openai", "anthropic"],
  embed: ["openrouter", "gemini", "ollama", "openai", "anthropic"],
};
