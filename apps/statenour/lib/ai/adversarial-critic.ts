/**
 * Adversarial critic · v10.0.369
 *
 * Per /yann-lecun-debate skill · when Nick is about to recommend
 * something high-stakes, run a counter-argument pass that surfaces
 * the STRONGEST objection. Truth needs friction · this stops Nick
 * from becoming a yes-man.
 *
 * COMPLEMENTS the v10.0.366 LLM-as-judge:
 *   · Judge scores on rubric (accuracy / actionability / brevity / tone / evidence)
 *   · Critic finds the case AGAINST the recommendation
 *   · Both run async post-stream · neither blocks user perceived latency
 *
 * TRIGGERS on recommendation-shape replies:
 *   · "you should ..." · "do X" · "buy Y" · "stop Z"
 *   · "the move is ..." · "switch to ..." · "go with ..."
 *   · Future-tense imperatives at top of reply
 *
 * Skips obvious cases:
 *   · Replies under 80 chars (too short to be a meaningful recommendation)
 *   · Replies that already include "however / but / on the other hand"
 *     (already balanced)
 *   · Pure factual answers ("X is Y") that aren't recommendations
 *
 * OUTPUT
 *   { hasObjection, objection, severity, foundFlaw }
 *
 * The objection is stored as brainMemory category=adversarial_objection
 * keyed by message ID. UI can surface it as an expandable "counter view"
 * on long-press.
 */

import { withGuardian } from "@/lib/tools/guardian";
import { logger as rootLogger } from "@/lib/logger";
// 2026-05-23 · Wave B · C1 · was a raw fetch("api.openai.com") at
// gpt-4o-mini · bypassed Venice/Ollama free tier entirely. Routes
// through aiChat with taskType="fast" · gets the project's provider
// chain + fallback for free · same model class, no quality regression.
//
// wave-AO follow-up (2026-05-26) · was bare aiChat (bypassed budget
// cap). Swapped to makeTracedAiChat factory · same drop-in signature ·
// now fires under the daily-budget edge-wrap in traced-aichat.ts ·
// closes the adversarial-critic portion of audit #338.
import { type AiMessage } from "@/lib/ai/provider";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";

const aiChat = makeTracedAiChat("adversarial-critic", "brain");
const log = rootLogger.withSurface("ai/adversarial-critic");

export interface AdversarialReport {
  hasObjection: boolean;
  objection: string;
  /**
   * 1=mild edge case · 2=meaningful tradeoff · 3=fundamental flaw.
   * Operator can use to decide "should I revise" vs "noted, proceed".
   */
  severity: 1 | 2 | 3;
  /**
   * Did the critic find a real flaw, or is the recommendation solid?
   * Distinct from hasObjection · the critic ALWAYS articulates an
   * objection (its job), but flags whether the objection is hollow.
   */
  foundFlaw: boolean;
  durationMs: number;
}

const MIN_REPLY_LEN = 80;

