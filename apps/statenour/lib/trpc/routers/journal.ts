/**
 * lib/trpc/routers/journal.ts · Phase TT (2026-05-19 AM).
 *
 * Journal-domain procedures · the 7th domain router (nick · operator ·
 * system · chat · browser · task · journal). Wraps the 4 endpoints
 * the /journal page polls + supplementary metacognition surface.
 *
 * Delegates to:
 *   · buildJournalFeed         → @/lib/services/journal-feed
 *   · getLatestLearningJournalEntry → @/lib/brain/learning-journal
 *
 * Drift between legacy REST and tRPC structurally impossible.
 */

import { z } from "zod";
import { router, operatorProcedure } from "../trpc";
import { buildJournalFeed } from "@/lib/services/journal-feed";
import { getLatestLearningJournalEntry } from "@/lib/brain/learning-journal";

export const journalRouter = router({
  /**
   * Phase TT · owner-only · unified journal feed merging the 4
   * thought-capture tables (BrainDump · Reflection · SituationLog ·
   * DecisionReplay) into a single chronologically-sorted stream
   * with rollup counts by source and entryType.
   *
   * The page polls this on filter switch (source · type · limit ·
   * days change) · React Query keys on the input so each filter
   * combination has its own cache slot.
   */
  feed: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(100),
          days: z.number().int().min(1).max(365).default(60),
          type: z.string().max(40).nullable().optional(),
          source: z.string().max(40).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildJournalFeed({
        limit: input?.limit,
        days: input?.days,
        type: input?.type,
        source: input?.source,
      }),
    ),

  /**
   * Phase TT · owner-only · most-recent learning-journal entry ·
   * Nick's nightly self-assessment of his own brain. Powers the
   * small metacognition card at the top of /journal. Returns
   * `null` when no cron run has landed yet · page renders nothing
   * in that case.
   */
  metacognition: operatorProcedure.query(async () => {
    return getLatestLearningJournalEntry();
  }),
});
