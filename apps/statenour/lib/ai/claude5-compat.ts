/**
 * Claude 5 frontier-lane compatibility (fable / mythos / opus-5) · 2026-08-11.
 *
 * The Claude 5 frontier models (claude-fable-5, claude-mythos-5,
 * claude-opus-5) run adaptive thinking ALWAYS-ON and reject sampling
 * params — non-default `temperature` / `top_p` / `top_k` → HTTP 400.
 * This repo sends temperature on every chat turn (build-stream-config.ts,
 * from the turn classifier) and caps maxOutputTokens as low as 80-1600
 * for visible brevity — but on thinking models the cap covers thinking
 * AND visible text together, so a brevity cap strangles reasoning.
 *
 * This middleware makes `ANTHROPIC_MODEL=claude-fable-5` (or opus-5 /
 * mythos-5) safe to flip with ZERO call-site changes:
 *   · strips temperature / topP / topK           (400-proof)
 *   · floors maxOutputTokens at 16k              (thinking headroom;
 *     visible brevity stays governed by the response contract, which is
 *     prompt-level, not token-cap-level)
 *   · touches nothing else — providerOptions.anthropic.effort passes
 *     through untouched (the installed @ai-sdk/anthropic ^3.0.64
 *     accepts effort low|medium|high|xhigh|max; the vnext effort
 *     router owns choosing it — lib/ai/vnext/effort-policy.ts).
 *
 * 2026-09-29 (#2768) · the middleware now also covers claude-sonnet-5 /
 * sonnet-5-5 and claude-opus-4-7 / 4-8. The old header exempted Sonnet 5
 * as "prod-verified WITH temperature"; no receipt for that was ever
 * linked, and Anthropic's model-deprecations page (read 2026-09-29, "API
 * parameter deprecations") says `temperature`/`top_p`/`top_k` "Returns a
 * 400 error when set to a non-default value on Claude 4.7 and later
 * models". The claude-api skill's thinking table agrees row by row
 * (Sonnet 5: "Removed - 400"; Sonnet 5.5: "Non-default values - 400";
 * Opus 4.7/4.8: "Removed - 400"). Sonnet 5 / 5.5 also run adaptive
 * thinking when `thinking` is omitted, so they get the output floor too;
 * Opus 4.7/4.8 do not think unless asked, so they only lose sampling.
 * isClaude5ThinkingModel keeps its narrower meaning (the frontier ids the
 * effort router targets); the middleware keys on the two predicates below.
 *
 * Applied at the ONE choke point every lane passes through —
 * createAnthropicModel() in lib/ai/provider.ts — so chat, aiChat,
 * side-pane, reasoning, judge and any future caller inherit it.
 * (Pattern precedent: createOllamaModel's fetch-interceptor that clamps
 * num_predict / reasoning budgets per-model.)
 */
import type { LanguageModelMiddleware } from "ai";

const CLAUDE5_FRONTIER_RE = /^claude-(fable|mythos|opus)-5/;
/** Claude 4.7 and later: a non-default temperature / top_p / top_k is a 400. */
const REJECTS_SAMPLING_RE = /^claude-(?:(?:fable|mythos|opus|sonnet)-5|opus-4-[78](?![0-9]))/;
/** Runs adaptive thinking when `thinking` is omitted (the whole 5 family, Sonnet included). */
const THINKS_BY_DEFAULT_RE = /^claude-(?:fable|mythos|opus|sonnet)-5/;

const normId = (modelId: string | null | undefined) => (modelId ?? "").trim().toLowerCase();

/** True when the model 400s on a non-default temperature / top_p / top_k. */
export function rejectsSamplingParams(modelId: string | null | undefined): boolean {
  return REJECTS_SAMPLING_RE.test(normId(modelId));
}

/** True when the model thinks by default, so thinking shares maxOutputTokens with the answer. */
export function thinksByDefault(modelId: string | null | undefined): boolean {
  return THINKS_BY_DEFAULT_RE.test(normId(modelId));
}

