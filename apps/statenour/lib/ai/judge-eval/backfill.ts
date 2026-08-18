/**
 * lib/ai/judge-eval/backfill.ts · persona-axis backfill planning (2026-08-18).
 *
 * The persona axes (obedience / nonSycophancy / calibration, #1649) only
 * exist on judgments written after they shipped. Waiting for organic
 * traffic starves the census and the harvest flywheel for weeks; the
 * operator ordered a backfill over recent chats instead.
 *
 * This module is the PURE planning layer (typechecked, tested — unlike
 * scripts/, which tsconfig excludes). The DB/LLM I/O lives in
 * scripts/backfill-persona-judgments.ts.
 *
 * THE HISTORY-PRESERVATION RULE (why two persist shapes exist):
 * persona-lane-census attributes every row to a lane via `judgedBy`.
 * Overwriting an existing judgment would re-attribute a historical row
 * to whatever lane serves TODAY's backfill — silently rewriting the
 * per-lane history BDN-301 exists to read. And double-writing all 8
 * axes to a second row would double-count the core five in every mean.
 * So:
 *
 *   · message NEVER judged  -> full 8-axis row under the normal
 *     `judge_<messageId>` key (indistinguishable from a live judgment,
 *     minus the backfill provenance flag).
 *   · message ALREADY judged -> companion `judge_bf_<messageId>` row
 *     carrying ONLY the three persona axes. The original row keeps its
 *     lane, scores, and composite untouched; core-axis means see
 *     nothing new; persona means gain a row.
 */

import type { JudgeReport, JudgeRubric } from "@/lib/ai/judge-eval";

export const BACKFILL_KEY_PREFIX = "judge_bf_";

export const PERSONA_ONLY_AXES = [
  "obedience",
  "nonSycophancy",
  "calibration",
] as const;

export interface BackfillRowPlan {
  key: string;
  /** Rubric subset to persist — see the history-preservation rule. */
  rubric: Partial<JudgeRubric>;
  /** Composite is persisted ONLY on full rows — a persona-only row has
   *  no core axes, and a composite computed from nothing is a lie. */
  composite: number | null;
  content: string;
  metadata: Record<string, unknown>;
}

export function planBackfillRow(
  messageId: string,
  alreadyJudged: boolean,
  report: JudgeReport,
  backfilledAt: string,
): BackfillRowPlan {
  const provenance = {
    backfill: true,
    backfilledAt,
    messageId,
    judgedBy: report.judgedBy,
  };

  if (!alreadyJudged) {
    return {
      key: `judge_${messageId}`,
      rubric: report.rubric,
      composite: report.composite,
      content: `Score ${report.composite}/10 · ${report.reasoning}`,
      metadata: {
        ...provenance,
        rubric: report.rubric,
        composite: report.composite,
        flagForReview: report.flagForReview,
      },
    };
  }

  const personaOnly: Partial<JudgeRubric> = {};
  for (const axis of PERSONA_ONLY_AXES) {
    personaOnly[axis] = report.rubric[axis];
  }
  return {
    key: `${BACKFILL_KEY_PREFIX}${messageId}`,
    rubric: personaOnly,
    composite: null,
    content: `Persona backfill · obedience ${report.rubric.obedience} · nonSycophancy ${report.rubric.nonSycophancy} · calibration ${report.rubric.calibration} · ${report.reasoning}`,
    metadata: {
      ...provenance,
      rubric: personaOnly,
      personaOnly: true,
      /** The untouched original this row complements. */
      complementsKey: `judge_${messageId}`,
    },
  };
}
