import { prisma } from "@/lib/prisma";
import {
  MEDIA_MOMENT_CATEGORY,
  reopenTargetFromKey,
} from "@/lib/media/media-moment";

/**
 * Saved media moments (BDN-322) — the read side of media plan item #7.
 *
 * WHY THIS EXISTS
 * Self-audit found `reopenTargetFromKey` had no caller: moments could be
 * saved and never reopened. Saving without reopening is a write-only
 * feature, which is worse than no feature — the operator builds a habit
 * against something that never pays out.
 *
 * SCOPED TO ONE MEDIA ITEM, DELIBERATELY.
 * This lists moments for the media currently in the player, not a global
 * bookmark index. That is not a smaller version of the feature — it is
 * the only version that can be honest today: a moment stores a media ID
 * and an offset but no URL (`reopenTargetFromKey` returns none on
 * purpose, because a `blob:` URL dies with the session). When the media
 * is already docked, the URL is in hand and the seek is guaranteed to
 * land. A global list would have to resolve IDs to media it cannot
 * reach, and would show entries that silently do nothing.
 *
 * Read-only. No writes, no model calls.
 */

export interface SavedMoment {
  /** BrainMemory key — `media:<id>@<seconds>`. */
  key: string;
  /** Offset in seconds, parsed back out of the key. */
  seconds: number;
  /** Human-readable line as stored. */
  content: string;
  savedAt: Date;
}

/**
 * List saved moments for one media id, earliest offset first.
 *
 * Filtering happens in application code rather than SQL because the
 * offset is encoded IN the key (`media:<id>@<seconds>`) and media ids
 * may themselves contain the delimiter — a `LIKE 'media:<id>@%'` would
 * be right only until an id contained a `%` or `_`. Parsing the key
 * with the same function the writer used keeps one definition of the
 * format, which is the property that actually prevents drift.
 */
export async function listMediaMoments(mediaId: string): Promise<SavedMoment[]> {
  const id = mediaId?.trim();
  if (!id) return [];

  const rows = await prisma.brainMemory.findMany({
    where: { category: MEDIA_MOMENT_CATEGORY, deletedAt: null },
    select: { key: true, content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const out: SavedMoment[] = [];
  for (const row of rows) {
    const target = reopenTargetFromKey(row.key);
    // A row whose key does not parse is not ours — skip rather than
    // guess, so a foreign key can never seek the player somewhere.
    if (!target || target.mediaId !== id) continue;
    out.push({
      key: row.key,
      seconds: target.seconds,
      content: row.content,
      savedAt: row.createdAt,
    });
  }

  // Chronological within the media, not by save time: the operator is
  // scanning a timeline, not a history.
  return out.sort((a, b) => a.seconds - b.seconds);
}