/**
 * True for the always-on-thinking Claude 5 frontier ids (any suffix —
 * dated snapshots like "claude-opus-5-20260724" match too). False for
 * claude-sonnet-5 and every non-Anthropic id.
 */
export function isClaude5ThinkingModel(modelId: string | null | undefined): boolean {
  return CLAUDE5_FRONTIER_RE.test((modelId ?? "").trim().toLowerCase());
}

/**
 * Thinking + visible text share one output budget on the 5-family, so
 * the floor must leave reasoning room even when the turn classifier
 * asked for an 80-token visible answer. Anthropic's own guidance starts
 * agentic workloads at 64k; 16k is the interactive-chat floor — a cap
 * is a ceiling, not spend, and the bake-off can retune this.
 */
export const CLAUDE5_MIN_OUTPUT_TOKENS = 16_000;

/**
 * Pure param sanitizer — exported separately from the middleware so the
 * mechanism is directly unit-testable without SDK type scaffolding.
 */
export function stripSamplingParams<T extends Record<string, unknown>>(params: T): T {
  const next: Record<string, unknown> = { ...params };
  delete next.temperature;
  delete next.topP;
  delete next.topK;
  return next as T;
}

export function sanitizeClaude5Params<T extends Record<string, unknown>>(params: T): T {
  const next: Record<string, unknown> = stripSamplingParams(params);
  const requested = typeof next.maxOutputTokens === "number" ? next.maxOutputTokens : 0;
  next.maxOutputTokens = Math.max(requested, CLAUDE5_MIN_OUTPUT_TOKENS);
  return next as T;
}

export const claude5CompatMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => sanitizeClaude5Params(params),
};

const samplingOnlyMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => stripSamplingParams(params),
};

/**
 * The middleware createAnthropicModel wraps a model id in, or undefined for
 * a model that takes sampling params (Sonnet 4.6, Haiku 4.5, ...): strip +
 * floor for a thinks-by-default id, strip only for Opus 4.7 / 4.8.
 */
export function claudeCompatMiddlewareFor(modelId: string | null | undefined): LanguageModelMiddleware | undefined {
  if (!rejectsSamplingParams(modelId)) return undefined;
  return thinksByDefault(modelId) ? claude5CompatMiddleware : samplingOnlyMiddleware;
}

/**
 * Raw Messages API callers with a small max_tokens (Telegram photo analysis,
 * lib/ai/vision-input.ts) sent `thinking: { type: "disabled" }` to every
 * model. Per the claude-api skill's thinking table (models cached
 * 2026-09-25) that is a 400 on Claude Opus 5.5, Claude Sonnet 5.5 and
 * Fable / Mythos 5 and 5.1, so an ANTHROPIC_MODEL / ANTHROPIC_VISION_MODEL
 * flip to one of them failed every call. Their replacements:
 *   - Sonnet 5.5: `thinking: { type: "between_tools" }` turns thinking off
 *     (accepted at the default effort, `high`, or below).
 *   - Opus 5.5 / Fable / Mythos: thinking cannot be turned off; omit the
 *     parameter and send `effort: "low"` to keep the thinking share small.
 * Only ids known to accept `disabled` get it. nickstire carries the same
 * rule in server/services/claudeThinkingParams.ts (no shared AI code).
 */
const ACCEPTS_THINKING_DISABLED = new Set([
  "claude-sonnet-5",
  "claude-opus-5", // accepted at effort high or below; no effort is sent with it
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
]);

/** Request-body fields to spread into a Messages API call that wants a short, thinking-free answer. */
export function claudeThinkingOffParams(
  modelId: string,
): { thinking: { type: "disabled" | "between_tools" } } | { output_config: { effort: "low" } } {
  const key = normId(modelId).replace(/[-@]\d{8}$/, "").replace(/-latest$/, "");
  if (ACCEPTS_THINKING_DISABLED.has(key)) return { thinking: { type: "disabled" } };
  if (key === "claude-sonnet-5-5") return { thinking: { type: "between_tools" } };
  return { output_config: { effort: "low" } };
}
