/**
 * Server-side Analytics Helpers
 *
 * Utility functions for source attribution and snapshot queries.
 * GA4 Measurement Protocol integration was removed — it was never wired up
 * (GA4_MEASUREMENT_ID / GA4_API_SECRET were never set).
 */

import { getDb } from './db';
import { analyticsSnapshots } from '../drizzle/schema';
import { sql } from 'drizzle-orm';

import { BUSINESS } from "@shared/business";
/**
 * Extract source from referrer and UTM parameters
 */
export function extractSource(referrer?: string, utmSource?: string): string {
  // UTM takes priority
  if (utmSource === 'google' && utmSource) return 'paid_search';
  if (utmSource === 'facebook') return 'paid_social';
  if (utmSource === 'instagram') return 'paid_social';
  if (utmSource) return `paid_${utmSource}`;

  // Check referrer
  if (!referrer) return 'direct';
  if (referrer.includes('google')) return 'organic_search';
  if (referrer.includes('facebook')) return 'social';
  if (referrer.includes('instagram')) return 'social';
  if (referrer.includes('linkedin')) return 'social';

  return 'referral';
}

/**
 * Get today's analytics snapshot
 */
export async function getTodaySnapshot() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
  const db = await getDb();

  if (!db) return null;

  const snapshots = await db
    .select()
    .from(analyticsSnapshots)
    .where(sql`DATE(${analyticsSnapshots.createdAt}) = ${today}`)
    .limit(1);

  return snapshots[0] || null;
}

/**
 * Update analytics snapshot with new metrics
 */
export async function updateAnalyticsSnapshot(metrics: {
  totalBookings?: number;
  completedBookings?: number;
  newLeads?: number;
  convertedLeads?: number;
  pageViews?: number;
  uniqueVisitors?: number;
  topService?: string;
  serviceBreakdown?: Record<string, number>;
  geoBreakdown?: Record<string, number>;
}) {
  const today = new Date().toISOString().split('T')[0];

  // This would be implemented with actual database logic
  // For now, just log the update
  console.info('[analytics:snapshot] updated for', today);
}
