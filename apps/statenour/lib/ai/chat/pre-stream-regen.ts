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
import {
  runReplyGateWithContract,
  type ContractGateDecision,
} from "@/lib/ai/reply-gate";
import type { ResponseContract } from "@/lib/ai/response-contract";
import type { OutputShape, TurnSignal } from "@/lib/ai/turn-intelligence";

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

export interface CandidateAssessment {
  critic: CriticScore;
  gate: ContractGateDecision | null;
  /** One normalized severity used only for winner selection. */
  severity: number;
  needsRepair: boolean;
  reasons: string[];
}
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
  /** Full turn + response contract let this lane repair request-fit failures too. */
  turnSignal?: TurnSignal;
  responseContract?: ResponseContract | null;
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
    firstAssessment: CandidateAssessment;
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
  firstAssessment: CandidateAssessment;
  regenAssessment: CandidateAssessment | null;
  /** Why the selector chose the second draft or kept the first. */
  selectionReason:
    | "first-passed"
    | "intent-not-gated"
    | "cleaner"
    | "lower-severity"
    | "higher-overall"
    | "higher-specificity"
    | "first-kept";
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
export const REGEN_SYSTEM_PREFIX = `CRITICAL · the prior draft failed measured quality / request-fit checks. Repair it once before answering:
- **MANDATORY TOOL-CALL-FIRST RULE** · BEFORE saying "I don't have X" or describing any uncertain situation, you MUST attempt to call any available tools whose descriptions match the query. For SEO/GSC/search/traffic/impressions/clicks → call getGscSummary or getGscTopQueries. For customer questions → call findCustomer. For revenue → call getRevenueStats or getDashboardSummary. For tasks/missions → call getTasks or getMissions. For marketing attribution / "what's working" → call getMarketingAttribution. Only AFTER a tool call returns null, errors, or is unavailable may you say "I don't have access to that data right now". DO NOT invent narratives about "logging errors", "outages", "data discrepancies", or other plausible-sounding fabrications · those are HALLUCINATIONS and they fail Nour's trust.
- SPECIFICITY MUST BE EARNED · use numbers, names, dates, files, and system names only from the prompt, trusted context, or real tool output. Cite the source when one exists.
- If you don't have data AFTER attempting tool calls, say "I don't have X · the bridge doesn't expose that yet" · do NOT approximate.
- No hedging language ("might", "could", "may", "depending on factors").
- No stock phrases ("when it comes to", "navigate the complexities", "in today's landscape").
- If the question is unanswerable without more context, ask ONE precise clarifying question only when the response contract allows clarification; otherwise give the best supported answer from current evidence.
- Keep the requested count, format, concision, and grounding requirements.\n- NO PERSONAL PREFERENCE · give facts, mechanisms, options, and consequences toward Nour's stated objective. Only recommend when he explicitly asked for a recommendation, and optimize it for his objective / constraints.`;

function uniqueReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons.map((r) => r.trim()).filter(Boolean))]
    .filter((r) => !/waived/i.test(r))
    .slice(0, 8);
}

function normalizedSeverity(
  critic: CriticScore,
  gate: ContractGateDecision | null,
): number {
  // A critic axis can fire at a decent composite score. Preserve that as a
  // real failure instead of translating 76/100 into severity 24 and losing it.
  const criticFloor = critic.shouldRegen ? Math.max(50, 100 - critic.overall) : 0;
  return Math.max(criticFloor, gate?.severity ?? 0);
}

export function assessRegenCandidate(
  text: string,
  args: Pick<
    PreStreamRegenArgs,
    "shape" | "userPrompt" | "turnSignal" | "responseContract"
  >,
): CandidateAssessment {
  const critic = critiqueOutput(text, args.shape, { userPrompt: args.userPrompt });
  const gate =
    args.turnSignal && args.responseContract && args.userPrompt
      ? runReplyGateWithContract(
          text,
          args.userPrompt,
          critic,
          args.turnSignal,
          args.responseContract,
        )
      : null;
  return {
    critic,
    gate,
    severity: normalizedSeverity(critic, gate),
    needsRepair: critic.shouldRegen || Boolean(gate?.shouldRegen),
    reasons: uniqueReasons([...critic.reasons, ...(gate?.reasons ?? [])]),
  };
}

