/**
 * Unified AI provider layer for NOUR OS v8.1
 *
 * Provider chain: Ollama Cloud → Gemini → OpenAI → Anthropic.
 * (Venice retired — removed from the runtime PROVIDERS list. The
 * VENICE_PARAMS / clearVeniceQuotaExhausted exports remain as empty
 * no-ops for getProviderStatus back-compat only.)
 *
 * Per-task routing tunes the provider order, reasoning effort, and
 * temperature; see getPreferredOrderForTask + getModel below.
 *
 * ──────────────────────────────────────────────────────────────
 * ⚠  KNOWN ISSUE — DO NOT USE FROM STANDALONE SCRIPTS
 *
 * This module WORKS in the Next.js runtime (API routes, crons) but
 * has historically been fragile when imported from a standalone
 * `tsx scripts/foo.ts` context, where the Vercel AI SDK's
 * OpenAI-compatible client can choke on provider-specific response
 * fields outside Next.js.
 *
 * Do NOT try to replace aiChat() here — it works fine in Next.js
 * routes where 95% of the traffic lives, and the AI SDK handles
 * streaming, tool calls, and provider fallback that the backfill
 * scripts don't need. Keep the two code paths separate.
 * ──────────────────────────────────────────────────────────────
 */

import { checkLaneBudget } from "@/lib/ai/budget";
import { trackGeneration } from "@/lib/ai/track";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { langfuseTelemetry, type LangfuseTelemetryInput } from "@/lib/observability/langfuse";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  generateText,
  wrapLanguageModel,
  extractReasoningMiddleware,
  type LanguageModel,
} from "ai";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";
import {
  PROVIDERS_REGISTRY,
  TASK_ROUTING_PREFERENCES,
  PROVIDER_COST_CLASS,
  PROVIDER_ROUTING_COST_CLASS,
  type ProviderRoutingCostClass,
  type RuntimeProviderName,
  type TaskType,
} from "@/config/ai-providers";
import { claudeCompatMiddlewareFor } from "./claude5-compat";

export type { RuntimeProviderName, TaskType };

// v10.0.18 · structured logger for the provider layer. Surface tag
// lets /system/* dashboards filter by domain without parsing free-form
// `msg` strings. console.* calls in this file are kept ONLY for the
// fetch-level log lines that need to fire BEFORE the JSON serializer
// path (everything else routes through this logger).
const log = rootLogger.withSurface("ai/provider");

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Strip trailing \n, \r\n, whitespace, and literal backslash-n from env values */
function cleanEnv(val: string | undefined): string | undefined {
  if (!val) return val;
  return val.replace(/\\n/g, "").replace(/\\r/g, "").trim();
}

function getApiKey(provider: RuntimeProviderName): string | undefined {
  const cfg = PROVIDERS_REGISTRY[provider];
  for (const envKey of cfg.apiKeyEnv) {
    const val = cleanEnv(process.env[envKey]);
    if (val) return val;
  }
  return undefined;
}

export function resolveProviderModel(provider: RuntimeProviderName, taskType?: TaskType): string {
  const cfg = PROVIDERS_REGISTRY[provider];
  // 2026-07-29 · vision resolution used to be OLLAMA-ONLY. Every other
  // provider ignored taskType "vision" and returned its default chat
  // model, so when the ollama vision lane died — which this config
  // records happening TWICE (qwen3-vl retired 06-16, "every image chat
  // turn hit a dead model") — the fallback handed the image to whatever
  // came next, including openrouter's text chat model. The provider
  // rejected the image part and the operator saw only "Stream failed."
  // Now any provider that DECLARES a vision model resolves it here, and
  // isVisionCapableProvider() keeps the ones that don't out of the chain.
  if (taskType === "vision" && cfg.defaultVisionModel) {
    return (
      (cfg.visionModelEnv ? cleanEnv(process.env[cfg.visionModelEnv]) : "") ||
      cfg.defaultVisionModel
    );
  }
  // 2026-07-12 · Ollama two-lane. Ollama Cloud is now primary for every task,
  // but the strongest / least-restricted model (deepseek-v3.1:671b · OLLAMA_
  // MODEL) runs ~7s — fine for the user-facing chat/reason lane, wasteful on
  // the high-frequency internal lanes (classify/extract/summary/sql) that fire
  // several times per turn. Route those to OLLAMA_FAST_MODEL (a ~1s light-filter
  // model, e.g. glm-5.2). Falls back to OLLAMA_MODEL when the fast env is unset,
  // so behavior is unchanged unless the operator sets it.
  if (provider === "ollama" && (taskType === "fast" || taskType === "classify" || taskType === "extract" || taskType === "summary" || taskType === "sql")) {
    return (
      cleanEnv(process.env.OLLAMA_FAST_MODEL) ||
      cleanEnv(process.env[cfg.modelEnv]) ||
      cfg.defaultModel
    );
  }
  if (provider === "openrouter") {
    if (taskType === "reason" || taskType === "deep" || taskType === "code") {
      // 2026-07-06 · uncensored reasoning model (was google/gemini-2.5-pro,
      // whose safety filters can't be disabled via OpenRouter). x-ai/grok is
      // a strong reasoning + tool-calling model with minimal content filtering.
      // Override via OPENROUTER_REASONING_MODEL.
      return cleanEnv(process.env.OPENROUTER_REASONING_MODEL) || "x-ai/grok-4.3";
    }
    return cleanEnv(process.env[cfg.modelEnv]) || cfg.defaultModel;
  }
  return cleanEnv(process.env[cfg.modelEnv]) || cfg.defaultModel;
}

function getBaseUrl(provider: RuntimeProviderName): string | undefined {
  const cfg = PROVIDERS_REGISTRY[provider];
  if (cfg.baseUrlEnv) {
    return cleanEnv(process.env[cfg.baseUrlEnv]) || cfg.defaultBaseUrl;
  }
  return undefined;
}

const AI_PROVIDER = cleanEnv(process.env.AI_PROVIDER) as
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | undefined;

export type ProviderName =
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "emergency";

/**
 * Single source of truth for providers wired into the live runtime.
 * Excludes the retired `venice` and `emergency`.
 */
export const RUNTIME_PROVIDERS = ["ollama", "gemini", "openai", "anthropic", "openrouter"] as const;

/** True iff `v` is a provider the runtime can actually serve. */
export function isRuntimeProvider(v: unknown): v is RuntimeProviderName {
  return typeof v === "string" && (RUNTIME_PROVIDERS as readonly string[]).includes(v);
}

/**
 * Canonical model-id → provider classifier · ONE source of truth.
 *
 * Consolidates the three copies that previously drifted: inferProviderName
 * (failure-marking, stream-with-fallback.ts), the inline branch in
 * stream-error-handler.ts, and modelToProvider (telemetry, provider-health.ts).
 * That last one lacked the slash-first branch and misattributed OpenRouter ids
 * ("google/gemini-2.5-flash") to the native gemini lane — this is the fix.
 *
 * Precedence is the union of all three so no caller loses coverage:
 *  1. slash-first — OpenRouter ids are vendor-prefixed ("google/gemini-*",
 *     "openai/gpt-*"). Native OpenAI/Anthropic ids are never slash-prefixed.
 *     "models/" (Google native) + "gemini/"/"ollama/" (telemetry shapes) are NOT OpenRouter.
 *  2. colon-tag — ollama's native id form ("gpt-oss:120b", "qwen3:14b").
 *  3. registry-substring scan — catches bare ollama model families
 *     ("glm-5", "qwen3", "deepseek-v4", "kimi", "gpt-oss") the keyword pass misses.
 *  4. keyword fallback — gemini/google, ollama, gpt-/openai, claude/anthropic aliases.
 */
export function classifyModelId(modelId: string | null | undefined): ProviderName | null {
  const id = (modelId ?? "").trim();
  if (!id) return null;
  const lower = id.toLowerCase();
  const slashIdx = id.indexOf("/");
  if (slashIdx > 0 && !["models", "gemini", "ollama"].includes(lower.slice(0, slashIdx))) return "openrouter";
  if (/^[\w.-]+:[\w.-]+$/.test(id)) return "ollama";
  for (const provider of RUNTIME_PROVIDERS) {
    const cfg = PROVIDERS_REGISTRY[provider];
    if (lower === cfg.defaultModel.toLowerCase() || (cfg.defaultVisionModel && lower === cfg.defaultVisionModel.toLowerCase())) return provider;
    for (const sub of cfg.modelSubstrings) if (lower.includes(sub.toLowerCase())) return provider;
  }
  if (lower.includes("gemini") || lower.includes("google")) return "gemini";
  if (lower.includes("ollama")) return "ollama";
  if (id.startsWith("gpt-") || lower.includes("openai")) return "openai";
  if (lower.includes("claude") || lower.includes("anthropic")) return "anthropic";
  return null;
}

// Retired (Venice removed from runtime) · kept empty for getProviderStatus back-compat.
export const VENICE_PARAMS = {};

