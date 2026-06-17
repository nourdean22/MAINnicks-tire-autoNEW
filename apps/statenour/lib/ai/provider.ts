/**
 * Unified AI provider layer for NOUR OS v8.1
 *
 * Provider chain: Venice (x2 retry) → OpenAI → Anthropic.
 * Venice: MAXIMUM UNRESTRICTED MODE with task-adaptive intelligence.
 *
 * Every Venice request gets:
 * - No safety prompts (include_venice_system_prompt: false)
 * - Think tag stripping (strip_thinking_response: true)
 * - Web search + scraping + citations (auto mode)
 * - 24h prompt caching for the 50K system prompt
 * - E2E encryption for business strategy privacy
 * - Task-adaptive reasoning effort, temperature, and penalties
 *
 * ──────────────────────────────────────────────────────────────
 * ⚠  KNOWN ISSUE — DO NOT USE FROM STANDALONE SCRIPTS
 *
 * This module WORKS in the Next.js runtime (API routes, crons) but
 * FAILS when imported from a standalone `tsx scripts/foo.ts` context.
 * The Vercel AI SDK's OpenAI-compatible client chokes on Venice's
 * `reasoning_content` field when called outside Next.js — every
 * generateText() call raises "Invalid JSON response".
 *
 * Script callers: use `scripts/_lib/safety.ts` → `callVenice()` which
 * hits https://api.venice.ai/api/v1/chat/completions directly via
 * fetch() and bypasses the SDK entirely. Simpler, faster, and
 * strictly more reliable for batch jobs.
 *
 * Do NOT try to replace aiChat() here — it works fine in Next.js
 * routes where 95% of the traffic lives, and the AI SDK handles
 * streaming, tool calls, and provider fallback that the backfill
 * scripts don't need. Keep the two code paths separate.
 * ──────────────────────────────────────────────────────────────
 */

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

const VENICE_API_KEY = cleanEnv(process.env.VENICE_API_KEY);
const VENICE_MODEL = cleanEnv(process.env.VENICE_MODEL) || "venice-uncensored";

const ANTHROPIC_API_KEY = cleanEnv(process.env.ANTHROPIC_API_KEY);
const ANTHROPIC_MODEL = cleanEnv(process.env.ANTHROPIC_MODEL) || "claude-sonnet-4-6";

const OPENAI_API_KEY = cleanEnv(process.env.OPENAI_API_KEY);
const OPENAI_MODEL = cleanEnv(process.env.OPENAI_MODEL) || "gpt-4o-mini";

// Apr 28 · Ollama Cloud Pro — co-1st provider with Venice. Hosted models
// have 1M-token context (qwen3-vl, deepseek-v4-flash, etc.) which fixes
// our 65k Venice truncation problem on heavy content prompts. OpenAI-
// compatible endpoint at https://ollama.com/v1/chat/completions, auth
// via Bearer token. $20/mo flat fee, no per-token billing.
const OLLAMA_API_KEY = cleanEnv(process.env.OLLAMA_API_KEY);
// v10.0.529.45 · Cohere added to the embedding fallback chain after
// Ollama Cloud refused embeddings on the operator's plan.
const COHERE_API_KEY = cleanEnv(process.env.COHERE_API_KEY);
const OLLAMA_MODEL =
  cleanEnv(process.env.OLLAMA_MODEL) || "qwen3-vl:235b-instruct";
// v-truth · separate VISION model. The default chat model (OLLAMA_MODEL) may
// be a smarter TEXT-only model (e.g. qwen3.5:397b); image turns must still use
// a multimodal model. createOllamaModel routes taskType:"vision" here. Default
// keeps today's multimodal flagship so vision never regresses.
const OLLAMA_VISION_MODEL =
  cleanEnv(process.env.OLLAMA_VISION_MODEL) || "qwen3-vl:235b-instruct";
const OLLAMA_BASE_URL =
  cleanEnv(process.env.OLLAMA_BASE_URL) || "https://ollama.com";

