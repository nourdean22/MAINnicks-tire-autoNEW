/**
 * lib/brain/improve-agent.ts · v10.0.405
 *
 * Closes the eval feedback loop · turns low-scoring chat replies
 * into concrete improvement hypotheses the operator can act on.
 *
 * Background · v10.0.366 added LLM-as-judge eval (judge-eval.ts)
 * that scores every reply on 5 axes (accuracy, actionability,
 * brevity, tone, evidence) and persists the result as a
 * `reply_judgment` brain memory. Until now, those scores just sat
 * there. This module reads them and produces actionable signal.
 *
 * Pipeline:
 *   1. Pull last N days of reply_judgment memories
 *   2. For each axis, find the worst-scoring messages
 *   3. Cluster by axis-failure pattern (e.g. "tone < 5 in 12/40
 *      replies → consistently sycophantic")
 *   4. Emit `improvement_hypothesis` brain memories that propose
 *      a concrete rule-block tweak the operator can review
 *
 * Output is OPERATOR-FACING · no auto-edit of the prompt. The
 * hypotheses surface in /brain/wisdom · the operator decides
 * whether to wire the rule change.
 *
 * Run: GET /api/brain/improve-agent (manual) or via cron.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

export interface JudgmentRow {
  messageId: string;
  composite: number;
  rubric: {
    accuracy: number;
    actionability: number;
    brevity: number;
    tone: number;
    evidence: number;
  };
  reasoning: string;
  judgedAt: Date;
}

export interface ImprovementHypothesis {
  axis: keyof JudgmentRow["rubric"];
  failingCount: number;
  totalCount: number;
  failureRate: number; // 0..1
  avgScoreOnFailing: number;
  exampleReasonings: string[];
  proposedRuleChange: string;
}

const DEFAULT_DAYS = 7;
const FAILURE_THRESHOLD = 5; // axis score < 5 = failing

/**
 * Static fallback proposed-rule changes · used when LLM synthesis is
 * not available or fails. Replaced per-axis at runtime by
 * `synthesizeProposedRuleChange` which reads the actual failing
 * reasonings and proposes a concrete operator-rules.ts edit.
 */
const STATIC_PROPOSED_RULES: Record<keyof JudgmentRow["rubric"], string> = {
  accuracy:
    "Tighten the COLD-MEMORY RULE · require searchColdMemory before any claim that touches data older than 24h. Add a NEVER-FABRICATE check on numbers (revenue, weight, customer counts) — flag specific values vs ranges.",
  actionability:
    "Strengthen the 'lead with the answer + next step' rule. Add a checklist: every reply needs (a) the answer, (b) one concrete next step OR principle, (c) a question if blocked. Replies that are only diagnosis fail this axis.",
  brevity:
    "BREVITY DEFAULT may need a hard cap on default replies (currently ≤80 words · soft). Consider 60-word soft + 100 hard for conversational, with explicit detail-ask carve-out.",
  tone:
    "NO_SYCOPHANCY may not be enough — judge is catching softer corporate tones (\"I appreciate that\", \"Let me know if\"). Tighten to ban the soft-warmth phrases too.",
  evidence:
    "Add a rule: when a wisdom is in recall context AND the answer touches its principle, INLINE_CITATIONS is mandatory · not optional. The judge is catching answers that paraphrase wisdoms without crediting them.",
};

/**
 * v10.0.415 · LLM-synthesized rule change.
 *
 * Reads the actual judge reasonings for an axis and proposes a
 * specific edit to lib/ai/prompt/policy/operator-rules.ts. Falls
 * back to the static text if synthesis fails (provider down, no
 * useful pattern, etc).
 *
 * Cached at the call-site (improve-agent runs daily via cron) ·
 * no need for a TTL cache here.
 */
