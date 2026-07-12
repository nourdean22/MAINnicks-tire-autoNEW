/**
 * useConversionTracking — single hook that fans every conversion-relevant
 * event out to ALL existing analytics pipelines (GA4, Meta CAPI, Sheets CRM).
 *
 * Why a hook: the conversion-architecture components (UrgencyWidget, FOMO
 * ticker, ExitIntentModal, DecoyPricingTable, etc.) all need a single,
 * cheap call site to log "user saw bias element X" / "user clicked CTA Y".
 *
 * Implementation:
 *   - Pushes to `window.dataLayer` (GTM/GA4 picks it up).
 *   - Fires `fbq('trackCustom', ...)` for Meta Pixel where the pixel exists.
 *   - Calls a tRPC mutation `analytics.recordConversionEvent` to write to
 *     the server-side events table (so Sheets CRM cron can sync).
 *
 * The third (server-side) is the canonical source — client pixels can be
 * blocked by ad-blockers, server logging can't.
 *
 * Per the conversion-overhaul spec: "Once Batch 1 lands, every CTA + form +
 * capture event must fire to the existing analytics pipeline … conversion
 * lift is measured against the estimate → invoice funnel."
 */
import { useCallback } from "react";

export type ConversionEventType =
  | "urgency_widget_shown"
  | "urgency_widget_dismissed"
  | "urgency_widget_capture_started"
  | "urgency_widget_capture_completed"
  | "exit_intent_shown"
  | "exit_intent_dismissed"
  | "exit_intent_capture_completed"
  | "fomo_ticker_clicked"
  | "live_visitors_shown"
  | "decoy_tier_clicked"
  | "loss_aversion_cta_clicked"
  | "service_triage_card_clicked"
  | "weather_cta_clicked"
  | "page_cta_primary_clicked"
  | "page_cta_secondary_clicked"
  | "phone_number_clicked"
  | "form_started"
  | "form_completed"
  | "form_abandoned";

export interface ConversionEvent {
  type: ConversionEventType;
  /** Page where it fired (auto-filled if omitted). */
  page?: string;
  /** Bias element identifier (e.g., "decoy:brakes:popular", "fear-stat:287ft"). */
  element?: string;
  /** Free-form properties for downstream segmentation. */
  props?: Record<string, string | number | boolean | null>;
  /** Optional dollar value associated with the event (e.g., reserved slot value). */
  value?: number;
}

// fbq is declared elsewhere in the codebase (FB Pixel widget); we don't
// re-declare it here to avoid a type collision. dataLayer is GTM-standard.
declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/**
 * Returns a stable `track()` function. Call inside event handlers.
 *
 *   const track = useConversionTracking();
 *   <button onClick={() => track({ type: "urgency_widget_capture_completed" })}>...</button>
 */
export function useConversionTracking() {
  const track = useCallback((event: ConversionEvent) => {
    if (typeof window === "undefined") return;
    const page = event.page ?? window.location.pathname;
    const fullEvent = { ...event, page, ts: Date.now() };

    // 1. GTM / GA4 dataLayer
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: "conversion_event",
        conversion_type: event.type,
        conversion_element: event.element,
        conversion_value: event.value,
        page,
        ...event.props,
      });
    } catch {
      // best-effort
    }

    // 2. Meta Pixel — fire only on conversion-completed events to avoid
    //    polluting the funnel with low-intent signals.
    const FB_TRIGGERS: ConversionEventType[] = [
      "urgency_widget_capture_completed",
      "exit_intent_capture_completed",
      "form_completed",
    ];
    if (FB_TRIGGERS.includes(event.type)) {
      try {
        // window.fbq is declared in another file; access via index to avoid
        // re-declaration conflicts.
        const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
        fbq?.("trackCustom", event.type, {
          page,
          value: event.value,
          ...event.props,
        });
      } catch {
        // best-effort
      }
    }

    // 3. Server-side log (canonical source). Best-effort fire-and-forget.
    //    feat/home-v2 (Phase 0): the sink now PERSISTS to the
    //    customer_events table (previously only a 500-item in-memory ring
    //    buffer that died on every restart — HomeV2 wins were unprovable).
    //    sessionId + UTM ride along so persisted rows join the
    //    lead→booking→invoice funnel on the same key every capture
    //    surface already uses (@/lib/session + @/lib/utm).
    try {
      import("@/lib/session").then(async ({ getSessionId }) => {
        const { getUtmData } = await import("@/lib/utm");
        const utm = getUtmData();
        fetch("/api/analytics/conversion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...fullEvent,
            sessionId: getSessionId(),
            utmSource: utm.utmSource || null,
            utmMedium: utm.utmMedium || null,
            utmCampaign: utm.utmCampaign || null,
            referrer: utm.referrer || null,
          }),
          keepalive: true, // survives page unload
        }).catch(() => { /* don't block UX on analytics */ });
      }).catch(() => { /* session/utm import blocked — skip, never block UX */ });
    } catch {
      // best-effort
    }
  }, []);

  return track;
}