const GEMINI_API_KEY = cleanEnv(process.env.GEMINI_API_KEY) || cleanEnv(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const GEMINI_MODEL = cleanEnv(process.env.GEMINI_MODEL) || "gemini-3.5-flash";

const AI_PROVIDER = cleanEnv(process.env.AI_PROVIDER) as
  | "venice"
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | undefined;

export type ProviderName =
  | "venice"
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "emergency";
export type TaskType = "fast" | "reason" | "deep" | "vision" | "embed" | "code" | "sql" | "math" | "creative" | "summary" | "classify" | "extract";

// ---------------------------------------------------------------------------
// Venice Configuration — MAXIMUM UNRESTRICTED + TASK-ADAPTIVE
// ---------------------------------------------------------------------------

/**
 * Base Venice parameters — applied to EVERY Venice request.
 * These unlock Venice Pro features and remove all restrictions.
 */
export const VENICE_PARAMS = {
  // === UNRESTRICTED MODE ===
  include_venice_system_prompt: false,  // Nick has his own 50K prompt
  // strip_thinking_response FLIPPED Apr 15: when Venice strips thinking
  // server-side AND the model happens to burn its entire output budget
  // on reasoning, we get an empty response with no chance to recover.
  // Letting Venice return the raw tokens + stripping on OUR side gives
  // us diagnostic visibility and a fallback path.
  strip_thinking_response: false,
  // disable_thinking is set PER TASK TYPE in VENICE_TASK_OVERRIDES
  // below. The "fast" and "classify" profiles force it ON so quick
  // chat messages don't waste tokens on internal reasoning.
  enable_e2ee: true,                    // End-to-end encryption for business strategy

  // === REAL-TIME INTELLIGENCE ===
  enable_web_search: "auto",            // Venice searches when relevant
  enable_web_scraping: true,            // Scrape URLs in messages
  enable_web_citations: true,           // Cite sources from web search

  // === PERFORMANCE — prompt caching on Venice side ===
  // prompt_cache_key routes matching prompts to the same backend
  // worker so the 50K system prompt doesn't get re-tokenized on every
  // message. With a 24h retention window, warm sessions shave 5-15s
  // off first-token latency on Venice GLM-4.7-flash.
  prompt_cache_key: "nour-os-nick-v10",
  prompt_cache_retention: "24h",
};

/**
 * Task-specific overrides for Venice requests.
 * Different tasks need different reasoning depth, temperature, and penalties.
 *
 * reasoning_effort: none → max (how hard Venice thinks)
 * temperature: 0.0 → 2.0 (creativity vs determinism)
 * repetition_penalty: 1.0+ (prevent repetitive responses)
 * min_p: 0.0 → 1.0 (filter low-probability tokens)
 * top_k: filter to top K tokens
 */
// Note: these overrides spread LAST so task-level fields override the
// base VENICE_PARAMS. Setting disable_thinking: true here wins over
// anything in VENICE_PARAMS (which now leaves it out entirely).
const VENICE_TASK_OVERRIDES: Record<TaskType, Record<string, unknown>> = {
  fast: {
    // CRITICAL: quick-mode chat messages like "ping" or "hi" don't
    // need reasoning — and when reasoning_effort was "low" + Venice
    // still had disable_thinking: false, the model burned all 180
    // output tokens thinking and strip_thinking_response returned
    // an empty string. That killed quick-mode chat entirely.
    // Setting disable_thinking: true here forces the model to skip
    // the think phase and emit direct tokens immediately.
    reasoning_effort: "none",
    disable_thinking: true,
    temperature: 0.4,
    repetition_penalty: 1.1,
    min_p: 0.05,
  },
  reason: {
    // Apr 17 fix: disable_thinking was undefined here, so Venice left
    // reasoning_effort="high" free to burn the ENTIRE output budget on
    // internal <think> tokens. Result: visible assistant text was often
    // empty — "give me a list of movies" → blank response. Empty
    // responses were the #1 chat error in ai_errors.
    //
    // Solution: set disable_thinking=true. We lose Venice's internal
    // reasoning step, but we gain reliable visible output. Reasoning
    // still happens in the emitted tokens when the model wants — it
    // just can't hide ALL of it behind a <think> wall.
    //
    // Deep mode (below) keeps reasoning ON because it has maxOutputTokens=4000
    // as a visible-budget floor and is only used for strategic queries.
    reasoning_effort: "medium",
    disable_thinking: true,
    // v10.0.481 · 0.7 → 0.8 · operator turned up creativity. Default
    // chat thinking gets more room to explore phrasings + angles
    // without losing reasoning coherence (effort=medium holds).
    temperature: 0.8,
    repetition_penalty: 1.15,
    min_p: 0.03,
    prompt_cache_retention: "24h",
  },
  deep: {
    // Apr 17 v4: every deep request was returning empty with
    // finishReason='other'. Root cause: reasoning_effort="high" + the
    // venice-uncensored fast model (where deep actually routes by
    // default — see resolveVeniceModelForTask). The fast model doesn't
    // support heavy reasoning; sending it reasoning_effort=high AND
    // a 57K prompt silently failed.
    //
    // Fix: drop to effort="none" + disable_thinking so the fast model
    // handles it cleanly. Deep mode strategic "thinking" happens in
    // the VISIBLE output via the prompt ("think step by step before
    // answering") + the 4000-token visible budget set in the chat
    // route. Same shape as reason task, just colder temp + bigger
    // output budget for strategic queries.
    reasoning_effort: "none",
    disable_thinking: true,
    temperature: 0.4,
    repetition_penalty: 1.1,
    min_p: 0.02,
    prompt_cache_retention: "24h",
  },
  vision: {
    reasoning_effort: "medium",
    temperature: 0.5,
  },
  embed: {},  // Embeddings don't use chat completions
  code: {
    reasoning_effort: "high",
    temperature: 0.2,
    repetition_penalty: 1.0,
  },
  sql: {
    reasoning_effort: "medium",
    temperature: 0.1,
  },
  math: {
    reasoning_effort: "high",
    temperature: 0.1,
  },
  creative: {
    // v10.0.180 · creative is the ONE remaining task that routes to
    // the configured (heretic) model by default per
    // VENICE_USE_CONFIGURED_MODEL_FOR_TASKS=creative. Without
    // disable_thinking the heretic model can burn its full output
    // budget on internal <think> reasoning, leaving zero visible
    // tokens after strip_thinking. Same root-cause as v10.0.178
    // (suggestions) and v10.0.179 (conversation-compress). Marketing/
    // brainstorm/caption content routes here via domain-routing.ts;
    // an empty response on a "caption this photo" request looked
    // like a flake but was the silent burn.
    //
    // Reasoning still happens in the emitted tokens — the model just
    // can't hide ALL of it behind a <think> wall. Visible output
    // becomes reliable.
    reasoning_effort: "medium",
    disable_thinking: true,
    // v10.0.481 · 0.9 → 1.05 · operator turned up creativity hard.
    // Marketing / brainstorm / caption tasks now lean into novel
    // combinations, contrarian framings, unexpected adjacencies.
    // Repetition penalty stays at 1.3 to keep individual outputs
    // distinct; min_p tightened slightly to filter incoherent
    // tail-tokens at the higher temp.
    temperature: 1.05,
    repetition_penalty: 1.3,
    min_p: 0.02,
    top_k: 50,
  },
  summary: {
    reasoning_effort: "low",
    disable_thinking: true,
    // v10.0.481 · 0.3 → 0.45 · operator turned up creativity. Summary
    // gets slightly more room for novel phrasing while still being
    // grounded (reasoning=low + rep_penalty 1.2 keep it tight).
    temperature: 0.45,
    repetition_penalty: 1.2,
  },
  classify: {
    reasoning_effort: "none",
    disable_thinking: true,
    temperature: 0.1,
    min_p: 0.1,
  },
  extract: {
    reasoning_effort: "low",
    temperature: 0.1,
  },
};

/**
 * Build a Venice fetch wrapper CLOSURE-LOCKED to a specific task type.
 *
 * ⚠ Why a closure, not a module-level variable:
 *   The old approach stored `_currentTaskType` at module level and
 *   `createVeniceModel()` set it before each request. With concurrent
 *   requests (e.g. main chat=deep + /api/ai/chat/prefetch=fast firing
 *   in parallel) the prefetch would overwrite _currentTaskType AFTER
 *   the deep request grabbed it but BEFORE its fetch hit Venice. Deep
 *   mode requests ended up sent with `fast` params — reasoning_effort=none,
 *   disable_thinking=true, wrong model — and Venice silently returned
 *   empty responses (finishReason='other').
 *
 *   Closure-locked task type means each model instance owns its own
 *   fetcher. Concurrent Venice calls can't clobber each other.
 */
// Models that don't support Venice's function-calling surface. Tools get
// stripped from the request body when one of these is the target — Venice
// returns HTTP 400 "tools is not supported by this model" otherwise, which
// silently killed deep mode until Apr 17.
const VENICE_MODELS_WITHOUT_TOOLS = new Set([
  "venice-uncensored", // stock fast model, no function calling
]);

function makeVeniceFetch(taskType: TaskType): typeof globalThis.fetch {
  return async (url, options) => {
    if (options?.body && typeof options.body === "string") {
      try {
        const body = JSON.parse(options.body);

        // Strip tools + tool_choice when model can't handle them. We'd
        // rather give a good tool-free response than a 400 Bad Request.
        if (VENICE_MODELS_WITHOUT_TOOLS.has(body.model)) {
          if (body.tools || body.tool_choice) {
            const toolsDropped = Array.isArray(body.tools) ? body.tools.length : 0;
            delete body.tools;
            delete body.tool_choice;
            console.log(
              `[veniceFetch] stripped ${toolsDropped} tools + tool_choice — ${body.model} doesn't support function calling`
            );
          }
        }

        // Inject venice_parameters (unrestricted mode + web search + caching)
        // AND merge task-specific disable_thinking into venice_parameters
        // so Venice sees the full parameter block in one place.
        //
        // v10.0.529.106 · Wave 59 · prompt_cache_key segmented by
        // taskType. Pre-Wave-59 every task type shared the cache key
        // "nour-os-nick-v10", meaning a fast-turn (temp 0.4 ·
        // disable_thinking true) and a deep-turn (temp 0.0 ·
        // reasoning_effort high) shared cache slots and evicted each
        // other prematurely. Segmenting by task type gives each
        // reasoning profile its own cache lane → fewer evictions, more
        // hits within a task lane.
        const overrides = VENICE_TASK_OVERRIDES[taskType] || {};
        body.venice_parameters = {
          ...VENICE_PARAMS,
          prompt_cache_key: `${VENICE_PARAMS.prompt_cache_key}-${taskType}`,
          // disable_thinking is a venice_parameters field, not a top-level one
          ...(overrides.disable_thinking !== undefined
            ? { disable_thinking: overrides.disable_thinking }
            : {}),
        };

        // Inject task-specific overrides at the top level, EXCEPT disable_thinking
        // which belongs under venice_parameters (we already folded it above)
        for (const [key, value] of Object.entries(overrides)) {
          if (value === undefined) continue;
          if (key === "disable_thinking") continue; // already handled above
          body[key] = value;
        }

        // Debug log — shows up in server logs so we can see EXACTLY what
        // parameters Venice is receiving for a given task type.
        const systemMsgs = (body.messages || []).filter((m: { role: string }) => m.role === "system");
        const systemCharTotal = systemMsgs.reduce((sum: number, m: { content?: string }) => sum + (m.content?.length || 0), 0);
        const userMsgs = (body.messages || []).filter((m: { role: string }) => m.role === "user");
        const userCharTotal = userMsgs.reduce((sum: number, m: { content?: string }) => sum + (m.content?.length || 0), 0);
        const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
        const toolCharTotal = Array.isArray(body.tools)
          ? body.tools.reduce((sum: number, t: unknown) => sum + JSON.stringify(t).length, 0)
          : 0;
        console.log(
          `[veniceFetch] task=${taskType} model=${body.model} max_tokens=${body.max_tokens ?? body.max_output_tokens ?? "?"} disable_thinking=${body.venice_parameters?.disable_thinking} reasoning_effort=${body.reasoning_effort} msgs=${body.messages?.length ?? 0} sys=${systemMsgs.length}×${systemCharTotal}ch usr=${userMsgs.length}×${userCharTotal}ch tools=${toolCount}×${toolCharTotal}ch bodyKeys=${Object.keys(body).join(",")}`
        );

        // Fire the request; capture error body for diagnosis on non-2xx.
        const response = await globalThis.fetch(url, { ...options, body: JSON.stringify(body) });
        if (!response.ok) {
          const errorBody = await response.clone().text().catch(() => "<unreadable>");
          console.error(
            `[veniceFetch] ${response.status} ${response.statusText} task=${taskType} · body:`,
            errorBody.slice(0, 1000)
          );
          // Apr 27 · 402 Payment Required = Venice account is out of
          // credits. Trip the circuit breaker so subsequent calls fall
          // through to OpenAI/Anthropic for the cooldown window instead
          // of burning request budget hitting a known-broken endpoint
          // (which then 429s and makes the user think the chat itself
          // is broken).
          if (response.status === 402) {
            markVeniceQuotaExhausted();
          }
        } else {
          // Apr 27 · Success → clear the breaker. After a top-up the
          // first 200 from Venice means credits are flowing again, so
          // future calls should route to Venice without waiting for
          // the cooldown to expire.
          if (isVeniceQuotaExhausted()) clearVeniceQuotaExhausted();
        }
        return response;
      } catch {
        // Not JSON body — pass through unchanged
      }
    }
    return globalThis.fetch(url, options);
  };
}

// ---------------------------------------------------------------------------
// Provider factories
// ---------------------------------------------------------------------------

/**
 * Per-task Venice model — stays entirely on Venice but uses the right
 * model for the right job.
 *
 * The default VENICE_MODEL from env is `olafangensan-glm-4.7-flash-heretic`,
 * a community GLM-4.7 fine-tune that produces rich deep reasoning but
 * silently returns EMPTY text on short "quick" messages (verified:
 * raw=0, reasoning=0, content=0, steps=0, finish=stop, output=400 tokens).
 * It ignores disable_thinking and doesn't wrap output in <think> tags
 * the AI SDK can catch.
 *
 * For fast + classify task types we use `venice-uncensored` instead —
 * stock Venice model that responds immediately, no reasoning phase,
 * sub-3s first token. Heavy tasks (reason/deep/creative) keep the
 * heretic model where the thinking pays off.
 *
 * ⚠ Apr 15 2026 — the heretic model started returning "Invalid JSON
 *   response" on reason/deep calls in Next.js routes, silently
 *   killing every aiChat(..., "deep") caller (review, coach-goal,
 *   plan-project, suggest-goals, assist, strategy). The fix: route
 *   MOST tasks through venice-uncensored (the proven working model)
 *   and reserve the configured VENICE_MODEL only for `creative`
 *   where temperature 0.9 genuinely benefits from a bigger model.
 *
 *   To force heretic back on for a given task type, set
 *   VENICE_USE_CONFIGURED_MODEL_FOR_TASKS to a comma-separated list
 *   (e.g. "reason,deep") in .env.local.
 *
 * Override VENICE_FAST_MODEL env var to pick a different fast model.
 */
const VENICE_FAST_MODEL = cleanEnv(process.env.VENICE_FAST_MODEL) || "venice-uncensored";

// v10.0.514 · default dropped from "creative" to "" (empty).
// The 2026-05-12 chat smoke tests showed venice-uncensored handles
// creative content (post ideas, brand-voice copy) just fine · while
// the heretic model errored 3× in a row on a "post idea" question
// with "Stream interrupted: [object Object]" on the operator's
// production chat. Until heretic's invalid-JSON / empty-content
// failure mode is fixed upstream, default to NEVER use it.
// Operator can opt back in via VENICE_USE_CONFIGURED_MODEL_FOR_TASKS
// env var if they have a specific creative use case where the bigger
// model's temperature-0.9 reasoning actually pays off.
const TASKS_FORCED_TO_CONFIGURED_MODEL: Set<TaskType> = new Set(
  (cleanEnv(process.env.VENICE_USE_CONFIGURED_MODEL_FOR_TASKS) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as TaskType[]
);

function resolveVeniceModelForTask(taskType: TaskType): string {
  // `fast` and `classify` have always used the fast model — keep
  // that behavior.
  if (taskType === "fast" || taskType === "classify") {
    return VENICE_FAST_MODEL;
  }
  // Explicit opt-in list: if the env names this task type, use the
  // configured VENICE_MODEL (typically a reasoning-heavy model like
  // GLM heretic).
  if (TASKS_FORCED_TO_CONFIGURED_MODEL.has(taskType)) {
    return VENICE_MODEL;
  }
  // Default: route through venice-uncensored. It's stock, fast, and
  // doesn't produce the `reasoning_content` that chokes the AI SDK.
  return VENICE_FAST_MODEL;
}

function createVeniceModel(taskType: TaskType = "reason"): LanguageModel {
  const modelId = resolveVeniceModelForTask(taskType);

  const venice = createOpenAI({
    baseURL: "https://api.venice.ai/api/v1",
    apiKey: VENICE_API_KEY!,
    headers: {
      // X-Venice-Privacy: strict is the real privacy control.
      // X-Venice-No-Store was REMOVED Apr 15 — it was silently
      // canceling prompt_cache_key, forcing Venice to re-ingest the
      // 50K system prompt on every request (the root cause of the
      // "spotty chat" complaint). With this gone, warm sessions hit
      // the prompt cache and shave 5-15s off first-token latency.
      "X-Venice-Privacy": "strict",
    },
    // Closure-locked fetch: each model instance carries its own task
    // type, immune to concurrent request clobbering (see makeVeniceFetch).
    fetch: makeVeniceFetch(taskType),
  });

  // Wrap with extractReasoningMiddleware so any model that DOES emit
  // <think>...</think> blocks (the heretic model on deep mode) gets
  // them properly routed to the reasoning field instead of leaking
  // into visible text. Safe for models that don't use think tags —
  // middleware is a no-op when no tags are present.
  //
  // ⚠ Apr 17 v6 — THE deep mode "empty response" ROOT CAUSE:
  //   AI SDK v6's createOpenAI() defaults to OpenAI's new Responses API
  //   (`POST /v1/responses` with `input` field). Venice ONLY supports
  //   the legacy Chat Completions API (`POST /v1/chat/completions` with
  //   `messages` field). The default send path stripped the conversation
  //   from `messages` into the new `input` format, but Venice couldn't
  //   parse it — silently responded with finishReason='other' and 0
  //   tokens. venice.chat(modelId) forces the legacy Chat Completions
  //   path Venice actually supports. Fixes deep mode end-to-end.
  return wrapLanguageModel({
    model: venice.chat(modelId),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });
}

function createAnthropicModel(): LanguageModel {
  const anthropic = createAnthropic({ apiKey: ANTHROPIC_API_KEY! });
  return anthropic(ANTHROPIC_MODEL);
}

function createOpenAIModel(): LanguageModel {
  const openai = createOpenAI({ apiKey: OPENAI_API_KEY! });
  return openai(OPENAI_MODEL);
}

function createGoogleModel(taskType?: TaskType): LanguageModel {
  const google = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY! });
  return google(GEMINI_MODEL);
}

