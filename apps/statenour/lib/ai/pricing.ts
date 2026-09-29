/**
 * AI pricing · 2026-09-08 (program U6 · cost truth).
 *
 * ONE rate table. Before this file, `lib/ai/provider.ts` priced the calls
 * it answered (per provider) and `lib/ai/track.ts` priced the calls it
 * recorded (per model substring) — two tables, two answers, and 47 of 54
 * `aiChat` callers never recorded anything at all. Both modules now read
 * from here, and `aiChat` records every completed call itself.
 *
 * Rates are USD per 1M tokens. They are honest approximations per provider
 * family, not per-SKU list prices; the model table in track.ts refines
 * them for the SKUs it names. Langfuse gets the same numbers through
 * `scripts/langfuse-register-models.ts`, so the three cost surfaces
 * (AiGeneration rows, the reasoning engine, Langfuse) agree.
 */

export const PROVIDER_RATES_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  ollama: { input: 0.0, output: 0.0 }, // local · zero marginal
  gemini: { input: 0.075, output: 0.3 }, // Gemini 2.5/3.5 Flash rates
  openai: { input: 2.5, output: 10.0 }, // gpt-4o-mini-ish average
  anthropic: { input: 2.0, output: 10.0 }, // = claude-sonnet-5, the registry default; fallback only — Claude ids price per model (below)
  openrouter: { input: 0.15, output: 0.6 }, // OpenRouter Gemini 2.5 rates
  none: { input: 0.0, output: 0.0 },
};

/**
 * Claude list prices per model, USD per 1M tokens (base input / output).
 * Source: platform.claude.com/docs/en/about-claude/pricing, "Model pricing"
 * table, read 2026-09-29 (cross-checked against the claude-api skill's model
 * table cached 2026-09-25). Keys are aliases; dated snapshots
 * ("claude-opus-4-5-20251101") and "-latest" resolve to them via
 * claudeModelKey(). If Anthropic reprices, change the source date and the
 * numbers together (pinned by tests/lib/ai/claude-pricing.test.ts).
 *
 * Why per model: the escalation lane (lib/ai/vnext/effort-policy.ts) runs
 * claude-opus-5 and claude-fable-5, and ANTHROPIC_MODEL can name any id.
 * The family rate below is Sonnet's $2/$10; a Fable call is $10/$50, so the
 * family rate under-counted that spend five times over.
 *
 * Retired models (config/retired-claude-models.json) have no row: a call to
 * one fails, and an AiGeneration row stores its cents at write time, so a
 * retired id never needs a price here.
 */
export const CLAUDE_MODEL_RATES_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10.0, output: 50.0 },
  "claude-mythos-5-1": { input: 10.0, output: 50.0 },
  "claude-fable-5": { input: 10.0, output: 50.0 },
  "claude-mythos-5": { input: 10.0, output: 50.0 },
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-opus-4-5": { input: 5.0, output: 25.0 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

/** True for anything shaped like a Claude model id. */
export function isClaudeModelId(modelId: string | null | undefined): boolean {
  return /^claude[-.]/i.test((modelId ?? "").trim());
}

/**
 * The rate-table key for a Claude id: lowercased, with a dated-snapshot
 * suffix ("-20251101" / "@20251101") or "-latest" removed. Exact match only,
 * so "claude-opus-5-5" never prices as "claude-opus-5".
 */
export function claudeModelKey(modelId: string): string {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/[-@]\d{8}$/, "")
    .replace(/-latest$/, "");
}

/** The per-model Claude rate, or undefined for an id the table does not name. */
export function claudeModelRate(modelId: string): { input: number; output: number } | undefined {
  return CLAUDE_MODEL_RATES_PER_1M_TOKENS[claudeModelKey(modelId)];
}

const flaggedUnpricedClaude = new Set<string>();

/**
 * An unknown Claude id still gets the family rate (a cost of 0 would read as
 * "free"), but it is flagged once per id so a mispriced model is visible in
 * the logs instead of silently under-counting spend.
 */
function flagUnpricedClaudeModel(modelId: string): void {
  const key = claudeModelKey(modelId);
  if (flaggedUnpricedClaude.has(key)) return;
  flaggedUnpricedClaude.add(key);
  console.warn(
    `[pricing] no per-model rate for Claude model "${key}"; priced at the anthropic family rate. Add it to CLAUDE_MODEL_RATES_PER_1M_TOKENS.`,
  );
}

