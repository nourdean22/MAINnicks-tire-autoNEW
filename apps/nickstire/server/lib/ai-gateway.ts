/**
 * AI Gateway — Unified routing layer for OpenAI / OpenRouter Gemini
 *
 * Routes AI requests to the best available provider based on:
 * - Task type (classification, generation, embeddings, SQL, code)
 * - Timeout handling
 *
 * OpenAI/OpenRouter serves as the primary provider for LLM completions.
 * Embeddings use OpenAI (text-embedding-3-small) as primary.
 *
 * NOTE: Ollama was the original local-dev provider but was removed when the
 * stack migrated fully to cloud AI. The `codex/ollama-local` git branch name
 * is historical — do not rename it, it's the live deploy branch.
 */

import { createLogger } from "./logger";
import { appendFile, stat, writeFile, mkdir } from "fs/promises";
import { join } from "path";

import { BUSINESS } from "@shared/business";
const log = createLogger("ai-gateway");

// ─── File-based persistent logging ──────────────────
const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "ai-gateway.log");
const MAX_LOG_SIZE = 1_000_000; // ~1MB

let logDirReady = false;

async function ensureLogDir() {
  if (logDirReady) return;
  try {
    await mkdir(LOG_DIR, { recursive: true });
    logDirReady = true;
  } catch (e) {
    log.warn("[lib/ai-gateway] operation failed:", e);
    // If mkdir fails, we'll just skip file logging
  }
}

async function persistLog(entry: Record<string, unknown>) {
  try {
    await ensureLogDir();
    const line = JSON.stringify(entry) + "\n";
    await appendFile(LOG_FILE, line, "utf-8");
    // Simple rotation: truncate when over ~1MB
    const s = await stat(LOG_FILE).catch((e) => { log.warn("[lib/ai-gateway] optional operation failed:", e); return null; });
    if (s && s.size > MAX_LOG_SIZE) {
      await writeFile(LOG_FILE, line, "utf-8");
    }
  } catch (e) {
    log.warn("[lib/ai-gateway] operation failed:", e);
    // Non-blocking — don't let logging failures break requests
  }
}

// ─── Configuration ───────────────────────────────────
const OPENAI_BASE = process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";

// Note: Ollama was removed when the stack migrated to Venice/OpenAI cloud.
// The "ollama" provider type and env vars have been stripped from runtime code.
// The `codex/ollama-local` git branch name is kept for historical reasons.
export type AIProvider = "openai";

export type TaskType =
  | "chat"           // General conversation / operator chat
  | "classify"       // Intent classification, sentiment, categorization
  | "generate"       // Content generation (SMS, email, blog)
  | "summarize"      // Summarization tasks
  | "extract"        // Data extraction from text
  | "sql"            // SQL generation
  | "code"           // Code generation / analysis
  | "embed"          // Embeddings
  | "receptionist"   // AI receptionist / customer-facing
  | "estimate"       // Auto repair estimates
  | "sms-response";  // SMS bot responses

export type RoutingPolicy = "local-only" | "remote-only" | "local-first" | "remote-first";

type ModelConfig = {
  provider: AIProvider;
  model: string;
  fallbackProvider?: AIProvider;
  fallbackModel?: string;
  timeoutMs: number;
};

