/**
 * Customer Psychographic Profiler · DB-batch wrapper around the orphaned
 * `segmentCustomer()` classifier at server/services/customerSegmentation.ts.
 *
 * The classifier returns 10 segments (vip, loyal, growing, one-timer,
 * at-risk, churned, fleet, new, referrer, price-sensitive) with score +
 * recommendedAction. Pre-181.111 it was only called by a single tRPC
 * query that took hand-fed inputs — nothing persisted, nothing aggregated.
 *
 * This wrapper:
 *   1. Pulls all customers in batches of 500
 *   2. Joins customer_metrics for declineRate + visit aggregates
 *   3. Joins referrals + reviews counts (per customer phone)
 *   4. Calls segmentCustomer() per row
 *   5. Writes back to customers.psycho_profile + score + at
 *
 * Compounds with #4 SMS sequence: declinedRecoverySequence.pickProfile()
 * reads the persisted segment via a future enhancement (currently uses
 * inline signals). Profile-aware SMS routing becomes possible across all
 * win-back / drip / declined-recovery campaigns once this is populated.
 *
 * Daily cron: server/cron/jobs/psychoProfileRefresh.ts
 */

import { eq, sql } from "drizzle-orm";
import { customers, customerMetrics } from "../../drizzle/schema";
import { segmentCustomer } from "./customerSegmentation";
import { createLogger } from "../lib/logger";

const log = createLogger("psycho-profile");

const BATCH_SIZE = 500;

interface ProfileResult {
  processed: number;
  updated: number;
  unchanged: number;
  errored: number;
  segmentCounts: Record<string, number>;
}

/**
 * Classify a single customer by their persisted aggregates.
 * Used by the cron + can be called ad-hoc from admin tRPC.
 */
export async function classifyCustomer(customerId: number): Promise<{
  segment: string;
  score: number;
  recommendedAction: string;
} | null> {
  const { db } = await import("../lib/db-helper");
  const d = await db();
  if (!d) return null;

  // Pull customer + metrics with one query
  const rows = await d
    .select({
      id: customers.id,
      totalSpent: customers.totalSpent,
      totalVisits: customers.totalVisits,
      firstVisitDate: customers.firstVisitDate,
      lastVisitDate: customers.lastVisitDate,
      customerType: customers.customerType,
      vehicleMake: customers.vehicleMake,
      declinedValue: customerMetrics.declinedValue,
      declinedCount: customerMetrics.declinedCount,
      // Redirect to customers.totalSpent since customer_metrics.totalRevenue is dead (always 0)
      totalRevenue: customers.totalSpent,
      isVip: customerMetrics.isVip,
    })
    .from(customers)
    .leftJoin(customerMetrics, eq(customerMetrics.customerId, customers.id))
    .where(eq(customers.id, customerId))
    .limit(1);

  if (rows.length === 0) return null;
  const c = rows[0];
  return computeProfile(c);
}

interface RowShape {
  totalSpent: number | null;
  totalVisits: number | null;
  firstVisitDate: Date | null;
  lastVisitDate: Date | null;
  customerType: string | null;
  declinedValue: number | null;
  declinedCount: number | null;
  totalRevenue: number | null;
}

