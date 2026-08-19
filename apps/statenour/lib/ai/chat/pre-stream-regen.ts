/**
 * Pre-stream auto-regen · v10.0.492 · ADR-0011 Tier 2
 *
 * Standalone helper that runs the critic on a freshly-generated reply
 * and (if shouldRegen) requests a second generation at higher temp
 * with a hard-prefix system addition. Returns the winning text + a
 * flag so the caller can record telemetry.
 *
 * This module is DELIBERATELY decoupled from the chat route. It does
 * not import streamText, generateText, or any provider client · it
 * receives both functions as parameters. Two reasons:
 *
 *   1. Testability · we can pass mock generators and assert the
 *      regen logic without spinning up an LLM call.
 *   2. Hot-path safety · the chat route at app/api/ai/chat/route.ts
 *      stays untouched. Wiring this module in is a separate, env-
 *      flagged push (NICK_PRESTREAM_REGEN=on).
 *
 * The diagnosis behind why this exists is captured in ADR-0011 at
 * docs/adr/0011-axis-specific-regen-gate-chat-vagueness.md.
 */

import { critiqueOutput, type CriticScore } from "@/lib/ai/output-critic";
import type { OutputShape } from "@/lib/ai/turn-intelligence";

export type Intent =
  | "factual"
  | "decision"
  | "creative"
  | "casual"
  | "emotional"
  | "instructional"
  | "procedural"
  | "reflective"
  | "analytical";

export interface PreStreamRegenArgs {
  /** Turn intent from turn-intelligence. Gates whether regen even fires. */
  intent: Intent;
  /** Output shape from turn-intelligence. Passed through to critic. */
  shape: OutputShape;
  /** 2026-08-18 · the operator's message. Lets the critic waive the
   *  spec/length axes on operator-constrained brevity ("reply with just
   *  OK") — obedient terse replies were silently re-rolled here, paying
   *  a second generation for following instructions. */
  userPrompt?: string;
  /** First-attempt generator · returns the model's reply as a string. */
  generateOnce: () => Promise<string>;
  /**
   * Second-attempt generator · called only if first attempt fails the
   * critic. Receives the original text + critic score + a recommended
   * prefix the caller can prepend to the system prompt. Whatever the
   * caller does with the prefix is up to them · we just provide the
   * suggested language so behavior is consistent across callers.
   */
  regenOnce: (args: {
    firstAttempt: string;
    firstScore: CriticScore;
    suggestedSystemPrefix: string;
  }) => Promise<string>;
}

export interface PreStreamRegenResult {
  /** The text the caller should ship to the user. */
  text: string;
  /** True if regen was triggered AND its output replaced the first attempt. */
  regenFired: boolean;
  /** Critic score on the first attempt. */
  firstScore: CriticScore;
  /** Critic score on the regen, if regen was attempted. */
  regenScore: CriticScore | null;
  /** Latency-cost breakdown for telemetry. */
  durationMs: {
    first: number;
    regen: number | null;
    total: number;
  };
  /** Whether the regen output was actually better than the first attempt. */
  regenWasBetter: boolean | null;
}

/**
 * Intents that benefit from pre-stream regen. The trade-off: regen
 * adds ~1-2s latency on the first attempt's failure path. Worth it
 * for intents where specifics matter (factual = "what's true",
 * decision = "what should I do"). NOT worth it for emotional /
 * casual where the operator cares more about flow than precision.
 */
const REGEN_GATED_INTENTS: ReadonlySet<Intent> = new Set([
  "factual",
  "decision",
  "instructional",
  "procedural",
  "analytical",
]);

export function shouldGateForIntent(intent: Intent): boolean {
  return REGEN_GATED_INTENTS.has(intent);
}

/**
 * Recommended system-prompt prefix for the regen attempt. Hard,
 * specific, non-negotiable language · matches the operator's
 * "no fluff · concrete data or admission" voice. Callers prepend
 * this to whatever system prompt they pass to the LLM on regen.
 */
