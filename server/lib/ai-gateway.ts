/**
 * AI Gateway — Unified routing layer for local (Ollama) and remote (OpenAI) models
 *
 * Routes AI requests to the best available provider based on:
 * - Task type (classification, generation, embeddings, SQL, code)
 * - Model availability (local health check)
 * - Fallback policy (local-first with cloud fallback)
 * - Timeout handling
 *
 * Ollama runs locally at http://localhost:11434 with OpenAI-compatible API.
 * Available local models: dolphin-nour, dolphin-nour-deep, phi4-mini, gemma3:4b, sqlcoder:7b
 */

import { createLogger } from "./logger";
import { appendFile, stat, writeFile, mkdir } from "fs/promises";
import { join } from "path";

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
  } catch {
    // If mkdir fails, we'll just skip file logging
  }
}

async function persistLog(entry: Record<string, unknown>) {
  try {
    await ensureLogDir();
    const line = JSON.stringify(entry) + "\n";
    await appendFile(LOG_FILE, line, "utf-8");
    // Simple rotation: truncate when over ~1MB
    const s = await stat(LOG_FILE).catch(() => null);
    if (s && s.size > MAX_LOG_SIZE) {
      await writeFile(LOG_FILE, line, "utf-8");
    }
  } catch {
    // Non-blocking — don't let logging failures break requests
  }
}

// ─── Configuration ───────────────────────────────────
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OPENAI_BASE = process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";