export function buildTargetedRegenPrefix(
  assessment: CandidateAssessment,
): string {
  if (assessment.reasons.length === 0) return REGEN_SYSTEM_PREFIX;
  const failures = assessment.reasons.map((r) => "- " + r).join("\n");
  return [
    REGEN_SYSTEM_PREFIX,
    "",
    "MEASURED FAILURES IN THE PRIOR DRAFT:",
    failures,
    "",
    "Fix THESE failures specifically. Do not add unsupported facts just to satisfy a score.",
  ].join("\n");
}

function compareCandidates(
  regen: CandidateAssessment,
  first: CandidateAssessment,
): PreStreamRegenResult["selectionReason"] | null {
  if (regen.needsRepair !== first.needsRepair) {
    return regen.needsRepair ? null : "cleaner";
  }
  if (regen.severity !== first.severity) {
    return regen.severity < first.severity ? "lower-severity" : null;
  }
  if (regen.critic.overall !== first.critic.overall) {
    return regen.critic.overall > first.critic.overall ? "higher-overall" : null;
  }
  if (regen.critic.specificity !== first.critic.specificity) {
    return regen.critic.specificity > first.critic.specificity ? "higher-specificity" : null;
  }
  return null;
}

/**
 * Run one draft, assess it, and if necessary run exactly one targeted repair.
 * The repair wins whenever the same deterministic quality function says it is
 * better. It does NOT need to become perfect to replace a known-worse draft.
 */
export async function maybePreStreamRegen(
  args: PreStreamRegenArgs,
): Promise<PreStreamRegenResult> {
  const totalStart = Date.now();
  const firstStart = Date.now();
  const firstAttempt = await args.generateOnce();
  const firstMs = Date.now() - firstStart;
  const firstAssessment = assessRegenCandidate(firstAttempt, args);
  const firstScore = firstAssessment.critic;

  if (!shouldGateForIntent(args.intent)) {
    return {
      text: firstAttempt, regenFired: false, firstScore, regenScore: null,
      firstAssessment, regenAssessment: null, selectionReason: "intent-not-gated",
      durationMs: { first: firstMs, regen: null, total: Date.now() - totalStart },
      regenWasBetter: null,
    };
  }

  if (!firstAssessment.needsRepair) {
    return {
      text: firstAttempt, regenFired: false, firstScore, regenScore: null,
      firstAssessment, regenAssessment: null, selectionReason: "first-passed",
      durationMs: { first: firstMs, regen: null, total: Date.now() - totalStart },
      regenWasBetter: null,
    };
  }

  const regenStart = Date.now();
  const regenAttempt = await args.regenOnce({
    firstAttempt,
    firstScore,
    firstAssessment,
    suggestedSystemPrefix: buildTargetedRegenPrefix(firstAssessment),
  });
  const regenMs = Date.now() - regenStart;
  const regenAssessment = assessRegenCandidate(regenAttempt, args);
  const regenScore = regenAssessment.critic;
  const improvement = compareCandidates(regenAssessment, firstAssessment);
  const regenWasBetter = improvement !== null;

  return {
    text: regenWasBetter ? regenAttempt : firstAttempt,
    regenFired: regenWasBetter,
    firstScore,
    regenScore,
    firstAssessment,
    regenAssessment,
    selectionReason: improvement ?? "first-kept",
    durationMs: { first: firstMs, regen: regenMs, total: Date.now() - totalStart },
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
      selectionReason: result.selectionReason,
      firstSpec: result.firstScore.specificity,
      firstOverall: result.firstScore.overall,
      firstSeverity: result.firstAssessment.severity,
      firstNeedsRepair: result.firstAssessment.needsRepair,
      firstReasons: result.firstAssessment.reasons,
      regenSpec: result.regenScore?.specificity ?? null,
      regenOverall: result.regenScore?.overall ?? null,
      regenSeverity: result.regenAssessment?.severity ?? null,
      regenNeedsRepair: result.regenAssessment?.needsRepair ?? null,
      regenReasons: result.regenAssessment?.reasons ?? [],
      firstShouldRegen: result.firstScore.shouldRegen,
      regenShouldRegen: result.regenScore?.shouldRegen ?? null,
      durationMs: result.durationMs.total,
      firstMs: result.durationMs.first,
      regenMs: result.durationMs.regen,
    },
    source: "pre-stream-regen",
  };
}