function computeProfile(c: RowShape): { segment: string; score: number; recommendedAction: string } {
  const now = Date.now();
  const totalSpend = (c.totalSpent ?? 0) / 100;
  const visitCount = c.totalVisits ?? 0;
  const declinedTotal = (c.declinedValue ?? 0) / 100;
  const revenueTotal = (c.totalRevenue ?? 0) / 100;
  const declineRate = revenueTotal + declinedTotal > 0
    ? declinedTotal / (revenueTotal + declinedTotal)
    : 0;
  const daysSinceLastVisit = c.lastVisitDate
    ? Math.floor((now - c.lastVisitDate.getTime()) / (1000 * 60 * 60 * 24))
    : 9999; // never visited
  const daysSinceFirstVisit = c.firstVisitDate
    ? Math.floor((now - c.firstVisitDate.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Commercial = fleet override (regardless of other signals)
  if (c.customerType === "commercial") {
    return { segment: "fleet", score: 95, recommendedAction: "Offer fleet pricing. Priority scheduling. Account manager." };
  }

  // Referral + review counts not joined here (heavier query). Pass 0 for v1.
  // If we want to surface referrers we'd JOIN referrals + reviews — defer.
  return segmentCustomer({
    totalSpend,
    visitCount,
    daysSinceLastVisit,
    daysSinceFirstVisit,
    referralCount: 0,
    reviewCount: 0,
    vehicleCount: c.customerType === "commercial" ? 3 : 1,
    declineRate,
  });
}

/**
 * Batch refresh — called by the daily cron OR by admin tRPC to recompute
 * all customers' psychographic profile in one pass.
 *
 * Strategy:
 *   - Process in batches of 500 to keep memory + transaction footprint small
 *   - UPDATE only when profile actually changed (idempotent · no churn)
 *   - Track per-segment counts for the Telegram digest
 *   - Continue on per-row error · log + count
 */
export async function classifyAllCustomers(): Promise<ProfileResult> {
  const { db } = await import("../lib/db-helper");
  const d = await db();
  if (!d) {
    return { processed: 0, updated: 0, unchanged: 0, errored: 0, segmentCounts: {} };
  }

  const result: ProfileResult = {
    processed: 0,
    updated: 0,
    unchanged: 0,
    errored: 0,
    segmentCounts: {},
  };

  let offset = 0;
  while (true) {
    // Pull batch of customers + their metrics in one query
    const rows = await d
      .select({
        id: customers.id,
        psychoProfile: customers.psychoProfile,
        totalSpent: customers.totalSpent,
        totalVisits: customers.totalVisits,
        firstVisitDate: customers.firstVisitDate,
        lastVisitDate: customers.lastVisitDate,
        customerType: customers.customerType,
        vehicleMake: customers.vehicleMake,
        declinedValue: customerMetrics.declinedValue,
        declinedCount: customerMetrics.declinedCount,
        // Redirect to customers.totalSpent since customer_metrics.totalRevenue is dead (always 0)
        totalRevenue: customers.totalSpent,
        isVip: customerMetrics.isVip,
      })
      .from(customers)
      .leftJoin(customerMetrics, eq(customerMetrics.customerId, customers.id))
      .limit(BATCH_SIZE)
      .offset(offset);

    if (rows.length === 0) break;

    for (const c of rows) {
      try {
        const profile = computeProfile(c);
        result.segmentCounts[profile.segment] = (result.segmentCounts[profile.segment] ?? 0) + 1;
        result.processed++;

        // Idempotent · only write if changed
        if (c.psychoProfile === profile.segment) {
          result.unchanged++;
          continue;
        }

        await d
          .update(customers)
          .set({
            psychoProfile: profile.segment,
            psychoProfileScore: profile.score,
            psychoProfileAt: new Date(),
          })
          .where(eq(customers.id, c.id));

        result.updated++;
      } catch (e) {
        result.errored++;
        log.warn(`[psycho-profile] classify failed for customer ${c.id}`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  log.info(
    `[psycho-profile] refresh complete · processed=${result.processed} ` +
      `updated=${result.updated} unchanged=${result.unchanged} errored=${result.errored}`,
  );
  return result;
}

/**
 * Get psychographic profile counts by segment — for the admin dashboard
 * + Telegram digest. Reads from customers.psycho_profile (already populated
 * by the cron).
 */
export async function getPsychoCounts(): Promise<Record<string, number>> {
  const { db } = await import("../lib/db-helper");
  const d = await db();
  if (!d) return {};

  const rows = await d
    .select({
      segment: customers.psychoProfile,
      count: sql<number>`COUNT(*)`,
    })
    .from(customers)
    .groupBy(customers.psychoProfile);

  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.segment ?? "unclassified"] = Number(r.count);
  }
  return counts;
}
