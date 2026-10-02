/**
 * lib/ai/chat-output-budget.ts · 2026-10-02
 *
 * The chat turn's output-token cap, as one pure rule.
 *
 * The chat lane runs a THINKING model (OLLAMA_MODEL=minimax-m3) whose hidden
 * reasoning spends completion tokens BEFORE any visible answer. Measured
 * 2026-08-15 (scripts/probe-empty-responses.ts): every answer that completed
 * used 3,013-3,611 completion tokens. prepare-tools raised the MODE defaults to
 * 6,000 / 10,000 for that reason — but the query-shape budget still REPLACED
 * the mode default whenever it was set, so a short question got 300 (casual),
 * 500 (yes/no), 800 (factual) or 2,800 (plan) tokens and the model ran out
 * mid-reasoning. Production 2026-10-02 15:05Z and 15:10Z: two "factual" turns,
 * cap 800, finishReason "length", zero visible text → the operator got the
 * canned "trouble connecting" reply. Railway logs since 09-29 show nine turns
 * capped below the measured floor (factual 800 x4, plan 2800 x3, casual 300 x2).
 *
 * Brevity is not this number's job: the response contract built from the same
 * query shape (derive-turn-signals → buildResponseContract) tells the model how
 * long to be. The cap only has to be high enough that a short answer can
 * arrive at all. Output on the funded Ollama lane is flat-rate, and a metered
 * fallback bills tokens produced, not the ceiling.
 */

/** Below this a thinking-model turn can end before its first visible word. */
export const THINKING_OUTPUT_FLOOR = 6000;

export const RESEARCH_COMPILER_OUTPUT = 8000;

export function deriveMaxOutputTokens(args: {
  mode: "standard" | "deep" | string;
  researchCompilerMode: unknown;
  shapeBudget: number;
}): { maxOutputTokens: number; modeDefaultTokens: number } {
  const modeDefaultTokens = args.mode === "deep" ? 10000 : 6000;
  if (args.researchCompilerMode) return { maxOutputTokens: RESEARCH_COMPILER_OUTPUT, modeDefaultTokens };
  if (args.shapeBudget > 0) {
    return { maxOutputTokens: Math.max(args.shapeBudget, THINKING_OUTPUT_FLOOR), modeDefaultTokens };
  }
  return { maxOutputTokens: modeDefaultTokens, modeDefaultTokens };
}
