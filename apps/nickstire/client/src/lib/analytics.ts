/**
 * LEGACY analytics helper — DO NOT import from here.
 *
 * @deprecated attribution-wave 2026-06: import { trackPhoneClick } from
 * "@/components/SEO" instead. This legacy path fires ONLY a gtag
 * "phone_call_click" event — no umami, no Meta Pixel Contact, no
 * call_events DB row, no UTM — so clicks routed here are invisible to
 * the admin call dashboard and split the GA4 series (canonical event
 * name is "phone_click"). All production callers were migrated
 * (TireFinder, TireSizePage, CustomerPortal, ProblemPage); this file
 * remains only because __tests__/utils.test.ts exercises it.
 */

/** @deprecated use trackPhoneClick from "@/components/SEO" — see file header. */
export function trackPhoneClick(location: string): void {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", "phone_call_click", {
      event_category: "conversion",
      event_label: location,
    });
  }
}