// Apr 28 · Ollama Cloud Pro — uses createOpenAI with custom baseURL
// since Ollama Cloud exposes an OpenAI-compatible /v1/chat/completions
// endpoint. The 1M-context models (qwen3-vl:235b-instruct,
// deepseek-v4-flash, kimi-k2.6) handle our heavy content-mode prompts
// (~70-100kc) without truncation. taskType is currently unused —
// Ollama doesn't have Venice's reasoning_effort knob — but the param
// is kept for parity in case we add per-task model routing later
// (e.g. fast → qwen3-coder-next, deep → deepseek-v4-pro).
function createOllamaModel(taskType: TaskType = "reason"): LanguageModel {
  const ollama = createOpenAI({
    apiKey: OLLAMA_API_KEY!,
    baseURL: `${OLLAMA_BASE_URL}/v1`,
  });
  // v10.0.529.60 · CRITICAL · force the legacy Chat Completions
  // path. AI SDK v6's createOpenAI() defaults to the new Responses
  // API ({ input: [...] } body shape with item_reference parts).
  // Ollama Cloud's /v1 endpoint only speaks Chat Completions
  // ({ messages: [...] }) · the Responses-shape requests were getting
  // 400 with 'input[N]: unknown input item type: "item_reference"'.
  // Same fix Venice uses at line 492 · v529.58's sanitizer was on
  // the wrong layer (after this) so it never saw the bad parts.
  // v-truth · per-task model routing — vision turns need the multimodal
  // model; all other turns use the (possibly smarter, text-only) chat model.
  const ollamaModel = taskType === "vision" ? OLLAMA_VISION_MODEL : OLLAMA_MODEL;
  return ollama.chat(ollamaModel);
}

