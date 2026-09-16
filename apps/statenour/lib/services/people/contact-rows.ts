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

/**
 * The markers that make a row a NON-contact, as {key, value} pairs — the one
 * definition `isContactRow` below excludes on and `assertWritableMetadata`
 * refuses to write. Each has exactly one legitimate writer, and neither goes
 * through the contact seam: `status_flip` is written directly by
 * `task.flipPersonStatus`, and `synthetic: true` belongs to the retired
 * 2026-05-29 mention backfill.
 */
export const RESERVED_LEDGER_METADATA_KEYS = [
  { key: "synthetic", value: true as const },
  { key: "kind", value: "status_flip" as const },
] as const;

/** Thrown when a CONTACT writer tries to stamp a marker that excludes its own row. */
export class ReservedLedgerMetadataError extends Error {
  constructor(readonly key: string) {
    super(
      `relationship_ledger metadata.${key} is reserved: it marks a row as NOT a contact, ` +
        `but this writer increments interactionCount. Write the row directly if it is an ` +
        `audit event, or drop the marker if it is a real contact.`,
    );
    this.name = "ReservedLedgerMetadataError";
  }
}

/**
 * Guard for every CONTACT writer (the `record-interaction.ts` seam).
 *
 * Codex P2 on #2348: `task.logLedger` accepts free-form metadata and passes it
 * to `recordInteraction`, which creates the row and bumps `interactionCount` —
 * and `isContactRow` then excludes that same row from the counters. The
 * profile would count a contact the ledger does not have, until the next
 * delete or reconcile silently corrected it downward. Rejecting (rather than
 * stripping) keeps the caller's contradiction visible instead of guessing
 * which half they meant.
 */
export function assertWritableMetadata(metadata: unknown): void {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return;
  const m = metadata as Record<string, unknown>;
  for (const { key, value } of RESERVED_LEDGER_METADATA_KEYS) {
    if (m[key] === value) throw new ReservedLedgerMetadataError(key);
  }
}

export function isContactRow(row: LedgerRowShape): boolean {
  const meta = row.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return true;
  const m = meta as Record<string, unknown>;
  if (m.synthetic === true) return false;
  if (m.kind === "status_flip") return false;
  return true;
}

/**
 * Fetch-then-filter. This is the ONLY safe shape: a Prisma JSON `NOT` filter
 * drops rows with NULL metadata, which is most of them (15 of 23 in prod on
 * 2026-09-16). Select `metadata: true` and pipe the rows through this.
 *
 * Use it in every reader that DERIVES A NUMBER from ledger rows (a sum, a
 * count, a trend, a "touches") or that feeds rows to a model as if they were
 * contact. The non-contact rows are not inert: a status-flip row carries a
 * real amount (−50 blown_up, −5 cooling, 0 active — power-atlas.ts
 * `flipPersonStatus`), and the 8 synthetic mention rows each carry +1, which
 * is why they had been earning relationship XP in `people-credit.ts`.
 *
 * The one legitimate exception is an AUDIT view — `task.personProfile`'s
 * `ledger` feeds `LedgerTimeline` and `AlphaMoments`, which show the person's
 * whole history and derive nothing. That read stays unfiltered on purpose.
 */
export function contactRowsOnly<T extends LedgerRowShape>(rows: T[]): T[] {
  return rows.filter(isContactRow);
}

/** The same predicate in SQL, for the reconcile script; alias `l` is relationship_ledger. */
export const CONTACT_ROW_SQL =
  "coalesce((l.metadata->>'synthetic')::boolean, false) = false AND coalesce(l.metadata->>'kind', '') <> 'status_flip'";
