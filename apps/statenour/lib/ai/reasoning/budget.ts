/**
 * lib/ai/reasoning/budget.ts · Phase H.3 (2026-05-18 PM)
 *
 * Daily spend cap for the Nick Reasoning Engine.
 *
 * Pre-H.3 the engine had no rate limit + no budget. Operator could
 * accidentally trigger 10 mega runs in 60s and burn $2-4 with zero
 * brakes. This module reads back the persisted reasoning_trace rows
 * (Phase H.2.2 wrote them, this module is the first reader) and
 * computes today's total spend per operator. Returns a verdict the
 * endpoint enforces before kicking off a run.
 *
 * Caps:
 *   · DEFAULT_DAILY_CAP_USD = $1.00 per day per operator (single-
 *     operator OS so "operator" is effectively a constant)
 *   · MEGA_PER_RUN_CAP_USD = $0.25 · single mega run can't claim
 *     more than this even if the daily cap has headroom
 *
 * Failure mode: if the reader fails for any reason, we DEFAULT TO
 * ALLOWING the run. Better to risk one extra run than to silently
 * block legitimate work because of a Prisma error.
 *
 * Used by · /api/nick/reason · /api/nick/reason/stream.
 */

import { prisma } from "@/lib/prisma";
import type { ReasoningTier } from "./types";
import { TIER_CONFIG } from "./tier-config";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

export const DEFAULT_DAILY_CAP_USD = 1.0;
export const MEGA_PER_RUN_CAP_USD = 0.25;

/** H.6.2 · TTL for stale in-flight reservations. Anything older than
 *  this is assumed to be from a crashed engine run and gets cleaned
 *  up on the next budget check. Long enough to outlast the slowest
 *  mega run (120s upper bound) plus generous slack. */
export const RESERVATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface BudgetVerdict {
  /** Whether to allow the run */
  allow: boolean;
  /** Today's spend in USD before this run · 0 if unknown */
  spentTodayUsd: number;
  /** H.6.2 · in-flight reservation total · sum of estimated cost
   *  for runs currently executing. Included in the cap check to
   *  close the TOCTOU gap. */
  inFlightUsd: number;
  /** Configured cap */
  capUsd: number;
  /** Estimated cost of THIS run (pre-execution guess) */
  estimatedRunUsd: number;
  /** Human-readable reason · used by the UI when allow=false */
  reason: string;
}

export interface Reservation {
  /** BrainMemory key for the reservation row · pass to releaseReservation
   *  after the run completes. */
  id: string;
  /** Estimated cost reserved · refunded if release is called. */
  estimatedRunUsd: number;
}

/** Pre-run cost estimate per tier. Conservative · over-estimates so
 *  the cap is hit before we actually exceed it. */
/** O.1 · reads from TIER_CONFIG single source of truth · adding a new
 *  tier without updating tier-config.ts is now a compile error. */
function estimateTierCost(tier: ReasoningTier): number {
  return TIER_CONFIG[tier].budgetEstimateUsd;
}

/** Sum today's spend by reading back BrainMemory(category="reasoning_trace")
 *  rows created since midnight ET. Each row carries metadata.usd from
 *  Phase H.2.2 persistence. */
/** Sentinel returned by getTodaySpendUsd on read failure. H.7.2 fail-
 *  closed semantics · checkBudget treats this as "cap exceeded" so
 *  the operator gets a clean 402 instead of a wide-open gate. */
export const BUDGET_READ_FAILED = Symbol("BUDGET_READ_FAILED");

