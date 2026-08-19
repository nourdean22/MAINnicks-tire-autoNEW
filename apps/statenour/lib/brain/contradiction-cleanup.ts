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
 *   - 2026-08-19: the BDN-310 supersession stamp (supersededById +
 *     validUntil on the loser, lastVerifiedAt on the winner) runs
 *     UNCONDITIONALLY on an explicit-loser status — an operator verdict
 *     already authorized that metadata. ONLY the soft-delete below is
 *     flag-gated: NICK_CONTRADICTION_CLEANUP must be ON, else no delete.
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
  /** True iff BDN-310 supersession fields were stamped on the loser this call. */
  superseded: boolean;
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
  // Only the two statuses that name an EXPLICIT loser. both_valid /
  // dismissed / unresolved -> no determinable loser -> do nothing.
  const losingMemoryId =
    status === ("current_wins" satisfies WinningStatus)
      ? oldMemoryId
      : status === ("old_wins" satisfies WinningStatus)
        ? newMemoryId
        : null;
  if (!losingMemoryId) {
    return { cleaned: false, superseded: false, skippedReason: "no_loser" };
  }
  const winningMemoryId =
    losingMemoryId === oldMemoryId ? newMemoryId : oldMemoryId;

  // BDN-310 · bi-temporal supersession — the columns were applied to prod
  // 2026-08-14 and had NO writer until this. An operator-resolved
  // contradiction with an explicit winner IS a supersession event, so the
  // loser gets `supersededById` (provenance: what replaced it) and
  // `validUntil = now` (when it stopped being believed). Both recall lanes
  // filter on these (memory-recall.ts + contextual-recall.ts), so this
  // alone removes the stale belief from the pool — reversibly, with the
  // row and its history intact. NOT flag-gated: this is metadata the
  // operator's explicit verdict already authorized; only the harsher
  // soft-delete below stays behind NICK_CONTRADICTION_CLEANUP.
  let superseded = false;
  try {
    // Bi-temporal semantics per prior art (Zep/Graphiti, SQL:2011): the
    // loser's validity ends when the WINNER's begins — not at whatever
    // moment the operator happened to tap resolve. validFrom has no
    // writer yet, so this degrades to NOW() until one exists.
    const winner = await prisma.brainMemory.findUnique({
      where: { id: winningMemoryId },
      select: { validFrom: true, supersededById: true },
    });
    const invalidatedAt = winner?.validFrom ?? new Date();

    if (winner?.supersededById === losingMemoryId) {
      // Verdict flip: the row the operator just ruled CORRECT is itself
      // superseded BY the row it now beats (an earlier resolution the
      // other way). Without this, both rows end up superseded and the
      // operator's ruled-correct belief stays buried forever. Clear the
      // stamp narrowly — only when it points at this exact pair.
      await prisma.brainMemory.update({
        where: { id: winningMemoryId },
        data: { supersededById: null, validUntil: null, lastVerifiedAt: new Date() },
      });
      log.info("contradiction_winner_unstranded", { status, winningMemoryId, losingMemoryId });
    } else {
      // An operator adjudication is the strongest verification event the
      // system ever sees — BDN-310 lastVerifiedAt's first writer.
      await prisma.brainMemory.updateMany({
        where: { id: winningMemoryId, deletedAt: null },
        data: { lastVerifiedAt: new Date() },
      });
    }

    const stamped = await prisma.brainMemory.updateMany({
      // Idempotent: never re-stamp an already-superseded row.
      where: { id: losingMemoryId, supersededById: null, deletedAt: null },
      data: { supersededById: winningMemoryId, validUntil: invalidatedAt },
    });
    superseded = stamped.count > 0;
    if (superseded) {
      log.info("contradiction_loser_superseded", {
        status,
        losingMemoryId,
        winningMemoryId,
      });
    }
  } catch (err) {
    log.warn("contradiction_supersede_failed", {
      losingMemoryId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Self-gate — off by default; the soft-delete below stays flag-gated.
  if (!getFlag("NICK_CONTRADICTION_CLEANUP")?.isOn) {
    return { cleaned: false, superseded, losingMemoryId, skippedReason: "flag_off" };
  }

  try {
    // Idempotent: skip a row that's already soft-deleted (or missing).
    const existing = await prisma.brainMemory.findUnique({
      where: { id: losingMemoryId },
      select: { id: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) {
      return { cleaned: false, superseded, losingMemoryId, skippedReason: "already_deleted" };
    }

    await prisma.brainMemory.update({
      where: { id: losingMemoryId },
      data: { deletedAt: new Date() },
    });

    log.info("contradiction_loser_soft_deleted", { status, losingMemoryId });
    return { cleaned: true, superseded, losingMemoryId };
  } catch (err) {
    // Never throw into the resolve path / a cron — log and move on.
    log.warn("contradiction_cleanup_failed", {
      losingMemoryId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { cleaned: false, superseded, losingMemoryId, skippedReason: "error" };
  }
}
