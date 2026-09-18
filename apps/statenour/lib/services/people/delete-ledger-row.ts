/**
 * deleteLedgerRow · the delete side of the ledger seam · 2026-09-16 (W6).
 *
 * The seam (record-interaction.ts) adds a row and moves both counters in
 * one transaction. Removing a row is the same contract in reverse: the
 * counters must land exactly where the remaining CONTACT rows put them —
 * no blind decrement (task.deleteLedger used to subtract 1 whatever the
 * row was, so deleting a synthetic mention or a status-flip audit row cost
 * a real contact), and lastInteraction recomputed rather than left stale
 * ("not worth a full scan" — it is one indexed query per delete).
 *
 * Same per-person advisory lock as every seam writer, so a delete cannot
 * interleave with a log for the same person at any isolation level. The
 * formula is deriveCounters (counter-reconcile.ts), shared with the
 * reconcile script.
 */

import { prisma } from "@/lib/prisma";
import { isContactRow } from "./contact-rows";
import { deriveCounters } from "./counter-reconcile";
import { lockPerson } from "./record-interaction";
import { dropEmbeddingsForSource } from "@/lib/brain/memory-tombstone";

export class LedgerRowNotFoundError extends Error {
  constructor(ledgerId: string) {
    super(`No ledger row with id ${ledgerId}`);
    this.name = "LedgerRowNotFoundError";
  }
}

export interface DeletedLedgerRow {
  ledgerId: string;
  personId: string;
  /** Whether the removed row itself counted as a contact. */
  wasContact: boolean;
  interactionCount: number;
  lastInteraction: Date | null;
}

export async function deleteLedgerRow(ledgerId: string): Promise<DeletedLedgerRow> {
  const row = await prisma.relationshipLedger.findUnique({
    where: { id: ledgerId },
    select: { personId: true, metadata: true },
  });
  if (!row) throw new LedgerRowNotFoundError(ledgerId);
  const wasContact = isContactRow(row);

  // relationship_ledger is indexed in vector_embeddings by
  // lib/brain/people-embed-hook.ts through a plain text ("sourceType","sourceId") pair
  // with NO foreign key — there is no referential action to cascade. Measured
  // 2026-09-18: 16 such embeddings, newest written the day before, so this is a LIVE
  // producer, not a historical one.
  //
  // Dropped OUTSIDE the transaction on purpose. The embedding is a DERIVED index; a
  // failure to clean it must not roll back a completed delete and leave the counters
  // half-updated. Same trade lib/brain/memory-tombstone.ts already made for
  // brain_memory: a storage leak beats a failed prune.
  const result = await prisma.$transaction(async (tx) => {
    await lockPerson(tx, row.personId);
    await tx.relationshipLedger.delete({ where: { id: ledgerId } });
    const remaining = await tx.relationshipLedger.findMany({
      where: { personId: row.personId },
      select: { createdAt: true, metadata: true },
    });
    const after = deriveCounters(remaining);
    await tx.personProfile.update({
      where: { id: row.personId },
      data: after,
      select: { id: true },
    });
    return { ledgerId, personId: row.personId, wasContact, ...after };
  });

  // .catch here as well as inside the helper: the row is ALREADY deleted and the
  // counters ALREADY recomputed, so a cleanup failure must not turn a completed
  // delete into a reported error. Pinned by a canary in this file's test.
  await dropEmbeddingsForSource("relationship_ledger", [ledgerId], "people:delete-ledger-row").catch(
    () => 0,
  );
  return result;
}
