/**
 * Admin Dashboard Bundle Service
 *
 * Closes admin audit §1: OverviewSection.tsx had 17 polling useQuery calls
 * fanning out to 17 distinct backend procedures every 30 seconds. Each
 * procedure ran one or more DB queries. With one open admin tab, the
 * client generated ~50K backend hits/day from the dashboard alone.
 *
 * This module bundles the 5 most-active medium-frequency queries
 * (every 30s) into ONE call. Promise.allSettled ensures one slow/failing
 * subquery doesn't break the whole dashboard — each field is null on
 * failure, components render with what's available.
 *
 * Tier strategy:
 *   - FAST   (15s): shopPulse + campaignStats — kept separate, time-critical
 *   - MEDIUM (30s): stats + bookings + leads + callbacks + workOrders
 *                   - bundled here, this file
 *   - SLOW   (120s+): siteHealth, custIntel, revIntel, masterReport
 *                     - kept separate, low cost, varied cadence
 *
 * Bundling MEDIUM cuts dashboard polling from ~17 calls/30s to ~13 calls/30s
 * AND eliminates 4 round-trip serialization costs (each bundled query
 * shares one HTTP/JSON envelope).
 */

import { desc } from "drizzle-orm";
import { getDashboardStats, getSiteHealth } from "../admin-stats";
import { getBookings, getCallbackRequests } from "../db";
import { leads as leadsTable } from "../../drizzle/schema";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("services:adminBundle");

/** Map a settled promise to value-or-null so one failure doesn't break the bundle. */
function settled<T>(p: PromiseSettledResult<T>): T | null {
  if (p.status === "fulfilled") return p.value;
  log.warn(`[adminBundle] subquery rejected: ${p.reason instanceof Error ? p.reason.message : String(p.reason)}`);
  return null;
}

/**
 * Fetch leads list using the same shape as the lead.list tRPC procedure.
 * Inlined here so adminBundle doesn't depend on the lead router (which
 * would cause a circular import via the appRouter).
 */
async function listLeads() {
  const d = await db();
  if (!d) return [];
  return d.select().from(leadsTable).orderBy(desc(leadsTable.createdAt)).limit(1000);
}

/**
 * Medium-tier overview bundle — 30s refetch cadence on the client.
 * Returns 5 fields, each independently nullable on failure.
 *
 * Replaces these 5 useQuery calls in OverviewSection:
 *   - trpc.adminDashboard.stats
 *   - trpc.booking.list
 *   - trpc.lead.list
 *   - trpc.callback.list
 *   - trpc.adminDashboard.siteHealth   (was 120s, brought into the bundle
 *                                        because it's cheap and useful to
 *                                        refresh alongside the rest)
 */
export async function getOverviewMediumBundle() {
  const [stats, bookings, leads, callbacks, health] = await Promise.allSettled([
    getDashboardStats(),
    getBookings(),
    listLeads(),
    getCallbackRequests(),
    getSiteHealth(),
  ]);
  return {
    stats: settled(stats),
    bookings: settled(bookings),
    leads: settled(leads),
    callbacks: settled(callbacks),
    health: settled(health),
  };
}