async function getTodaySpendUsd(): Promise<number | typeof BUDGET_READ_FAILED> {
  try {
    // ET midnight · matches the operator's local-day rhythm
    const startOfDayEt = new Date();
    const etDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(startOfDayEt);
    const startGte = new Date(`${etDateStr}T00:00:00-05:00`);

    const rows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.REASONING_TRACE,
        createdAt: { gte: startGte },
        deletedAt: null,
      },
      select: { metadata: true },
      take: 500,
    });
    let total = 0;
    for (const r of rows) {
      const m = (r.metadata ?? null) as { usd?: number } | null;
      const usd = typeof m?.usd === "number" ? m.usd : 0;
      if (Number.isFinite(usd)) total += usd;
    }
    return Math.round(total * 1000) / 1000;
  } catch (err) {
    // H.7.2 · fail CLOSED · pre-fix we returned 0 (open the gate) which
    // meant a Prisma outage = unlimited spend. Now we return a sentinel
    // and checkBudget rejects. Operator can override with explicit
    // /force=true if they know Prisma is the issue · NOT in this wave.
    logError("ai.reasoning-budget", err, { fn: "getTodaySpendUsd" });
    return BUDGET_READ_FAILED;
  }
}

/** H.6.2 · sum currently-in-flight reservations. Adds to spent-today
 *  for the budget check so two concurrent requests can't both pass
 *  the cap by reading the same pre-write spend. Stale reservations
 *  (engine crashed) are pruned by maxAge filter and the next call to
 *  pruneStaleReservations. */
async function getInFlightUsd(): Promise<number | typeof BUDGET_READ_FAILED> {
  try {
    const cutoff = new Date(Date.now() - RESERVATION_TTL_MS);
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.REASONING_IN_FLIGHT,
        createdAt: { gte: cutoff },
        deletedAt: null,
      },
      select: { metadata: true },
      take: 100,
    });
    let total = 0;
    for (const r of rows) {
      const m = (r.metadata ?? null) as { usd?: number } | null;
      const usd = typeof m?.usd === "number" ? m.usd : 0;
      if (Number.isFinite(usd)) total += usd;
    }
    return Math.round(total * 1000) / 1000;
  } catch (err) {
    // H.7.2 · fail CLOSED · same pattern as getTodaySpendUsd
    logError("ai.reasoning-budget", err, { fn: "getInFlightUsd" });
    return BUDGET_READ_FAILED;
  }
}

/** H.6.2 · reserve budget headroom for a run that's about to start.
 *  Writes a BrainMemory(category="reasoning_in_flight") row. Caller
 *  MUST call releaseReservation in a finally block, otherwise the
 *  reservation persists until RESERVATION_TTL_MS expires. */
export async function reserveBudget(
  tier: ReasoningTier,
  estimatedRunUsd: number,
): Promise<Reservation | null> {
  try {
    // H.7.7 · crypto.randomUUID for stronger uniqueness
    const id = `inflight_${tier}_${Date.now()}_${crypto.randomUUID().slice(0, 10)}`;
    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.REASONING_IN_FLIGHT,
        key: id,
        content: `reserved $${estimatedRunUsd.toFixed(3)} for ${tier} tier`,
        confidence: 0.5,
        source: "reasoning-engine",
        createdBy: "system",
        metadata: {
          usd: estimatedRunUsd,
          tier,
          reservedAt: Date.now(),
        },
      },
    });
    return { id, estimatedRunUsd };
  } catch (err) {
    // Best-effort · if reservation write fails, fall back to no-reservation
    // (caller still proceeds · TOCTOU window is the cost of resilience).
    logError("ai.reasoning-budget", err, { fn: "reserveBudget", tier, estimatedRunUsd });
    return null;
  }
}

/** H.6.2 · release a reservation after the run completes. Called from
 *  a finally block so it always runs, even on engine error. */
export async function releaseReservation(reservation: Reservation | null): Promise<void> {
  if (!reservation) return;
  try {
    await prisma.brainMemory.deleteMany({
      where: { category: BRAIN_CATEGORIES.REASONING_IN_FLIGHT, key: reservation.id },
    });
  } catch (err) {
    // Best-effort · stale reservation will TTL out after RESERVATION_TTL_MS
    logError("ai.reasoning-budget", err, { fn: "releaseReservation", reservation: reservation.id });
  }
}