// ---------------------------------------------------------------------------
// Availability checks
// ---------------------------------------------------------------------------

// Apr 27 · QUOTA-EXHAUSTED CIRCUIT BREAKER
// When Venice returns 402 Payment Required (no balance) the API stays
// broken until the user tops up. Without a circuit breaker every chat
// call hits Venice, gets 402, cascades into 429 rate-limiting (Venice
// counts failed attempts), and the user sees zero responses with no
// explanation.
//
// Cooldown is 2 min (was 10) so a top-up self-recovers fast: every
// 2 min isVeniceAvailable returns true, getModel sends one probe call
// to Venice, success clears the breaker entirely, failure re-trips
// it. Cost is one wasted request per 2 min during a quota outage.
//
// Direct calls to clearVeniceQuotaExhausted() let the venice-status
// endpoint reset the breaker the moment it sees a non-402 from
// Venice — so the user's "I added credits" doesn't have to wait the
// full 2 min.
// Reusable per-provider quota circuit-breaker. Venice (402 → cooldown)
// and Ollama Cloud share identical breaker logic, so one factory closes
// over the cooldown deadline and the two can never drift. The returned
// methods close over `until` (not `this`), so detaching them onto the
// exported names below is safe.
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
  };
}

const veniceBreaker = makeQuotaBreaker("venice", 2 * 60_000);
export const markVeniceQuotaExhausted = veniceBreaker.mark;
export const clearVeniceQuotaExhausted = veniceBreaker.clear;
export const isVeniceQuotaExhausted = veniceBreaker.isExhausted;

