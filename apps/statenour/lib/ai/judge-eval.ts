/**
 * v10.0.366 · LLM-as-judge real-time eval · per /advanced-evaluation skill
 *
 * Complements the existing nightly heuristic self-critique (v10.0.92).
 * That system grades past messages using deterministic patterns.
 * THIS system grades a reply IMMEDIATELY after generation using a fast
 * LLM as judge against a 5-axis rubric. Different layer · different
 * latency · different precision.
 *
 * 5-AXIS RUBRIC (each scored 0-10)
 *   · accuracy   · do the claims hold up against context provided?
 *   · actionability · is there a clear next step or just words?
 *   · brevity    · concise without losing substance?
 *   · tone       · operator-grade · direct · not sycophantic?
 *   · evidence   · specific numbers, names, sources where relevant?
 *
 * COMPOSITE = mean(5 axes) · low scores get logged to brain so the
 * operator can review on /brain/wisdom (future · pair with reply_to_improve).
 *
 * BIAS MITIGATION
 *   · Position bias · mitigated by single-reply scoring (no pairwise)
 *   · Length bias · brevity is an explicit axis · doesn't reward long
 *   · Self-preference · we use a DIFFERENT model class than generation
 *     when possible (Venice generates, OpenAI mini judges, or vice versa)
 *
 * PERFORMANCE
 *   · Fires async after stream completes · zero impact on user latency
 *   · Uses gpt-4o-mini or fast Venice · ~$0.0001 per eval
 *   · Guarded with v10.0.357 guardian · auto-retries transient failures
 *
 * Returns null if eval fails or skipped · caller should treat as no-op.
 */

import { withGuardian } from "@/lib/tools/guardian";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/judge-eval");

export interface JudgeRubric {
  accuracy: number;       // 0-10
  actionability: number;  // 0-10
  brevity: number;        // 0-10
  tone: number;           // 0-10
  evidence: number;       // 0-10
}

export interface JudgeReport {
  composite: number;      // mean of 5 axes
  rubric: JudgeRubric;
  reasoning: string;      // one-line judge note
  flagForReview: boolean; // composite < 6
  judgedBy: string;       // model used
  durationMs: number;
}

const JUDGE_THRESHOLD_FLAG = 6;
const REPLY_PREVIEW_CAP = 3000;
const QUERY_PREVIEW_CAP = 1000;

const JUDGE_SYSTEM = `You are an evaluation judge for an operator-grade personal-OS AI named Nick. Score every reply on 5 axes (0-10 each):

ACCURACY — claims hold up; no fabrication; aligned with provided context
ACTIONABILITY — clear next step OR principle the operator can use; not vague
BREVITY — concise without losing substance; no filler; no preamble
TONE — direct, operator-grade, not sycophantic, not corporate; matches Nick's persona (efficient, slightly dry)
EVIDENCE — specific numbers / names / sources where relevant; says "I don't know" when uncertain

Output JSON only:
{
  "accuracy": 0-10,
  "actionability": 0-10,
  "brevity": 0-10,
  "tone": 0-10,
  "evidence": 0-10,
  "reasoning": "one-line note · max 80 chars"
}

NO MARKDOWN. NO PROSE OUTSIDE JSON. Be terse.`;

interface JudgeArgs {
  userQuery: string;
  assistantReply: string;
  brainContextHint?: string; // optional · helps accuracy axis
}

async function _judgeReply(args: JudgeArgs): Promise<JudgeReport | null> {
  // v10.0.412 · was hardcoded to OPENAI_API_KEY direct fetch · which
  // silently returned null in production because operator's stack
  // is Venice + Ollama Cloud Pro co-1st, OpenAI is fallback only.
  // 187 chat replies in last 7d had ZERO judgments persisted ·
  // smoke (scripts/smoke-brain-feedback-layers.ts) caught it.
  // Now routes through aiChat() which respects the provider chain.
  const startedAt = Date.now();
  const userTurn = args.userQuery.slice(0, QUERY_PREVIEW_CAP);
  const reply = args.assistantReply.slice(0, REPLY_PREVIEW_CAP);
  const ctx = args.brainContextHint?.slice(0, 800);

  const userPrompt = `OPERATOR ASKED: ${userTurn}

NICK REPLIED: ${reply}${ctx ? `\n\nBRAIN CONTEXT NICK HAD: ${ctx}` : ""}

Score the reply. Output JSON only.`;

  // wave-AO follow-up · was bare aiChat (bypassed budget cap). Routed
  // through tracedAiChat so this fires under the daily-budget edge-
  // wrap installed in traced-aichat.ts. Closes the judge-eval portion
  // of audit #338 (uncapped chat-turn cost amplifier).
  const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
  const tracedChat = makeTracedAiChat("judge-eval", "brain");
  let text = "";
  let judgedBy = "unknown";
  try {
    const result = await tracedChat(
      [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      "classify",
    );
    text = (result.content ?? "").trim();
    judgedBy = `${result.provider ?? "?"}:${result.model ?? "?"}`;
  } catch (err) {
    log.warn("judge_provider_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }

  if (!text) {
    log.warn("judge_empty_response");
    return null;
  }

  // Models occasionally wrap JSON in ```json``` fences or include
  // a preamble · strip to the first { ... } block.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log.warn("judge_no_json_block", { preview: text.slice(0, 200) });
    return null;
  }
  let parsed: Partial<JudgeRubric & { reasoning: string }>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    log.warn("judge_parse_failed", { preview: jsonMatch[0].slice(0, 200) });
    return null;
  }

  const rubric: JudgeRubric = {
    accuracy: clamp(parsed.accuracy),
    actionability: clamp(parsed.actionability),
    brevity: clamp(parsed.brevity),
    tone: clamp(parsed.tone),
    evidence: clamp(parsed.evidence),
  };
  const composite =
    (rubric.accuracy + rubric.actionability + rubric.brevity + rubric.tone + rubric.evidence) / 5;

  return {
    composite: Math.round(composite * 10) / 10,
    rubric,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 200) : "",
    flagForReview: composite < JUDGE_THRESHOLD_FLAG,
    judgedBy,
    durationMs: Date.now() - startedAt,
  };
}

function clamp(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

/**
 * Guardian-wrapped exterior · auto-retries transient failures (timeout,
 * rate-limit, network) up to 1 time. Returns null on failure · caller
 * should treat eval as best-effort and never block on it.
 */
export const judgeReply = withGuardian("judge-eval", _judgeReply, {
  timeoutMs: 8_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal post-stream telemetry sub-op (was a stale registry entry)
});

/**
 * Fire-and-forget · runs the eval async + persists score to a brain
 * memory keyed by message ID for later review. Caller doesn't await.
 */
export async function judgeReplyAsync(args: JudgeArgs & { messageId: string }) {
  try {
    const report = await judgeReply(args);
    if (!report) return;

    // Persist via brainMemory.remember · category=reply_judgment so
    // it doesn't pollute wisdom recall but stays queryable.
    const { brainMemory } = await import("@/lib/brain/memory-manager");
    await brainMemory.remember(
      "reply_judgment",
      `judge_${args.messageId}`,
      `Score ${report.composite}/10 · ${report.reasoning}`,
      "judge-eval",
      {
        messageId: args.messageId,
        rubric: report.rubric,
        composite: report.composite,
        flagForReview: report.flagForReview,
        judgedBy: report.judgedBy,
      },
    );

    if (report.flagForReview) {
      log.warn("judge_low_score", {
        messageId: args.messageId,
        composite: report.composite,
        rubric: report.rubric,
        reasoning: report.reasoning,
      });
    }
  } catch {
    // best-effort · no-op on failure
  }
}