/** H.6.2 · prune reservation rows older than the TTL. Opportunistic
 *  · called from the budget check at ~10% sampling so the table stays
 *  bounded even if a bunch of engine runs crash. */
async function pruneStaleReservations(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RESERVATION_TTL_MS);
    await prisma.brainMemory.deleteMany({
      where: {
        category: BRAIN_CATEGORIES.REASONING_IN_FLIGHT,
        createdAt: { lt: cutoff },
      },
    });
  } catch (err) {
    // best-effort
    logError("ai.reasoning-budget", err, { fn: "pruneStaleReservations" });
  }
}

export async function checkBudget(
  tier: ReasoningTier,
  options?: { capUsd?: number },
): Promise<BudgetVerdict> {
  const capUsd = options?.capUsd ?? DEFAULT_DAILY_CAP_USD;
  // H.6.2 · opportunistic prune of stale reservations · runs roughly
  // every 10th check so the in-flight set never accumulates indefinitely.
  if (Math.random() < 0.1) void pruneStaleReservations();
  const [spentRaw, inFlightRaw] = await Promise.all([
    getTodaySpendUsd(),
    getInFlightUsd(),
  ]);
  // H.7.2 · if EITHER read failed we fail closed · the cap can't be
  // safely enforced without knowing current spend. Return a 402 so
  // the operator sees the failure mode instead of a wide-open gate.
  if (spentRaw === BUDGET_READ_FAILED || inFlightRaw === BUDGET_READ_FAILED) {
    return {
      allow: false,
      spentTodayUsd: 0,
      inFlightUsd: 0,
      capUsd,
      estimatedRunUsd: estimateTierCost(tier),
      reason:
        "Budget store unavailable (Prisma error). Failing closed to protect spend · retry once it's back.",
    };
  }
  const spentTodayUsd = spentRaw;
  const inFlightUsd = inFlightRaw;
  const estimatedRunUsd = estimateTierCost(tier);
  // H.6.2 · TOCTOU close · the cap check now includes already-reserved
  // headroom from runs still executing. Pre-fix, two concurrent
  // requests both read the same spend-today and both passed the gate.
  // Now each request adds its reservation BEFORE the next request
  // reads, so the second request sees the first request's reserved
  // headroom too.
  const effectiveSpend = spentTodayUsd + inFlightUsd;

  // Mega per-run hard cap · even if daily cap has room, one mega run
  // can't claim more than MEGA_PER_RUN_CAP_USD. Protects against the
  // estimate being wildly low for a particular run.
  if (tier === "mega" && estimatedRunUsd > MEGA_PER_RUN_CAP_USD) {
    return {
      allow: false,
      spentTodayUsd,
      inFlightUsd,
      capUsd,
      estimatedRunUsd,
      reason: `Mega tier estimated at $${estimatedRunUsd.toFixed(2)} exceeds per-run cap $${MEGA_PER_RUN_CAP_USD.toFixed(2)}.`,
    };
  }

  // Daily cap · includes both completed and in-flight
  if (effectiveSpend + estimatedRunUsd > capUsd) {
    return {
      allow: false,
      spentTodayUsd,
      inFlightUsd,
      capUsd,
      estimatedRunUsd,
      reason: `Daily reasoning cap would be exceeded · $${spentTodayUsd.toFixed(3)} spent + $${inFlightUsd.toFixed(3)} in-flight + $${estimatedRunUsd.toFixed(3)} estimate > $${capUsd.toFixed(2)} cap.`,
    };
  }

  return {
    allow: true,
    spentTodayUsd,
    inFlightUsd,
    capUsd,
    estimatedRunUsd,
    reason: `Within budget · $${spentTodayUsd.toFixed(3)} spent + $${inFlightUsd.toFixed(3)} in-flight + $${estimatedRunUsd.toFixed(3)} estimate ≤ $${capUsd.toFixed(2)} cap.`,
  };
}

export const __internals = {
  estimateTierCost,
  getTodaySpendUsd,
  getInFlightUsd,
  pruneStaleReservations,
};