// ─── Model routing table ─────────────────────────────
// OpenAI is the sole provider.
const ROUTING_TABLE: Record<TaskType, ModelConfig> = {
  chat: {
    provider: "openai",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  classify: {
    provider: "openai",
    model: "gpt-4o-mini",
    timeoutMs: 10_000,
  },
  generate: {
    provider: "openai",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 60_000,
  },
  summarize: {
    provider: "openai",
    model: "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  extract: {
    provider: "openai",
    model: "gpt-4o-mini",
    timeoutMs: 15_000,
  },
  sql: {
    provider: "openai",
    model: "gpt-4o-mini",
    timeoutMs: 20_000,
  },
  code: {
    provider: "openai",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  embed: {
    provider: "openai",
    model: "text-embedding-3-small",
    timeoutMs: 10_000,
  },
  receptionist: {
    provider: "openai",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 15_000,
  },
  estimate: {
    provider: "openai",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  "sms-response": {
    provider: "openai",
    model: "gpt-4o-mini",
    timeoutMs: 10_000,
  },
};

// ─── Provider request functions ──────────────────────

async function callOpenAI(model: string, messages: ChatMessage[], timeoutMs: number): Promise<GatewayResponse> {
  let apiKey = process.env.OPENAI_API_KEY;
  let baseUrl = OPENAI_BASE;
  let resolvedModel = model;

  if (process.env.GEMINI_API_KEY) {
    apiKey = process.env.GEMINI_API_KEY;
    baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
    if (!model || model.includes("gpt-") || model.includes("llama-") || model.includes("claude-")) {
      resolvedModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    }
  }

  if (!apiKey) throw new Error("Neither OPENAI_API_KEY nor GEMINI_API_KEY configured");

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: resolvedModel, messages, max_tokens: 4096 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI Gateway ${res.status}: ${body}`);
    }

    const data = await res.json();
    const latency = Date.now() - start;

    return {
      content: data.choices?.[0]?.message?.content || "",
      model: data.model || resolvedModel,
      provider: "openai",
      latencyMs: latency,
      tokensUsed: data.usage?.total_tokens,
      wasFallback: false,
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── Types ───────────────────────────────────────────

type ChatMessage = { role: string; content: string };

// Request and response interfaces are kept OpenAI-compatible
export type GatewayRequest = {
  task: TaskType;
  messages: ChatMessage[];
  overrideProvider?: AIProvider;
  overrideModel?: string;
};

export type GatewayResponse = {
  content: string;
  model: string;
  provider: AIProvider;
  latencyMs: number;
  tokensUsed?: number;
  fallbackUsed?: boolean;
  wasFallback: boolean;
};

// ─── Request log (in-memory ring buffer) ─────────────
type RequestLogEntry = {
  timestamp: number;
  task: TaskType;
  provider: AIProvider;
  model: string;
  latencyMs: number;
  success: boolean;
  fallbackUsed: boolean;
  error?: string;
  originalError?: string; // failure reason that triggered fallback
};

const requestLog: RequestLogEntry[] = [];
const MAX_LOG_ENTRIES = 50; // Reduced — tight container memory

// ─── Daily stats & latency tracking ─────────────────
let lastRequestAt: number | null = null;

type DailyStats = {
  date: string; // YYYY-MM-DD in ET
  total: number;
  venice: number;
  openai: number;
  failures: number;
  fallbacks: number;
};

type LatencyTracker = {
  totalMs: number;
  count: number;
};

let dailyStats: DailyStats = makeDailyStats();
const providerLatency: Record<AIProvider, LatencyTracker> = {
  openai: { totalMs: 0, count: 0 },
};

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
}

function makeDailyStats(): DailyStats {
  return { date: getTodayET(), total: 0, venice: 0, openai: 0, failures: 0, fallbacks: 0 };
}

function ensureDailyReset() {
  const today = getTodayET();
  if (dailyStats.date !== today) {
    dailyStats = makeDailyStats();
    providerLatency.openai = { totalMs: 0, count: 0 };
  }
}

function logRequest(entry: RequestLogEntry) {
  requestLog.push(entry);
  if (requestLog.length > MAX_LOG_ENTRIES) requestLog.splice(0, requestLog.length - MAX_LOG_ENTRIES);

  lastRequestAt = entry.timestamp;

  // Update daily stats
  ensureDailyReset();
  dailyStats.total++;
  if (entry.provider === "openai") dailyStats.openai++;
  if (!entry.success) dailyStats.failures++;
  if (entry.fallbackUsed) dailyStats.fallbacks++;

  // Update latency averages
  if (entry.success && entry.latencyMs > 0) {
    providerLatency[entry.provider].totalMs += entry.latencyMs;
    providerLatency[entry.provider].count++;
  }

  // Persist to file (fire-and-forget)
  persistLog({
    timestamp: new Date(entry.timestamp).toISOString(),
    task: entry.task,
    provider: entry.provider,
    model: entry.model,
    latencyMs: entry.latencyMs,
    success: entry.success,
    fallback: entry.fallbackUsed,
    error: entry.error || undefined,
    originalError: entry.originalError || undefined,
  });
}

// ─── Error classification ───────────────────────────
function classifyError(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  if (e.name === "AbortError" || e.message?.includes("aborted")) return "timeout";
  if (e.message?.includes("ECONNREFUSED")) return "connection_refused";
  if (e.message?.includes("ECONNRESET")) return "connection_reset";
  if (e.message?.includes("ETIMEDOUT")) return "network_timeout";
  if (e.message?.includes("404") || e.message?.includes("model")) return "model_not_found";
  if (e.message?.includes("429")) return "rate_limited";
  if (/\b5\d{2}\b/.test(e.message || "")) return "server_error";
  return "unknown";
}

// ─── Main gateway function ───────────────────────────

export async function aiGateway(request: GatewayRequest): Promise<GatewayResponse> {
  const config = ROUTING_TABLE[request.task];
  if (!config) throw new Error(`Unknown task type: ${request.task}`);

  const provider = request.overrideProvider || config.provider;
  const model = request.overrideModel || config.model;

  if (provider === "openai") {
    try {
      const result = await callOpenAI(model, request.messages, config.timeoutMs);
      logRequest({ timestamp: Date.now(), task: request.task, provider: "openai", model, latencyMs: result.latencyMs, success: true, fallbackUsed: false });
      log.info(`[${request.task}] OpenAI ${model} → ${result.latencyMs}ms`);
      return { ...result, wasFallback: false };
    } catch (err: unknown) {
      logRequest({ timestamp: Date.now(), task: request.task, provider: "openai", model, latencyMs: 0, success: false, fallbackUsed: false, error: (err as Error).message });
      throw err;
    }
  }

  throw new Error(`Provider ${provider} unavailable and no fallback configured for task ${request.task}`);
}

// ─── Health & stats endpoint data ────────────────────

export function getGatewayHealth() {
  const recent = requestLog.filter(r => r.timestamp > Date.now() - 300_000); // last 5 min
  const openaiRequests = recent.filter(r => r.provider === "openai");
  const failures = recent.filter(r => !r.success);
  const fallbacks = recent.filter(r => r.fallbackUsed);

  ensureDailyReset();

  const openaiLatency = providerLatency.openai;

  return {
    lastRequestAt: lastRequestAt ? new Date(lastRequestAt).toISOString() : null,
    stats: {
      last5min: {
        total: recent.length,
        openai: openaiRequests.length,
        failures: failures.length,
        fallbacks: fallbacks.length,
        avgLatencyMs: recent.length > 0 ? Math.round(recent.reduce((sum, r) => sum + r.latencyMs, 0) / recent.length) : 0,
      },
    },
    todayStats: { ...dailyStats },
    providerLatency: {
      openai: openaiLatency.count > 0 ? Math.round(openaiLatency.totalMs / openaiLatency.count) : 0,
    },
    recentRequests: requestLog.slice(-10).reverse(),
    routingTable: Object.entries(ROUTING_TABLE).map(([task, config]) => ({
      task,
      primaryProvider: config.provider,
      primaryModel: config.model,
      fallbackProvider: config.fallbackProvider,
      fallbackModel: config.fallbackModel,
      timeoutMs: config.timeoutMs,
    })),
  };
}

// ─── Model discovery ─────────────────────────────────

export async function getAvailableModels(): Promise<{ provider: AIProvider; models: string[] }[]> {
  const result: { provider: AIProvider; models: string[] }[] = [];

  if (process.env.GEMINI_API_KEY) {
    result.push({ provider: "openai", models: [process.env.GEMINI_MODEL || "gemini-2.5-flash", "text-embedding-3-small"] });
  } else if (process.env.OPENAI_API_KEY) {
    result.push({ provider: "openai", models: [process.env.LLM_MODEL || "gpt-4o-mini", "text-embedding-3-small"] });
  }

  return result;
}

// ─── Quick convenience functions ─────────────────────

export async function aiChat(userMessage: string, systemPrompt?: string): Promise<string> {
  const messages: ChatMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userMessage });
  const result = await aiGateway({ task: "chat", messages });
  return result.content;
}

export async function aiClassify(text: string, categories: string[]): Promise<string> {
  const result = await aiGateway({
    task: "classify",
    messages: [
      { role: "system", content: `Classify the following text into exactly one of these categories: ${categories.join(", ")}. Respond with only the category name.` },
      { role: "user", content: text },
    ],
  });
  return result.content.trim();
}

export async function aiSummarize(text: string, maxLength?: number): Promise<string> {
  const result = await aiGateway({
    task: "summarize",
    messages: [
      { role: "system", content: `Summarize the following text concisely${maxLength ? ` in under ${maxLength} characters` : ""}.` },
      { role: "user", content: text },
    ],
  });
  return result.content;
}
