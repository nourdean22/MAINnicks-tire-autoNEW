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

const FEED_URL = "https://statenour-os.vercel.app/api/weather";

export function useWeatherCTA(): WeatherCTA | null {
  const [feed, setFeed] = useState<WeatherFeed | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(FEED_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setFeed(data); })
      .catch(() => { /* offline / blocked — fall through to null */ });
    return () => { cancelled = true; };
  }, []);

  if (!feed) return null;

  const desc = (feed.current?.description || "").toLowerCase();
  const tempHigh = feed.current?.tempHigh;
  const demand = feed.businessImpact?.demandForecast;

  // Snow / ice — winter tire urgency
  if (/snow|ice|sleet|blizzard|freezing rain/.test(desc)) {
    return {
      message: "Snow on the road right now",
      sub: "Worn tires fail in 2-3 stopping distances. Tires from $40 installed today.",
      urgency: "high",
      ctaLabel: "GET WINTER-RATED TIRES",
      ctaHref: "/tires",
      context: { tempHigh, description: feed.current?.description, demandForecast: demand },
    };
  }

  // Snow forecast in next 3 days
  const snowForecast = feed.forecast?.find((d) => /snow|ice|sleet/.test((d.description || "").toLowerCase()));
  if (snowForecast) {
    const daysUntil = feed.forecast?.indexOf(snowForecast) ?? 1;
    return {
      message: `Lake-effect snow forecast in ${daysUntil + 1} day${daysUntil === 0 ? "" : "s"}`,
      sub: "Get winter-rated tires before the rush. From $40 installed.",
      urgency: daysUntil <= 1 ? "high" : "medium",
      ctaLabel: "BEAT THE STORM",
      ctaHref: "/tires",
      context: { tempHigh, description: feed.current?.description, demandForecast: demand },
    };
  }

  // Heat — AC urgency
  if (typeof tempHigh === "number" && tempHigh >= 85) {
    return {
      message: `${tempHigh}°F today`,
      sub: "If your AC is iffy now, it'll fail tomorrow. Free AC inspection.",
      urgency: tempHigh >= 90 ? "high" : "medium",
      ctaLabel: "FREE AC CHECK",
      ctaHref: "/ac-repair",
      context: { tempHigh, description: feed.current?.description, demandForecast: demand },
    };
  }

  // Rain — brake/tire urgency
  if (/rain|storm|thunderstorm/.test(desc)) {
    return {
      message: "Wet roads right now",
      sub: "Stopping distance doubles with worn tires. Free tire-tread + brake check.",
      urgency: "medium",
      ctaLabel: "FREE INSPECTION",
      ctaHref: "/booking",
      context: { tempHigh, description: feed.current?.description, demandForecast: demand },
    };
  }

  // Surge demand from the demand-forecast model
  if (demand === "surge" || demand === "high") {
    return {
      message: "Shop is slammed today",
      sub: "Pull up early — first-come, first-served.",
      urgency: "low",
      ctaLabel: "GET DIRECTIONS",
      ctaHref: "/booking",
      context: { tempHigh, description: feed.current?.description, demandForecast: demand },
    };
  }

  return null;
}
