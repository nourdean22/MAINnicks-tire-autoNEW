/**
 * Stale-conversation auto-archive · v8.11 BATCH 64 · Apr 29.
 *
 * Sets `archivedAt` on ChatConversation rows that:
 *   · Haven't had activity (`lastActiveAt`) in STALE_DAYS days
 *   · AREN'T starred (Nour deliberately pinned them — keep visible)
 *   · AREN'T already archived
 *   · Have at least one message (skip empty stubs)
 *
 * Why archive vs delete: the v7.6 ChatMessage Batch A fields (pinnedSummary,
 * topicTags) make stale conversations cheap to keep but expensive to render.
 * Archiving hides them from the default sidebar (the @@index([archivedAt,
 * lastActiveAt]) makes that filter near-free) while preserving full content
 * for semantic search and brain-mining.
 *
 * Batch limit so a backlog doesn't lock the whole table — at MAX_PER_RUN=200
 * the worst case is 200 PK updates which is well under cron's 60s budget.
 *
 * Folded into mega-evening (no standalone schedule).
 */

import { prisma } from "@/lib/prisma";

const STALE_DAYS = 60;
const MAX_PER_RUN = 200;

export interface ArchiveReport {
  ranAt: string;
  cutoffIso: string;
  candidates: number;
  archived: number;
  capped: boolean;
}

export async function runStaleConversationArchive(): Promise<ArchiveReport> {
  const ranAt = new Date().toISOString();
  const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000);

  // Find candidates by updatedAt fallback when lastActiveAt is null —
  // older rows from before lastActiveAt was added rely on updatedAt as
  // the freshness signal. Either-or covers both populations.
  const candidates = await prisma.chatConversation.findMany({
    where: {
      archivedAt: null,
      starredAt: null,
      messageCount: { gt: 0 },
      OR: [
        { lastActiveAt: { lt: cutoff } },
        { AND: [{ lastActiveAt: null }, { updatedAt: { lt: cutoff } }] },
      ],
    },
    orderBy: [{ lastActiveAt: "asc" }, { updatedAt: "asc" }],
    take: MAX_PER_RUN + 1, // +1 lets us detect "more remaining"
    select: { id: true },
  });

  const capped = candidates.length > MAX_PER_RUN;
  const toArchive = capped ? candidates.slice(0, MAX_PER_RUN) : candidates;

  let archived = 0;
  if (toArchive.length > 0) {
    const result = await prisma.chatConversation.updateMany({
      where: { id: { in: toArchive.map((c) => c.id) } },
      data: { archivedAt: new Date() },
    });
    archived = result.count;
  }

  return {
    ranAt,
    cutoffIso: cutoff.toISOString(),
    candidates: toArchive.length,
    archived,
    capped,
  };
}
