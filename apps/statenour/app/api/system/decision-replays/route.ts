/**
 * GET /api/system/decision-replays · v10.0.528 · Arc B · Feature 3
 *
 * Owner-gated read for the future Ultron tile. Returns:
 *   · `due` — replay prompts queued by the daily cron, not yet consumed
 *   · `recent` — last 10 reviewed DecisionReplay rows (operator can
 *     audit what they actually answered + the lessons that landed in
 *     BrainMemory)
 *
 * Read-only · no mutation, no AI cost. The cron is the ONLY producer
 * of `decision_replay_due` BrainMemory rows; this surface is purely
 * a reader.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

// v10.0.528 type aliases · hoisted so `typeof dueRows` doesn't collapse to
// `never[]` when the Promise.all .catch fallback narrows the inferred type.
type DueRow = {
  id: string;
  key: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};
type RecentRow = {
  id: string;
  decisionId: number | null;
  title: string;
  choiceMade: string;
  outcome: string | null;
  outcomeScore: number | null;
  lesson: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

export const GET = apiHandler(
  async () => {
    const [dueRowsRaw, recentRaw] = await Promise.all([
      prisma.brainMemory
        .findMany({
          where: { category: "decision_replay_due", deletedAt: null },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: {
            id: true,
            key: true,
            content: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        })
        .catch((): DueRow[] => []),
      prisma.decisionReplay
        .findMany({
          where: { reviewed: true },
          orderBy: { reviewedAt: "desc" },
          take: 10,
          select: {
            id: true,
            decisionId: true,
            title: true,
            choiceMade: true,
            outcome: true,
            outcomeScore: true,
            lesson: true,
            reviewedAt: true,
            createdAt: true,
          },
        })
        .catch((): RecentRow[] => []),
    ]);

    const dueRows = dueRowsRaw as DueRow[];
    const recent = recentRaw as RecentRow[];

    // Split due → unconsumed vs already shown today.
    const unconsumed: DueRow[] = [];
    const consumed: DueRow[] = [];
    for (const row of dueRows) {
      const consumedAt = (row.metadata as Record<string, unknown> | null)?.consumedAt;
      if (consumedAt) consumed.push(row);
      else unconsumed.push(row);
    }

    return {
      due: {
        unconsumedCount: unconsumed.length,
        unconsumed: unconsumed.map((r) => ({
          id: r.id,
          key: r.key,
          text: r.content,
          metadata: r.metadata,
          queuedAt: r.createdAt,
        })),
        consumedTodayCount: consumed.length,
      },
      recent: recent.map((r) => ({
        id: r.id,
        decisionId: r.decisionId,
        title: r.title,
        choiceMade: r.choiceMade,
        outcome: r.outcome,
        outcomeScore: r.outcomeScore,
        lesson: r.lesson,
        reviewedAt: r.reviewedAt,
        ageDays:
          r.reviewedAt && r.createdAt
            ? Math.floor(
                (r.reviewedAt.getTime() - r.createdAt.getTime()) /
                  (24 * 60 * 60 * 1000),
              )
            : null,
      })),
    };
  },
  { auth: "owner" },
);
