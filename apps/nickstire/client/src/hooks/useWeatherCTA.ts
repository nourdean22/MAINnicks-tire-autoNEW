/**
 * useWeatherCTA — turns the existing statenour weather feed into a
 * conversion-architecture CTA hint.
 *
 * The statenour OS already exposes `/api/weather` with a `businessImpact`
 * field that classifies the day's weather impact on shop demand. This hook
 * maps that into a {message, urgency, ctaLabel, ctaHref} contract that
 * any page can render.
 *
 * Examples (auto-generated based on weather state):
 *   - Snow forecast 3 days out:
 *       "Lake-effect snow is 3 days away. Winter tires from $40 — now
 *        or pay for a tow truck Wednesday. → /tires"
 *   - Today freezing rain:
 *       "Freezing rain right now. Worn tires kill — book a brake +
 *        tire check while we still have slots. → /booking"
 *   - 90°F+ heat advisory:
 *       "AC will fail tomorrow if it's iffy today. Free AC inspection. → /ac-repair"
 *   - Normal day:
 *       returns null — no nag.
 *
 * Per the conversion-overhaul spec: only fire when the weather genuinely
 * matters operationally. Don't manufacture urgency on a 70°F clear day.
 */
import { useEffect, useState } from "react";

export interface WeatherCTA {
  /** Headline-ready message. Short, punchy. */
  message: string;
  /** Sub-line with the offer/relief. */
  sub: string;
  /** "high" → red urgent banner; "medium" → amber; "low" → muted. */
  urgency: "high" | "medium" | "low";
  /** CTA copy, action-verb led. */
  ctaLabel: string;
  /** Destination route. */
  ctaHref: string;
  /** Raw weather context for debugging / tooltips. */
  context?: { tempHigh?: number; description?: string; demandForecast?: string };
}

interface WeatherFeed {
  current?: { tempHigh?: number; description?: string };
  forecast?: Array<{ date: string; tempHigh?: number; tempLow?: number; description?: string; precipChance?: number }>;
  businessImpact?: {
    demandForecast?: "low" | "normal" | "high" | "surge";
    demandMultiplier?: number;
    reasoning?: string;
    staffingAdvice?: string;
    alerts?: string[];
  };
}

// 2026-05-19 · was https://statenour-os.vercel.app/api/weather but
// that Vercel deploy is RETIRED (statenour now runs on Railway at
// statenour-web-production.up.railway.app). The hardcoded Vercel URL
// was firing on every page load and getting CSP-blocked · noisy in
// the browser console. Disabling the fetch entirely until the
// statenour cleanup session re-wires this. The hook returns null
// (graceful degradation — no weather-conditional CTAs surface).
//
// Env-driven option for the new statenour URL is wired in
// `STATENOUR_SYNC_URL` on the server crons — when the operator wants
// this re-enabled, point a client-side fetch at the new Railway URL
// (will require adding Railway origin to CSP connect-src).

export function useWeatherCTA(): WeatherCTA | null {
  // 2026-05-19 · disabled at the source · old FEED_URL pointed at the
  // retired Vercel statenour deploy and was getting CSP-blocked on
  // every page load. Re-enable by restoring the fetch (see git history
  // at wave-181.96) and pointing FEED_URL at the current statenour
  // Railway URL · need to add that origin to the site's CSP connect-src.
  return null;
}
