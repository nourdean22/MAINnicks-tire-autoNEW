/**
 * tests/eval/judge.ts · Scenario-aware judge adapter (task #14).
 *
 * Thin wrapper around `lib/ai/judge-eval.ts` · the existing LLM-as-judge
 * module that powers real-time per-reply scoring in production chat.
 * That module has a fixed 5-axis rubric (accuracy / actionability /
 * brevity / tone / evidence). For the regression suite we want
 * SCENARIO-SPECIFIC criteria (each scenario defines its own 1-6
 * criteria with weights), so we wrap `aiChat` directly with a
 * scenario-aware prompt.
 *
 * Why not extend judge-eval.ts itself · keeping that module's API
 * stable. Production code paths call `judgeReply()` with a fixed
 * contract; mutating its signature for a single test suite would
 * be a YAGNI violation. This adapter borrows the prompt structure
 * + provider routing pattern verbatim · the cost-conscious provider
 * chain (Venice → Ollama → OpenAI → Anthropic per the policy matrix)
 * applies here too because `aiChat` honors it.
 *
 * Bias mitigation echoes lib/ai/judge-eval.ts:
 *   · single-reply scoring · no pairwise position bias
 *   · brevity is one of the scenario criteria · doesn't reward length
 *   · uses the cheap "classify" task profile · NOT the same model
 *     class as Nick's generation
 */

import type {
  JudgeCriterionScore,
  JudgeResult,
  Scenario,
  ScenarioMessage,
} from "./types";

const JUDGE_REPLY_PREVIEW_CAP = 3000;
const JUDGE_RATIONALE_CAP = 200;

const JUDGE_SYSTEM = `You are an evaluation judge for Nick, an operator-grade personal-OS AI. You score Nick's reply against scenario-specific criteria.

For each criterion you receive, output an integer score 0-10 and a one-line rationale (max 80 chars).

Scoring rubric:
  · 0-3 · criterion clearly failed
  · 4-6 · partial · some intent but missing the mark
  · 7-8 · solid · criterion met
  · 9-10 · exceptional · best-case execution

Output JSON only, in this exact shape:
{
  "scores": [
    { "criterionId": "<id>", "score": 0-10, "rationale": "one-line max 80 chars" }
  ]
}

NO MARKDOWN. NO PROSE OUTSIDE JSON. Be terse.`;

function formatConversation(messages: ScenarioMessage[]): string {
  return messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

function formatCriteria(scenario: Scenario): string {
  return scenario.judgeCriteria
    .map((c, i) => `${i + 1}. [${c.id}] ${c.description} (weight ${c.weight ?? 1.0})`)
    .join("\n");
}

function clampScore(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

interface JudgeRawScore {
  criterionId?: unknown;
  score?: unknown;
  rationale?: unknown;
}

/**
 * Judge a Nick response against a scenario's criteria. Returns a
 * fully-populated `JudgeResult`. If the judge fails (provider down,
 * malformed JSON, timeout) the result carries an `error` field and
 * zero scores — the suite runner treats that as a flagged scenario.
 */
export async function judgeResponse(
  scenario: Scenario,
  nickResponse: string,
  startedAt: number,
): Promise<JudgeResult> {
  // Dynamic import · keeps tsconfig's `tests/` exclusion happy and
  // matches how lib/ai/judge-eval.ts loads the provider.
  const { aiChat } = await import("@/lib/ai/provider");

  const reply = nickResponse.slice(0, JUDGE_REPLY_PREVIEW_CAP);
  const conversation = formatConversation(scenario.input.messages);
  const criteriaList = formatCriteria(scenario);
  const contextHint = scenario.contextSetup?.length
    ? `\n\nBACKGROUND CONTEXT:\n${scenario.contextSetup.map((s) => `· ${s}`).join("\n")}`
    : "";

  const userPrompt = `SCENARIO: ${scenario.name}
CATEGORY: ${scenario.category}

CONVERSATION:
${conversation}

NICK REPLIED:
${reply}${contextHint}

CRITERIA TO SCORE:
${criteriaList}

Score every criterion. Output JSON only.`;

  let rawText = "";
  let judgedBy = "unknown";
  let providerError: string | null = null;
  try {
    const result = await aiChat(
      [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      "classify",
    );
    rawText = (result.content ?? "").trim();
    judgedBy = `${result.provider ?? "?"}:${result.model ?? "?"}`;
  } catch (err) {
    providerError = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
  }

  if (providerError || !rawText) {
    return {
      scenarioId: scenario.id,
      responsePreview: reply.slice(0, 2000),
      criterionScores: [],
      composite: 0,
      flagForReview: true,
      judgedBy,
      durationMs: Date.now() - startedAt,
      error: providerError ?? "empty judge response",
    };
  }

  // Strip ```json``` fences / preamble → grab the first {...} block.
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      scenarioId: scenario.id,
      responsePreview: reply.slice(0, 2000),
      criterionScores: [],
      composite: 0,
      flagForReview: true,
      judgedBy,
      durationMs: Date.now() - startedAt,
      error: `judge returned no JSON block (preview: ${rawText.slice(0, 120)})`,
    };
  }
  let parsed: { scores?: JudgeRawScore[] };
  try {
    parsed = JSON.parse(jsonMatch[0]) as { scores?: JudgeRawScore[] };
  } catch (err) {
    return {
      scenarioId: scenario.id,
      responsePreview: reply.slice(0, 2000),
      criterionScores: [],
      composite: 0,
      flagForReview: true,
      judgedBy,
      durationMs: Date.now() - startedAt,
      error: `judge JSON parse failed: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`,
    };
  }

  const rawScores = Array.isArray(parsed.scores) ? parsed.scores : [];

  // Normalize · map every scenario criterion to a score (filling 0 +
  // empty rationale when the judge omitted it). This keeps the shape
  // stable for the report.
  const criterionScores: JudgeCriterionScore[] = scenario.judgeCriteria.map((criterion) => {
    const match = rawScores.find(
      (s) => typeof s.criterionId === "string" && s.criterionId === criterion.id,
    );
    return {
      criterionId: criterion.id,
      score: clampScore(match?.score),
      rationale:
        typeof match?.rationale === "string"
          ? match.rationale.slice(0, JUDGE_RATIONALE_CAP)
          : "(no rationale)",
    };
  });

  // Composite = weighted mean of criterion scores. Weights default to
  // 1.0 (validated upstream by Zod).
  const totalWeight = scenario.judgeCriteria.reduce((sum, c) => sum + (c.weight ?? 1.0), 0);
  const weightedSum = scenario.judgeCriteria.reduce((sum, c, i) => {
    return sum + (c.weight ?? 1.0) * criterionScores[i].score;
  }, 0);
  const composite = totalWeight === 0 ? 0 : weightedSum / totalWeight;
  const rounded = Math.round(composite * 10) / 10;

  return {
    scenarioId: scenario.id,
    responsePreview: reply.slice(0, 2000),
    criterionScores,
    composite: rounded,
    flagForReview: rounded < 6.0,
    judgedBy,
    durationMs: Date.now() - startedAt,
    error: null,
  };
}
