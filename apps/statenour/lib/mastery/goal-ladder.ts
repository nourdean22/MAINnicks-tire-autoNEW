/**
 * goal-ladder · Ambition Engine P3 · "Compounding Ladder" (2026-05-31)
 *
 * The pure logic behind LifeGoal.parentGoalId (the GoalLadder self-relation
 * shipped dormant in the P1 migration). A goal ladders into a higher-horizon
 * goal — LIFE -> YEAR -> QUARTER -> MONTH -> WEEK -> DAY -> rep — and a parent
 * rolls up its children's progress.
 *
 * Kept side-effect-free (maps in, verdicts out) so it's unit-tested in
 * isolation — same pattern as goal-drift-classify.ts / goal-stats.ts. The
 * service (lib/services/goals.ts) owns the DB reads (existence, soft-delete)
 * and feeds these functions the id->horizon and id->parent maps.
 */

/** Horizon ordering, low (short) to high (long). Used to reject inverted links. */
export const HORIZON_RANK: Record<string, number> = {
  DAY: 0,
  WEEK: 1,
  MONTH: 2,
  QUARTER: 3,
  YEAR: 4,
  LIFE: 5,
};

export type LadderRejectReason = "self" | "cycle" | "horizon";
export type LadderLinkResult = { ok: true } | { ok: false; reason: LadderRejectReason };

/**
 * Walk the parent chain upward from `startParentId`, returning the ancestor
 * ids in order. Guards against pre-existing cycles in the data (a corrupt
 * loop won't hang the walk).
 */
export function ancestorChain(
  startParentId: string | null | undefined,
  parentOf: ReadonlyMap<string, string | null>,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur = startParentId ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return chain;
}

/**
 * Validate a proposed `goal.parentGoalId = parentGoalId` link.
 *
 * Rules (in order):
 *  - null parent (unlink) is always allowed.
 *  - a goal cannot be its own parent ("self").
 *  - the link must not create a cycle — walking up from the proposed parent
 *    must never reach the goal itself ("cycle").
 *  - the parent must be at least as high-horizon as the child, when both
 *    horizons are known: a YEAR goal can't ladder INTO a WEEK goal ("horizon").
 *    Unknown horizons skip this check (lenient — legacy goals have null horizon).
 */
export function validateParentLink(args: {
  goalId: string;
  parentGoalId: string | null;
  horizonOf: ReadonlyMap<string, string | null>;
  parentOf: ReadonlyMap<string, string | null>;
}): LadderLinkResult {
  const { goalId, parentGoalId, horizonOf, parentOf } = args;

  if (parentGoalId === null) return { ok: true };
  if (parentGoalId === goalId) return { ok: false, reason: "self" };

  if (ancestorChain(parentGoalId, parentOf).includes(goalId)) {
    return { ok: false, reason: "cycle" };
  }

  const childHorizon = horizonOf.get(goalId);
  const parentHorizon = horizonOf.get(parentGoalId);
  const cr = childHorizon ? HORIZON_RANK[childHorizon] : undefined;
  const pr = parentHorizon ? HORIZON_RANK[parentHorizon] : undefined;
  if (cr !== undefined && pr !== undefined && pr < cr) {
    return { ok: false, reason: "horizon" };
  }

  return { ok: true };
}

export interface LadderChild {
  progress: number;
  status: string;
}

export interface LadderRollup {
  childCount: number;
  doneCount: number;
  avgChildProgress: number;
}

const DONE_STATUSES = new Set(["achieved", "completed"]);

/**
 * Roll a parent goal's children up into a compact summary for the card:
 * "3 sub-goals · 2 done · 64% avg". Empty children -> all zeros.
 */
export function rollUpChildren(children: readonly LadderChild[]): LadderRollup {
  const childCount = children.length;
  if (childCount === 0) return { childCount: 0, doneCount: 0, avgChildProgress: 0 };
  const doneCount = children.filter((c) => DONE_STATUSES.has(c.status)).length;
  const avgChildProgress = Math.round(
    children.reduce((sum, c) => sum + (Number.isFinite(c.progress) ? c.progress : 0), 0) /
      childCount,
  );
  return { childCount, doneCount, avgChildProgress };
}