export const REGEN_SYSTEM_PREFIX = `CRITICAL · the prior draft was flagged generic by the post-stream critic. Regenerate with:
- **MANDATORY TOOL-CALL-FIRST RULE** · BEFORE saying "I don't have X" or describing any uncertain situation, you MUST attempt to call any available tools whose descriptions match the query. For SEO/GSC/search/traffic/impressions/clicks → call getGscSummary or getGscTopQueries. For customer questions → call findCustomer. For revenue → call getRevenueStats or getDashboardSummary. For tasks/missions → call getTasks or getMissions. For marketing attribution / "what's working" → call getMarketingAttribution. Only AFTER a tool call returns null, errors, or is unavailable may you say "I don't have access to that data right now". DO NOT invent narratives about "logging errors", "outages", "data discrepancies", or other plausible-sounding fabrications · those are HALLUCINATIONS and they fail Nour's trust.
- SPECIFIC numbers · names · dates · system names from REAL tool output. Cite the source if there is one.
- If you don't have data AFTER attempting tool calls, say "I don't have X · the bridge doesn't expose that yet" · do NOT approximate.
- No hedging language ("might", "could", "may", "depending on factors").
- No stock phrases ("when it comes to", "navigate the complexities", "in today's landscape").
- If the question is unanswerable without more context, ask ONE precise clarifying question instead of approximating.
- Keep the same output shape as before unless the prior draft's shape was itself the problem.`;

/**
 * Run the first generation · score it · if it fails the critic AND
 * the intent is regen-gated, run one regeneration · return the
 * winner (regen ONLY wins if it scores higher than the first attempt
 * AND its shouldRegen is false; otherwise we ship the first attempt
 * because two bad replies don't make a good one).
 *
 * Pure orchestration · no LLM calls inside this function · the
 * caller supplies both generation functions.
 */
export async function maybePreStreamRegen(
  args: PreStreamRegenArgs,
): Promise<PreStreamRegenResult> {
  const totalStart = Date.now();

  const firstStart = Date.now();
  const firstAttempt = await args.generateOnce();
  const firstMs = Date.now() - firstStart;
  const firstScore = critiqueOutput(firstAttempt, args.shape, { userPrompt: args.userPrompt });

  // Fast path · first attempt passed the critic OR intent isn't gated.
  if (!firstScore.shouldRegen || !shouldGateForIntent(args.intent)) {
    return {
      text: firstAttempt,
      regenFired: false,
      firstScore,
      regenScore: null,
      durationMs: {
        first: firstMs,
        regen: null,
        total: Date.now() - totalStart,
      },
      regenWasBetter: null,
    };
  }

  // Regen path · first attempt failed AND intent is gated.
  const regenStart = Date.now();
  const regenAttempt = await args.regenOnce({
    firstAttempt,
    firstScore,
    suggestedSystemPrefix: REGEN_SYSTEM_PREFIX,
  });
  const regenMs = Date.now() - regenStart;
  const regenScore = critiqueOutput(regenAttempt, args.shape, { userPrompt: args.userPrompt });

  // Regen wins only if it is BOTH cleaner AND scores higher than the
  // first attempt. Two bad replies don't make a good one · ship the
  // less-bad one to avoid spending latency for no quality gain.
  const regenIsCleaner = !regenScore.shouldRegen;
  const regenScoresHigher = regenScore.overall > firstScore.overall;
  const regenWasBetter = regenIsCleaner && regenScoresHigher;

  return {
    text: regenWasBetter ? regenAttempt : firstAttempt,
    regenFired: regenWasBetter,
    firstScore,
    regenScore,
    durationMs: {
      first: firstMs,
      regen: regenMs,
      total: Date.now() - totalStart,
    },
    regenWasBetter,
  };
}

/**
 * Build the telemetry record for a SystemMetric write. Caller decides
 * whether to write it · we just format consistently so dashboards can
 * aggregate.
 */
export function formatRegenTelemetry(
  result: PreStreamRegenResult,
  intent: Intent,
  shape: OutputShape,
): {
  metric: string;
  value: number;
  unit: string;
  tags: Record<string, unknown>;
  source: string;
} {
  return {
    metric: "chat.pre_stream_regen",
    value: result.regenFired ? 1 : 0,
    unit: "count",
    tags: {
      intent,
      shape,
      regenAttempted: result.regenScore !== null,
      regenFired: result.regenFired,
      regenWasBetter: result.regenWasBetter,
      firstSpec: result.firstScore.specificity,
      firstOverall: result.firstScore.overall,
      regenSpec: result.regenScore?.specificity ?? null,
      regenOverall: result.regenScore?.overall ?? null,
      firstShouldRegen: result.firstScore.shouldRegen,
      regenShouldRegen: result.regenScore?.shouldRegen ?? null,
      durationMs: result.durationMs.total,
      firstMs: result.durationMs.first,
      regenMs: result.durationMs.regen,
    },
    source: "pre-stream-regen",
  };
}
