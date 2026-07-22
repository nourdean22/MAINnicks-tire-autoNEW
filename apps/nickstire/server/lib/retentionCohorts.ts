/**
 * Repeat-customer RETENTION cohorts — the missing top-line lens.
 *
 * nickstire already has the acquisition funnel (conversion.leadFunnel),
 * revenueReconciliation (arrival -> paid) and a narrow "lapsed VIP" insight.
 * What it lacked was the fundamental retention picture the shop's own numbers
 * scream about: of customers who actually visited, how many were one-and-done
 * vs repeat, and how many are winnable-back right now. That is this file.
 *
 * READ-ONLY. Computes over the maintained denormalized customer aggregates
 * (totalVisits / totalSpent / lastVisitDate, kept current by reportIngestion) —
 * no invoice group-by, no writes, and NOTHING on the SMS send path.
 */

/** Lapsed at least this long counts as "gone" (not just between routine visits). */
export const REACTIVATION_MIN_DAYS = 180; // ~6 months
/** ...but still within reach — beyond this the win-back economics fade. */
export const REACTIVATION_MAX_DAYS = 730; // ~2 years
/** Below this many visited customers the percentages are statistical noise. */
export const MIN_COHORT_SAMPLE = 20;

export interface CustomerStatRow {
  totalVisits: number;
  totalSpent: number; // cents
  lastVisitDate: Date | null;
}

export interface RetentionCohortSummary {
  /** Every customer row, including imports that never actually visited. */
  totalCustomers: number;
  /** Customers with >= 1 visit — the retention denominator. */
  customersWithVisits: number;
  /** Exactly one visit and never returned. */
  oneAndDone: { count: number; pct: number };
  /** Two or more visits. */
  repeat: { count: number; pct: number };
  /** Mean visits across customers who visited (2 dp). */
  avgVisitsPerCustomer: number;
  /** Lifetime spend (cents) attributable to repeat customers. */
  repeatLifetimeValueCents: number;
  /** Visited, but lapsed within the winnable window — the reactivation target. */
  reactivationEligible: { count: number; lifetimeValueCents: number };
}

/**
 * PURE. Classify customer aggregate rows into retention cohorts as of `now`.
 * Deterministic (inject `now` in tests). Never divides by zero.
 */
export function computeRetentionCohorts(
  rows: CustomerStatRow[],
  now: Date = new Date(),
): RetentionCohortSummary {
  const nowMs = now.getTime();
  let withVisits = 0;
  let oneAndDone = 0;
  let repeat = 0;
  let visitSum = 0;
  let repeatValueCents = 0;
  let reactCount = 0;
  let reactValueCents = 0;

  for (const r of rows) {
    const visits = r.totalVisits ?? 0;
    if (visits < 1) continue; // never-visited imports are not a retention data point
    withVisits++;
    visitSum += visits;
    if (visits === 1) {
      oneAndDone++;
    } else {
      repeat++;
      repeatValueCents += r.totalSpent ?? 0;
    }
    if (r.lastVisitDate) {
      const days = (nowMs - r.lastVisitDate.getTime()) / 86_400_000;
      if (days >= REACTIVATION_MIN_DAYS && days <= REACTIVATION_MAX_DAYS) {
        reactCount++;
        reactValueCents += r.totalSpent ?? 0;
      }
    }
  }

  const pct = (n: number) =>
    withVisits === 0 ? 0 : Math.round((n / withVisits) * 1000) / 10;

  return {
    totalCustomers: rows.length,
    customersWithVisits: withVisits,
    oneAndDone: { count: oneAndDone, pct: pct(oneAndDone) },
    repeat: { count: repeat, pct: pct(repeat) },
    avgVisitsPerCustomer:
      withVisits === 0 ? 0 : Math.round((visitSum / withVisits) * 100) / 100,
    repeatLifetimeValueCents: repeatValueCents,
    reactivationEligible: { count: reactCount, lifetimeValueCents: reactValueCents },
  };
}

/**
 * Fetch the maintained customer aggregates and compute the cohort summary.
 * Read-only. Returns null if the DB is unavailable (best-effort, like the
 * existing dashboard insights).
 */
export async function getRetentionCohortSummary(
  now: Date = new Date(),
): Promise<RetentionCohortSummary | null> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return null;
  const { customers } = await import("../../drizzle/schema");
  const rows = await d
    .select({
      totalVisits: customers.totalVisits,
      totalSpent: customers.totalSpent,
      lastVisitDate: customers.lastVisitDate,
    })
    .from(customers);
  return computeRetentionCohorts(
    rows.map(
      (r: { totalVisits: number | null; totalSpent: number | null; lastVisitDate: Date | null }) => ({
        totalVisits: Number(r.totalVisits ?? 0),
        totalSpent: Number(r.totalSpent ?? 0),
        lastVisitDate: r.lastVisitDate ?? null,
      }),
    ),
    now,
  );
}
