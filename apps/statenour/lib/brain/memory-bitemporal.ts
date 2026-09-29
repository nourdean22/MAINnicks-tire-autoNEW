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