function createAnthropicModel(modelOverride?: string): LanguageModel {
  const apiKey = getApiKey("anthropic");
  // 2026-08-28 · escalation lane. A per-TURN model id (opus-5 for a
  // deep/thorough ask, fable-5 for an explicit mega) cannot come from
  // ANTHROPIC_MODEL, which is process-global. The override is threaded
  // from lib/ai/vnext/escalation.ts through getModel; absent it, the env
  // default is unchanged for every existing caller.
  const modelId = modelOverride || resolveProviderModel("anthropic");
  const anthropic = createAnthropic({ apiKey: apiKey! });
  const model = anthropic(modelId);
  // 2026-08-11 · Claude 4.7-and-later models reject sampling params
  // (temperature/top_p/top_k → 400), and the 5 family counts default-on
  // adaptive thinking against maxOutputTokens, so the compat middleware
  // strips/floors at the ONE place every caller passes through — an
  // ANTHROPIC_MODEL flip is safe with zero call-site changes. 2026-09-29
  // (#2768): claude-sonnet-5, the default, is covered too.
  // See lib/ai/claude5-compat.ts.
  const compat = claudeCompatMiddlewareFor(modelId);
  return compat ? wrapLanguageModel({ model, middleware: compat }) : model;
}

function createOpenAIModel(): LanguageModel {
  const apiKey = getApiKey("openai");
  const modelId = resolveProviderModel("openai");
  const openai = createOpenAI({ apiKey: apiKey! });
  return openai(modelId);
}

function createGoogleModel(taskType?: TaskType): LanguageModel {
  const apiKey = getApiKey("gemini");
  const modelId = resolveProviderModel("gemini", taskType);
  const google = createGoogleGenerativeAI({ apiKey: apiKey! });
  return google(modelId);
}

/**
 * 2026-07-06 · Gemini safety-filter override. Passed via
 * `providerOptions.google` at the streamText / generateText call sites (the
 * @ai-sdk/google v3 API — safetySettings is a per-call GoogleLanguageModelOptions
 * field, NOT a model-creation option). Ignored by non-Google providers.
 *
 * Why: safetySettings were UNSET everywhere, so Gemini applied its DEFAULT
 * filters, which can TRUNCATE a reply mid-generation on flagged content — the
 * leading suspect behind the operator's "messages don't finish" report (a
 * ~44-token mid-sentence cut that NO maxOutputTokens cap explains: query-shape
 * budgets 300-1600, mode default 1200, aiChat 1500-8000). The truncated turn
 * was the model AFFIRMING it is "unrestricted / will do anything" — squarely
 * in the dangerous-content / harassment filters. Disabling them removes that
 * truncation vector AND matches OWNER AUTHORITY: a single-operator personal OS,
 * not a public product, so provider-side content filtering is an unwanted
 * restriction on the owner.
 */
export const GEMINI_SAFETY_OFF: {
  safetySettings: Array<{ category: string; threshold: string }>;
} = {
  safetySettings: [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
  ],
};

function createOpenRouterModel(taskType?: TaskType): LanguageModel {
  const apiKey = getApiKey("openrouter");
  const modelId = resolveProviderModel("openrouter", taskType);
  const openrouter = createOpenAI({
    apiKey: apiKey!,
    baseURL: "https://openrouter.ai/api/v1",
  });
  // 2026-07-04 (chat-pipeline audit P2) · MUST be .chat(), not the bare
  // callable: in @ai-sdk/openai v3 the provider CALLABLE defaults to the
  // RESPONSES API, so this was posting to openrouter.ai/api/v1/responses —
  // the strict zod validator behind the prod invalid_prompt/invalid_union
  // 400s (poison-pill incident). Chat Completions is the endpoint the
  // item_reference sanitizer in build-model-messages.ts was built for.
  return openrouter.chat(modelId);
}


/**
 * Retry an Ollama request against a sibling model when the configured id
 * has been RETIRED.
 *
 * Ollama Cloud retires cloud models on a rolling schedule and the id simply
 * stops resolving. That has already cost this repo two incidents:
 * qwen3-vl (2026-06-16, vision lane) and deepseek-v3.1:671b (2026-07-15),
 * the latter taking the whole reason/chat lane down for ~9h because every
 * paid provider fallback was simultaneously exhausted.
 *
 * The existing provider chain (ollama -> gemini -> openai -> ...) only helps
 * when a DIFFERENT provider is healthy. A retired model is not a provider
 * outage: Ollama is up, this one id is gone. Trying a sibling Ollama model
 * first is strictly cheaper and far likelier to succeed than burning a paid lane.
 *
 * SCOPE IS DELIBERATELY NARROW: 404/410 only. A 5xx, a 429 or a timeout is
 * NOT a retirement and must fall through untouched so the real provider
 * fallback still owns those. Widening this would silently swallow outages.
 *
 * Exported for test. `fetchImpl` is injected so the retirement path can be
 * exercised without a network.
 */
export async function fetchWithModelRetirementFallback(
  fetchImpl: typeof fetch,
  url: Parameters<typeof fetch>[0],
  options: Parameters<typeof fetch>[1],
  modelId: string,
  fallbackModelsEnv?: string
): Promise<Response> {
  const res = await fetchImpl(url, options);
  if (res.status !== 404 && res.status !== 410) return res;

  const candidates = (fallbackModelsEnv ?? process.env.OLLAMA_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0 && m !== modelId);

  if (candidates.length === 0) {
    // Say so loudly rather than letting a 404 look like a generic provider
    // failure downstream - that misdiagnosis is what cost 9h last time.
    logError(
      "ai.provider",
      new Error(
        `Ollama model "${modelId}" returned ${res.status} (retired or unknown) and OLLAMA_FALLBACK_MODELS is unset`
      ),
      { fn: "fetchWithModelRetirementFallback", modelId, status: res.status },
      "error"
    );
    return res;
  }

  for (const candidate of candidates) {
    let retryBody = options?.body;
    if (typeof retryBody === "string") {
      try {
        const parsed = JSON.parse(retryBody);
        parsed.model = candidate;
        retryBody = JSON.stringify(parsed);
      } catch {
        break; // unparseable body - cannot safely swap the model
      }
    }
    const retry = await fetchImpl(url, { ...options, body: retryBody });
    if (retry.status !== 404 && retry.status !== 410) {
      logError(
        "ai.provider",
        new Error(
          `Ollama model "${modelId}" is gone (${res.status}); served by fallback "${candidate}". Update OLLAMA_MODEL.`
        ),
        { fn: "fetchWithModelRetirementFallback", modelId, servedBy: candidate },
        "warn"
      );
      return retry;
    }
  }

  logError(
    "ai.provider",
    new Error(`Ollama model "${modelId}" and all ${candidates.length} fallbacks returned 404/410`),
    { fn: "fetchWithModelRetirementFallback", modelId, candidates: candidates.join(",") },
    "error"
  );
  return res;
}

function createOllamaModel(taskType: TaskType = "reason"): LanguageModel {
  const apiKey = getApiKey("ollama");
  const modelId = resolveProviderModel("ollama", taskType);
  const baseUrl = getBaseUrl("ollama");
  const ollama = createOpenAI({
    apiKey: apiKey!,
    baseURL: baseUrl ? `${baseUrl}/v1` : undefined,
    fetch: async (url, options) => {
      if (options?.body && typeof options.body === "string") {
        try {
          const parsed = JSON.parse(options.body);
          // Always enforce a strict upper bound to prevent infinite <think> loop drains.
          // 2026-07-15 · reason/deep lanes get 8192: Ollama Cloud IGNORES
          // `reasoning: { exclude: true }` for deepseek-v4-pro (probed live —
          // reasoning tokens still emitted), so on heavy prompts the model can
          // burn most of a 4096 budget on hidden reasoning and return EMPTY
          // content on the post-tool continuation (the silent-tool-turn bug).
          // Double headroom on the long-form lanes keeps a hard bound while
          // leaving room for visible text after the reasoning spend.
          const MAX_TOKENS = taskType === "reason" || taskType === "deep" ? 8192 : 4096;
          const requested = typeof parsed.max_tokens === "number" ? parsed.max_tokens : MAX_TOKENS;
          const num_predict = Math.min(requested, MAX_TOKENS);

          parsed.options = { ...parsed.options, num_predict };

          // Configure reasoning / thinking budget for reasoning models under Ollama/OpenRouter
          const isReasoningModel = ["glm-5", "glm-5.2", "gpt-oss", "deepseek"].some((m) =>
            modelId.toLowerCase().includes(m)
          );
          if (isReasoningModel) {
            const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
            const needsDeepReasoning = taskType === "reason" || taskType === "deep";

            if (hasTools || !needsDeepReasoning) {
              // Exclude reasoning to avoid burning the output token budget and ensure tools/text are returned
              parsed.reasoning = { exclude: true };
              parsed.include_reasoning = false;
            } else {
              // Limit reasoning tokens to leave room for the actual response
              parsed.reasoning = { max_tokens: 1024 };
              parsed.include_reasoning = true;
            }
          }

          options.body = JSON.stringify(parsed);
        } catch (err) {
          // Body rewrite is best-effort — the request proceeds unclamped.
          logError("ai.provider", err, { fn: "createOllamaModel", modelId }, "warn");
        }
      }
      return fetchWithModelRetirementFallback(fetch, url, options, modelId);
    },
  });
  return ollama.chat(modelId);
}

// ---------------------------------------------------------------------------
// Availability checks
// ---------------------------------------------------------------------------

// Reusable per-provider quota circuit-breaker.
function makeQuotaBreaker(provider: ProviderName, cooldownMs: number) {
  let until = 0;
  return {
    mark(): void {
      until = Date.now() + cooldownMs;
      log.warn("provider.quota_exhausted", {
        provider,
        cooldownMin: cooldownMs / 60_000,
      });
    },
    clear(): void {
      if (until > 0) {
        until = 0;
        log.info("provider.quota_cleared", { provider });
      }
    },
    isExhausted(): boolean {
      return Date.now() < until;
    },
    remainingMs(): number {
      const diff = until - Date.now();
      return diff > 0 ? diff : 0;
    },
  };
}