async function synthesizeProposedRuleChange(
  axis: keyof JudgmentRow["rubric"],
  failingReasonings: string[],
): Promise<string> {
  if (failingReasonings.length === 0) return STATIC_PROPOSED_RULES[axis];

  try {
    // wave-AO follow-up · audit #438 · was bare aiChat. Migrated to
    // tracedAiChat factory so the nightly improve-agent run (up to 5
    // axes · per-axis call) inherits the daily-budget gate. Closes
    // audit #362.
    const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
    const aiChat = makeTracedAiChat("improve-agent", "brain");
    const sys = `You are an LLM-rule-edit synthesizer for an operator-grade personal-OS AI named Nick. You read judge reasonings explaining WHY Nick's replies failed the ${axis} axis, then output ONE concrete edit to the rule that governs that axis.

The current rule files live in lib/ai/prompt/policy/operator-rules.ts. Axis → rule mapping:
  accuracy → COLD-MEMORY rule + TRUTH_RULE_NEVER_FABRICATE
  actionability → "Lead with the answer + next step" (in the response-style block)
  brevity → BREVITY_DEFAULT
  tone → NO_SYCOPHANCY
  evidence → INLINE_CITATIONS / CONFIDENCE_CUES

Output a single specific edit (40-80 words). Be concrete · name the phrase to add, the threshold to tighten, the example to ban. NEVER write generic advice ("be more careful") · always cite the actual pattern in the reasonings.

Output plain text only. No markdown, no preamble.`;

    const usr = `Judge reasonings (failing replies on the ${axis} axis):

${failingReasonings.map((r, i) => `${i + 1}. ${r}`).join("\n")}

Propose one specific rule edit.`;

    const result = await aiChat(
      [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      "classify",
    );
    const text = (result.content ?? "").trim();
    if (!text || text.length < 20) return STATIC_PROPOSED_RULES[axis];
    return text.slice(0, 400);
  } catch (err) {
    logError("brain.improve-agent", err, { fn: "synthesizeProposedRuleChange" });
    return STATIC_PROPOSED_RULES[axis];
  }
}

/**
 * Pull the last N days of reply judgments from brain memory.
 *
 * Each is stored as category=reply_judgment with metadata.rubric
 * holding the 5-axis scores.
 */
export async function getRecentJudgments(
  daysBack = DEFAULT_DAYS,
): Promise<JudgmentRow[]> {
  const sinceDate = new Date(Date.now() - daysBack * 86_400_000);
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.REPLY_JUDGMENT,
      deletedAt: null,
      lastSeen: { gte: sinceDate },
    },
    orderBy: { lastSeen: "desc" },
    select: {
      key: true,
      content: true,
      metadata: true,
      lastSeen: true,
    },
    take: 500,
  });

  const out: JudgmentRow[] = [];
  for (const r of rows) {
    const meta = r.metadata as
      | {
          messageId?: string;
          composite?: number;
          rubric?: JudgmentRow["rubric"];
        }
      | null;
    if (!meta?.rubric || typeof meta.composite !== "number") continue;
    out.push({
      messageId: meta.messageId ?? r.key.replace(/^judge_/, ""),
      composite: meta.composite,
      rubric: meta.rubric,
      reasoning: r.content.replace(/^Score \d+(\.\d+)?\/10 · /, ""),
      judgedAt: r.lastSeen,
    });
  }
  return out;
}

/**
 * Compute per-axis failure stats and emit improvement hypotheses.
 *
 * "Failing" = axis score < FAILURE_THRESHOLD. We surface an axis
 * only if its failure rate is ≥ 15% over the window AND ≥ 5
 * absolute messages — otherwise it's noise.
 */
