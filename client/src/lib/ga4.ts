/**
 * GA4 Event Tracking Utility
 * Tracks conversions, form submissions, phone clicks, and custom events.
 * All tracking functions are gated behind consent-manager analytics consent.
 */

import { hasConsent } from "@/lib/consent-manager";

// Extend Window interface to include gtag
declare global {
  interface Window {
    gtag?: (command: string, eventName: string, eventData?: Record<string, unknown>) => void;
  }
}

export interface GA4Event {
  event_name: string;
  parameters: Record<string, string | number | boolean>;
}

/** Returns true if GA4 is available and analytics consent is granted. */
function canTrack(): boolean {
  return typeof window !== "undefined" && !!window.gtag && hasConsent("analytics");
}

/**
 * Initialize GA4 tracking.
 * Should be called after analytics consent is granted.
 */
export function initGA4() {
  if (typeof window !== "undefined" && window.gtag && hasConsent("analytics")) {
    // GA4 script is loaded via index.html — nothing else needed
  }
}

/**
 * Track a form submission as a conversion
 */
export function trackFormSubmission(formType: 'booking' | 'lead' | 'callback', data: {
  name?: string;
  phone?: string;
  service?: string;
  source?: string;
  eventId?: string;
}) {
  if (!canTrack()) return;

  const eventName = `form_submission_${formType}`;
  
  window.gtag('event', eventName, {
    event_category: 'form',
    event_label: formType,
    form_type: formType,
    service: data.service || 'unknown',
    source: data.source || 'direct',
    event_id: data.eventId,
    timestamp: new Date().toISOString(),
  });

  console.log(`[GA4] Tracked: ${eventName}`, data);
}

/**
 * Track a phone click as a conversion
 */
export function trackPhoneClick(context: string, data?: {
  source?: string;
  page?: string;
  eventId?: string;
}) {
  if (!canTrack()) return;

  window.gtag('event', 'phone_click', {
    event_category: 'engagement',
    event_label: context,
    source: data?.source || 'direct',
    page: data?.page || window.location.pathname,
    event_id: data?.eventId,
    timestamp: new Date().toISOString(),
  });

  console.log('[GA4] Tracked: phone_click', context);
}

/**
 * Track a service page view with custom parameters
 */
export function trackServiceView(serviceType: string, data?: {
  section?: string;
  scrollDepth?: number;
}) {
  if (!canTrack()) return;

  window.gtag('event', 'view_service', {
    event_category: 'content',
    service_type: serviceType,
    section: data?.section || 'overview',
    scroll_depth: data?.scrollDepth || 0,
    page_path: window.location.pathname,
    timestamp: new Date().toISOString(),
  });

  console.log('[GA4] Tracked: view_service', serviceType);
}

/**
 * Track a chat interaction
 */
export function trackChatInteraction(action: 'start' | 'message' | 'convert', data?: {
  vehicleInfo?: string;
  problem?: string;
  messageCount?: number;
  eventId?: string;
}) {
  if (!canTrack()) return;

  window.gtag('event', `chat_${action}`, {
    event_category: 'engagement',
    event_label: action,
    vehicle_info: data?.vehicleInfo,
    problem: data?.problem,
    message_count: data?.messageCount || 0,
    event_id: data?.eventId,
    timestamp: new Date().toISOString(),
  });

  console.log(`[GA4] Tracked: chat_${action}`);
}

/**
 * Track a search/diagnosis action
 */
export function trackSearch(query: string, data?: {
  resultCount?: number;
  category?: string;
  eventId?: string;
}) {
  if (!canTrack()) return;

  window.gtag('event', 'search', {
    event_category: 'engagement',
    search_term: query,
    result_count: data?.resultCount || 0,
    category: data?.category || 'general',
    event_id: data?.eventId,
    timestamp: new Date().toISOString(),
  });

  console.log('[GA4] Tracked: search', query);
}

/**
 * Track a page view with custom parameters
 */
export function trackPageView(pagePath: string, data?: {
  pageTitle?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}) {
  if (!canTrack()) return;

  window.gtag('event', 'page_view', {
    page_path: pagePath,
    page_title: data?.pageTitle || document.title,
    referrer: data?.referrer || document.referrer,
    utm_source: data?.utm_source,
    utm_medium: data?.utm_medium,
    utm_campaign: data?.utm_campaign,
    timestamp: new Date().toISOString(),
  });

  console.log('[GA4] Tracked: page_view', pagePath);
}

/**
 * Get UTM parameters from URL
 */
export function getUTMParameters() {
  if (typeof window === 'undefined') return {};

  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') || undefined,
    utm_medium: params.get('utm_medium') || undefined,
    utm_campaign: params.get('utm_campaign') || undefined,
    utm_content: params.get('utm_content') || undefined,
    utm_term: params.get('utm_term') || undefined,
  };
}

/**
 * Get referrer source (organic, paid, direct, referral, etc.)
 */
export function getTrafficSource(): string {
  if (typeof window === 'undefined') return 'direct';

  const referrer = document.referrer;
  const utm = getUTMParameters();

  // Check UTM parameters first
  if (utm.utm_source === 'google' && utm.utm_medium === 'cpc') return 'paid_search';
  if (utm.utm_source === 'facebook') return 'paid_social';
  if (utm.utm_source === 'instagram') return 'paid_social';
  if (utm.utm_source) return `paid_${utm.utm_source}`;

  // Check referrer
  if (!referrer) return 'direct';
  if (referrer.includes('google')) return 'organic_search';
  if (referrer.includes('facebook')) return 'social';
  if (referrer.includes('instagram')) return 'social';
  if (referrer.includes('linkedin')) return 'social';
  if (referrer.includes('twitter')) return 'social';

  return 'referral';
}
