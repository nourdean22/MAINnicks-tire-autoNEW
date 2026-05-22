/**
 * lib/services/decisions.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice).
 *
 * The decision-log list read · lifted verbatim from the GET handler of
 * app/api/decisions/route.ts so the legacy REST endpoint AND the new
 * `operator.decisions` tRPC procedure call the SAME function · drift
 * between consumers structurally impossible.
 *
 * `MasteryDecision` carries no Json columns (every field is String /
 * DateTime), but every row is still projected to the explicit, flat
 * `DecisionRow` shape — `Date` fields stringified to ISO — so the
 * public AppRouter type stays shallow and stable. That is the TS2589
 * firewall discipline applied uniformly.
 */

import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";

/** A flat, shallow projection of a MasteryDecision row. */
export interface DecisionRow {
  id: number;
  date: string;
  title: string;
  domain: string | null;
  stakes: string | null;
  context: string | null;
  optionsConsidered: string | null;
  chosen: string | null;
  reasoning: string | null;
  predictedOutcome: string | null;
  emotionalState: string | null;
  reviewDate: string | null;
  actualOutcome: string | null;
  grade: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The decision-log feed · recent decisions + the pending-review subset. */
export interface DecisionsView {
  decisions: DecisionRow[];
  pending_review: DecisionRow[];
}

/**
 * List the 50 most-recent decisions + the pending-review subset
 * (review date is due AND no actualOutcome yet). The REST route and the
 * `operator.decisions` procedure both call this.
 */
export async function listDecisions(): Promise<DecisionsView> {
  const [decisions, pendingReview] = await Promise.all([
    prisma.masteryDecision.findMany({
      orderBy: { date: "desc" },
      take: 50,
    }),
    prisma.masteryDecision.findMany({
      where: {
        deletedAt: null,
        reviewDate: { lte: today() },
        actualOutcome: null,
      },
    }),
  ]);

  return {
    decisions: decisions.map(toRow),
    pending_review: pendingReview.map(toRow),
  };
}

/** Project a Prisma MasteryDecision row to the flat {@link DecisionRow}. */
function toRow(d: {
  id: number;
  date: string;
  title: string;
  domain: string | null;
  stakes: string | null;
  context: string | null;
  optionsConsidered: string | null;
  chosen: string | null;
  reasoning: string | null;
  predictedOutcome: string | null;
  emotionalState: string | null;
  reviewDate: string | null;
  actualOutcome: string | null;
  grade: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DecisionRow {
  return {
    id: d.id,
    date: d.date,
    title: d.title,
    domain: d.domain,
    stakes: d.stakes,
    context: d.context,
    optionsConsidered: d.optionsConsidered,
    chosen: d.chosen,
    reasoning: d.reasoning,
    predictedOutcome: d.predictedOutcome,
    emotionalState: d.emotionalState,
    reviewDate: d.reviewDate,
    actualOutcome: d.actualOutcome,
    grade: d.grade,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
