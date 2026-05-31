/**
 * lib/services/decisions.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice) ·
 * extended scattered-components slice (2026-05-22 · the `/decide`
 * branch of OmniCapture's decision-log write).
 *
 * The decision-log list read · lifted verbatim from the GET handler of
 * app/api/decisions/route.ts so the legacy REST endpoint AND the new
 * `operator.decisions` tRPC procedure call the SAME function · drift
 * between consumers structurally impossible. The scattered-components
 * slice adds `createDecision` — the POST-create branch of the same
 * route — so the `operator.logDecision` procedure and the REST POST
 * also call ONE function.
 *
 * `MasteryDecision` carries no Json columns (every field is String /
 * DateTime), but every row is still projected to the explicit, flat
 * `DecisionRow` shape — `Date` fields stringified to ISO — so the
 * public AppRouter type stays shallow and stable. That is the TS2589
 * firewall discipline applied uniformly.
 */

import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import { logCreate } from "@/lib/db/entity-audit";
import { creditFromSignal } from "@/lib/mastery/credit-signal";

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

/** Payload for {@link createDecision} · mirrors the legacy POST body. */
export interface CreateDecisionInput {
  title: string;
  domain?: string | null;
  stakes?: string | null;
  context?: string | null;
  optionsConsidered?: string[];
  chosen?: string | null;
  reasoning?: string | null;
  predictedOutcome?: string | null;
  emotionalState?: string | null;
  reviewDate?: string | null;
}

/**
 * Persist one MasteryDecision row. The REST route's POST-create branch
 * and the `operator.logDecision` procedure both call this · `date` is
 * stamped server-side, `optionsConsidered` is JSON-stringified. Fires
 * the entity-audit create fire-and-forget. Returns the new row id.
 */
export async function createDecision(
  input: CreateDecisionInput,
): Promise<{ ok: true; id: number }> {
  const created = await prisma.masteryDecision.create({
    data: {
      date: today(),
      title: input.title,
      domain: input.domain || null,
      stakes: input.stakes || null,
      context: input.context || null,
      optionsConsidered: JSON.stringify(input.optionsConsidered ?? []),
      chosen: input.chosen || null,
      reasoning: input.reasoning || null,
      predictedOutcome: input.predictedOutcome || null,
      emotionalState: input.emotionalState || null,
      reviewDate: input.reviewDate || null,
    },
  });

  void logCreate(
    "masteryDecision",
    String(created.id),
    created as unknown as Record<string, unknown>,
    { source: "api:decisions.POST.create" },
  );

  // Ambition/Mastery · a logged decision under stakes is a real rep — credit
  // the stat it exercised, write-time. The backfill cron also sweeps decisions
  // batch; the shared `decision:<id>` sourceKey dedupes. Never throws.
  void creditFromSignal("decision", {
    text: [input.title, input.reasoning].filter(Boolean).join("\n"),
    sourceKey: `decision:${created.id}`,
  });

  return { ok: true as const, id: created.id };
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
