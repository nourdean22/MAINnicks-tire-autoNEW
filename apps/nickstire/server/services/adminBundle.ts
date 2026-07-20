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
  // THROW, do not return []. An unreachable database is not "no leads".
  // Returning an empty array here launders the failure into a FULFILLED promise,
  // so Promise.allSettled below cannot see it and the client renders an empty
  // queue with "All clear". getBookings (db.ts:171) and getCallbackRequests
  // (db.ts:484) still do this — which is why the bundle now checks the database
  // itself before dispatching, rather than trusting each reader to report.
  if (!d) throw new Error("Database not available");
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
/** Per-slice truth: did this read SUCCEED, or is its emptiness a failure? */
export interface SliceStatus {
  available: boolean;
  error: string | null;
}

function sliceStatus<T>(p: PromiseSettledResult<T>, dbDown: boolean): SliceStatus {
  if (dbDown) return { available: false, error: "Database not available" };
  if (p.status === "fulfilled") return { available: true, error: null };
  return { available: false, error: p.reason instanceof Error ? p.reason.message.slice(0, 200) : String(p.reason).slice(0, 200) };
}

/**
 * NULL WAS INDISTINGUISHABLE FROM EMPTY, AND EMPTY RENDERED AS "ALL CLEAR".
 *
 * This returned five independently-nullable fields and NOTHING ELSE. `settled()`
 * maps a rejection to null with only a log.warn, so the client could not tell
 * "no one is waiting" from "the table could not be read" — and
 * OverviewSection.tsx does `bundle?.leads ?? []`, turning the second into the
 * first. DegradedDataBanner only fires on `stats._degraded` or a whole-query
 * isError, so a leads-only or callbacks-only failure rendered a clean queue and
 * the words "All clear".
 *
 * Worse, two of the readers never even reject: getBookings (db.ts:171) and
 * getCallbackRequests (db.ts:484) return [] when the database is unavailable, so
 * Promise.allSettled sees a FULFILLED empty array. The failure is laundered into
 * a legitimate-looking result before this function can observe it. (Their
 * immediate neighbours at db.ts:177 and :490 throw — both patterns, same file,
 * six lines apart.)
 *
 * So the database is checked HERE, once, up front. A reader that swallows its
 * own failure can no longer hide it from the bundle, and every slice is reported
 * unavailable when the source they all share is down.
 *
 * The five original fields are unchanged so existing consumers keep working;
 * `slices` is additive.
 */
export async function getOverviewMediumBundle() {
  // One check, before dispatch — the only way to catch readers that return []
  // instead of throwing. Cheap: getDb() is pooled.
  const dbDown = !(await db());

  const [stats, bookings, leads, callbacks, health] = await Promise.allSettled([
    getDashboardStats(),
    getBookings(),
    listLeads(),
    getCallbackRequests(),
    getSiteHealth(),
  ]);

  const slices = {
    stats: sliceStatus(stats, dbDown),
    bookings: sliceStatus(bookings, dbDown),
    leads: sliceStatus(leads, dbDown),
    callbacks: sliceStatus(callbacks, dbDown),
    health: sliceStatus(health, dbDown),
  };

  const failed = Object.entries(slices).filter(([, s]) => !s.available).map(([k]) => k);
  if (failed.length) {
    log.warn(`[adminBundle] ${failed.length} slice(s) unavailable: ${failed.join(", ")}`);
  }

  return {
    stats: settled(stats),
    bookings: settled(bookings),
    leads: settled(leads),
    callbacks: settled(callbacks),
    health: settled(health),
    /** Which reads actually succeeded. An empty list is only real when its slice is available. */
    slices,
    /** True when ANY slice failed — the one flag a screen needs to stop saying "All clear". */
    anyUnavailable: failed.length > 0,
    unavailableSlices: failed,
  };
}