function isVeniceAvailable(): boolean {
  // Venice is retired for chat/completions (operator directive)
  if (process.env.RETIRE_VENICE !== "false") return false;

  if (!VENICE_API_KEY || VENICE_API_KEY === "your-new-key-here") return false;
  // Skip Venice while the quota-exhausted cooldown is active so getModel
  // falls through to the next provider in the chain.
  if (isVeniceQuotaExhausted()) return false;
  return true;
}

function isAnthropicAvailable(): boolean {
  return !!ANTHROPIC_API_KEY;
}

function isOpenAIAvailable(): boolean {
  return !!OPENAI_API_KEY;
}

// Apr 28 · Ollama Cloud Pro availability — same pattern as Venice
// (key check + the shared quota breaker above). Empty key or placeholder
// counts as unavailable so getModel falls through to the next provider.
const ollamaBreaker = makeQuotaBreaker("ollama", 2 * 60_000);
export const markOllamaQuotaExhausted = ollamaBreaker.mark;
export const clearOllamaQuotaExhausted = ollamaBreaker.clear;
export const isOllamaQuotaExhausted = ollamaBreaker.isExhausted;

function isOllamaAvailable(): boolean {
  if (!OLLAMA_API_KEY || OLLAMA_API_KEY.length < 20) return false;
  if (isOllamaQuotaExhausted()) return false;
  return true;
}

