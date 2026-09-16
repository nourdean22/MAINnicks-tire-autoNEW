/**
 * What counts as a CONTACT in the relationship ledger · 2026-09-16 (W6).
 *
 * relationship_ledger carries two kinds of rows that are NOT contacts and
 * must never move interactionCount or lastInteraction:
 *   · synthetic backfill rows — `metadata.synthetic === true`. Eight rows
 *     written on 2026-05-29 from chat messages that MENTIONED a person
 *     (`chatMessageId` in the metadata). A mention is not a contact.
 *   · status-flip audit rows — `metadata.kind === "status_flip"`, written
 *     straight to the table by task.flipPersonStatus. A status change is
 *     not contact either (record-interaction.ts header).
 *
 * Everything else is a contact: the seam's rows, the June/July manual logs,
 * the picks outreach rows. interactionCount and lastInteraction are a pure
 * function of the contact rows, and this predicate is that function's one
 * definition — shared by the delete side (delete-ledger-row.ts), the
 * reconcile (counter-reconcile.ts + scripts/reconcile-person-counters.ts)
 * and anything else that counts rows.
 *
 * Filter in TypeScript, never with a Prisma JSON `NOT` filter: 15 of the 23
 * prod rows have NULL metadata, and `NOT (NULL = true)` is NULL in SQL — the
 * rows would silently vanish from the count. The SQL twin below coalesces
 * for the same reason.
 */

export interface LedgerRowShape {
  metadata: unknown;
}

export function isContactRow(row: LedgerRowShape): boolean {
  const meta = row.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return true;
  const m = meta as Record<string, unknown>;
  if (m.synthetic === true) return false;
  if (m.kind === "status_flip") return false;
  return true;
}

/** The same predicate in SQL, for the reconcile script; alias `l` is relationship_ledger. */
export const CONTACT_ROW_SQL =
  "coalesce((l.metadata->>'synthetic')::boolean, false) = false AND coalesce(l.metadata->>'kind', '') <> 'status_flip'";
