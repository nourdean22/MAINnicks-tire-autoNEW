/**
 * Contradiction Auto-Cleanup — when a contradiction is RESOLVED with an
 * explicit winner, soft-delete the SUPERSEDED (losing) BrainMemory row so
 * the stale belief leaves the recall pool. v-truth · 2026-06-03.
 *
 * The problem this closes: contradiction-surfacer.ts already deprecates the
 * losing memory by FLOORING its confidence to 0.1 (current_wins -> old loses,
 * old_wins -> new loses) — but a confidence-0.1 row is STILL recallable, so
 * Nick can confidently cite an outdated fact the operator already overruled.
 * Recall already filters `deletedAt: null` (see contextual-recall + every
 * brainMemory.findMany in lib/brain/**), so setting deletedAt is the precise,
 * reversible way to pull the loser out of the pool without destroying it.
 *
 * Conservatism (matches lib/brain/memory-consolidation.ts soft-delete):
 *   - Flag-gated: NICK_CONTRADICTION_CLEANUP must be ON, else no-op.
 *   - ONLY the explicitly-losing side. current_wins -> old loses;
 *     old_wins -> new loses. both_valid / dismissed have NO loser -> no-op.
 *     We never guess a winner.
 *   - Soft-delete only (deletedAt), never hard-delete. Fully reversible by
 *     clearing deletedAt.
 *   - Idempotent: a row already soft-deleted is skipped (no-op update is
 *     harmless, but we short-circuit to keep it honest + audit-quiet).
 *   - Graceful: all DB work is wrapped; this NEVER throws into its caller
 *     (resolveContradiction is fire-and-forget-adjacent and runs in crons).
 */

import { prisma } from "@/lib/prisma";
import { getFlag } from "@/lib/feature-flags";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/contradiction-cleanup");

/** The resolution statuses that name an explicit loser. */
type WinningStatus = "current_wins" | "old_wins";

export interface ContradictionCleanupResult {
  /** True iff the flag was on AND a losing row was soft-deleted this call. */
  cleaned: boolean;
  /** The BrainMemory.id that was soft-deleted, when cleaned. */
  losingMemoryId?: string;
  /** Why nothing happened (flag_off · no_loser · already_deleted · error). */
  skippedReason?: "flag_off" | "no_loser" | "already_deleted" | "error";
}

/**
 * Soft-delete the losing memory of a resolved contradiction.
 *
 * @param status            The resolution the operator chose.
 * @param newMemoryId       BrainMemory.id of the fresher contradicting row.
 * @param oldMemoryId       BrainMemory.id of the prior contradicting row.
 * Returns a result describing what happened; never throws.
 */
export async function cleanupResolvedContradiction(
  status: string,
  newMemoryId: string,
  oldMemoryId: string,
): Promise<ContradictionCleanupResult> {
  // Self-gate — off by default; return early when disabled.
  if (!getFlag("NICK_CONTRADICTION_CLEANUP")?.isOn) {
    return { cleaned: false, skippedReason: "flag_off" };
  }

  // Only the two statuses that name an EXPLICIT loser. both_valid /
  // dismissed / unresolved -> no determinable loser -> do nothing.
  const losingMemoryId =
    status === ("current_wins" satisfies WinningStatus)
      ? oldMemoryId
      : status === ("old_wins" satisfies WinningStatus)
        ? newMemoryId
        : null;
  if (!losingMemoryId) {
    return { cleaned: false, skippedReason: "no_loser" };
  }

  try {
    // Idempotent: skip a row that's already soft-deleted (or missing).
    const existing = await prisma.brainMemory.findUnique({
      where: { id: losingMemoryId },
      select: { id: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) {
      return { cleaned: false, losingMemoryId, skippedReason: "already_deleted" };
    }

    await prisma.brainMemory.update({
      where: { id: losingMemoryId },
      data: { deletedAt: new Date() },
    });

    log.info("contradiction_loser_soft_deleted", { status, losingMemoryId });
    return { cleaned: true, losingMemoryId };
  } catch (err) {
    // Never throw into the resolve path / a cron — log and move on.
    log.warn("contradiction_cleanup_failed", {
      losingMemoryId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { cleaned: false, losingMemoryId, skippedReason: "error" };
  }
}