export function analyzeJudgments(
  judgments: JudgmentRow[],
): ImprovementHypothesis[] {
  if (judgments.length < 5) return []; // not enough signal

  const axes: (keyof JudgmentRow["rubric"])[] = [
    "accuracy",
    "actionability",
    "brevity",
    "tone",
    "evidence",
  ];

  const out: ImprovementHypothesis[] = [];
  for (const axis of axes) {
    const failing = judgments.filter((j) => j.rubric[axis] < FAILURE_THRESHOLD);
    const failureRate = failing.length / judgments.length;
    if (failing.length < 5 || failureRate < 0.15) continue;

    const avgFailing =
      failing.reduce((sum, f) => sum + f.rubric[axis], 0) / failing.length;
    const examples = failing
      .sort((a, b) => a.rubric[axis] - b.rubric[axis])
      .slice(0, 3)
      .map((f) => f.reasoning.slice(0, 120));

    out.push({
      axis,
      failingCount: failing.length,
      totalCount: judgments.length,
      failureRate: Math.round(failureRate * 100) / 100,
      avgScoreOnFailing: Math.round(avgFailing * 10) / 10,
      exampleReasonings: examples,
      proposedRuleChange: STATIC_PROPOSED_RULES[axis],
    });
  }
  // Sort by failure rate descending · highest-impact axis first.
  out.sort((a, b) => b.failureRate - a.failureRate);
  return out;
}

/**
 * v10.0.415 · async wrapper that swaps the static proposedRuleChange
 * for an LLM-synthesized one based on the actual failing reasonings.
 *
 * Sync `analyzeJudgments` returns the static version (used by tests
 * + low-latency UI paths). The async version is called by the
 * cron-driven persist path so the synthesized text shows up in the
 * brain memory + dashboard surface.
 *
 * Falls back gracefully · if any axis synthesis fails the static
 * text remains.
 */
export async function analyzeJudgmentsWithSynthesis(
  judgments: JudgmentRow[],
): Promise<ImprovementHypothesis[]> {
  const base = analyzeJudgments(judgments);
  if (base.length === 0) return base;
  return Promise.all(
    base.map(async (h) => ({
      ...h,
      proposedRuleChange: await synthesizeProposedRuleChange(
        h.axis,
        h.exampleReasonings,
      ),
    })),
  );
}

/**
 * Persist the analysis as a `improvement_hypothesis` brain memory
 * the operator can review on /brain/wisdom. Idempotent · keys are
 * stable per axis + day, so re-running the cron rewrites today's
 * hypotheses but doesn't pollute the corpus.
 */
export async function persistHypotheses(
  hypotheses: ImprovementHypothesis[],
): Promise<number> {
  if (hypotheses.length === 0) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const { brainMemory } = await import("@/lib/brain/memory-manager");
  let written = 0;
  let persistFailCount = 0;
  for (const h of hypotheses) {
    const key = `improvement_${h.axis}_${today}`;
    const summary = `Axis ${h.axis} failing ${(h.failureRate * 100).toFixed(0)}% (${h.failingCount}/${h.totalCount}) · avg failing score ${h.avgScoreOnFailing}/10 · ${h.proposedRuleChange}`;
    try {
      await brainMemory.remember("improvement_hypothesis", key, summary, "improve-agent", {
        axis: h.axis,
        failingCount: h.failingCount,
        totalCount: h.totalCount,
        failureRate: h.failureRate,
        avgScoreOnFailing: h.avgScoreOnFailing,
        exampleReasonings: h.exampleReasonings,
        proposedRuleChange: h.proposedRuleChange,
        windowDate: today,
      });
      written++;
    } catch {
      // skip · best-effort
      persistFailCount++;
    }
  }
  if (persistFailCount > 0) {
    logError("brain.improve-agent", new Error(`${persistFailCount} persist failures`), { fn: "persistHypotheses" });
  }
  return written;
}

/**
 * One-shot · run the full pipeline. Returns the hypotheses + count
 * persisted. v10.0.415 · uses the LLM-synthesis path so persisted
 * memories + dashboard responses see concrete proposed edits derived
 * from the actual judge reasonings, not the static fallbacks.
 */
export async function runImproveAgent(daysBack = DEFAULT_DAYS): Promise<{
  judgmentCount: number;
  hypotheses: ImprovementHypothesis[];
  persisted: number;
}> {
  const judgments = await getRecentJudgments(daysBack);
  const hypotheses = await analyzeJudgmentsWithSynthesis(judgments);
  const persisted = await persistHypotheses(hypotheses);
  return {
    judgmentCount: judgments.length,
    hypotheses,
    persisted,
  };
}
