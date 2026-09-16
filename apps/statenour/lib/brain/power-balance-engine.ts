/**
 * 2026-05-27 · Power Atlas Phase 3 · Power-balance auto-compute engine.
 *
 * Derives a per-person `powerBalance` ∈ [-1, +1] from three signals:
 *   1. Reciprocity asymmetry (90d) · operator-init ≥50% leans negative
 *      (operator pursues · person has leverage).
 *   2. Role-based prior · mentors / bosses default negative · mentees /
 *      employees / customers default positive.
 *   3. Recent ledger trend (last 10 entries) · positive sum (operator
 *      giving) leans negative · negative sum (operator withdrawing
 *      energy) leans positive.
 *
 * OPERATOR-MANDATED SAFETY · respects PersonProfile.powerBalanceManualLock.
 * When the operator has dragged the gauge slider, updatePowerBalance sets
 * the lock=true. This engine MUST check it and return null in that case ·
 * the cron caller MUST skip the write so the operator's value is sticky.
 *
 * Pure read · no DB writes. The reciprocity-tracker-update cron is the
 * sole writer · this module just computes the value.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";

/**
 * Compute the auto-derived power balance for a person, RESPECTING the
 * manual-lock. Returns null in two cases:
 *   1. Profile does not exist.
 *   2. powerBalanceManualLock === true (operator's slider value is
 *      sticky · auto-compute is disabled for this profile).
 *
 * Otherwise returns a value in [-1, +1] clamped at the boundaries.
 */
export async function computePowerBalance(
  personId: string,
): Promise<number | null> {
  const person = await prisma.personProfile.findUnique({
    where: { id: personId },
    select: {
      role: true,
      metadata: true,
      powerBalanceManualLock: true,
    },
  });
  if (!person) return null;

  // ── OPERATOR-MANDATED SAFETY · honor the manual-lock ────────────────
  if (person.powerBalanceManualLock) return null;

  const metadata = person.metadata as {
    reciprocity?: { operatorInitiatedPct?: number };
  } | null;
  const reciprocity = metadata?.reciprocity?.operatorInitiatedPct ?? null;

  // Heuristic · positive = operator has leverage · negative = they do
  let balance = 0;

  // 1. Reciprocity · operator-init 100% → -1 (operator chases) ·
  //    operator-init 50% → 0 (balanced) · operator-init 0% → +1
  if (reciprocity !== null) {
    balance += (50 - reciprocity) / 50;
  }

  // 2. Role-based prior
  const rolePrior: Record<string, number> = {
    employee: 0.5,
    mentor: -0.4,
    mentee: 0.4,
    boss: -0.6,
    customer: 0.3,
    vendor: 0.2,
    family: 0.0,
    friend: 0.0,
    close_friend: 0.0,
    acquaintance: 0.0,
    network_only: 0.0,
    advisor: -0.2,
    romantic: 0.0,
    rival: -0.1,
    enemy: -0.3,
  };
  balance += rolePrior[person.role] ?? 0;

  // 3. Recent ledger trend · positive ledger = operator giving = -balance
  // CONTACT rows only (W8): a status flip's −50 would dominate this sum.
  const recentLedger = contactRowsOnly(
    await prisma.relationshipLedger.findMany({
      where: { personId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { amount: true, metadata: true },
    }),
  ).slice(0, 10);
  const recentSum = recentLedger.reduce((s, r) => s + r.amount, 0);
  balance += -Math.tanh(recentSum / 50) * 0.3;

  return Math.max(-1, Math.min(1, balance));
}