// June 14 · Gemini — same pattern
const geminiBreaker = makeQuotaBreaker("gemini", 2 * 60_000);
export const markGeminiQuotaExhausted = geminiBreaker.mark;
export const clearGeminiQuotaExhausted = geminiBreaker.clear;
export const isGeminiQuotaExhausted = geminiBreaker.isExhausted;

function isGeminiAvailable(): boolean {
  if (!GEMINI_API_KEY) return false;
  if (isGeminiQuotaExhausted()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Ordered provider list
// ---------------------------------------------------------------------------

interface ProviderEntry {
  name: ProviderName;
  available: () => boolean;
  create: (taskType?: TaskType) => LanguageModel;
  modelId: string;
}

// Provider order. Ollama Cloud is the default primary chat provider;
// Venice, OpenAI, and Anthropic are fallbacks (in that order). The
// `getModel(task, opts)` function below reorders this list to put Ollama
// first when opts.preferLargeContext is set. Set the `AI_PROVIDER` env to
// pin one provider (incident triage).
const PROVIDERS: ProviderEntry[] = [
  { name: "ollama", available: isOllamaAvailable, create: (t) => createOllamaModel(t), modelId: OLLAMA_MODEL },
  { name: "gemini", available: isGeminiAvailable, create: (t) => createGoogleModel(t), modelId: GEMINI_MODEL },
  { name: "openai", available: isOpenAIAvailable, create: () => createOpenAIModel(), modelId: OPENAI_MODEL },
  { name: "anthropic", available: isAnthropicAvailable, create: () => createAnthropicModel(), modelId: ANTHROPIC_MODEL },
  { name: "venice", available: isVeniceAvailable, create: (t) => createVeniceModel(t), modelId: VENICE_MODEL },
];

// ---------------------------------------------------------------------------
// v9.1.27 · Recently-failed provider tracker
//
// The chat route uses streamText() directly with a single model from
// getModel(). Once SSE headers are sent, you can't switch providers
// mid-stream. So if Venice errors mid-response on turn N, the user
// gets an interrupted stream — and if turn N+1 fires immediately
// after, getModel() picks Venice AGAIN (it's still available()) and
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
 * Default: Ollama Cloud 1st → Venice 2nd → OpenAI 3rd → Anthropic safety net.
 *   (v10.0.529.46 · Venice demoted after extended 402 outage.)
 * With opts.preferLargeContext: same order · Ollama already 1st so the
 *   flag is now a no-op for the default chain but kept for clarity at
 *   the call site (signals intent in case the chain changes again).
 *
 * preferLargeContext is set by callers that know the prompt is bigger
 * than Venice's 65k system-prompt limit — content-mode chat, deep-mode
 * planning, etc. The chat route detects this via detectContentIntent
 * and threads it down.
 *
 * TaskType controls Venice's reasoning_effort + temperature + penalties.
 * On Ollama it's currently a no-op but preserved for future per-task routing.
 */
export interface GetModelOptions {
  /** Promote Ollama Cloud (1M-context models) to 1st in the chain. */
  preferLargeContext?: boolean;
  /**
   * v10.0.512 · Promote a specific provider to 1st in the chain.
   * Used for factual/customer/SEO queries where Anthropic Claude
   * respects tool descriptions and explicit system-prompt directives
   * far better than venice-uncensored.
   *
   * The 2026-05-12 smoke test showed venice ignoring directly-injected
   * GSC data and saying "Sorry, I cannot provide information" instead
   * of citing the numbers in its system prompt. Anthropic Claude
   * doesn't have that compliance gap.
   */
  forceProviderFirst?: ProviderName;
}

export function getPreferredOrderForTask(taskType: TaskType): ProviderName[] {
  switch (taskType) {
    case "fast":
    case "sql":
    case "summary":
    case "classify":
    case "extract":
      return ["gemini", "ollama", "openai", "anthropic", "venice"];
    case "reason":
    case "vision":
      return ["ollama", "gemini", "openai", "anthropic", "venice"];
    case "deep":
      return ["ollama", "openai", "anthropic", "gemini", "venice"];
    case "code":
      return ["ollama", "openai", "anthropic", "gemini", "venice"];
    case "math":
      return ["openai", "gemini", "ollama", "anthropic", "venice"];
    case "creative":
      return ["ollama", "gemini", "openai", "anthropic", "venice"];
    case "embed":
    default:
      return ["ollama", "gemini", "openai", "anthropic", "venice"];
  }
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
    preferred = ["ollama", "gemini", "venice", "openai", "anthropic"];
  } else {
    preferred = getPreferredOrderForTask(taskType);
  }

  const ordered = [...PROVIDERS].sort((a, b) => {
    return preferred.indexOf(a.name) - preferred.indexOf(b.name);
  });

  if (AI_PROVIDER) {
    const entry = ordered.find((p) => p.name === AI_PROVIDER);
    if (!entry) {
      throw new Error(`Unknown AI_PROVIDER: ${AI_PROVIDER}`);
    }
    if (entry.available()) {
      // Pinned provider override — respect even if recently failed.
      // This is an explicit operator choice; we don't second-guess.
      return entry.create(taskType);
    }
    throw new Error(
      `AI_PROVIDER is set to "${AI_PROVIDER}" but it is not configured (missing API key).`
    );
  }

  // v9.1.27 · skip providers marked failed in the last ~60s. If ALL
  // providers are flagged (worst case), we still need to return one,
  // so we fall through to the unfiltered loop below as last resort.
  for (const entry of ordered) {
    if (entry.available() && !isProviderRecentlyFailed(entry.name)) {
      return entry.create(taskType);
    }
  }
  // All-flagged fallback — pick any available, even if failed.
  for (const entry of ordered) {
    if (entry.available()) {
      return entry.create(taskType);
    }
  }

  throw new Error(
    "No AI provider available. Set VENICE_API_KEY, OLLAMA_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY."
  );
}

/**
 * Returns the name and model ID of the currently active provider.
 *
 * v10.0.112 audit fix · two correctness fixes:
 *   1. Skip providers in the recently-failed cooldown so we never
 *      report "currently using Venice" while getModel() has already
 *      rotated to Ollama. Mirrors the same guard in getModel().
 *   2. For Venice, resolve the per-task model dynamically. The
 *      configured VENICE_MODEL is the "creative/deep" pick; for
 *      most tasks resolveVeniceModelForTask() returns the FAST model.
 *      Pre-fix this surface lied about which Venice model was active.
 */
function activeModelIdFor(entry: ProviderEntry, taskType: TaskType): string {
  if (entry.name === "venice") {
    return resolveVeniceModelForTask(taskType);
  }
  return entry.modelId;
}

export function getActiveProviderInfo(taskType: TaskType = "reason"): { provider: ProviderName; modelId: string } {
  const preferred = getPreferredOrderForTask(taskType);
  const ordered = [...PROVIDERS].sort((a, b) => {
    return preferred.indexOf(a.name) - preferred.indexOf(b.name);
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
  providers: { name: ProviderName; available: boolean; modelId: string }[];
  veniceParams: typeof VENICE_PARAMS;
} {
  let activeProvider: ProviderName | null = null;
  const seen = new Set<string>();
  const providers = PROVIDERS
    .filter((p) => {
      // Deduplicate Venice entries for display
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    })
    .map((p) => {
      const available = p.available();
      if (available && !activeProvider) activeProvider = p.name;
      return { name: p.name, available, modelId: p.modelId };
    });

  return { activeProvider, providers, veniceParams: VENICE_PARAMS };
}

/**
 * Returns a model suitable for structured output.
 */
export function getStructuredModel(): LanguageModel {
  return getModel();
}

/**
 * Async alias for getModel(). Kept for backward compat.
 */
export async function getModelWithFallback(): Promise<LanguageModel> {
  return getModel();
}

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
const PROVIDER_RATES_PER_1M_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  venice: { input: 0.5, output: 1.5 }, // Venice flagship-ish pricing
  ollama: { input: 0.0, output: 0.0 }, // local · zero marginal
  gemini: { input: 0.075, output: 0.30 }, // Gemini 2.5/3.5 Flash rates
  openai: { input: 2.5, output: 10.0 }, // gpt-4o-mini-ish average
  anthropic: { input: 3.0, output: 15.0 }, // Claude Sonnet-ish average
  none: { input: 0.0, output: 0.0 },
};

function estimateCostUsd(
  provider: string,
  inputTokens?: number,
  outputTokens?: number,
): number | undefined {
  if (inputTokens == null && outputTokens == null) return undefined;
  const rate = PROVIDER_RATES_PER_1M_TOKENS[provider];
  if (!rate) return undefined;
  const inUsd = ((inputTokens ?? 0) / 1_000_000) * rate.input;
  const outUsd = ((outputTokens ?? 0) / 1_000_000) * rate.output;
  return Math.round((inUsd + outUsd) * 10000) / 10000; // round to $0.0001
}

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
  opts: { signal?: AbortSignal; budgetNearingLimit?: boolean } = {},
): Promise<AiResponse> {
  // L.1 · external AbortSignal support · when caller passes a signal,
  // every per-provider attempt combines the external + per-attempt
  // timeout via AbortSignal.any(). Caller cancellation (e.g. mega-tier
  // budget timeout) actually aborts the in-flight fetch instead of
  // letting the LLM call complete and discarding the result. Closes
  // the orphan-promise spend leak noted in H.6.1.
  const externalSignal = opts.signal;
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
        n === "ollama" ? 0 : n === "gemini" ? 1 : n === "openai" ? 2 : n === "venice" ? 3 : 4;
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
  for (const p of orderedProviders) {
    if (p.available() && !toTry.includes(p)) toTry.push(p);
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
    // L.1 · early-bail if the external signal already aborted (operator
    // cancelled before this provider got its turn).
    if (externalSignal?.aborted) {
      failures.push({
        provider: entry.name,
        modelId: entry.modelId,
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
    const resolvedModelId = entry.name === "venice"
      ? resolveVeniceModelForTask(taskType)
      : entry.modelId;
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
      } catch {
        // never let telemetry break the provider
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
      );
      return {
        content: cleaned,
        provider: entry.name,
        // v10.0.215 · use resolvedModelId, not entry.modelId. For Venice
        // those diverge: entry.modelId is the env-configured VENICE_MODEL
        // (typically a heavy heretic model), but resolveVeniceModelForTask
        // routes most tasks through venice-uncensored. Pre-fix the
        // /system/agent-traces dashboard reported the wrong model on
        // every Venice success — analytics drift.
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
  return {
    content: `I'm having trouble connecting to my AI providers right now. ${userHint ? `You asked about "${userHint}..." — ` : ""}try again in a moment, or switch to a different mode.`,
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
 * Primary: Venice `text-embedding-bge-m3` (BAAI BGE-M3, 1024 dims).
 *          This is the ONLY embedding model Venice currently serves.
 *          Confirmed via the Venice OpenAPI spec on Apr 15 — the prior
 *          code was passing `text-embedding-ada-002` which Venice
 *          silently rejected, making the whole chain fail.
 * Fallback: OpenAI `text-embedding-3-small` (1536 dims).
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
export async function getEmbedding(text: string): Promise<number[]> {
  const input = text.slice(0, 30_000);

  // 1. Venice (primary)
  if (VENICE_API_KEY) {
    try {
      const res = await fetch("https://api.venice.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${VENICE_API_KEY}`,
        },
        body: JSON.stringify({ model: "text-embedding-bge-m3", input }),
        // wave-181.90 follow-up · 5s cap. Embedding paths run on every
        // RAG retrieval · without bounds a Venice stall blocks every
        // chat turn. Graceful fallback to Ollama / Cohere / OpenAI
        // already exists below · timeout just hits that path faster.
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const data = await res.json();
        const vec = data.data?.[0]?.embedding;
        if (vec?.length > 0) return vec;
      } else {
        // Log the actual error so we can see if the model name changes
        // or the endpoint moves. Previously this was a silent catch
        // which masked the root cause for weeks.
        const errBody = await res.text().catch(() => "");
        console.warn(
          `[ai:embedding] Venice failed (${res.status}): ${errBody.slice(0, 200)}`
        );
      }
    } catch (err) {
      console.warn(
        `[ai:embedding] Venice fetch threw: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 2. Ollama Cloud (fallback) · v10.0.529.45 · added after Venice ran
  // out of credit during the operator's live persona-corpus import.
  // Ollama Cloud exposes the NATIVE /api/embed endpoint (not the
  // OpenAI-compatible /v1/embeddings). Response shape:
  //   { embeddings: [[...]], model: "...", total_duration: ... }
  // OLLAMA_EMBED_MODEL defaults to nomic-embed-text · 768-dim · the
  // standard reliable model on Ollama Cloud.
  if (OLLAMA_API_KEY) {
    try {
      const model =
        cleanEnv(process.env.OLLAMA_EMBED_MODEL) || "nomic-embed-text";
      // Ollama Cloud returned 401 on /api/embed in field test · the
      // legacy /api/embeddings endpoint (plural · prompt-not-input) is
      // more widely exposed on cloud + self-hosted installs. Try that
      // shape first · fall through to /api/embed if 4xx.
      const tryEndpoint = async (
        path: string,
        body: Record<string, unknown>,
      ): Promise<number[] | null> => {
        const res = await fetch(`${OLLAMA_BASE_URL}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OLLAMA_API_KEY}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000), // wave-181.90 follow-up
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.warn(
            `[ai:embedding] Ollama ${path} failed (${res.status}): ${errBody.slice(0, 200)}`,
          );
          return null;
        }
        const data = await res.json();
        const vec: number[] | undefined = Array.isArray(data?.embeddings)
          ? data.embeddings[0]
          : data?.embedding;
        if (Array.isArray(vec) && vec.length > 0) return vec;
        return null;
      };
      const legacy = await tryEndpoint("/api/embeddings", { model, prompt: input });
      if (legacy) return legacy;
      const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OLLAMA_API_KEY}`,
        },
        body: JSON.stringify({ model, input }),
        signal: AbortSignal.timeout(10_000), // wave-181.90 follow-up
      });
      if (res.ok) {
        const data = await res.json();
        const vec: number[] | undefined = Array.isArray(data?.embeddings)
          ? data.embeddings[0]
          : data?.embedding;
        if (Array.isArray(vec) && vec.length > 0) return vec;
        console.warn(
          `[ai:embedding] Ollama returned 200 but no embedding in payload (keys: ${Object.keys(data ?? {}).join(",")})`,
        );
      } else {
        const errBody = await res.text().catch(() => "");
        console.warn(
          `[ai:embedding] Ollama failed (${res.status}): ${errBody.slice(0, 200)}`,
        );
      }
    } catch (err) {
      console.warn(
        `[ai:embedding] Ollama fetch threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

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
        if (Array.isArray(vec) && vec.length > 0) return vec;
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
      console.warn(
        `[ai:embedding] Cohere fetch threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 4. HuggingFace Inference (Wave AH · cheap multilingual backend)
  // Default model: intfloat/multilingual-e5-large · 1024-dim · supports
  // Spanish + 100 langs · ~$0.0001/call. See lib/ai/hf-embeddings.ts +
  // docs/runbooks/hf-embeddings-cutover.md.
  {
    const { getHfEmbedding, isHfEmbeddingAvailable } = await import("./hf-embeddings");
    if (isHfEmbeddingAvailable()) {
      const vec = await getHfEmbedding(input);
      if (vec && vec.length > 0) return vec;
    }
  }

  // 5. OpenAI (final fallback)
  if (OPENAI_API_KEY) {
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input }),
        signal: AbortSignal.timeout(15_000), // wave-181.90 follow-up · final fallback · give it more room
      });
      if (res.ok) {
        const data = await res.json();
        const vec = data.data?.[0]?.embedding;
        if (vec?.length > 0) return vec;
      } else {
        const errBody = await res.text().catch(() => "");
        console.warn(
          `[ai:embedding] OpenAI failed (${res.status}): ${errBody.slice(0, 200)}`
        );
      }
    } catch (err) {
      console.warn(
        `[ai:embedding] OpenAI fetch threw: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  log.warn("embedding.all_failed", {
    tried: ["venice", "ollama", "cohere", "hf", "openai"],
  });
  return [];
}

// ---------------------------------------------------------------------------
// Streaming (backward compat)
// ---------------------------------------------------------------------------

export function aiStream(messages: AiMessage[], taskType: TaskType = "reason"): ReadableStream<Uint8Array> {
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