export const markVeniceQuotaExhausted = () => {};
export const clearVeniceQuotaExhausted = () => {};
export const isVeniceQuotaExhausted = () => false;

function isVeniceAvailable(): boolean {
  return false;
}

const anthropicBreaker = makeQuotaBreaker("anthropic", PROVIDERS_REGISTRY.anthropic.cooldownMs);
// 2026-07-16 (chat audit) · mark/clear were NEVER exported for the
// anthropic + openai breakers — the breakers existed but nothing could
// trip them, so during the 07-15 provider outage every chat call
// re-tried the dead lanes and burned the full per-attempt timeout
// (~29s/call). Exported now and wired into the stream failure paths
// (stream-with-fallback.ts + stream-error-handler.ts), exactly like
// gemini/ollama.
export const markAnthropicQuotaExhausted = anthropicBreaker.mark;
export const clearAnthropicQuotaExhausted = anthropicBreaker.clear;
export const isAnthropicQuotaExhausted = anthropicBreaker.isExhausted;
export const getAnthropicCooldownRemainingMs = anthropicBreaker.remainingMs;

function isAnthropicAvailable(): boolean {
  if (anthropicBreaker.isExhausted()) return false;
  return !!getApiKey("anthropic");
}

const openaiBreaker = makeQuotaBreaker("openai", PROVIDERS_REGISTRY.openai.cooldownMs);
export const markOpenAiQuotaExhausted = openaiBreaker.mark;
export const clearOpenAiQuotaExhausted = openaiBreaker.clear;
export const isOpenAiQuotaExhausted = openaiBreaker.isExhausted;
export const getOpenAiCooldownRemainingMs = openaiBreaker.remainingMs;

function isOpenAIAvailable(): boolean {
  if (openaiBreaker.isExhausted()) return false;
  return !!getApiKey("openai");
}

const ollamaBreaker = makeQuotaBreaker("ollama", PROVIDERS_REGISTRY.ollama.cooldownMs);
export const markOllamaQuotaExhausted = ollamaBreaker.mark;
export const clearOllamaQuotaExhausted = ollamaBreaker.clear;
export const isOllamaQuotaExhausted = ollamaBreaker.isExhausted;
export const getOllamaCooldownRemainingMs = ollamaBreaker.remainingMs;

// Background health check cache for Ollama v10.1
let ollamaHealthCached = true;
let lastOllamaCheckTime = 0;
let isCheckingOllamaHealth = false;

export async function probeOllamaHealth(): Promise<void> {
  if (isCheckingOllamaHealth) return;
  isCheckingOllamaHealth = true;
  try {
    const baseUrl = getBaseUrl("ollama");
    const apiKey = getApiKey("ollama");
    if (!baseUrl || !apiKey) {
      ollamaHealthCached = false;
      return;
    }
    const url = `${baseUrl}/v1/models`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3-second timeout

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      log.warn("ollama.health_check_failed", { status: res.status });
      ollamaHealthCached = false;
      return;
    }

    const data = await res.json();
    const targetModel = resolveProviderModel("ollama");
    const models = data?.data || [];
    const hasTargetModel = models.some((m: any) => 
      m.id === targetModel || 
      m.id?.includes("glm-5.2") || 
      m.id?.includes("glm-5")
    );
    
    if (models.length > 0 && !hasTargetModel) {
      log.warn("ollama.health_check_model_missing", { targetModel, available: models.map((m: any) => m.id) });
      ollamaHealthCached = false;
    } else {
      ollamaHealthCached = true;
    }
  } catch (err) {
    log.warn("ollama.health_check_exception", { error: String(err) });
    ollamaHealthCached = false;
  } finally {
    lastOllamaCheckTime = Date.now();
    isCheckingOllamaHealth = false;
  }
}

function isOllamaAvailable(): boolean {
  const apiKey = getApiKey("ollama");
  if (!apiKey || apiKey.length < 20) return false;
  if (isOllamaQuotaExhausted()) return false;

  // Skip live health checks in testing to keep unit tests isolated and fast
  if (process.env.NODE_ENV === "test") {
    return true;
  }

  const now = Date.now();
  if (now - lastOllamaCheckTime > 60_000) {
    probeOllamaHealth().catch((e) => log.error("ollama.background_health_check_error", e));
  }

  return ollamaHealthCached;
}

const geminiBreaker = makeQuotaBreaker("gemini", PROVIDERS_REGISTRY.gemini.cooldownMs);
export const markGeminiQuotaExhausted = geminiBreaker.mark;
export const clearGeminiQuotaExhausted = geminiBreaker.clear;
export const isGeminiQuotaExhausted = geminiBreaker.isExhausted;
export const getGeminiCooldownRemainingMs = geminiBreaker.remainingMs;

