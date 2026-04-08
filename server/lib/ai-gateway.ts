/**
 * AI Gateway — Unified routing layer for Venice (primary), OpenAI (fallback), and Ollama (local dev)
 *
 * Routes AI requests to the best available provider based on:
 * - Task type (classification, generation, embeddings, SQL, code)
 * - Provider availability (Venice health check + circuit breaker)
 * - Fallback policy (Venice-first with OpenAI fallback)
 * - Timeout handling
 *
 * Venice is OpenAI-compatible at https://api.venice.ai/api/v1.
 * OpenAI is the fallback for all tasks. Embeddings use OpenAI as primary (text-embedding-3-small).
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
const VENICE_BASE = process.env.VENICE_BASE_URL?.replace(/\/$/, "") || "https://api.venice.ai/api/v1";
const OPENAI_BASE = process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

export type AIProvider = "venice" | "openai" | "ollama";

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
// Venice is primary for all LLM tasks. OpenAI is fallback.
// Embeddings use OpenAI primary (Venice doesn't support embeddings).
const ROUTING_TABLE: Record<TaskType, ModelConfig> = {
  chat: {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  classify: {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 10_000,
  },
  generate: {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 60_000,
  },
  summarize: {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  extract: {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 15_000,
  },
  sql: {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 20_000,
  },
  code: {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  embed: {
    provider: "openai",
    model: "text-embedding-3-small",
    timeoutMs: 10_000,
  },
  receptionist: {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 15_000,
  },
  estimate: {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: 30_000,
  },
  "sms-response": {
    provider: "venice",
    model: process.env.VENICE_MODEL || "llama-3.3-70b",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    timeoutMs: 10_000,
  },
};

// ─── Health tracking + Circuit Breaker ──────────────
let veniceHealthy = true;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60_000; // 1 minute

// Circuit breaker: after N consecutive failures, skip Venice for COOLDOWN period → OpenAI takeover
let consecutiveVeniceFailures = 0;
let circuitOpenUntil = 0;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 120_000; // 2 minutes

function isCircuitOpen(): boolean {
  if (Date.now() < circuitOpenUntil) return true;
  // Reset if cooldown expired
  if (consecutiveVeniceFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    consecutiveVeniceFailures = 0;
    log.info("Circuit breaker reset — retrying Venice");
  }
  return false;
}

function recordVeniceSuccess() {
  consecutiveVeniceFailures = 0;
  veniceHealthy = true;
}

function recordVeniceFailure() {
  consecutiveVeniceFailures++;
  if (consecutiveVeniceFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    veniceHealthy = false;
    log.warn(`Circuit breaker OPEN — skipping Venice for ${CIRCUIT_COOLDOWN_MS / 1000}s after ${consecutiveVeniceFailures} failures`);
  }
}

async function checkVeniceHealth(): Promise<boolean> {
  if (isCircuitOpen()) return false;

  const now = Date.now();
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) return veniceHealthy;

  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) {
    veniceHealthy = false;
    lastHealthCheck = now;
    return false;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${VENICE_BASE}/models`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    veniceHealthy = res.ok;
    if (res.ok) consecutiveVeniceFailures = 0;
  } catch (err) {
    veniceHealthy = false;
    log.debug("Venice health check failed", { error: err instanceof Error ? err.message : String(err) });
  }
  lastHealthCheck = now;
  return veniceHealthy;
}

// ─── Provider request functions ──────────────────────

async function callVenice(model: string, messages: ChatMessage[], timeoutMs: number): Promise<GatewayResponse> {
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) throw new Error("VENICE_API_KEY not configured");

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${VENICE_BASE}/chat/completions`, {
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
      throw new Error(`Venice ${res.status}: ${body}`);
    }

    const data = await res.json();
    const latency = Date.now() - start;

    return {
      content: data.choices?.[0]?.message?.content || "",
      model: data.model || model,
      provider: "venice",
      latencyMs: latency,
      tokensUsed: data.usage?.total_tokens,
      wasFallback: false,
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function callOpenAI(model: string, messages: ChatMessage[], timeoutMs: number): Promise<GatewayResponse> {
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

type ChatMessage = { role: string; content: string };

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
  venice: { totalMs: 0, count: 0 },
  openai: { totalMs: 0, count: 0 },
  ollama: { totalMs: 0, count: 0 },
};

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function makeDailyStats(): DailyStats {
  return { date: getTodayET(), total: 0, venice: 0, openai: 0, failures: 0, fallbacks: 0 };
}

function ensureDailyReset() {
  const today = getTodayET();
  if (dailyStats.date !== today) {
    dailyStats = makeDailyStats();
    providerLatency.venice = { totalMs: 0, count: 0 };
    providerLatency.openai = { totalMs: 0, count: 0 };
    providerLatency.ollama = { totalMs: 0, count: 0 };
  }
}

function logRequest(entry: RequestLogEntry) {
  requestLog.push(entry);
  if (requestLog.length > MAX_LOG_ENTRIES) requestLog.splice(0, requestLog.length - MAX_LOG_ENTRIES);

  lastRequestAt = entry.timestamp;

  // Update daily stats
  ensureDailyReset();
  dailyStats.total++;
  if (entry.provider === "venice") dailyStats.venice++;
  else if (entry.provider === "openai") dailyStats.openai++;
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

  // Venice primary attempt
  if (provider === "venice") {
    const veniceAvailable = await checkVeniceHealth();

    if (veniceAvailable) {
      try {
        const result = await callVenice(model, request.messages, config.timeoutMs);
        recordVeniceSuccess();
        logRequest({ timestamp: Date.now(), task: request.task, provider: "venice", model, latencyMs: result.latencyMs, success: true, fallbackUsed: false });
        log.info(`[${request.task}] Venice ${model} → ${result.latencyMs}ms`);
        return { ...result, wasFallback: false };
      } catch (err: any) {
        recordVeniceFailure();
        const failureReason = classifyError(err);
        log.warn(`[${request.task}] Venice failed (${failureReason}): ${err.message}`);
        logRequest({ timestamp: Date.now(), task: request.task, provider: "venice", model, latencyMs: 0, success: false, fallbackUsed: false, error: err.message });

        // Fallback to OpenAI
        if (config.fallbackProvider === "openai" && config.fallbackModel) {
          log.info(`[${request.task}] Triggering fallback: venice/${model} → openai/${config.fallbackModel} (reason: ${failureReason})`);
          try {
            const fallbackResult = await callOpenAI(config.fallbackModel, request.messages, config.timeoutMs);
            logRequest({ timestamp: Date.now(), task: request.task, provider: "openai", model: config.fallbackModel, latencyMs: fallbackResult.latencyMs, success: true, fallbackUsed: true, originalError: `${failureReason}: ${err.message}` });
            log.info(`[${request.task}] Fallback OpenAI ${config.fallbackModel} → ${fallbackResult.latencyMs}ms`);
            return { ...fallbackResult, fallbackUsed: true, wasFallback: true };
          } catch (fallbackErr: any) {
            logRequest({ timestamp: Date.now(), task: request.task, provider: "openai", model: config.fallbackModel, latencyMs: 0, success: false, fallbackUsed: true, error: fallbackErr.message, originalError: `${failureReason}: ${err.message}` });
            throw new Error(`Both Venice and OpenAI failed. Primary (${failureReason}): ${err.message}. Fallback: ${fallbackErr.message}`);
          }
        }
        throw err;
      }
    }

    // Venice unavailable (circuit open or health check failed) — use OpenAI fallback
    if (config.fallbackProvider === "openai" && config.fallbackModel) {
      log.info(`[${request.task}] Venice unavailable (circuit open or health check failed), using OpenAI fallback → ${config.fallbackModel}`);
      const result = await callOpenAI(config.fallbackModel, request.messages, config.timeoutMs);
      logRequest({ timestamp: Date.now(), task: request.task, provider: "openai", model: config.fallbackModel, latencyMs: result.latencyMs, success: true, fallbackUsed: true, originalError: "venice_unavailable: health check failed" });
      return { ...result, fallbackUsed: true, wasFallback: true };
    }
  }

  // Direct OpenAI (used for embeds and any openai-primary tasks)
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
  const veniceRequests = recent.filter(r => r.provider === "venice");
  const openaiRequests = recent.filter(r => r.provider === "openai");
  const failures = recent.filter(r => !r.success);
  const fallbacks = recent.filter(r => r.fallbackUsed);

  ensureDailyReset();

  const veniceLatency = providerLatency.venice;
  const openaiLatency = providerLatency.openai;

  return {
    veniceHealthy,
    veniceBase: VENICE_BASE,
    circuitBreaker: {
      open: isCircuitOpen(),
      consecutiveFailures: consecutiveVeniceFailures,
      cooldownUntil: circuitOpenUntil > Date.now() ? new Date(circuitOpenUntil).toISOString() : null,
    },
    lastRequestAt: lastRequestAt ? new Date(lastRequestAt).toISOString() : null,
    stats: {
      last5min: {
        total: recent.length,
        venice: veniceRequests.length,
        openai: openaiRequests.length,
        failures: failures.length,
        fallbacks: fallbacks.length,
        avgLatencyMs: recent.length > 0 ? Math.round(recent.reduce((sum, r) => sum + r.latencyMs, 0) / recent.length) : 0,
      },
    },
    todayStats: { ...dailyStats },
    providerLatency: {
      venice: veniceLatency.count > 0 ? Math.round(veniceLatency.totalMs / veniceLatency.count) : 0,
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

  // Venice models
  const veniceKey = process.env.VENICE_API_KEY;
  if (veniceKey) {
    try {
      const res = await fetch(`${VENICE_BASE}/models`, {
        headers: { "Authorization": `Bearer ${veniceKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const data = await res.json();
        result.push({ provider: "venice", models: data.data?.map((m: any) => m.id) || [process.env.VENICE_MODEL || "llama-3.3-70b"] });
      } else {
        result.push({ provider: "venice", models: [process.env.VENICE_MODEL || "llama-3.3-70b"] });
      }
    } catch (err) {
      log.debug("Venice model discovery failed", { error: err instanceof Error ? err.message : String(err) });
      result.push({ provider: "venice", models: [process.env.VENICE_MODEL || "llama-3.3-70b"] });
    }
  }

  // OpenAI is always available if key exists
  if (process.env.OPENAI_API_KEY) {
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
