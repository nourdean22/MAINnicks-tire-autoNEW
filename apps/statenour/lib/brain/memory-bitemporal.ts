/**
 * Q-31 · BrainMemory bitemporal helpers.
 *
 * Effective time answers "what was true at t?"
 * Transaction time answers "what did StateNour believe at t?"
 *
 * They are intentionally independent. A retro-dated correction can change the
 * effective history today without pretending the system already knew it last
 * week.
 */
import { prisma } from "@/lib/prisma";

export interface BitemporalMemoryWindow {
  createdAt: Date;
  validFrom?: Date | null;
  validUntil?: Date | null;
  transactionFromAt?: Date | null;
  transactionExpiredAt?: Date | null;
}

function startOrCreated(start: Date | null | undefined, createdAt: Date): Date {
  return start ?? createdAt;
}

function containsHalfOpen(start: Date, end: Date | null | undefined, at: Date): boolean {
  return start.getTime() <= at.getTime() && (!end || at.getTime() < end.getTime());
}

/** Current corrected-world interpretation of the claim. */
export function wasEffectivelyTrueAt(row: BitemporalMemoryWindow, at: Date): boolean {
  return containsHalfOpen(startOrCreated(row.validFrom, row.createdAt), row.validUntil, at);
}

/** What the system had recorded as its belief at that system/transaction time. */
export function wasBelievedAt(row: BitemporalMemoryWindow, at: Date): boolean {
  return containsHalfOpen(
    startOrCreated(row.transactionFromAt, row.createdAt),
    row.transactionExpiredAt,
    at,
  );
}

/**
 * Clip the outgoing effective interval only when the incoming correction
 * actually starts inside the old interval. This is the Graphiti-style guard:
 * a retro-dated row must not blindly set old.validUntil to a time before the
 * old row's own validity start.
 */
export function effectiveInvalidationAt(
  old: Pick<BitemporalMemoryWindow, "createdAt" | "validFrom" | "validUntil">,
  incomingValidFrom: Date,
): Date | null {
  const oldStart = startOrCreated(old.validFrom, old.createdAt);
  if (incomingValidFrom.getTime() <= oldStart.getTime()) return null;
  if (old.validUntil && incomingValidFrom.getTime() >= old.validUntil.getTime()) return null;
  return incomingValidFrom;
}

/**
 * The DB query side is intentionally not emitted through Prisma yet.
 * The additive transaction-time DDL is still operator-gated and has not been
 * applied to production, so generated Prisma fields would make every
 * BrainMemory select depend on columns that do not exist yet.
 *
 * After the pending migration is applied/read back, a follow-up schema-sync
 * commit can expose transaction_from_at / transaction_expired_at to Prisma and
 * compose these pure predicates into DB queries without changing semantics.
 */


interface TransactionColumnProbeRow {
  count: number | bigint | string;
}

export interface ClosedTransactionWindow {
  available: boolean;
  previousFromAt: Date | null;
}

let transactionColumnProbe:
  | { checkedAt: number; promise: Promise<boolean> }
  | null = null;
const TRANSACTION_COLUMN_PROBE_TTL_MS = 60_000;

/**
 * The pending Q-31 DDL is operator-gated. Runtime code must therefore tolerate
 * both schemas during the deploy window. Probe information_schema instead of
 * adding Prisma fields before the columns exist in production.
 */
export async function transactionTimeColumnsAvailable(): Promise<boolean> {
  const now = Date.now();
  if (
    transactionColumnProbe &&
    now - transactionColumnProbe.checkedAt < TRANSACTION_COLUMN_PROBE_TTL_MS
  ) {
    return transactionColumnProbe.promise;
  }

  const promise = prisma.$queryRawUnsafe<TransactionColumnProbeRow[]>(
    `SELECT COUNT(*)::int AS "count"
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'brain_memories'
        AND column_name IN ('transaction_from_at', 'transaction_expired_at')`,
  )
    .then((rows) => Number(rows[0]?.count ?? 0) === 2)
    .catch(() => false);

  transactionColumnProbe = { checkedAt: now, promise };
  return promise;
}

/**
 * Stamp a newly-created/replacement belief's transaction start. No-op before
 * the operator applies the additive DDL.
 */
export async function openTransactionWindowIfAvailable(
  memoryId: string,
  at: Date,
): Promise<boolean> {
  if (!(await transactionTimeColumnsAvailable())) return false;
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "brain_memories"
        SET "transaction_from_at" = $1,
            "transaction_expired_at" = NULL
      WHERE "id" = $2`,
    at,
    memoryId,
  ).catch(() => 0);
  return Number(updated) > 0;
}

/**
 * Close the outgoing canonical row BEFORE its content flips. The previous
 * start is returned so the frozen snapshot can preserve the old belief window
 * and a failed replacement can restore the canonical row.
 */
export async function closeTransactionWindowIfAvailable(
  memoryId: string,
  at: Date,
): Promise<ClosedTransactionWindow> {
  if (!(await transactionTimeColumnsAvailable())) {
    return { available: false, previousFromAt: null };
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ fromAt: Date | string | null }>>(
    `SELECT COALESCE("transaction_from_at", "created_at") AS "fromAt"
       FROM "brain_memories"
      WHERE "id" = $1
      LIMIT 1`,
    memoryId,
  ).catch(() => []);

  if (rows.length === 0) return { available: true, previousFromAt: null };
  const raw = rows[0]?.fromAt;
  const previousFromAt =
    raw instanceof Date ? raw : raw ? new Date(raw) : null;

  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "brain_memories"
        SET "transaction_expired_at" = $1
      WHERE "id" = $2
        AND ("transaction_expired_at" IS NULL OR "transaction_expired_at" > $1)`,
    at,
    memoryId,
  ).catch(() => 0);

  return {
    available: Number(updated) > 0,
    previousFromAt,
  };
}

/** Preserve the outgoing belief's transaction interval on its frozen snapshot. */
export async function stampHistoricalTransactionWindowIfAvailable(
  snapshotId: string,
  fromAt: Date,
  expiredAt: Date,
): Promise<boolean> {
  if (!(await transactionTimeColumnsAvailable())) return false;
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "brain_memories"
        SET "transaction_from_at" = $1,
            "transaction_expired_at" = $2
      WHERE "id" = $3`,
    fromAt,
    expiredAt,
    snapshotId,
  ).catch(() => 0);
  return Number(updated) > 0;
}

/** Compensating restore if the content flip fails after the close step. */
export async function restoreTransactionWindowIfAvailable(
  memoryId: string,
  fromAt: Date | null,
): Promise<boolean> {
  if (!(await transactionTimeColumnsAvailable())) return false;
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "brain_memories"
        SET "transaction_from_at" = COALESCE($1, "transaction_from_at"),
            "transaction_expired_at" = NULL
      WHERE "id" = $2`,
    fromAt,
    memoryId,
  ).catch(() => 0);
  return Number(updated) > 0;
}

/** Test-only cache reset; does not alter database state. */
export function resetTransactionColumnProbeForTest(): void {
  transactionColumnProbe = null;
}
