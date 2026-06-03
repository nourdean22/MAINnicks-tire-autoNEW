/**
 * propose-actions-history · Outcome Learning · 2026-06-03.
 *
 * Flag-gated rerank pass for the Nick action proposer. Reads each
 * actionType's recent accepted-vs-rejected rate from AutonomousAction
 * history and gently reorders the candidate list so chronically-
 * rejected proposal types sink and consistently-accepted ones rise.
 *
 * RANKING-ONLY. This never changes WHAT executes (the executor still
 * dispatches on `actionType` unchanged) and never auto-executes — it
 * only adjusts the ORDER/inclusion of pending proposals the operator
 * sees in Telegram. The static P0>P1>P2 priority remains the primary
 * sort key; the acceptance multiplier is a deterministic tiebreaker
 * within a priority band, so a P0 never sinks below a P1.
 *
 * Self-gates on `NICK_OUTCOME_LEARNING`. OFF (default) ⇒ candidates
 * returned UNCHANGED (multiplier 1.0 for every type). Fully graceful:
 * any query/throw falls back to the unchanged list.
 *
 * Minimum-sample floor · a brand-new rule with little history MUST NOT
 * be penalised. Types below MIN_SAMPLES decided actions get a flat
 * 1.0 multiplier (neutral). Only types with a real, decided track
 * record move. This keeps the system from punishing exploration.
 *
 * Per kaizen + karpathy · the simplest deterministic thing that turns
 * fixed rules into learned preferences. No new tables, no AI call.
 */

import { prisma } from "@/lib/prisma";
import { getFlag } from "@/lib/feature-flags";
import type { NickActionDraft, NickActionPriority } from "@/lib/ai/propose-actions";

/** Look-back window for the accepted/rejected tally. */
const LOOKBACK_DAYS = 45;
const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Minimum number of DECIDED actions (approved + rejected) a type needs
 * before its acceptance rate is allowed to move its ranking. Below
 * this, the type is treated as neutral (1.0) — never penalise a
 * rule that hasn't earned a verdict yet.
 */
const MIN_SAMPLES = 4;

/** Multiplier bounds · a gentle ±30% nudge, never a hard drop. */
const MIN_MULTIPLIER = 0.7;
const MAX_MULTIPLIER = 1.3;

/** Static priority order · mirrors propose-actions.ts (P0 first). */
const PRIORITY_ORDER: Record<NickActionPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

/**
 * Per-actionType acceptance multiplier in [0.7, 1.3]. Types with
 * insufficient history (or when the flag is off) map to 1.0.
 */
export type AcceptanceMultipliers = Map<string, number>;

/**
 * Build the per-actionType acceptance multiplier map from the last
 * ~45 days of decided AutonomousAction rows.
 *
 * Acceptance rate = approved / (approved + rejected). Pending/auto/
 * other states are ignored — only the operator's explicit verdicts
 * count. The rate (0..1) is mapped linearly onto [0.7, 1.3] so a
 * 100%-accepted type rises 30% and a 100%-rejected type sinks 30%.
 *
 * Returns an empty map (⇒ all-neutral) when the flag is off or on any
 * error. Never throws.
 */
export async function getAcceptanceMultipliers(): Promise<AcceptanceMultipliers> {
  const empty: AcceptanceMultipliers = new Map();

  // Self-gate · OFF ⇒ neutral, identical to today's behaviour.
  if (!getFlag("NICK_OUTCOME_LEARNING")?.isOn) return empty;

  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS);
    const rows = await prisma.autonomousAction.groupBy({
      by: ["actionType", "approval"],
      where: {
        createdAt: { gte: since },
        approval: { in: ["approved", "rejected"] },
      },
      _count: { id: true },
    });

    // Tally approved/rejected per actionType.
    const tally = new Map<string, { approved: number; rejected: number }>();
    for (const r of rows) {
      const t = tally.get(r.actionType) ?? { approved: 0, rejected: 0 };
      if (r.approval === "approved") t.approved += r._count.id;
      else if (r.approval === "rejected") t.rejected += r._count.id;
      tally.set(r.actionType, t);
    }

    const multipliers: AcceptanceMultipliers = new Map();
    for (const [actionType, { approved, rejected }] of tally) {
      const decided = approved + rejected;
      // Minimum-sample floor · neutral until the type has a verdict
      // track record (protects brand-new rules from being penalised).
      if (decided < MIN_SAMPLES) continue; // absent ⇒ caller reads 1.0
      const rate = approved / decided; // 0..1
      // Linear map: rate 0 → 0.7, rate 0.5 → 1.0, rate 1 → 1.3.
      const multiplier =
        MIN_MULTIPLIER + rate * (MAX_MULTIPLIER - MIN_MULTIPLIER);
      multipliers.set(actionType, multiplier);
    }

    return multipliers;
  } catch {
    // Graceful · history is a nice-to-have, never a blocker.
    return empty;
  }
}

/**
 * Rerank a candidate list by acceptance history. RANKING-ONLY · the
 * returned array is a reordering of the SAME drafts (no adds, no
 * drops, no field edits).
 *
 * Ordering · primary key is the static priority band (P0>P1>P2) so the
 * learned signal can never float a hygiene proposal above an urgent
 * one. Within a band, candidates are ordered by their type's
 * acceptance multiplier (higher = accepted-more = rises). Ties fall
 * back to the input order, preserving today's deterministic morning
 * ordering.
 *
 * When the flag is off (or history is empty / errors) every multiplier
 * is 1.0, so within-band order is unchanged ⇒ output === input order.
 */
export async function scoreByAcceptanceHistory(
  candidates: NickActionDraft[],
): Promise<NickActionDraft[]> {
  if (candidates.length === 0) return candidates;

  const multipliers = await getAcceptanceMultipliers();
  if (multipliers.size === 0) return candidates; // neutral ⇒ unchanged

  // Stable sort: decorate with input index so equal keys keep order.
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.c.priority];
      const pb = PRIORITY_ORDER[b.c.priority];
      if (pa !== pb) return pa - pb; // priority band wins, always
      const ma = multipliers.get(a.c.actionType) ?? 1.0;
      const mb = multipliers.get(b.c.actionType) ?? 1.0;
      if (mb !== ma) return mb - ma; // higher acceptance rises
      return a.i - b.i; // stable: preserve input order
    })
    .map((x) => x.c);
}
