/**
 * Pure categorization logic for the commitments cleanup (2026-08-12).
 * No I/O, no prisma import — safe to import from both the plan (read-only)
 * and execute (write) scripts without triggering the other's main().
 */

export interface CommitmentRow {
  id: number;
  description: string;
  toWhom: string;
  deadline: string | null;
  createdAt: Date;
}

export type Category = "COMPLETE" | "ABANDON" | "KEEP";

/** Self-evidently completed — the described outcome is verifiably true. */
const COMPLETE_MARKERS = [/deploy.*sta[e]?nour/i, /launch.*nour\s*os/i];

/** Rows this specific pattern flags as noise (duplicated the same remark
 *  three ways) — named explicitly so the plan is auditable, not a black box. */
const KNOWN_NOISE_CLUSTER = /unethical life hacks/i;

const NOISE_AGE_FLOOR_DAYS = 90;

export function categorize(row: CommitmentRow, now = Date.now()): { category: Category; reason: string } {
  if (COMPLETE_MARKERS.some((re) => re.test(row.description))) {
    return { category: "COMPLETE", reason: "self-evidently done (verified true today)" };
  }
  if (row.deadline) {
    return { category: "KEEP", reason: "has a deadline — handled by the pulse ticker's own overdue/resolve flow" };
  }
  const ageDays = Math.floor((now - row.createdAt.getTime()) / 86_400_000);
  if (ageDays < NOISE_AGE_FLOOR_DAYS) {
    return { category: "KEEP", reason: `only ${ageDays}d old — too recent to call abandoned with confidence` };
  }
  if (KNOWN_NOISE_CLUSTER.test(row.description)) {
    return { category: "ABANDON", reason: "named noise cluster — near-duplicate extraction from one remark" };
  }
  return {
    category: "ABANDON",
    reason: `no deadline, ${ageDays}d old — reads as passing remark, not a tracked promise`,
  };
}
