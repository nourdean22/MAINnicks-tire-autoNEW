export const AI_PROVIDER_COOLDOWN_MS = 2 * 60_000;

export type RuntimeProviderName = "ollama" | "gemini" | "openai" | "anthropic";

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
    defaultModel: "qwen3-vl:235b-instruct",
    baseUrlEnv: "OLLAMA_BASE_URL",
    defaultBaseUrl: "https://ollama.com",
    visionModelEnv: "OLLAMA_VISION_MODEL",
    defaultVisionModel: "qwen3-vl:235b-instruct",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["qwen3", "deepseek-v4", "kimi"],
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
    defaultModel: "gpt-4o-mini",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["gpt", "o1", "o3", "o4"],
  },
  anthropic: {
    id: "anthropic",
    apiKeyEnv: ["ANTHROPIC_API_KEY"],
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    cooldownMs: AI_PROVIDER_COOLDOWN_MS,
    modelSubstrings: ["claude"],
  },
};

export const TASK_ROUTING_PREFERENCES: Record<TaskType, RuntimeProviderName[]> = {
  fast: ["gemini", "ollama", "openai", "anthropic"],
  sql: ["gemini", "ollama", "openai", "anthropic"],
  summary: ["gemini", "ollama", "openai", "anthropic"],
  classify: ["gemini", "ollama", "openai", "anthropic"],
  extract: ["gemini", "ollama", "openai", "anthropic"],
  reason: ["ollama", "gemini", "openai", "anthropic"],
  vision: ["ollama", "gemini", "openai", "anthropic"],
  deep: ["ollama", "openai", "anthropic", "gemini"],
  code: ["ollama", "openai", "anthropic", "gemini"],
  math: ["openai", "gemini", "ollama", "anthropic"],
  creative: ["ollama", "gemini", "openai", "anthropic"],
  embed: ["ollama", "gemini", "openai", "anthropic"],
};
