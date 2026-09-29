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
  anthropic: { input: 2.0, output: 10.0 }, // = claude-sonnet-5, the registry default (config/ai-providers.ts)
  openrouter: { input: 0.15, output: 0.6 }, // OpenRouter Gemini 2.5 rates
  none: { input: 0.0, output: 0.0 },
};

/** USD for one call at the provider's family rate; undefined when usage is missing or the provider is unknown. */
export function estimateCostUsd(
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
    modelName: "statenour/anthropic-family",
    matchPattern: "(?i)^claude[-.].*",
    inputPrice: perToken(PROVIDER_RATES_PER_1M_TOKENS.anthropic.input),
    outputPrice: perToken(PROVIDER_RATES_PER_1M_TOKENS.anthropic.output),
    sample: "claude-sonnet-5",
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
];
