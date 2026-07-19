/**
 * When a reel job dies, its queue entry must stop saying "awaiting your review".
 *
 * MEASURED IN PRODUCTION 2026-07-19: the Queue showed 30 reel items in `pending`
 * — the status that means "ready for the operator to look at". Every one of them
 * had a FAILED job and NO rendered media. Thirty corpses presented as work.
 *
 * They died between 2026-07-09 and 2026-07-10 with:
 *   "Veo submit failed (HTTP 403): Your API key was reported as leaked."
 * The key has since been rotated, so the BRIEFS are still good and the jobs are
 * regenerable. Two separate facts the operator could not see: these cannot
 * publish as they are, AND they can be revived.
 *
 * This is the same defect the whole session has been about — a status that
 * describes an intention rather than reality. `pending` meant "we made this",
 * not "this is reviewable".
 *
 * PURE CLASSIFIER, IMPURE CALLER. The decision of what a row SHOULD say is a
 * function of two facts; applying it is a separate, operator-triggered step,
 * because mass-updating thirty production rows is a data change and not a
 * side effect of looking at a screen.
 */

/** What the inventory row currently claims, and what its job actually did. */
export interface InventoryJobPair {
  inventoryId: string;
  inventoryStatus: string;
  jobId: number | null;
  jobStatus: string | null;
  hasRenderedAsset: boolean;
  jobError: string | null;
}

export type ReconcileVerdict =
  | { action: "none"; reason: string }
  | { action: "mark_failed"; reason: string; regenerable: boolean };

/**
 * A queue entry earns `pending` only if something could actually be reviewed.
 *
 * Deliberately narrow: this only ever moves a row OUT of a reviewable state when
 * its job is terminally failed AND no media exists. It never invents a success,
 * never touches a published row, and never guesses about a job still running —
 * an in-flight job legitimately has no asset yet.
 */
export function classifyInventoryRow(pair: InventoryJobPair): ReconcileVerdict {
  // Only reviewable states can be wrong in the way this fixes.
  if (pair.inventoryStatus !== "pending" && pair.inventoryStatus !== "needs_review") {
    return { action: "none", reason: "not in a reviewable state" };
  }
  if (!pair.jobId || !pair.jobStatus) {
    // No job at all — a manually staged item. Its status is the operator's.
    return { action: "none", reason: "no reel job backs this row" };
  }
  if (pair.jobStatus !== "failed") {
    return { action: "none", reason: `job is '${pair.jobStatus}', not terminally failed` };
  }
  if (pair.hasRenderedAsset) {
    // Failed AFTER rendering — the media exists and is genuinely reviewable.
    // Recovery, not removal, is the right path and the Action Center owns it.
    return { action: "none", reason: "job failed but rendered media survives — recoverable, leave it reviewable" };
  }

  // A leaked/rotated key or an exhausted cap is an ENVIRONMENTAL failure: the
  // brief was never the problem, so the work can be revived. A malformed brief
  // cannot be, and saying so is the difference between a to-do and a dead end.
  const err = String(pair.jobError ?? "");
  const regenerable = /leaked|API key|429|spending cap|quota|Session expired|auth|timeout|no progress/i.test(err);

  return {
    action: "mark_failed",
    reason: regenerable
      ? "generation failed for an environmental reason (key, quota or session) — the brief is still good and can be regenerated"
      : "generation failed and no media exists",
    regenerable,
  };
}

export interface ReconcileReport {
  examined: number;
  misreported: number;
  regenerable: number;
  rows: Array<{ inventoryId: string; jobId: number | null; reason: string; regenerable: boolean }>;
}

/** Read-only: what WOULD change, and why. Applying is a separate call. */
export function planInventoryReconcile(pairs: readonly InventoryJobPair[]): ReconcileReport {
  const rows: ReconcileReport["rows"] = [];
  for (const p of pairs) {
    const v = classifyInventoryRow(p);
    if (v.action !== "mark_failed") continue;
    rows.push({ inventoryId: p.inventoryId, jobId: p.jobId, reason: v.reason, regenerable: v.regenerable });
  }
  return {
    examined: pairs.length,
    misreported: rows.length,
    regenerable: rows.filter((r) => r.regenerable).length,
    rows,
  };
}