/**
 * USD for one call; undefined when usage is missing or the provider is unknown.
 * A Claude model id (on the anthropic provider) is priced by the per-model
 * table first; the provider family rate is the fallback.
 */
export function estimateCostUsd(
  provider: string,
  inputTokens?: number,
  outputTokens?: number,
  modelId?: string,
): number | undefined {
  if (inputTokens == null && outputTokens == null) return undefined;
  let rate = PROVIDER_RATES_PER_1M_TOKENS[provider];
  if (provider === "anthropic" && modelId && isClaudeModelId(modelId)) {
    const perModel = claudeModelRate(modelId);
    if (perModel) rate = perModel;
    else flagUnpricedClaudeModel(modelId);
  }
  if (!rate) return undefined;
  const inUsd = ((inputTokens ?? 0) / 1_000_000) * rate.input;
  const outUsd = ((outputTokens ?? 0) / 1_000_000) * rate.output;
  return Math.round((inUsd + outUsd) * 10000) / 10000; // round to $0.0001
}

/** Cents for the AiGeneration ledger. Rounds half up; never negative. */
export function usdToCents(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * 100);
}

/**
 * Langfuse model definitions. Langfuse prices a generation only when the
 * model id on the span matches a registered `matchPattern`; ids from this
 * app's failover chain (OpenRouter slugs, Gemini, GPT, Claude, local
 * Ollama tags) matched nothing, so every trace showed cost 0. Prices are
 * per TOKEN (the API unit), derived from the table above.
 */
export interface LangfuseModelPrice {
  modelName: string;
  /** Langfuse regex (Go RE2 syntax) over the model id reported on the span. */
  matchPattern: string;
  inputPrice: number;
  outputPrice: number;
  /** A model id this pattern must match — pinned by the pricing test. */
  sample: string;
}

const perToken = (perMillion: number) => perMillion / 1_000_000;

/**
 * Definitions this app registered before and must remove: the 2026-09-08
 * "statenour/anthropic-family" catch-all (^claude[-.].*) priced every Claude
 * id at Sonnet's rate and would overlap the per-model rows below.
 * scripts/langfuse-register-models.ts deletes these.
 */
export const RETIRED_LANGFUSE_MODEL_NAMES = ["statenour/anthropic-family"];

export const LANGFUSE_MODEL_PRICES: LangfuseModelPrice[] = [
  {
    modelName: "statenour/gemini-family",
    matchPattern: "(?i)^(models/)?gemini[-.].*",
    inputPrice: perToken(PROVIDER_RATES_PER_1M_TOKENS.gemini.input),
    outputPrice: perToken(PROVIDER_RATES_PER_1M_TOKENS.gemini.output),
    sample: "gemini-2.5-flash",
  },
  {
    modelName: "statenour/openai-family",
    matchPattern: "(?i)^(gpt-|o[1-9]|chatgpt-).*",
    inputPrice: perToken(PROVIDER_RATES_PER_1M_TOKENS.openai.input),
    outputPrice: perToken(PROVIDER_RATES_PER_1M_TOKENS.openai.output),
    sample: "gpt-4o-mini",
  },
  {
    modelName: "statenour/openrouter-slug",
    matchPattern: "(?i)^[a-z0-9_-]+/[a-z0-9._:-]+$",
    inputPrice: perToken(PROVIDER_RATES_PER_1M_TOKENS.openrouter.input),
    outputPrice: perToken(PROVIDER_RATES_PER_1M_TOKENS.openrouter.output),
    sample: "google/gemini-2.5-flash",
  },
  {
    modelName: "statenour/ollama-local",
    matchPattern: "(?i)^(qwen|llama|gemma|mistral|phi|deepseek)[a-z0-9._:-]*$",
    inputPrice: 0,
    outputPrice: 0,
    sample: "qwen3-vl:8b",
  },
  // One definition per Claude model, exact id (plus an optional dated
  // snapshot suffix). No catch-all "claude-*" pattern: it would overlap
  // these, and an unknown Claude id is better unpriced in Langfuse than
  // priced at the wrong rate. The AiGeneration ledger still prices it at
  // the family rate and flags it (estimateCostUsd).
  ...Object.entries(CLAUDE_MODEL_RATES_PER_1M_TOKENS).map(([id, rate]) => ({
    modelName: `statenour/${id}`,
    matchPattern: `(?i)^${id}(-\\d{8}|-latest)?$`,
    inputPrice: perToken(rate.input),
    outputPrice: perToken(rate.output),
    sample: id,
  })),
];