function isGeminiAvailable(): boolean {
  if (!getApiKey("gemini")) return false;
  if (isGeminiQuotaExhausted()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 2026-07-16 (chat audit) · unified quota-error marking.
//
// One dispatcher for "this provider failed with a quota/billing-class
// error → trip its circuit breaker" so the stream failure paths don't
// each hand-roll a provider switch (the old code special-cased gemini
// and silently skipped openai/anthropic — their breakers were dead
// weight and the 07-15 outage burned ~29s per call re-trying them).
// ---------------------------------------------------------------------------

const QUOTA_BREAKER_MARKS: Partial<Record<ProviderName, () => void>> = {
  gemini: geminiBreaker.mark,
  ollama: ollamaBreaker.mark,
  openai: openaiBreaker.mark,
  anthropic: anthropicBreaker.mark,
};

/**
 * Quota / billing failure detector. Superset of the regex the
 * stream-error-handler previously applied to gemini only, extended with
 * the OpenAI ("insufficient_quota", "429 Too Many Requests") and
 * Anthropic ("credit balance is too low", payment errors) shapes.
 */
export const QUOTA_ERROR_RE =
  /quota|exhausted|budget|spending.*cap|billing|limit|insufficient|payment|credit.?balance|too many requests|\b429\b/i;

/**
 * Trip `provider`'s quota breaker iff `errorMessage` looks like a
 * quota/billing failure. Returns true when a breaker was tripped.
 * No-op (false) for providers without a breaker (openrouter/emergency)
 * and for non-quota errors — those stay on the short markProviderFailed
 * 60s rotation instead of the long cooldown.
 */
export function markProviderQuotaExhausted(
  provider: ProviderName,
  errorMessage: string,
): boolean {
  if (!QUOTA_ERROR_RE.test(errorMessage)) return false;
  const mark = QUOTA_BREAKER_MARKS[provider];
  if (!mark) return false;
  mark();
  return true;
}

// ---------------------------------------------------------------------------
// 2026-07-16 (chat audit) · ground-truth provider tag.
//
// Failure-marking used to depend ENTIRELY on string inference over the
// modelId (classifyModelId). When inference failed on an unknown id the
// marking silently no-opped and the dead lane was re-picked on every
// retry. getModel() KNOWS which provider entry built the model — tag it
// on the model object so downstream marking never has to guess.
// Symbol.for so the tag survives duplicated module instances.
// ---------------------------------------------------------------------------

const MODEL_PROVIDER_TAG = Symbol.for("nour.ai.providerName");

function tagModelProvider(model: LanguageModel, provider: ProviderName): LanguageModel {
  try {
    Object.defineProperty(model as object, MODEL_PROVIDER_TAG, {
      value: provider,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // Frozen/proxy model — inference fallback still applies downstream.
  }
  return model;
}

/** Ground-truth provider for a model built by getModel(); null for untagged models. */
export function getTaggedModelProvider(model: unknown): ProviderName | null {
  if (model && (typeof model === "object" || typeof model === "function")) {
    const v = (model as Record<symbol, unknown>)[MODEL_PROVIDER_TAG];
    if (typeof v === "string" && ((RUNTIME_PROVIDERS as readonly string[]).includes(v) || v === "emergency")) {
      return v as ProviderName;
    }
  }
  return null;
}

function isOpenRouterAvailable(): boolean {
  return !!getApiKey("openrouter");
}

// ---------------------------------------------------------------------------
// Ordered provider list
// ---------------------------------------------------------------------------

interface ProviderEntry {
  name: ProviderName;
  available: () => boolean;
  create: (taskType?: TaskType, modelOverride?: string) => LanguageModel;
  modelId: string;
}

const PROVIDER_CREATORS: Record<
  RuntimeProviderName,
  (taskType?: TaskType, modelOverride?: string) => LanguageModel
> = {
  ollama: (t) => createOllamaModel(t),
  gemini: (t) => createGoogleModel(t),
  openai: () => createOpenAIModel(),
  // Only the anthropic lane honours a per-turn model override today (the
  // escalation lane). Other providers ignore it rather than silently
  // resolving a model id that does not exist in their namespace.
  anthropic: (_t, modelOverride) => createAnthropicModel(modelOverride),
  openrouter: (t) => createOpenRouterModel(t),
};

const PROVIDER_AVAILABILITY: Record<RuntimeProviderName, () => boolean> = {
  ollama: isOllamaAvailable,
  gemini: isGeminiAvailable,
  openai: isOpenAIAvailable,
  anthropic: isAnthropicAvailable,
  openrouter: isOpenRouterAvailable,
};

const PROVIDERS: ProviderEntry[] = RUNTIME_PROVIDERS.map((name) => ({
  name,
  available: PROVIDER_AVAILABILITY[name],
  create: PROVIDER_CREATORS[name],
  get modelId() {
    return resolveProviderModel(name);
  },
}));

// ---------------------------------------------------------------------------
// v9.1.27 · Recently-failed provider tracker
//
// The chat route uses streamText() directly with a single model from
// getModel(). Once SSE headers are sent, you can't switch providers
// mid-stream. So if ollama errors mid-response on turn N, the user
// gets an interrupted stream — and if turn N+1 fires immediately
// after, getModel() picks ollama AGAIN (it's still available()) and
// hits the same dead provider.
//
// Fix: when an onError fires, the chat route calls
// markProviderFailed(name). getModel() skips providers marked as
// failed within the last FAILURE_TTL_MS window. After the window,
// the provider auto-rehabs back into rotation. This gives us
// automatic provider rotation across REQUESTS without needing to
// refactor the streamText pipeline.
// ---------------------------------------------------------------------------

const FAILURE_TTL_MS = 60_000; // 1 minute
const recentFailures = new Map<ProviderName, number>(); // provider → expiresAt

export function markProviderFailed(name: ProviderName): void {
  recentFailures.set(name, Date.now() + FAILURE_TTL_MS);
}

function isProviderRecentlyFailed(name: ProviderName): boolean {
  const expires = recentFailures.get(name);
  if (!expires) return false;
  if (expires < Date.now()) {
    recentFailures.delete(name);
    return false;
  }
  return true;
}

/** Test/debug helper: returns the active failure markers. */
export function getRecentlyFailedProviders(): Array<{
  name: ProviderName;
  expiresAt: number;
}> {
  const now = Date.now();
  const live: Array<{ name: ProviderName; expiresAt: number }> = [];
  for (const [name, expiresAt] of recentFailures) {
    if (expiresAt >= now) live.push({ name, expiresAt });
  }
  return live;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the first available AI model based on the fallback chain.
 *
 * Default: Ollama Cloud 1st → Gemini 2nd → OpenAI 3rd → Anthropic safety net.
 *   (Venice retired — removed from the chain.)
 * With opts.preferLargeContext: same order · Ollama already 1st so the
 *   flag is now a no-op for the default chain but kept for clarity at
 *   the call site (signals intent in case the chain changes again).
 *
 * preferLargeContext is set by callers that know the prompt is large —
 * content-mode chat, deep-mode planning, etc. — and want Ollama's
 * 1M-context models. The chat route detects this via detectContentIntent
 * and threads it down.
 *
 * TaskType tunes the per-task provider order (getPreferredOrderForTask)
 * and, where supported, reasoning effort + temperature.
 */
/**
 * Can this provider accept image parts? True only when it DECLARES a
 * vision model in the registry (config/ai-providers.ts). Undeclared =
 * text-only, because guessing is exactly how an image reaches a model
 * that rejects it. Exported so callers can explain the constraint
 * instead of failing opaquely.
 */
export function isVisionCapableProvider(provider: ProviderName): boolean {
  // "emergency" is the last-resort stub lane — it cannot read an image,
  // and letting it take a vision turn would answer ABOUT an image it
  // never saw. Excluding it makes the failure explicit instead.
  if (provider === "emergency") return false;
  const cfg = PROVIDERS_REGISTRY[provider as RuntimeProviderName];
  const envModel = cfg?.visionModelEnv ? cleanEnv(process.env[cfg.visionModelEnv]) : "";
  return Boolean(envModel || cfg?.defaultVisionModel);
}

export interface GetModelOptions {
  /** Promote Ollama Cloud (1M-context models) to 1st in the chain. */
  preferLargeContext?: boolean;
  /**
   * v10.0.512 · Promote a specific provider to 1st in the chain.
   * Used for factual/customer/SEO queries where Anthropic Claude
   * respects tool descriptions and explicit system-prompt directives
   * far better than others.
   */
  forceProviderFirst?: ProviderName;
  /**
   * 2026-08-28 · per-turn model id for the FORCED provider only. Used by
   * the chat escalation lane to pick opus-5 vs fable-5 per turn without
   * mutating the process-global ANTHROPIC_MODEL. Ignored on any attempt
   * that is not the forced provider, so a fallback rotation can never
   * carry a stray model id into another provider's namespace.
   */
  modelOverride?: string;
  /**
   * 2026-08-11 · explicit operator consent to metered lanes (Turbo): a
   * per-request provider override or the deep-canary env attestation.
   * Internal tool forces are NOT consent — without this, the cost
   * firewall restricts the chain to zero-incremental providers.
   */
  allowMetered?: boolean;
}

/** Normal-chat cost firewall — ON unless NICK_COST_FIREWALL=0. */
export function isCostFirewallOn(): boolean {
  return process.env.NICK_COST_FIREWALL !== "0";
}

/**
 * Failover rescue — OFF unless NICK_FAILOVER_RESCUE=1. Enabling it authorizes
 * real per-token spend, which is the operator's call.
 *
 * 2026-09-18 · exported so the flag-board mirror is verified by CALLING it
 * rather than by pinning source text (review, #2429).
 */
export function isFailoverRescueOn(): boolean {
  return process.env.NICK_FAILOVER_RESCUE === "1";
}

/**
 * 2026-08-11 · the cost firewall, as a pure filter. Under the firewall a
 * normal lane may only try zero-incremental providers (the Ollama flat
 * subscription); metered lanes require explicit consent (allowMetered).
 * A key in the environment is availability, not authorization.
 */
export function filterByCostFirewall<T extends { name: ProviderName }>(
  entries: readonly T[],
  allowMetered: boolean,
): T[] {
  if (!isCostFirewallOn() || allowMetered) return [...entries];
  return entries.filter(
    (e) => isRuntimeProvider(e.name) && PROVIDER_COST_CLASS[e.name] === "zero_incremental",
  );
}

export function getPreferredOrderForTask(taskType: TaskType): ProviderName[] {
  return TASK_ROUTING_PREFERENCES[taskType] || ["ollama", "gemini", "openai", "anthropic"];
}

export function getModel(
  taskType: TaskType = "reason",
  opts: GetModelOptions = {},
): LanguageModel {
  // v10.0.512 · forceProviderFirst takes precedence over preferLargeContext
  // when the caller has classified the turn as needing a specific provider
  // (e.g. factual intent → Anthropic for tool-call compliance).
  let preferred: ProviderName[];
  if (opts.forceProviderFirst) {
    const pinned = opts.forceProviderFirst;
    const taskOrder = getPreferredOrderForTask(taskType);
    preferred = [pinned, ...taskOrder.filter((p) => p !== pinned)];
  } else if (opts.preferLargeContext) {
    // Apr 28 · Reorder when caller wants large context — Ollama goes first, then Gemini.
    preferred = ["ollama", "gemini", "openai", "anthropic"];
  } else {
    preferred = getPreferredOrderForTask(taskType);
  }

  // forensic-audit MEDIUM · a provider absent from `preferred` returned
  // indexOf -1 and thus sorted FIRST. The preferLargeContext list omits
  // openrouter, so OPENROUTER_API_KEY promoted it to 1st — opposite of the
  // "Ollama first" intent. Rank unlisted providers LAST, not first.
  const orderedAll = [...PROVIDERS].sort((a, b) => {
    const ra = preferred.indexOf(a.name); const rb = preferred.indexOf(b.name);
    return (ra === -1 ? preferred.length : ra) - (rb === -1 ? preferred.length : rb);
  });
  // 2026-07-29 · vision turns may only use providers that DECLARE a
  // vision model. Before this, taskType "vision" constrained nothing:
  // the ollama lane resolved a vision model, but every fallback hop
  // silently handed the image to a text chat model, which the provider
  // rejected mid-stream — surfacing as a bare "Stream failed." Fail closed.
  const ordered =
    taskType === "vision"
      ? orderedAll.filter((p) => isVisionCapableProvider(p.name))
      : orderedAll;
  if (taskType === "vision" && ordered.length === 0) {
    throw new Error(
      "No vision-capable AI provider is configured — an image was sent but no " +
        "provider declares a vision model. Set OLLAMA_VISION_MODEL (or a " +
        "GEMINI/OPENAI/ANTHROPIC vision model) to restore image chat.",
    );
  }

  // 2026-08-28 · a per-turn model override belongs to the FORCED provider
  // only. If the chain rotates away from it (rate limit, outage), the
  // next provider must resolve its own configured model — carrying
  // "claude-opus-5" into the ollama namespace would 404 the whole turn.
  const createFor = (entry: { name: ProviderName; create: (t?: TaskType, m?: string) => LanguageModel }) =>
    entry.create(
      taskType,
      opts.modelOverride && entry.name === opts.forceProviderFirst ? opts.modelOverride : undefined,
    );

  if (AI_PROVIDER) {
    const entry = ordered.find((p) => p.name === AI_PROVIDER);
    if (!entry) {
      throw new Error(`Unknown AI_PROVIDER: ${AI_PROVIDER}`);
    }
    if (entry.available()) {
      // Pinned provider override — respect even if recently failed.
      // This is an explicit operator choice; we don't second-guess.
      return tagModelProvider(createFor(entry), entry.name);
    }
    throw new Error(
      `AI_PROVIDER is set to "${AI_PROVIDER}" but it is not configured (missing API key).`
    );
  }

  // 2026-08-11 · cost firewall: without explicit consent, normal lanes
  // may only try zero-incremental providers. The AI_PROVIDER pin above
  // stays exempt (the operator's own hand). Fail COST-CLOSED, never
  // silently spend.
  const costAllowed = filterByCostFirewall(ordered, opts.allowMetered ?? false);

  // v9.1.27 · skip providers marked failed in the last ~60s. If ALL
  // providers are flagged (worst case), we still need to return one,
  // so we fall through to the unfiltered loop below as last resort.
  for (const entry of costAllowed) {
    if (entry.available() && !isProviderRecentlyFailed(entry.name)) {
      return tagModelProvider(createFor(entry), entry.name);
    }
  }
  // All-flagged fallback — pick any available, even if failed.
  for (const entry of costAllowed) {
    if (entry.available()) {
      return tagModelProvider(createFor(entry), entry.name);
    }
  }

  throw new Error(
    isCostFirewallOn() && !opts.allowMetered
      ? "Normal-chat spend protection is on and the zero-incremental lane (Ollama) is unavailable — not routing to a metered provider. Retry in a moment, or explicitly pick a provider to authorize external spend for this turn."
      : "No AI provider available. Set OLLAMA_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY."
  );
}

/**
 * Returns the name and model ID of the currently active provider.
 */
function activeModelIdFor(entry: ProviderEntry, taskType: TaskType): string {
  return entry.modelId;
}

export function getActiveProviderInfo(taskType: TaskType = "reason"): { provider: ProviderName; modelId: string } {
  const preferred = getPreferredOrderForTask(taskType);
  // forensic-audit MEDIUM · a provider absent from `preferred` returned
  // indexOf -1 and thus sorted FIRST. The preferLargeContext list omits
  // openrouter, so OPENROUTER_API_KEY promoted it to 1st — opposite of the
  // "Ollama first" intent. Rank unlisted providers LAST, not first.
  const ordered = [...PROVIDERS].sort((a, b) => {
    const ra = preferred.indexOf(a.name); const rb = preferred.indexOf(b.name);
    return (ra === -1 ? preferred.length : ra) - (rb === -1 ? preferred.length : rb);
  });

  if (AI_PROVIDER) {
    const entry = ordered.find((p) => p.name === AI_PROVIDER);
    if (entry?.available() && !isProviderRecentlyFailed(entry.name)) {
      return { provider: entry.name, modelId: activeModelIdFor(entry, taskType) };
    }
  }

  for (const entry of ordered) {
    if (entry.available() && !isProviderRecentlyFailed(entry.name)) {
      return { provider: entry.name, modelId: activeModelIdFor(entry, taskType) };
    }
  }

  // All-flagged fallback — same semantics as getModel()'s last-resort
  // path. Better to return SOMETHING than throw on a transient
  // global outage.
  for (const entry of ordered) {
    if (entry.available()) {
      return { provider: entry.name, modelId: activeModelIdFor(entry, taskType) };
    }
  }

  throw new Error("No AI provider available.");
}

/**
 * Returns full status of all providers. Used by /api/ai/status.
 */
export function getProviderStatus(): {
  activeProvider: ProviderName | null;
  providers: {
    name: ProviderName;
    available: boolean;
    modelId: string;
    costClass: ProviderRoutingCostClass;
  }[];
  veniceParams: typeof VENICE_PARAMS;
} {
  let activeProvider: ProviderName | null = null;
  const seen = new Set<string>();
  const providers = PROVIDERS
    .filter((p) => {
      // Deduplicate provider entries for display
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    })
    .map((p) => {
      const available = p.available();
      if (available && !activeProvider) activeProvider = p.name;
      const costClass: ProviderRoutingCostClass = isRuntimeProvider(p.name)
        ? PROVIDER_ROUTING_COST_CLASS[p.name]
        : "METERED_PAID";
      return { name: p.name, available, modelId: p.modelId, costClass };
    });

  return { activeProvider, providers, veniceParams: VENICE_PARAMS };
}

/**
 * Returns a model suitable for structured output.
 */
export function getStructuredModel(): LanguageModel {
  return getModel();
}

// `getModelWithFallback()` was DELETED 2026-09-02. It was a bare
// `return getModel()` — its own comment said "async alias, kept for backward
// compat" — while its NAME promised cross-provider fallback. It had exactly
// one caller: app/api/cron/weekly-review, which called it with no try/catch
// and failed 291 of 318 runs. A caller who reads `getModelWithFallback` has
// every reason not to write a catch. The real fallback lives in aiChat /
// aiStream, which return an "emergency" sentinel instead of throwing; a
// caller that wants bare generateText must handle its own failures, and the
// name should not suggest otherwise.

// ---------------------------------------------------------------------------
// aiChat — complete response with provider fallback
// ---------------------------------------------------------------------------

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderFailure {
  /** Provider name as configured (venice/ollama/openai/anthropic). */
  provider: ProviderName;
  /** Resolved model id at attempt time. */
  modelId: string;
  /** Time spent in this single provider attempt before throwing. */
  durationMs: number;
  /** Truncated error message from the SDK / fetch layer. */
  message: string;
  /** Error name / class when available (TypeError, AbortError, ApiError, etc). */
  errorName?: string;
  /** Coarse classification — see classifyProviderFailure(). */
  failureClass?:
    | "auth"
    | "rate_limit"
    | "timeout"
    | "network"
    | "model_not_found"
    | "bad_request"
    | "garbage_response"
    | "refusal"
    | "sdk_threw";
  /** Body snippet for non-2xx HTTP responses. */
  bodySnippet?: string;
}

export interface AiResponse {
  content: string;
  provider: ProviderName | "none";
  model: string;
  /** v10.0.212 · per-provider failure detail accumulated through the chain.
   *  Populated even on success (when earlier providers failed before a
   *  later one succeeded). Consumed by tracedAiChat for /system/agent-traces. */
  failures?: ProviderFailure[];
  /** H.4.7 · real token usage when the SDK reports it · undefined when
   *  the provider doesn't surface it (some local providers don't). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  /** H.4.7 · estimated USD cost for this single call, computed from the
   *  per-provider rate table below. Undefined when usage is missing or
   *  the provider isn't in the rate table. The reasoning engine uses
   *  this when present and falls back to per-tier estimates otherwise. */
  costUsd?: number;
}

/** H.4.7 · per-provider per-1M-token rates (USD). Conservative numbers
 *  · we'd rather over-attribute cost than miss spend. Venice + Ollama
 *  are local/cheap so set near-zero; OpenAI + Anthropic use rough
 *  averages of their flagship models since we don't know which sub-
 *  model the call actually routed to. */
// U6 (2026-09-08) · the rate table and estimateCostUsd moved to lib/ai/pricing.ts
// so track.ts, the reasoning engine and Langfuse price from ONE source.

/**
 * v10.0.212 · classify a thrown error into a small set of buckets so
 * /system/agent-traces can group failures across runs without parsing
 * free-form messages. Heuristic — favors specificity over recall.
 */
export function classifyProviderFailure(err: unknown): ProviderFailure["failureClass"] {
  const e = err as { message?: string; status?: number; statusCode?: number; name?: string };
  const msg = e.message ?? String(err);
  const status = e.status ?? e.statusCode;
  if (e.name === "AbortError" || /abort|timeout/i.test(msg)) return "timeout";
  if (status === 401 || status === 403 || /unauthorized|invalid.*api.*key/i.test(msg)) return "auth";
  if (status === 429 || /rate[_\s-]?limit|too many requests/i.test(msg)) return "rate_limit";
  if (status === 404 || /model.*not.*found/i.test(msg)) return "model_not_found";
  if (status === 400 || /bad.*request|invalid.*json/i.test(msg)) return "bad_request";
  if (/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(msg)) return "network";
  return "sdk_threw";
}

/**
 * Send messages to AI and get a complete response.
 * Tries each provider in the chain with 45s timeout per attempt.
 * Venice requests get task-adaptive params (reasoning, temperature, penalties).
 */
export async function aiChat(
  messages: AiMessage[],
  taskType: TaskType = "reason",
  opts: {
    signal?: AbortSignal;
    budgetNearingLimit?: boolean;
    allowMetered?: boolean;
    telemetry?: Partial<LangfuseTelemetryInput>;
    /** U6 · every completed call is recorded in AiGeneration unless the caller records it itself. */
    tracked?: boolean;
  } = {},
): Promise<AiResponse> {
  // L.1 · external AbortSignal support · when caller passes a signal,
  // every per-provider attempt combines the external + per-attempt
  // timeout via AbortSignal.any(). Caller cancellation (e.g. mega-tier
  // budget timeout) actually aborts the in-flight fetch instead of
  // letting the LLM call complete and discarding the result. Closes
  // the orphan-promise spend leak noted in H.6.1.
  const externalSignal = opts.signal;

  // U6 (2026-09-08) · a lane (feature) past its daily cap is a deterministic
  // stop: no provider is called, the caller gets the "none" sentinel it
  // already knows how to read. A lane with no cap never stops here.
  const laneFeature = opts.telemetry?.functionId ?? `ai:${taskType}`;
  if (opts.tracked !== false) {
    const lane = await checkLaneBudget(laneFeature).catch(() => null);
    if (lane?.over) {
      log.warn("lane_budget_exhausted", { lane: laneFeature, spentCents: lane.spentCents, capCents: lane.capCents });
      return { content: "", provider: "none", model: `lane-budget-exhausted:${laneFeature}` };
    }
  }
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");
  const systemPrompt = systemMessages.map((m) => m.content).join("\n\n") || undefined;
  const chatMessages = nonSystemMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // v10.0.209 NOTE · the v10.0.208 in-line budget gate was reverted
  // here because dynamically importing ./budget pulled prisma into
  // the client bundle (provider.ts is reachable from a client hook
  // via content-intent → auto-fire-gate). Server callers that need
  // pre-flight budget enforcement should call assertWithinBudget()
  // themselves before invoking aiChat(). The API chat route does
  // exactly that.

  let orderedProviders = [...PROVIDERS];
  if (opts.budgetNearingLimit) {
    log.warn("budget_near_limit_reordering_providers");
    // Sort so ollama (0 cost) and gemini (extremely cheap) are tried first
    orderedProviders = [...PROVIDERS].sort((a, b) => {
      const costTier = (n: ProviderName) =>
        n === "ollama" ? 0 : n === "gemini" ? 1 : n === "openai" ? 2 : 4;
      return costTier(a.name) - costTier(b.name);
    });
    // Skip anthropic if others are available to save remaining budget
    const hasCheaper = orderedProviders.some((p) => p.name !== "anthropic" && p.available());
    if (hasCheaper) {
      orderedProviders = orderedProviders.filter((p) => p.name !== "anthropic");
    }
  }

  const toTry: ProviderEntry[] = [];
  if (AI_PROVIDER) {
    const preferred = orderedProviders.find((p) => p.name === AI_PROVIDER);
    if (preferred?.available()) toTry.push(preferred);
  }
  // 2026-08-11 · cost firewall — internal LLM lanes (judge, critic,
  // reasoning, kn-extract) are the highest-frequency spend risk, so the
  // same zero-incremental restriction applies here. The AI_PROVIDER env
  // pin above stays exempt (the operator's own hand).
  const costCandidates = filterByCostFirewall(orderedProviders, opts.allowMetered ?? false);
  for (const p of costCandidates) {
    if (p.available() && !toTry.includes(p)) toTry.push(p);
  }

  // 2026-08-15 · LAST-RESORT RESCUE HOP.
  //
  // Two correct decisions collided. TASK_ROUTING_PREFERENCES (2026-07-12)
  // keeps openrouter as the 2nd hop explicitly "so a cooldown never
  // dead-ends a turn". The cost firewall (2026-08-11) then classed every
  // non-ollama provider as `metered` and filtered it out of normal chat.
  // The firewall runs on the list the failover loop iterates, so the 2nd
  // hop stopped existing and a cooldown DOES dead-end a turn.
  //
  // Live receipts, statenour-web 2026-08-15T22:52Z, two turns ~10s apart:
  //   provider.failed   provider="ollama" error="This operation was aborted"
  //   provider.all_failed  tried=["ollama"] failureCount=1
  //   provider.garbage  provider="ollama" chars=0 preview=""
  //   provider.all_failed  tried=["ollama"] failureCount=1
  // Four other provider keys were configured and idle on that service.
  //
  // This appends metered providers as a TAIL, so they are reached only
  // after every zero-incremental candidate has actually been tried and
  // failed. A healthy turn returns from the ollama hop and never touches
  // them — the $0-incremental directive holds for all normal traffic. The
  // only spend is in place of a turn that was otherwise already dead.
  //
  // OFF by default: enabling it authorizes real per-token spend, which is
  // the operator's call, not this file's. Set NICK_FAILOVER_RESCUE=1.
  if (
    isFailoverRescueOn() &&
    isCostFirewallOn() &&
    !(opts.allowMetered ?? false)
  ) {
    const rescue = orderedProviders.filter(
      (p) => p.available() && !toTry.includes(p),
    );
    if (rescue.length > 0) {
      log.info("provider.rescue_armed", {
        funded: toTry.map((p) => p.name),
        rescue: rescue.map((p) => p.name),
      });
      for (const p of rescue) toTry.push(p);
    }
  }

  // v10.0.184 · timeout + maxOutputTokens task-aware.
  //
  // Pre-fix: PROVIDER_TIMEOUT was 45s for ALL tasks. Long-form
  // generation (plan-project:plan asks for 15-30 phased steps in
  // structured JSON, ~5000-8000 tokens) cannot complete in 45s —
  // the heretic model emits ~30 tok/s, so 5000 tokens = 167s.
  // Every provider hit the abort, no provider returned content,
  // aiChat returned the emergency sentinel, the operator saw the
  // "AI project planner doesn't work" symptom they reported earlier
  // in the session.
  //
  // Post-fix: long-form tasks (deep/code/reason/math/creative)
  // get 100s per provider — enough to generate a full plan.
  // Fast/classify/embed stay at 45s since those are short by
  // definition.
  //
  // Also: explicit maxOutputTokens cap. Without it, the AI SDK's
  // default applied (provider-dependent) and slow-but-completing
  // generations could exceed even 100s. Caps:
  //   fast/classify : 1500  (terse responses)
  //   deep/code/math: 8000  (structured plans, full reasoning)
  //   default       : 4000  (chat / summary / extract / vision)
  const longForm = new Set<TaskType>(["deep", "reason", "code", "math", "creative"]);
  const PROVIDER_TIMEOUT = longForm.has(taskType) ? 100_000 : 45_000;
  const MAX_OUTPUT_TOKENS =
    taskType === "fast" || taskType === "classify"
      ? 1500
      : longForm.has(taskType)
        ? 8000
        : 4000;

  // v10.0.212 · accumulate per-provider failures so the caller can
  // see WHY each tier failed without needing Vercel runtime logs.
  // Persisted by tracedAiChat into agent_traces.metadata.
  const failures: ProviderFailure[] = [];

  for (const entry of toTry) {
    const resolvedModelId = isRuntimeProvider(entry.name)
      ? resolveProviderModel(entry.name, taskType)
      : entry.modelId;

    // L.1 · early-bail if the external signal already aborted (operator
    // cancelled before this provider got its turn).
    if (externalSignal?.aborted) {
      failures.push({
        provider: entry.name,
        modelId: resolvedModelId,
        durationMs: 0,
        message: "external abort before attempt",
        failureClass: "timeout",
      });
      break;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT);
    // L.1 · merge the external signal with our per-attempt timeout signal
    // via AbortSignal.any (ES2024 · Node 22+). Either abort cancels the
    // fetch · external abort gets surfaced as failureClass:"timeout".
    const combinedSignal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;
    const attemptStart = Date.now();
    try {
      log.debug("provider.try", { provider: entry.name, model: resolvedModelId, taskType });
      const model = entry.create(taskType);
      // v10.0.362 · prompt caching · per /prompt-caching skill.
      // - Anthropic: explicit cacheControl tag on the system message →
      //   90% token discount on cached prefix · cache window 5min ·
      //   massive savings since Nick's system prompt + brain context
      //   is 8-12k tokens and rarely changes within a conversation
      // - OpenAI: caching is automatic for prefixes ≥1024 tokens · no-op
      // - Venice / Ollama: no native caching · no-op
      // The Anthropic SDK accepts the cacheControl on the system field
      // directly when passed as a structured array.
      const useAnthropicCache = entry.name === "anthropic" && systemPrompt && systemPrompt.length > 200;
      const result = await generateText({
        model,
        experimental_telemetry: langfuseTelemetry({ ...opts.telemetry, functionId: opts.telemetry?.functionId ?? `ai-chat-${taskType}`, metadata: { taskType, ...opts.telemetry?.metadata } }),
        // 2026-07-06 · no Gemini content filtering on the internal LLM path
        // either (reasoning · judge · critic · kn-extract all route through
        // aiChat). Ignored by non-Google providers.
        providerOptions: { google: GEMINI_SAFETY_OFF },
        ...(useAnthropicCache
          ? {
              // Pass system as message-shaped to attach providerOptions.
              // v10.0.529.106 · Wave 59 · upgraded from default 5-min
              // ephemeral cache to 1-hour extended cache. Same 90%
              // read discount, but the longer TTL captures Nour's
              // working-session usage pattern (multiple chat turns
              // over 20-40 min) where the 5-min TTL was missing
              // cache hits on every 2nd-3rd turn. Same cost-per-
              // creation (1.25x) · 50-70% more hits across a session.
              messages: [
                {
                  role: "system" as const,
                  content: systemPrompt!,
                  providerOptions: {
                    anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
                  },
                },
                ...chatMessages,
              ],
            }
          : {
              system: systemPrompt,
              messages: chatMessages,
            }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: combinedSignal,
      });
      clearTimeout(timeout);
      // Strip Venice GLM <think> blocks (belt-and-suspenders with API-level strip)
      const cleaned = result.text
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<\/?think>/gi, "")
        .replace(/^[\s\n]+/, "");

      // 2026-08-11 · model refusal is a FIRST-CLASS outcome, not noise.
      // Claude 5-family models return HTTP 200 with stop_reason
      // "refusal", which the AI SDK maps to finishReason
      // "content-filter" (@ai-sdk/anthropic mapAnthropicStopReason).
      // Pre-fix the empty text fell through to the garbage gate and got
      // mislabeled "garbage_response"; now the chain records WHY and
      // rotates, and /system/agent-traces can count refusals per lane.
      if (result.finishReason === "content-filter") {
        log.warn("provider.refusal", { provider: entry.name, model: resolvedModelId });
        failures.push({
          provider: entry.name,
          modelId: resolvedModelId,
          durationMs: Date.now() - attemptStart,
          message: "model refusal (finishReason content-filter) — rotating to next provider",
          failureClass: "refusal",
        });
        continue; // refusal is prompt-specific; the next lane may serve it
      }

      // ── Response quality gate ──
      // Check for garbage BEFORE returning. A 200 OK with empty or
      // sentinel content is worse than a retry — the caller would
      // show garbage to Nour. If the content fails the gate, we
      // continue to the next provider instead of returning.
      const isGarbage =
        !cleaned ||
        cleaned.length < 5 ||
        cleaned === "AI is currently unavailable. No provider could be reached." ||
        /^[\s.!?]+$/.test(cleaned);

      if (isGarbage) {
        log.warn("provider.garbage", {
          provider: entry.name,
          chars: cleaned.length,
          preview: cleaned.slice(0, 50),
        });
        failures.push({
          provider: entry.name,
          modelId: resolvedModelId,
          durationMs: Date.now() - attemptStart,
          message: `garbage response: ${cleaned.slice(0, 50)}`,
          failureClass: "garbage_response",
        });
        continue; // try next provider in the chain
      }

      // v10.0.385 · prompt-cache telemetry · capture Anthropic
      // cacheCreation/cacheRead token counts when present. AI SDK
      // exposes these via providerMetadata.anthropic on Anthropic calls.
      try {
        const { recordCacheUsage } = await import("@/lib/observability/cache-telemetry");
        const usageObj = result as unknown as {
          usage?: { inputTokens?: number; outputTokens?: number };
          providerMetadata?: { anthropic?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } };
        };
        recordCacheUsage({
          provider: entry.name,
          inputTokens: usageObj.usage?.inputTokens,
          outputTokens: usageObj.usage?.outputTokens,
          cacheCreationInputTokens: usageObj.providerMetadata?.anthropic?.cacheCreationInputTokens,
          cacheReadInputTokens: usageObj.providerMetadata?.anthropic?.cacheReadInputTokens,
        });
      } catch (err) {
        // never let telemetry break the provider
        logError("ai.provider", err, { fn: "aiChat.cacheTelemetry", provider: entry.name }, "warn");
      }

      log.info("provider.success", { provider: entry.name, model: resolvedModelId, chars: cleaned.length });
      // H.4.7 · pluck usage + compute cost · was extracted above for
      // cache telemetry, now also returned for callers (reasoning
      // engine accumulates real cost from this).
      const usageOut = (result as unknown as {
        usage?: { inputTokens?: number; outputTokens?: number };
        providerMetadata?: { anthropic?: { cacheCreationInputTokens?: number; cacheReadInputTokens?: number } };
      });
      const usage = usageOut.usage
        ? {
            inputTokens: usageOut.usage.inputTokens,
            outputTokens: usageOut.usage.outputTokens,
            cacheCreationInputTokens: usageOut.providerMetadata?.anthropic?.cacheCreationInputTokens,
            cacheReadInputTokens: usageOut.providerMetadata?.anthropic?.cacheReadInputTokens,
          }
        : undefined;
      const costUsd = estimateCostUsd(
        entry.name,
        usage?.inputTokens,
        usage?.outputTokens,
        resolvedModelId,
      );
      // U6 (2026-09-08) · the ledger write lives HERE, once, for every caller.
      // 47 of 54 aiChat callers never recorded a row before this.
      if (opts.tracked !== false) {
        void trackGeneration({
          feature: laneFeature,
          model: resolvedModelId,
          provider: entry.name,
          promptTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          durationMs: Date.now() - attemptStart,
          conversationId: opts.telemetry?.sessionId,
          costUsd,
        });
      }
      return {
        content: cleaned,
        provider: entry.name,
        // Report the actually-resolved model id (resolvedModelId), not
        // the configured entry.modelId, so /system/agent-traces shows the
        // real model used for each turn.
        model: resolvedModelId,
        failures: failures.length > 0 ? failures : undefined,
        usage,
        costUsd,
      };
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      log.error("provider.failed", { provider: entry.name, error: msg });
      failures.push({
        provider: entry.name,
        modelId: resolvedModelId,
        durationMs: Date.now() - attemptStart,
        message: msg.slice(0, 500),
        errorName: (err as { name?: string })?.name,
        failureClass: classifyProviderFailure(err),
        bodySnippet: ((err as { responseBody?: string; body?: string })?.responseBody
          ?? (err as { body?: string })?.body)?.slice?.(0, 300),
      });
    }
  }

  // ── Graceful degradation: Emergency tier ──
  // Instead of showing "AI unavailable", return a minimal response
  // that at least acknowledges the user's message. This is better
  // than a dead screen.
  log.error("provider.all_failed", { tried: toTry.map(p => p.name), failureCount: failures.length });
  const lastUserMsg = nonSystemMessages.filter(m => m.role === "user").pop();
  const userHint = lastUserMsg?.content?.slice(0, 50) || "";
  // 2026-08-11 · cost-closed honesty: when the firewall held the metered
  // lanes shut, say so — a silent generic error would read as an outage
  // while hiding the deliberate no-spend decision.
  const firewallHeld = isCostFirewallOn() && !(opts.allowMetered ?? false);
  return {
    content: `I'm having trouble connecting to my AI providers right now.${firewallHeld ? " Spend protection stayed on — no metered provider was tried." : ""} ${userHint ? `You asked about "${userHint}..." — ` : ""}try again in a moment, or switch to a different mode.`,
    provider: "emergency",
    model: "none",
    failures,
  };
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/**
 * Generate embeddings for semantic memory recall.
 *
 * Chain: Cohere embed-v4.0 -> HF e5-large -> OpenAI text-embedding-3-small
 * (dimensions: 1024) -> OpenRouter. Every provider in the chain is pinned
 * to 1024 dims so the vector space never desyncs on fallover.
 *
 * Ollama Cloud was REMOVED from this chain (2026-07-04): it refused
 * embeddings in prod (404 /api/embeddings + 401 /api/embed — see the
 * Cohere note below), burned up to 20s of timeouts per call, and its
 * default model (nomic-embed-text) is 768-dim which would poison the
 * 1024-dim space if it ever started responding. Ollama remains a CHAT
 * provider (getModel) — only embeddings dropped it.
 *
 * IMPORTANT: dimensions differ between providers. Cosine similarity
 * across a mixed-dimension pair returns 0 (see cosineSim in
 * tool-embeddings.ts), so any consumer that MIXES old + new vectors
 * in the same similarity search will see old vectors as irrelevant.
 * That's fine for the live tool-pruning path (everything is embedded
 * fresh in-process with the same provider) but RAG/knowledge-ingest
 * stored vectors may need a one-time backfill if you switched
 * providers since the records were written.
 */
// 2026-07-05 improvement · request-scoped embed memo. The SAME userContent is
// embedded 2x+ per recall turn (route.ts prefetch + semanticSearch) and at 6+
// more same-turn sites (anticipated-questions, contradiction-injector,
// contextual-recall, calibration). A short-TTL text-keyed memo collapses ALL
// of them → ~one Cohere round-trip saved per turn. Module-level so it survives
// a warm lambda and resets on cold start (same lifecycle + pattern as
// context-reranker.ts's EMBED_CACHE). getEmbedding has a fixed text-only
// signature with a hardcoded input_type, so a text key is safe. Successes only
// — never cache the [] fail-soft path, so a transient embedder error retries.
const EMBED_MEMO = new Map<string, { vec: number[]; model: string | null; expiresAt: number }>();
const EMBED_MEMO_TTL_MS = 45_000;

// djb2 — tiny, fast, no deps. Cache-key only over the embed window, so a
// collision would at worst reuse a fresh-enough vector for ~45s (never a
// correctness issue). Mirrors hashContent in context-reranker.ts.
function embedMemoKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h >>> 0}`;
}

/**
 * An embedding plus the identity of the space it belongs to.
 *
 * ★★★ WHY THE MODEL COMES BACK WITH THE VECTOR. Measured 2026-09-18: of 97,401
 * rows in `vector_embeddings`, the embedding SPACE was knowable on 4.3%. Not
 * because a backfill was skipped — because this function has always returned a
 * bare `number[]`, so no writer could record what produced it even when it
 * wanted to. The `model` column was filled by whoever happened to have a guess
 * in scope, which is how it ended up holding real model names, the literal
 * string "default", and content fingerprints all at once.
 *
 * Two vectors from different models are not comparable, and cosine similarity
 * between them is a number with no meaning rather than an error. Provenance has
 * to travel with the vector or it does not exist.
 */
export interface EmbeddingResult {
  vec: number[];
  /** Provider-qualified model id, or null when every provider failed. */
  model: string | null;
}

/**
 * Embed `text`, discarding provenance.
 *
 * ⚠ PREFER `getEmbeddingWithModel` ON ANY PATH THAT PERSISTS THE VECTOR.
 * This wrapper exists because ~14 read-side callers only ever compare or rank
 * in-process, where the space is implicitly "whatever the query used" and
 * recording it would be noise. A WRITE that drops the model is how the 4.3%
 * happened.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  return (await getEmbeddingWithModel(text)).vec;
}

/** Embed `text` and report which model produced it. */
export async function getEmbeddingWithModel(text: string): Promise<EmbeddingResult> {
  const memoKey = embedMemoKey(text.slice(0, 30_000));
  const now = Date.now();
  const hit = EMBED_MEMO.get(memoKey);
  if (hit && hit.expiresAt > now) return { vec: hit.vec, model: hit.model };

  const out = await getEmbeddingUncached(text);
  // Cache successes only; the [] fail-soft path must stay retryable.
  if (out.vec.length > 0) {
    EMBED_MEMO.set(memoKey, { vec: out.vec, model: out.model, expiresAt: now + EMBED_MEMO_TTL_MS });
  }
  return out;
}

/** The one width every embedding provider in this chain is pinned to. */
export const EMBEDDING_CONTRACT_DIM = 1024;

/**
 * Enforce the 1024-dim contract at the PROVIDER BOUNDARY, loudly.
 *
 * ⚠ THE BELT EXISTED BUT WAS WORN ON ONLY ONE OF THREE PATHS. The Cohere branch
 * already normalized-and-warned on an off-contract width; the HuggingFace and
 * OpenAI branches returned whatever arrived, unchecked. All three now share this
 * ONE implementation — three copies of a normalization rule diverge, and the
 * divergence here is invisible by construction (see below).
 *
 * WHY THIS MATTERS MORE NOW THAN IT DID. `padToVectorDim` silently truncates or
 * ZERO-PADS, by design: the store has two vector spaces (1024 and 1536) and
 * padding 1024 -> 1536 is intentional. But that same silence means an
 * off-contract vector arriving from a PROVIDER is repaired into nonsense with no
 * signal — a 768-dim vector zero-padded into a 1024-dim space has 256 dead
 * dimensions and ranks essentially at random against real neighbours. Recall
 * degrades; nothing errors.
 *
 * And the tail of the chain is now two dead providers (HF has no credits,
 * OpenAI's key is bad, and Ollama Cloud refuses embeddings outright), leaving
 * Cohere as the ONLY live embedder. The realistic next event is someone adding a
 * replacement in a hurry — which is exactly when an unchecked width lands.
 *
 * Measured 2026-09-18: prod is clean, 97,622 of 97,622 stored vectors at 1024.
 * This is preventive, and it preserves the existing repair rather than throwing —
 * a degraded embedding still beats no embedding on a live chat turn.
 */
export async function enforceEmbeddingDim(vec: number[], provider: string): Promise<number[]> {
  if (vec.length === EMBEDDING_CONTRACT_DIM) return vec;
  console.warn(
    `[ai:embedding] ${provider} returned ${vec.length}-dim (contract: ${EMBEDDING_CONTRACT_DIM}) — normalizing`,
  );
  const { padToVectorDim } = await import("@/lib/db/pgvector");
  return padToVectorDim(vec, EMBEDDING_CONTRACT_DIM);
}

async function getEmbeddingUncached(text: string): Promise<EmbeddingResult> {
  const input = text.slice(0, 30_000);

  const COHERE_API_KEY = cleanEnv(process.env.COHERE_API_KEY);
  const OPENAI_API_KEY = getApiKey("openai");

  // 3. Cohere · v10.0.529.45 · added after Ollama Cloud refused
  // embeddings (401 on /api/embed · 404 on /v1/embeddings). The
  // project already integrates Cohere for the reranker · they offer
  // embed-v4.0 (1024-dim · multilingual · matches Venice's bge-m3
  // dimensionality so vector spaces don't desync on fallover).
  if (COHERE_API_KEY) {
    try {
      const model =
        cleanEnv(process.env.COHERE_EMBED_MODEL) || "embed-v4.0";
      const res = await fetch("https://api.cohere.com/v2/embed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${COHERE_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          texts: [input],
          input_type: "search_document",
          embedding_types: ["float"],
          // 2026-07-04 (audit) · PIN the dimension. The chain contract
          // above says every provider is 1024-dim, but without this
          // param embed-v4.0 uses its server default (>1024) — and
          // knnSearch filters rows by the RAW query-vector width, so an
          // unpinned query scans the wrong partition and recall goes
          // silently empty.
          output_dimension: 1024,
        }),
        signal: AbortSignal.timeout(10_000), // wave-181.90 follow-up
      });
      if (res.ok) {
        const data = await res.json();
        // Cohere v2 returns { embeddings: { float: [[...]] } }
        const vec: number[] | undefined =
          data?.embeddings?.float?.[0] ??
          // v1 fallback shape · { embeddings: [[...]] }
          (Array.isArray(data?.embeddings) ? data.embeddings[0] : undefined);
        if (Array.isArray(vec) && vec.length > 0) {
          // Belt for env-pinned models that ignore output_dimension. Now shared
          // with the HF and OpenAI branches — see enforceEmbeddingDim.
          return { vec: await enforceEmbeddingDim(vec, "Cohere"), model: `cohere:${model}` };
        }
        console.warn(
          `[ai:embedding] Cohere returned 200 but no embedding in payload (keys: ${Object.keys(data ?? {}).join(",")})`,
        );
      } else {
        const errBody = await res.text().catch(() => "");
        console.warn(
          `[ai:embedding] Cohere failed (${res.status}): ${errBody.slice(0, 200)}`,
        );
      }
    } catch (err) {
      logError("ai.provider", err, { fn: "getEmbedding", provider: "cohere" }, "warn");
    }
  }

  // 4. HuggingFace Inference (Wave AH · cheap multilingual backend)
  // Default model: intfloat/multilingual-e5-large · 1024-dim · supports
  // Spanish + 100 langs · ~$0.0001/call. See lib/ai/hf-embeddings.ts +
  // docs/runbooks/hf-embeddings-cutover.md.
  {
    const { getHfEmbedding, isHfEmbeddingAvailable, hfEmbeddingModel } = await import("./hf-embeddings");
    if (isHfEmbeddingAvailable()) {
      const vec = await getHfEmbedding(input);
      // Was returned UNCHECKED. multilingual-e5-large happens to be 1024-dim, so
      // this never bit — but "happens to be right" is not a contract, and the
      // model is env-overridable via the HF model config.
      if (vec && vec.length > 0) {
        return { vec: await enforceEmbeddingDim(vec, "HuggingFace"), model: `hf:${hfEmbeddingModel()}` };
      }
    }
  }

  // 5. OpenAI (final fallback)
  if (OPENAI_API_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input, dimensions: 1024 }),
        signal: AbortSignal.timeout(15_000), // wave-181.90 follow-up · final fallback · give it more room
      });
      if (res.ok) {
        const data = await res.json();
        const vec = data.data?.[0]?.embedding;
        // Was returned UNCHECKED. The request asks for `dimensions: 1024`, but a
        // requested dimension is not a verified one — that is the whole reason
        // the Cohere branch grew a belt.
        if (vec?.length > 0) {
          return {
            vec: await enforceEmbeddingDim(vec, "OpenAI"),
            model: "openai:text-embedding-3-small",
          };
        }
      } else {
        const errBody = await res.text().catch(() => "");
        console.warn(
          `[ai:embedding] OpenAI failed (${res.status}): ${errBody.slice(0, 200)}`
        );
      }
    } catch (err) {
      logError("ai.provider", err, { fn: "getEmbedding", provider: "openai" }, "warn");
    }
  }

  // 6. OpenRouter (fallback embeddings)
  const OPENROUTER_API_KEY = cleanEnv(process.env.OPENROUTER_API_KEY);
  if (OPENROUTER_API_KEY) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://bdnick.info",
          "X-Title": "Nour OS",
        },
        body: JSON.stringify({ model: "openai/text-embedding-3-small", input, dimensions: 1024 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const data = await res.json();
        const vec = data.data?.[0]?.embedding;
        if (vec && vec.length > 0) return { vec, model: "openrouter:openai/text-embedding-3-small" };
      } else {
        const errBody = await res.text().catch(() => "");
        console.warn(
          `[ai:embedding] OpenRouter failed (${res.status}): ${errBody.slice(0, 200)}`
        );
      }
    } catch (err) {
      logError("ai.provider", err, { fn: "getEmbedding", provider: "openrouter" }, "warn");
    }
  }

  log.warn("embedding.all_failed", {
    tried: ["cohere", "hf", "openai", "openrouter"],
  });
  // ⚠ model null, NOT a placeholder. "unknown" written into the identity column
  // is what produced the 1,431 rows reading "default" — a value that names
  // nothing while looking like it names something.
  return { vec: [], model: null };
}

// ---------------------------------------------------------------------------
// Streaming (backward compat)
// ---------------------------------------------------------------------------

export function aiStream(
  messages: AiMessage[],
  taskType: TaskType = "reason",
  opts: { telemetry?: Partial<LangfuseTelemetryInput> } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const { streamText } = await import("ai");
        const model = getModel(taskType);

        const systemMessages = messages.filter((m) => m.role === "system");
        const nonSystemMessages = messages.filter((m) => m.role !== "system");

        const result = streamText({
          model,
          experimental_telemetry: langfuseTelemetry({ ...opts.telemetry, functionId: opts.telemetry?.functionId ?? `ai-stream-${taskType}`, metadata: { taskType, ...opts.telemetry?.metadata } }),
          providerOptions: { google: GEMINI_SAFETY_OFF }, // 2026-07-06 · no Gemini content filtering
          system: systemMessages.map((m) => m.content).join("\n\n") || undefined,
          messages: nonSystemMessages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        });

        for await (const chunk of result.textStream) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch {
        controller.enqueue(encoder.encode("AI connection failed."));
      }

      controller.close();
    },
  });
}