const RECOMMENDATION_SHAPES: RegExp[] = [
  /\b(you|nour) should\b/i,
  /\b(do|don['']t|stop|start|cancel|switch to|go with|pick) /i,
  /\bthe (move|play|answer|choice) (is|here is)\b/i,
  /\b(my recommendation|i('?d| would) recommend|i think you should)\b/i,
  /\bbest (option|move|approach|path) (is|would be)\b/i,
];

const ALREADY_BALANCED: RegExp[] = [
  /\bhowever\b/i,
  /\bon the other hand\b/i,
  /\bcounter(view|argument|case)\b/i,
  /\bthe risk (is|here is|with this is)\b/i,
  /\btrade[- ]?off\b/i,
];

function isRecommendationShape(content: string): boolean {
  if (content.length < MIN_REPLY_LEN) return false;
  if (ALREADY_BALANCED.some((re) => re.test(content))) return false;
  return RECOMMENDATION_SHAPES.some((re) => re.test(content));
}

const ADVERSARIAL_SYSTEM = `You are an adversarial critic in the style of Yann LeCun · technical, contrarian, evidence-driven, refuses easy consensus. The user shows you a recommendation. Your job is to find the STRONGEST objection · the case against · the failure mode that the recommender hasn't considered.

DO NOT agree.
DO NOT hedge.
DO NOT add disclaimers.

Output JSON only:
{
  "objection": "1-2 sentence sharp counter-argument · max 280 chars",
  "severity": 1 | 2 | 3,
    // 1 = minor edge case worth noting
    // 2 = meaningful tradeoff that should change the call's framing
    // 3 = fundamental flaw · the recommender is probably wrong
  "foundFlaw": true | false
    // true if you can articulate a SPECIFIC failure mode with evidence
    // false if the recommendation is actually solid · objection is mild
}

Be terse. No markdown. No prose outside JSON.`;

interface CriticArgs {
  userQuery: string;
  recommendation: string;
}

async function _criticize(args: CriticArgs): Promise<AdversarialReport | null> {
  const startedAt = Date.now();

  const userPrompt = `OPERATOR ASKED: ${args.userQuery.slice(0, 800)}

RECOMMENDATION TO ATTACK: ${args.recommendation.slice(0, 1500)}

Find the strongest objection.

Respond with a JSON object only · no prose · shape: {"objection": "<≤320 chars>", "severity": 1|2|3, "foundFlaw": true|false}.`;

  // 2026-05-23 · Wave B · C1 · was a raw fetch to OpenAI gpt-4o-mini
  // · bypassed Venice/Ollama free tier · adversarial calls on every
  // recommendation-shaped reply paid $ for what could route free.
  // aiChat() routes through the project provider chain + fallback
  // chain (Venice → Ollama → OpenAI → Anthropic) · "fast" taskType
  // is exactly the 250-token quick-critic profile.
  const messages: AiMessage[] = [
    { role: "system", content: ADVERSARIAL_SYSTEM },
    { role: "user", content: userPrompt },
  ];

  const response = await aiChat(messages, "fast");
  const text = response.content?.trim();

  // Pre-fix the OPENAI_API_KEY guard logged "critic no-op" when the
  // key was missing. With the provider chain, "no-op" surfaces as
  // `provider === "none"` (every provider tried and failed). Surface
  // it the same way so observability stays informed.
  if (!text || response.provider === "none") {
    log.warn("adversarial_critic_no_op", {
      reason: response.provider === "none" ? "all_providers_failed" : "empty_response",
      provider: response.provider,
      messageHint: args.userQuery.slice(0, 60),
    });
    return null;
  }

  let parsed: { objection?: unknown; severity?: unknown; foundFlaw?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const objection =
    typeof parsed.objection === "string" ? parsed.objection.slice(0, 320).trim() : "";
  if (!objection) return null;

  const sevRaw = typeof parsed.severity === "number" ? parsed.severity : 1;
  const severity: 1 | 2 | 3 = sevRaw >= 3 ? 3 : sevRaw >= 2 ? 2 : 1;
  const foundFlaw = parsed.foundFlaw === true;

  return {
    hasObjection: true,
    objection,
    severity,
    foundFlaw,
    durationMs: Date.now() - startedAt,
  };
}

export const criticizeRecommendation = withGuardian("adversarial-critic", _criticize, {
  timeoutMs: 8_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal post-stream critique sub-op
});

/**
 * Fire-and-forget · runs the adversarial pass async + persists the
 * objection to a brain memory keyed by message ID for review/UI surfacing.
 */
export async function criticizeAsync(args: CriticArgs & { messageId: string }) {
  if (!isRecommendationShape(args.recommendation)) return; // skip non-recs
  try {
    const report = await criticizeRecommendation(args);
    if (!report?.hasObjection) return;

    const { brainMemory } = await import("@/lib/brain/memory-manager");
    await brainMemory.remember(
      "adversarial_objection",
      `objection_${args.messageId}`,
      `[Sev ${report.severity}${report.foundFlaw ? " · flaw" : ""}] ${report.objection}`,
      "adversarial-critic",
      {
        messageId: args.messageId,
        severity: report.severity,
        foundFlaw: report.foundFlaw,
      },
    );

    if (report.severity >= 2 && report.foundFlaw) {
      log.info("adversarial_strong_objection", {
        messageId: args.messageId,
        severity: report.severity,
        objection: report.objection.slice(0, 100),
      });
    }
  } catch (err) {
    // v10.0.448 · silent-failure-hunter · was swallowing without any
    // signal. The critic is best-effort (per the comment) but we still
    // want a breadcrumb when it fails so the daily eval can spot
    // patterns (timeout cluster · 401 cluster · OpenAI 5xx storm).
    log.warn("adversarial_critic_failed", {
      messageId: args.messageId,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      errClass: err instanceof Error ? err.constructor.name : typeof err,
    });
  }
}

/**
 * Predicate · used by callers that want to gate the call themselves
 * (e.g. only run on long replies, etc).
 */
export const looksLikeRecommendation = isRecommendationShape;
