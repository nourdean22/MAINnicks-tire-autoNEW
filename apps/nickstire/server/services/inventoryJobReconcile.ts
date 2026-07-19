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

/**
 * Read-only: what WOULD change, and why. Applying is a separate call.
 *
 * ONE VERDICT PER INVENTORY ROW, NOT PER JOB.
 *
 * The caller reaches these pairs through
 * `leftJoin(reelJobs, eq(reelJobs.briefId, socialContentInventory.id))`, and one
 * inventory row can have SEVERAL reel jobs. Classifying each pair independently
 * meant a single dead job could condemn a queue item whose sibling job was alive.
 *
 * That is not hypothetical — REGENERATE DELIBERATELY CREATES THAT SHAPE. It
 * supersedes the old job (marking it `failed`) and enqueues a new one against the
 * same brief. So the moment an operator regenerated a dead reel, this planner
 * would look at the corpse, ignore the live replacement, and offer to mark the
 * row failed — killing the very recovery it had just been used to start.
 *
 * The rule is therefore an ALL, not an ANY: a row is misreported only when EVERY
 * job behind it is terminally dead. One surviving job is enough to leave it alone,
 * which is the safe direction — wrongly burying reviewable work is far worse than
 * leaving a dead row visible for another day.
 */
export function planInventoryReconcile(pairs: readonly InventoryJobPair[]): ReconcileReport {
  const byInventory = new Map<string, InventoryJobPair[]>();
  for (const p of pairs) {
    const list = byInventory.get(p.inventoryId);
    if (list) list.push(p);
    else byInventory.set(p.inventoryId, [p]);
  }

  const rows: ReconcileReport["rows"] = [];
  for (const [inventoryId, jobs] of byInventory) {
    const verdicts = jobs.map((j) => ({ pair: j, verdict: classifyInventoryRow(j) }));

    // Any job that is not condemned protects the whole row — an in-flight
    // regeneration, a job with surviving media, a published sibling.
    if (verdicts.some((v) => v.verdict.action !== "mark_failed")) continue;

    // Report against the NEWEST job: it is the one whose failure is current, and
    // its error is what the operator needs to read. Job ids ascend.
    const newest = verdicts.reduce((a, b) => ((b.pair.jobId ?? 0) > (a.pair.jobId ?? 0) ? b : a));
    if (newest.verdict.action !== "mark_failed") continue;

    rows.push({
      inventoryId,
      jobId: newest.pair.jobId,
      reason: newest.verdict.reason,
      // Regenerable if ANY surviving brief can be revived — the operator only
      // needs one good path forward, and offering none when one exists would
      // strand recoverable work.
      regenerable: verdicts.some((v) => v.verdict.action === "mark_failed" && v.verdict.regenerable),
    });
  }

  return {
    // The count the operator can verify by eye: queue ROWS looked at, not join rows.
    examined: byInventory.size,
    misreported: rows.length,
    regenerable: rows.filter((r) => r.regenerable).length,
    rows,
  };
}
