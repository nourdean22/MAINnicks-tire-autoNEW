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
 * Deliberately NOT applied to claude-sonnet-5 (the current Anthropic
 * default): that lane is prod-verified WITH temperature; changing its
 * params would be an unforced behavior change.
 *
 * Applied at the ONE choke point every lane passes through —
 * createAnthropicModel() in lib/ai/provider.ts — so chat, aiChat,
 * side-pane, reasoning, judge and any future caller inherit it.
 * (Pattern precedent: createOllamaModel's fetch-interceptor that clamps
 * num_predict / reasoning budgets per-model.)
 */
import type { LanguageModelMiddleware } from "ai";

const CLAUDE5_FRONTIER_RE = /^claude-(fable|mythos|opus)-5/;

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
export function sanitizeClaude5Params<T extends Record<string, unknown>>(params: T): T {
  const next: Record<string, unknown> = { ...params };
  delete next.temperature;
  delete next.topP;
  delete next.topK;
  const requested = typeof next.maxOutputTokens === "number" ? next.maxOutputTokens : 0;
  next.maxOutputTokens = Math.max(requested, CLAUDE5_MIN_OUTPUT_TOKENS);
  return next as T;
}

export const claude5CompatMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => sanitizeClaude5Params(params),
};
