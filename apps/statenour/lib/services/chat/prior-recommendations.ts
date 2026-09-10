/**
 * PRIOR RECOMMENDATIONS -- 2026-09-10.
 *
 * Feeds `lib/ai/chat/recommendation-novelty.ts` with what NICK has
 * already recommended, so a list can be checked for repetition BEFORE it
 * is generated.
 *
 * DESIGN NOTE -- why there is no new table.
 *
 * The obvious build is a `recommendation` table written on every turn.
 * It is also the wrong one here, and the reason is worth stating because
 * it generalises: every new store is a new thing that can drift from
 * reality, a new thing a deletion has to reach, a new backfill for the
 * history that predates it, and a new writer that can silently stop.
 * This repo already carries eleven capabilities that were built and
 * never wired -- adding a twelfth store to answer a question the
 * existing data already answers would be the same mistake.
 *
 * Every recommendation NICK has ever made is already durably stored, in
 * the assistant messages themselves. Extracting from those means:
 *   - no write path, so it cannot silently stop writing;
 *   - no backfill, because the whole history is already there;
 *   - deletion propagates for free -- delete the message, the
 *     recommendation is gone, with no second copy to forget about;
 *   - and it uses the SAME extractor as the receipt gate, so a name
 *     checked for fabrication is the same string checked for repetition.
 *
 * The cost is a bounded scan per turn instead of an indexed lookup. At
 * one operator and a 60-message window that is microseconds of regex
 * over text already in Postgres. If NICK ever has many users, this
 * becomes a materialized view -- not a rewrite.
 */

import { prisma } from "@/lib/prisma";
import { detectNamedSources } from "@/lib/ai/chat/named-source-claims";
import type { PriorRecommendation } from "@/lib/ai/chat/recommendation-novelty";

/** How many recent assistant turns to scan. */
const SCAN_LIMIT = 60;
/** Ignore anything older than this -- a pick from a year ago is fair to re-serve. */
const LOOKBACK_DAYS = 120;

export interface PriorRecommendationsResult {
  priors: PriorRecommendation[];
  /**
   * EMPTY vs ERROR. An empty `priors` from a failed query must not be
   * read as "nothing has ever been recommended" -- that reading turns a
   * database blip into a confident "this is all new".
   */
  provenance: "OK" | "ZERO" | "ERROR";
}

/**
 * Scan recent assistant messages and extract the resources already named.
 */
export async function loadPriorRecommendations(): Promise<PriorRecommendationsResult> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  try {
    const rows = await prisma.chatMessage.findMany({
      // No per-user filter: NICK is single-operator, so every assistant
      // message in the window is Nour's. When that stops being true this
      // needs a userId scope -- and a test that proves one operator
      // cannot see another's recommendation history.
      where: {
        role: "assistant",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: SCAN_LIMIT,
      select: { content: true, createdAt: true },
    });

    const byKey = new Map<string, PriorRecommendation>();
    for (const row of rows) {
      if (!row.content) continue;
      for (const claim of detectNamedSources(row.content)) {
        const existing = byKey.get(claim.name.toLowerCase());
        if (existing) {
          existing.timesSurfaced += 1;
          // Rows arrive newest-first, so the first sighting is the latest.
          continue;
        }
        byKey.set(claim.name.toLowerCase(), {
          name: claim.name,
          lastSurfacedAt: row.createdAt,
          timesSurfaced: 1,
        });
      }
    }

    const priors = [...byKey.values()];
    return { priors, provenance: priors.length > 0 ? "OK" : "ZERO" };
  } catch {
    // Never let a novelty lookup break a turn. But say it FAILED --
    // returning ZERO here would let a DB blip present a stale list as new.
    return { priors: [], provenance: "ERROR" };
  }
}
