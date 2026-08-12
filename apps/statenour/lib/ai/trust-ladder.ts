/**
 * Trust-ladder scoreboard — BDN-102 (2026-08-12, operator green-lit).
 *
 * The graduation MECHANISM has existed since 2026-06-03: the engine
 * tallies operator verdicts per actionType over 45 days and
 * `canAutoExecute` (lib/ai/confidence-tier.ts) already gates unattended
 * execution on those tallies — behind NICK_CONFIDENCE_TIER, default OFF.
 * What never existed is the pit boss's screen: the tallies rendered so
 * flipping the flag becomes an evidence-reading, not a leap.
 *
 * This module is READ-ONLY. It changes nothing about execution; it
 * renders the same 45-day tally the engine computes at fire time
 * (autonomous-engine.ts:1124-1145), plus each type's standing against
 * the auto bar (flag-independent) and under the flag (real gate).
 */

import { prisma } from "@/lib/prisma";
import {
  canAutoExecute,
  meetsAutoBar,
  SAFE_AUTO_ALLOWLIST,
} from "@/lib/ai/confidence-tier";
import { getFlag } from "@/lib/feature-flags";

/** Mirrors the engine's own tally window (45 days). */
const TALLY_WINDOW_DAYS = 45;

export interface TrustLadderRow {
  actionType: string;
  decided: number;
  approved: number;
  rejected: number;
  /** approved / decided, null when decided === 0. */
  acceptanceRate: number | null;
  /** On the hardcoded safe-auto allowlist at all? */
  allowlisted: boolean;
  /** Passes every check EXCEPT the flag (rate + samples + allowlist). */
  meetsBar: boolean;
  /** The real gate, flag included — what would happen tonight. */
  wouldAutoExecute: boolean;
}

export interface TrustLadderView {
  rows: TrustLadderRow[];
  flagOn: boolean;
  windowDays: number;
  computedAt: string;
}

/**
 * PURE and exported for the test: fold the groupBy tally into rows.
 * Types with verdicts appear from the data; allowlisted types with NO
 * verdicts yet still appear (decided 0) so the operator can see the
 * whole ladder, not just the rungs with history.
 */
export function summarizeTrustTallies(
  tally: Array<{ actionType: string; approval: string; count: number }>,
): TrustLadderRow[] {
  const byType = new Map<string, { approved: number; rejected: number }>();
  for (const t of SAFE_AUTO_ALLOWLIST) byType.set(t, { approved: 0, rejected: 0 });
  for (const row of tally) {
    const entry = byType.get(row.actionType) ?? { approved: 0, rejected: 0 };
    if (row.approval === "approved") entry.approved += row.count;
    else if (row.approval === "rejected") entry.rejected += row.count;
    byType.set(row.actionType, entry);
  }
  return [...byType.entries()]
    .map(([actionType, { approved, rejected }]) => {
      const decided = approved + rejected;
      const rate = decided > 0 ? approved / decided : null;
      return {
        actionType,
        decided,
        approved,
        rejected,
        acceptanceRate: rate,
        allowlisted: (SAFE_AUTO_ALLOWLIST as readonly string[]).includes(actionType),
        meetsBar: meetsAutoBar(actionType, rate ?? undefined, decided),
        wouldAutoExecute: canAutoExecute(actionType, rate ?? undefined, decided),
      };
    })
    .sort((a, b) => b.decided - a.decided || a.actionType.localeCompare(b.actionType));
}

/**
 * Verdicts written by machinery, not by the operator. The 2026-08-12
 * queue cleanup flipped 424 rows to rejected/auto-purge; counting those
 * as operator rejections made EVERY type read 0% acceptance on the first
 * live probe — a scoreboard telling the operator he rejected work he
 * never saw. Excluded here.
 *
 * Deliberately NOT changed in the engine's own tally
 * (autonomous-engine.ts): there the same pollution DEPRESSES acceptance,
 * which only makes auto-execution harder — fail-safe. Loosening a live
 * safety gate is an operator decision, not a scoreboard side effect.
 */
const MACHINE_APPROVERS = ["auto-purge"];

export async function buildTrustLadder(): Promise<TrustLadderView> {
  const since = new Date(Date.now() - TALLY_WINDOW_DAYS * 86_400_000);
  const tally = await prisma.autonomousAction.groupBy({
    by: ["actionType", "approval"],
    where: {
      approval: { in: ["approved", "rejected"] },
      createdAt: { gte: since },
      OR: [{ approvedBy: null }, { approvedBy: { notIn: MACHINE_APPROVERS } }],
    },
    _count: { id: true },
  });
  return {
    rows: summarizeTrustTallies(
      tally.map((t) => ({
        actionType: t.actionType,
        approval: t.approval,
        count: t._count.id,
      })),
    ),
    flagOn: getFlag("NICK_CONFIDENCE_TIER")?.isOn === true,
    windowDays: TALLY_WINDOW_DAYS,
    computedAt: new Date().toISOString(),
  };
}
