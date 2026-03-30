/**
 * Server-side Analytics Event Logging
 * Logs form submissions, calls, and conversions for attribution tracking
 * Integrates with GA4 via Measurement Protocol
 */

import { getDb } from './db';
import { analyticsSnapshots } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';

export interface AnalyticsEvent {
  eventType: 'form_submission' | 'phone_click' | 'chat_start' | 'chat_convert' | 'search' | 'page_view';
  source: string; // 'organic', 'paid_search', 'paid_social', 'direct', 'referral', etc.
  formType?: 'booking' | 'lead' | 'callback';
  service?: string;
  page?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  eventId?: string;
  metadata?: Record<string, any>;
}

/**
 * Log an analytics event to GA4 via Measurement Protocol
 */
export async function logAnalyticsEvent(event: AnalyticsEvent) {
  try {
    const ga4MeasurementId = process.env.GA4_MEASUREMENT_ID;
    const ga4ApiSecret = process.env.GA4_API_SECRET;

    if (!ga4MeasurementId || !ga4ApiSecret) {
      console.warn('[Analytics] GA4 credentials not configured');
      return;
    }

    // Map event type to GA4 event name
    const eventNameMap: Record<string, string> = {
      form_submission: 'form_submission',
      phone_click: 'phone_click',
      chat_start: 'chat_start',
      chat_convert: 'chat_convert',
      search: 'search',
      page_view: 'page_view',
    };

    const eventName = eventNameMap[event.eventType];

    // Build GA4 Measurement Protocol payload
    const payload = {
      client_id: event.eventId || `server_${Date.now()}`,
      events: [
        {
          name: eventName,
          params: {
            event_category: getEventCategory(event.eventType),
            event_label: event.formType || event.eventType,
            source: event.source,
            service: event.service,
            page: event.page,
            referrer: event.referrer,
            utm_source: event.utmSource,
            utm_medium: event.utmMedium,
            utm_campaign: event.utmCampaign,
            timestamp: new Date().toISOString(),
            ...event.metadata,
          },
        },
      ],
    };

    // Send to GA4 Measurement Protocol
    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${ga4MeasurementId}&api_secret=${ga4ApiSecret}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (!response.ok) {
      console.warn('[Analytics] GA4 event failed:', response.status, await response.text());
    } else {
      console.log('[Analytics] GA4 event logged:', eventName);
    }
  } catch (error) {
    console.error('[Analytics] Failed to log event:', error);
  }
}

/**
 * Map event type to GA4 event category
 */
function getEventCategory(eventType: string): string {
  const categoryMap: Record<string, string> = {
    form_submission: 'form',
    phone_click: 'engagement',
    chat_start: 'engagement',
    chat_convert: 'conversion',
    search: 'engagement',
    page_view: 'content',
  };
  return categoryMap[eventType] || 'general';
}

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
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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
  console.log('[Analytics] Snapshot updated for', today, metrics);
}