export type AIProvider = "ollama" | "openai";

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
// Defines which model handles each task type, with fallbacks
const ROUTING_TABLE: Record<TaskType, ModelConfig> = {
  chat: {
    provider: "ollama",
    model: "dolphin-nour:latest",
    fallbackProvider: "openai",
    fallbackModel: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  classify: {
    provider: "ollama",
    model: "phi4-mini:latest",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 10_000,
  },
  generate: {
    provider: "openai",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 60_000,
  },
  summarize: {
    provider: "ollama",
    model: "dolphin-nour:latest",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  extract: {
    provider: "ollama",
    model: "phi4-mini:latest",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 15_000,
  },
  sql: {
    provider: "ollama",
    model: "sqlcoder:7b",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 20_000,
  },
  code: {
    provider: "ollama",
    model: "dolphin-nour-deep:latest",
    fallbackProvider: "openai",
    fallbackModel: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  embed: {
    provider: "ollama",
    model: "nomic-embed-text:latest",
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
    provider: "ollama",
    model: "dolphin-nour:latest",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 10_000,
  },
};

// ─── Health tracking ─────────────────────────────────
let ollamaHealthy = true;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60_000; // 1 minute

async function checkOllamaHealth(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) return ollamaHealthy;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    ollamaHealthy = res.ok;
  } catch {
    ollamaHealthy = false;
  }
  lastHealthCheck = now;
  return ollamaHealthy;
}

// ─── Provider request functions ──────────────────────

async function callOllama(model: string, messages: OllamaMessage[], timeoutMs: number): Promise<GatewayResponse> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama ${res.status}: ${body}`);
    }

    const data = await res.json();
    const latency = Date.now() - start;

    return {
      content: data.choices?.[0]?.message?.content || "",
      model: data.model || model,
      provider: "ollama",
      latencyMs: latency,
      tokensUsed: data.usage?.total_tokens,
      wasFallback: false,
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function callOpenAI(model: string, messages: OllamaMessage[], timeoutMs: number): Promise<GatewayResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: 4096 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body}`);
    }

    const data = await res.json();
    const latency = Date.now() - start;

    return {
      content: data.choices?.[0]?.message?.content || "",
      model: data.model || model,
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

type OllamaMessage = { role: string; content: string };

export type GatewayRequest = {
  task: TaskType;
  messages: OllamaMessage[];
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
const MAX_LOG_ENTRIES = 200;

// ─── Daily stats & latency tracking ─────────────────
let lastRequestAt: number | null = null;

type DailyStats = {
  date: string; // YYYY-MM-DD in ET
  total: number;
  ollama: number;
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
  ollama: { totalMs: 0, count: 0 },
  openai: { totalMs: 0, count: 0 },
};

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function makeDailyStats(): DailyStats {
  return { date: getTodayET(), total: 0, ollama: 0, openai: 0, failures: 0, fallbacks: 0 };
}

function ensureDailyReset() {
  const today = getTodayET();
  if (dailyStats.date !== today) {
    dailyStats = makeDailyStats();
    providerLatency.ollama = { totalMs: 0, count: 0 };
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
  dailyStats[entry.provider]++;
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
function classifyError(err: any): string {
  if (err.name === "AbortError" || err.message?.includes("aborted")) return "timeout";
  if (err.message?.includes("ECONNREFUSED")) return "connection_refused";
  if (err.message?.includes("ECONNRESET")) return "connection_reset";
  if (err.message?.includes("ETIMEDOUT")) return "network_timeout";
  if (err.message?.includes("404") || err.message?.includes("model")) return "model_not_found";
  if (err.message?.includes("429")) return "rate_limited";
  if (/\b5\d{2}\b/.test(err.message || "")) return "server_error";
  return "unknown";
}

// ─── Main gateway function ───────────────────────────

export async function aiGateway(request: GatewayRequest): Promise<GatewayResponse> {
  const config = ROUTING_TABLE[request.task];
  if (!config) throw new Error(`Unknown task type: ${request.task}`);

  const provider = request.overrideProvider || config.provider;
  const model = request.overrideModel || config.model;

  // Check if Ollama is available for local-first routing
  const ollamaAvailable = provider === "ollama" ? await checkOllamaHealth() : false;

  // Primary attempt
  if (provider === "ollama" && ollamaAvailable) {
    try {
      const result = await callOllama(model, request.messages, config.timeoutMs);
      logRequest({ timestamp: Date.now(), task: request.task, provider: "ollama", model, latencyMs: result.latencyMs, success: true, fallbackUsed: false });
      log.info(`[${request.task}] Ollama ${model} → ${result.latencyMs}ms`);
      return { ...result, wasFallback: false };
    } catch (err: any) {
      const failureReason = classifyError(err);
      log.warn(`[${request.task}] Ollama failed (${failureReason}): ${err.message}`);
      logRequest({ timestamp: Date.now(), task: request.task, provider: "ollama", model, latencyMs: 0, success: false, fallbackUsed: false, error: err.message });

      // Fallback to cloud
      if (config.fallbackProvider && config.fallbackModel) {
        log.info(`[${request.task}] Triggering fallback: ollama/${model} → openai/${config.fallbackModel} (reason: ${failureReason})`);
        try {
          const fallbackResult = await callOpenAI(config.fallbackModel, request.messages, config.timeoutMs);
          logRequest({ timestamp: Date.now(), task: request.task, provider: "openai", model: config.fallbackModel, latencyMs: fallbackResult.latencyMs, success: true, fallbackUsed: true, originalError: `${failureReason}: ${err.message}` });
          log.info(`[${request.task}] Fallback OpenAI ${config.fallbackModel} → ${fallbackResult.latencyMs}ms`);
          return { ...fallbackResult, fallbackUsed: true, wasFallback: true };
        } catch (fallbackErr: any) {
          logRequest({ timestamp: Date.now(), task: request.task, provider: "openai", model: config.fallbackModel, latencyMs: 0, success: false, fallbackUsed: true, error: fallbackErr.message, originalError: `${failureReason}: ${err.message}` });
          throw new Error(`Both Ollama and OpenAI failed. Primary (${failureReason}): ${err.message}. Fallback: ${fallbackErr.message}`);
        }
      }
      throw err;
    }
  }

  // Ollama requested but not available — use fallback
  if (provider === "ollama" && !ollamaAvailable && config.fallbackProvider === "openai" && config.fallbackModel) {
    log.info(`[${request.task}] Ollama unavailable (health check failed), using OpenAI fallback → ${config.fallbackModel}`);
    const result = await callOpenAI(config.fallbackModel, request.messages, config.timeoutMs);
    logRequest({ timestamp: Date.now(), task: request.task, provider: "openai", model: config.fallbackModel, latencyMs: result.latencyMs, success: true, fallbackUsed: true, originalError: "ollama_unavailable: health check failed" });
    return { ...result, fallbackUsed: true, wasFallback: true };
  }

  // Direct OpenAI
  if (provider === "openai") {
    const result = await callOpenAI(model, request.messages, config.timeoutMs);
    logRequest({ timestamp: Date.now(), task: request.task, provider: "openai", model, latencyMs: result.latencyMs, success: true, fallbackUsed: false });
    log.info(`[${request.task}] OpenAI ${model} → ${result.latencyMs}ms`);
    return { ...result, wasFallback: false };
  }

  throw new Error(`Provider ${provider} unavailable and no fallback configured for task ${request.task}`);
}

// ─── Health & stats endpoint data ────────────────────

export function getGatewayHealth() {
  const recent = requestLog.filter(r => r.timestamp > Date.now() - 300_000); // last 5 min
  const ollamaRequests = recent.filter(r => r.provider === "ollama");
  const openaiRequests = recent.filter(r => r.provider === "openai");
  const failures = recent.filter(r => !r.success);
  const fallbacks = recent.filter(r => r.fallbackUsed);

  ensureDailyReset();

  const ollamaLatency = providerLatency.ollama;
  const openaiLatency = providerLatency.openai;

  return {
    ollamaHealthy,
    ollamaBase: OLLAMA_BASE,
    lastRequestAt: lastRequestAt ? new Date(lastRequestAt).toISOString() : null,
    stats: {
      last5min: {
        total: recent.length,
        ollama: ollamaRequests.length,
        openai: openaiRequests.length,
        failures: failures.length,
        fallbacks: fallbacks.length,
        avgLatencyMs: recent.length > 0 ? Math.round(recent.reduce((sum, r) => sum + r.latencyMs, 0) / recent.length) : 0,
      },
    },
    todayStats: { ...dailyStats },
    providerLatency: {
      ollama: ollamaLatency.count > 0 ? Math.round(ollamaLatency.totalMs / ollamaLatency.count) : 0,
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

  // Ollama models
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      const data = await res.json();
      result.push({ provider: "ollama", models: data.models?.map((m: any) => m.name) || [] });
    }
  } catch {
    result.push({ provider: "ollama", models: [] });
  }

  // OpenAI is always available if key exists
  if (process.env.OPENAI_API_KEY) {
    result.push({ provider: "openai", models: [process.env.LLM_MODEL || "gpt-4o-mini"] });
  }

  return result;
}

// ─── Quick convenience functions ─────────────────────

export async function aiChat(userMessage: string, systemPrompt?: string): Promise<string> {
  const messages: OllamaMessage[] = [];
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
