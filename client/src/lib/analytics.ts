/**
 * Shared analytics helpers — single source of truth for tracking events.
 * Import these instead of duplicating gtag calls across pages.
 */

/** Track a phone call click conversion event via GA4 */
export function trackPhoneClick(location: string): void {
  if (typeof window !== "undefined" && (window as any).gtag) {
    (window as any).gtag("event", "phone_call_click", {
      event_category: "conversion",
      event_label: location,
    });
  }
}
