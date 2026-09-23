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
  return dropEmbeddingsForSource("brain_memory", memoryIds, reason);
}

/**
 * The same tombstone for any source type whose rows are HARD-deleted.
 *
 * ⚠ THIS FILE'S HEADER WAS TRUE AND INCOMPLETE — TWICE.
 *
 * It said four brain_memory paths hard-delete without cleaning up, and fixed
 * those. That was true OF brain_memory and read as though it were the whole
 * story. A systematic sweep of every hard delete on the 11 embedded source
 * tables (2026-09-18) found FIVE more, none of which cascaded:
 *
 *   · app/api/cron/data-cleanup   deleted situation_logs nightly on a 90-day
 *     timer → 205 situation_log embeddings, 0 source rows, ever. (That sweep
 *     is removed; see the route for why.)
 *   · lib/system/stale-data-purger  deletes orphan chat_conversations AND
 *     their chat_messages → 7 chat_message orphans measured.
 *   · lib/services/chat-edit        truncates a conversation on edit/regenerate
 *     → chat_message, 2,473 embeddings with the newest written THAT DAY.
 *   · lib/services/people/delete-ledger-row → relationship_ledger, 16
 *     embeddings, newest the day before.
 *   · lib/services/undo-token      undoing `person.create` → person_profile.
 *
 * Every one of those runs on a schedule or on a user action, so each count is
 * a RATE, not a total.
 *
 * ⚠ AND FIVE SITES WERE CHECKED AND DELIBERATELY LEFT ALONE — lib/ai/reasoning
 * {budget,idempotency,engine}.ts delete `reasoning_in_flight` /
 * `reasoning_idempotency` rows, which are in-flight bookkeeping that measured
 * ZERO rows on prod and are never observed in the vector index. Adding a
 * cascade there would be dead code written to look thorough. "Delete on an
 * embedded TABLE" is not the same as "deletes EMBEDDED ROWS"; check the
 * category before adding a call.
 *
 * Generalising is the point: the next writer of a hard delete needs one
 * obvious function to call, not a per-table convention to rediscover. Only
 * HARD deletes belong here — a soft delete leaves the row addressable, and
 * lib/db/embedding-shadow.ts marks those instead so they stay recoverable.
 *
 * Best-effort by design, exactly like the brain_memory path: the caller has
 * already removed the rows, and turning a cleanup miss into a throw converts a
 * storage leak into a failed prune.
 */
export async function dropEmbeddingsForSource(
  sourceType: string,
  sourceIds: string[],
  reason: string,
): Promise<number> {
  if (sourceIds.length === 0) return 0;
  try {
    const res = await prisma.vectorEmbedding.deleteMany({
      where: { sourceType, sourceId: { in: sourceIds } },
    });
    return res.count;
  } catch (err) {
    log.warn("embedding_cleanup_failed", {
      reason,
      sourceType,
      memoryCount: sourceIds.length,
      error: String((err as { message?: string })?.message ?? err).slice(0, 200),
    });
    return 0;
  }
}
