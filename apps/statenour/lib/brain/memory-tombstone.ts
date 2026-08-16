/**
 * Hard-deleting a BrainMemory must take its embedding with it.
 *
 * WHY THIS EXISTS. Four code paths hard-delete `brain_memories` rows. Only one
 * of them — `semantic-dedup` — also removed the matching `vector_embeddings`
 * row. The other three left it behind, and `vector_embeddings` carries a
 * `content` TEXT copy of the memory, so each orphan became a readable memory
 * with no memory row: invisible to every admin surface, unreachable by any
 * lifecycle, and still returned by vector search until that was fixed
 * separately. Measured on prod 2026-08-16: **4,867 such orphans**, spanning
 * 2026-04-26 to 2026-08-15.
 *
 * Two distinct harms, which is why this is not merely tidiness:
 *
 *   1. `memory-manager.purge()` is documented as the stale-data-purger and
 *      GDPR-style scrub path. A scrub that leaves the text in a second table is
 *      not a scrub.
 *   2. The orphans are the LAST copy of their content, so the obvious cleanup
 *      (delete the orphan rows) destroys data — see lib/db/embedding-cleanup.ts.
 *
 * Deliberately NOT a Prisma cascade: `vector_embeddings.sourceId` is a plain
 * text column keyed by `sourceType`, not a foreign key, precisely because one
 * table indexes many source tables. There is no referential action to lean on,
 * so the cleanup has to be explicit at each call site.
 */
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/memory-tombstone");

/**
 * Delete the vector_embeddings rows for memories that were just hard-deleted.
 *
 * Best-effort by design: it never throws. The caller has already removed the
 * memory, and turning a cleanup miss into a thrown error would convert a
 * storage leak into a failed prune. A miss is logged so it is visible in
 * /system/errors rather than silent — silence is how 4,867 accumulated.
 */
export async function dropEmbeddingsForMemories(
  memoryIds: string[],
  reason: string,
): Promise<number> {
  if (memoryIds.length === 0) return 0;
  try {
    const res = await prisma.vectorEmbedding.deleteMany({
      where: { sourceType: "brain_memory", sourceId: { in: memoryIds } },
    });
    return res.count;
  } catch (err) {
    log.warn("embedding_cleanup_failed", {
      reason,
      memoryCount: memoryIds.length,
      error: String((err as { message?: string })?.message ?? err).slice(0, 200),
    });
    return 0;
  }
}
