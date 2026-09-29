/**
 * Q-31 · BrainMemory transaction-time write boundary.
 *
 * Effective time (valid_from/valid_until) says when a claim is true in the
 * corrected world. Transaction time says when StateNour itself held that
 * version. The transaction columns are deliberately NOT in Prisma yet:
 * production can run this code safely before the operator applies the pending
 * additive migration.
 *
 * Strong rule: when the columns exist, transaction_expired_at is written in
 * the SAME database transaction and BEFORE superseded_by_id/valid_until.
 */
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import {
  resetTransactionColumnProbeForTest,
  transactionTimeColumnsAvailable,
} from "@/lib/brain/memory-bitemporal";

const log = rootLogger.withSurface("brain/memory-transaction-time");
/** Test-only compatibility wrapper around the shared Q-31 schema probe. */
export function resetTransactionTimeColumnCache(): void {
  resetTransactionColumnProbeForTest();
}

/**
 * Give an admitted row a transaction start once the columns exist. Legacy rows
 * intentionally fall back to created_at: inventing a later "first believed"
 * time would rewrite history.
 */
export async function ensureMemoryTransactionStart(memoryId: string): Promise<boolean> {
  if (!(await transactionTimeColumnsAvailable())) return false;
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "brain_memories"
          SET "transaction_from_at" = COALESCE("transaction_from_at", "created_at")
        WHERE "id" = $1`,
      memoryId,
    );
    return true;
  } catch (err) {
    log.warn("transaction_time_start_failed", {
      memoryId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export interface SupersedeMemoryVersionInput {
  losingMemoryId: string;
  winningMemoryId: string;
  effectiveUntil: Date;
  transactionAt?: Date;
  /** Operator resolution also demotes the losing statement as an extra signal. */
  deprecate?: boolean;
}

export interface SupersedeMemoryVersionResult {
  count: number;
  transactionStamped: boolean;
}

/**
 * Atomic supersession. The loser is row-locked first. When transaction-time
 * columns are available, transaction_expired_at is stamped before the
 * supersession pointer/effective end inside the same transaction.
 */
export async function supersedeMemoryVersion(
  input: SupersedeMemoryVersionInput,
): Promise<SupersedeMemoryVersionResult> {
  const transactionAt = input.transactionAt ?? new Date();
  const hasTransactionColumns = await transactionTimeColumnsAvailable();

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id"::text AS id
         FROM "brain_memories"
        WHERE "id" = $1
          AND "superseded_by_id" IS NULL
          AND "deleted_at" IS NULL
        FOR UPDATE`,
      input.losingMemoryId,
    );
    if (locked.length === 0) {
      return { count: 0, transactionStamped: false };
    }

    let transactionStamped = false;
    if (hasTransactionColumns) {
      await tx.$executeRawUnsafe(
        `UPDATE "brain_memories"
            SET "transaction_from_at" = COALESCE("transaction_from_at", "created_at"),
                "transaction_expired_at" = COALESCE("transaction_expired_at", $2)
          WHERE "id" = $1`,
        input.losingMemoryId,
        transactionAt,
      );
      transactionStamped = true;
    }

    const stamped = await tx.brainMemory.updateMany({
      where: {
        id: input.losingMemoryId,
        supersededById: null,
        deletedAt: null,
      },
      data: {
        supersededById: input.winningMemoryId,
        validUntil: input.effectiveUntil,
        ...(input.deprecate
          ? {
              confidence: 0.1,
              source: "deprecated_by_resolution",
              lastSeen: transactionAt,
            }
          : {}),
      },
    });

    // The row lock makes this unexpected, but fail closed inside the transaction
    // if a future predicate change makes the Prisma update miss the locked row.
    if (stamped.count !== 1) {
      throw new Error(
        `supersession invariant: locked ${input.losingMemoryId} but updated ${stamped.count} rows`,
      );
    }

    return { count: 1, transactionStamped };
  });
}

export interface RestoreCurrentMemoryResult {
  count: number;
  transactionStamped: boolean;
}

/**
 * Verdict flip: reopen the row the operator just ruled correct. Transaction
 * time restarts NOW; effective time remains whatever its own validity says.
 */
export async function restoreMemoryAsCurrent(
  memoryId: string,
  expectedSupersededById: string,
  transactionAt = new Date(),
): Promise<RestoreCurrentMemoryResult> {
  const hasTransactionColumns = await transactionTimeColumnsAvailable();

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id"::text AS id
         FROM "brain_memories"
        WHERE "id" = $1
          AND "superseded_by_id" = $2
          AND "deleted_at" IS NULL
        FOR UPDATE`,
      memoryId,
      expectedSupersededById,
    );
    if (locked.length === 0) {
      return { count: 0, transactionStamped: false };
    }

    let transactionStamped = false;
    if (hasTransactionColumns) {
      await tx.$executeRawUnsafe(
        `UPDATE "brain_memories"
            SET "transaction_from_at" = $2,
                "transaction_expired_at" = NULL
          WHERE "id" = $1`,
        memoryId,
        transactionAt,
      );
      transactionStamped = true;
    }

    const restored = await tx.brainMemory.updateMany({
      where: {
        id: memoryId,
        supersededById: expectedSupersededById,
        deletedAt: null,
      },
      data: {
        supersededById: null,
        validUntil: null,
        lastVerifiedAt: transactionAt,
      },
    });
    if (restored.count !== 1) {
      throw new Error(
        `restore invariant: locked ${memoryId} but updated ${restored.count} rows`,
      );
    }
    return { count: 1, transactionStamped };
  });
}
