/**
 * Contradiction Auto-Cleanup — when a contradiction is RESOLVED with an
 * explicit winner, soft-delete the SUPERSEDED (losing) BrainMemory row so
 * the stale belief leaves the recall pool. v-truth · 2026-06-03.
 *
 * This is the single owner of losing-memory deprecation/supersession after an
 * operator resolves a contradiction. The surfacer records the verdict and
 * invalidates UI caches; this module applies the memory-history mutation.
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
import { effectiveInvalidationAt } from "@/lib/brain/memory-bitemporal";
import {
  restoreMemoryAsCurrent,
  supersedeMemoryVersion,
} from "@/lib/brain/memory-transaction-time";

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
  /** True only when Q-31 transaction-time columns existed and were stamped. */
  transactionStamped?: boolean;
  /** Why nothing happened. */
  skippedReason?:
    | "flag_off"
    | "no_loser"
    | "non_overlapping"
    | "already_deleted"
    | "error";
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

  // BDN-310 + Q-31 · one supersession owner.
  //
  // Effective time and transaction time are deliberately separate:
  //   effective validUntil = when the winner became true;
  //   transaction_expired_at = when StateNour learned/adjudicated the change.
  //
  // Graphiti-style guard: NEVER close the loser's effective interval unless
  // the incoming winner actually begins inside that interval. A retro-dated,
  // non-overlapping correction is historical context, not permission to
  // corrupt another interval.
  let superseded = false;
  let transactionStamped = false;
  try {
    const transactionAt = new Date();
    const [winner, loser] = await Promise.all([
      prisma.brainMemory.findUnique({
        where: { id: winningMemoryId },
        select: { validFrom: true, supersededById: true },
      }),
      prisma.brainMemory.findUnique({
        where: { id: losingMemoryId },
        select: { createdAt: true, validFrom: true, validUntil: true },
      }),
    ]);
    if (!winner || !loser) {
      throw new Error("winner or loser memory missing");
    }

    const winnerEffectiveStart = winner.validFrom ?? transactionAt;
    const invalidatedAt = effectiveInvalidationAt(loser, winnerEffectiveStart);

    if (winner.supersededById === losingMemoryId) {
      // Verdict flip: reopen the row the operator just ruled correct. When
      // transaction-time columns exist, restart that belief window BEFORE
      // clearing its supersession pointer in the same transaction.
      const restored = await restoreMemoryAsCurrent(
        winningMemoryId,
        losingMemoryId,
        transactionAt,
      );
      transactionStamped = restored.transactionStamped;
      if (restored.count > 0) {
        log.info("contradiction_winner_unstranded", {
          status,
          winningMemoryId,
          losingMemoryId,
          transactionStamped,
        });
      }
    } else {
      // An operator adjudication is the strongest verification event the
      // system sees. This is independent of whether the effective intervals
      // overlap.
      await prisma.brainMemory.updateMany({
        where: { id: winningMemoryId, deletedAt: null },
        data: { lastVerifiedAt: transactionAt },
      });
    }

    if (!invalidatedAt) {
      log.info("contradiction_non_overlapping_no_supersede", {
        status,
        losingMemoryId,
        winningMemoryId,
        winnerEffectiveStart: winnerEffectiveStart.toISOString(),
      });
      return {
        cleaned: false,
        superseded: false,
        losingMemoryId,
        transactionStamped,
        skippedReason: "non_overlapping",
      };
    }

    const stamped = await supersedeMemoryVersion({
      losingMemoryId,
      winningMemoryId,
      effectiveUntil: invalidatedAt,
      transactionAt,
      deprecate: true,
    });
    superseded = stamped.count > 0;
    transactionStamped =
      transactionStamped || stamped.transactionStamped;

    if (superseded) {
      log.info("contradiction_loser_superseded", {
        status,
        losingMemoryId,
        winningMemoryId,
        effectiveUntil: invalidatedAt.toISOString(),
        transactionStamped,
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
    return {
      cleaned: false,
      superseded,
      losingMemoryId,
      transactionStamped,
      skippedReason: "flag_off",
    };
  }

  try {
    // Idempotent: skip a row that's already soft-deleted (or missing).
    const existing = await prisma.brainMemory.findUnique({
      where: { id: losingMemoryId },
      select: { id: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt) {
      return {
        cleaned: false,
        superseded,
        losingMemoryId,
        transactionStamped,
        skippedReason: "already_deleted",
      };
    }

    await prisma.brainMemory.update({
      where: { id: losingMemoryId },
      data: { deletedAt: new Date() },
    });

    log.info("contradiction_loser_soft_deleted", { status, losingMemoryId });
    return { cleaned: true, superseded, losingMemoryId, transactionStamped };
  } catch (err) {
    // Never throw into the resolve path / a cron — log and move on.
    log.warn("contradiction_cleanup_failed", {
      losingMemoryId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      cleaned: false,
      superseded,
      losingMemoryId,
      transactionStamped,
      skippedReason: "error",
    };
  }
}
