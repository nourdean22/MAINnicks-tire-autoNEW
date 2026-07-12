/**
 * Pure column-mapping for `lead.update`.
 *
 * Extracted from the router so the "a status move to 'contacted' implies the
 * contacted flag + a first-contact timestamp" invariant is unit-testable
 * without a database. Three writers set a lead to `contacted` — the list-view
 * Mark-Contacted button (sends `contacted:1`), the Kanban dropdown (sends only
 * `status`), and the stale-lead cron (writes SQL directly) — and before this
 * guard the status-only paths left rows at `status="contacted", contacted=0,
 * contactedAt=null`, which broke time-to-contact analytics and the admin
 * "No follow-up recorded" badge.
 *
 * Async concerns (lost-reason note merge, booking/invoice attribution) stay in
 * the handler; this function is deliberately synchronous and side-effect free.
 * `now` is injected so tests are deterministic.
 */
import { sql } from "drizzle-orm";
import { leads } from "../../drizzle/schema";

export interface LeadContactStatusUpdate {
  status?: "new" | "contacted" | "booked" | "completed" | "closed" | "lost";
  contacted?: number;
  contactedBy?: string;
  contactNotes?: string;
  estimatedValueCents?: number;
}

export function buildLeadContactStatusSet(
  updates: LeadContactStatusUpdate,
  now: Date = new Date(),
): Record<string, unknown> {
  const setObj: Record<string, unknown> = {};

  if (updates.status !== undefined) setObj.status = updates.status;

  if (updates.contacted !== undefined) {
    setObj.contacted = updates.contacted;
    if (updates.contacted === 1) {
      setObj.contactedAt = now;
      setObj.lastFollowUpAt = now;
    }
  }

  // Atomicity guard — status→"contacted" with no explicit `contacted` value
  // (the Kanban dropdown path) still sets the flag + first-contact timestamp.
  // Skipped when the caller passed an explicit `contacted`, so the REOPEN path
  // ({ status:"new", contacted:0 }) is untouched. COALESCE preserves the
  // earliest contactedAt across re-confirmations.
  if (updates.status === "contacted" && updates.contacted === undefined) {
    setObj.contacted = 1;
    setObj.contactedAt = sql`COALESCE(${leads.contactedAt}, ${now})`;
    setObj.lastFollowUpAt = now;
  }

  if (updates.contactedBy !== undefined) setObj.contactedBy = updates.contactedBy;

  if (updates.contactNotes !== undefined) {
    setObj.contactNotes = updates.contactNotes;
    setObj.lastFollowUpAt = now; // Any note = a follow-up
  }

  if (updates.estimatedValueCents !== undefined) setObj.estimatedValueCents = updates.estimatedValueCents;

  return setObj;
}
