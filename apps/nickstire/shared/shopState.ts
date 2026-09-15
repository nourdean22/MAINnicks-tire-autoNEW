/**
 * ShopState — the coarse, privacy-safe projection of the physical shop that
 * the public storefront is allowed to see.
 *
 * WHAT THIS REPLACES. `useWeatherCTA` was a client fetch against a retired
 * Vercel deploy; it has returned null since 2026-05-19. Instead of repointing
 * one URL, the storefront now reads ONE server-derived state that fuses the
 * signals the shop already has (hours, booking-derived capacity, an aggregate
 * lot count, Open-Meteo weather) into a handful of bands, and the weather CTA
 * is a pure projection of that state.
 *
 * WHAT IT MUST NEVER CONTAIN. No plate, no customer id, no phone, no exact
 * per-vehicle anything. The lot input is a COUNT and a timestamp; the schema
 * below has no field a plate could travel in, and `shopState.test.ts` proves
 * with a property test that no derived state ever grows one.
 *
 * WHAT IT MUST NEVER FAKE. Every band has an "unknown" arm, and unknown is the
 * value on any missing or stale input. `getShopStatus` already refuses to
 * assert bay counts when its numbers are the time-of-day guess (waitIsFresh),
 * and that refusal is carried through here rather than papered over.
 *
 * Pure and browser-safe: `shared/` is bundled into the client.
 */

export type Band = "light" | "steady" | "busy" | "unknown";
export type SensorHealth = "fresh" | "stale" | "offline";
export type WeatherRisk = "none" | "snow" | "ice" | "heat" | "unknown";
export type Recommendation = "pull_up" | "drop_off" | "call_first" | "normal";

export interface ShopState {
  generatedAt: string;
  business: {
    state: "open" | "closed";
    /** Human label for the next transition ("8:00 AM tomorrow"), never a promise. */
    nextChange: string | null;
  };
  capacity: { band: Band; fresh: boolean };
  lot: { band: Band; sensorHealth: SensorHealth };
  weather: { risk: WeatherRisk; tempF: number | null };
  recommendation: Recommendation;
  /** One line per input, so an operator can see WHY the state says what it says. */
  evidence: string[];
}

export interface ShopStateInputs {
  now: Date;
  timezone: string;
  /** BUSINESS.hours.structured shape: weekday name -> "HH:MM-HH:MM". */
  hours: Record<string, string>;
  /** From getShopStatus(); null when the service itself failed. */
  capacity: { openBays: number; totalBays: number; waitIsFresh: boolean } | null;
  /**
   * Aggregate only. null = lot feed disabled or unreadable. `lastObservationAt`
   * is the FEED's last heartbeat (camera_runtime), never a visit transition: a
   * car parked for an hour is a healthy feed, a dead camera mid-visit is not.
   */
  lot: { activeVisits: number; lastObservationAt: Date | null } | null;
  /** From server/weather.ts; null = fetch failed and no cache. */
  weather: { code: number; tempF: number } | null;
}

/** Lot observation older than this is stale; older than STALE window is offline. */
export const LOT_FRESH_MS = 15 * 60_000;
export const LOT_STALE_MS = 2 * 60 * 60_000;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Local wall-clock in the shop's timezone, without a date library. */
export function localClock(now: Date, timezone: string): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday").toLowerCase();
  // "24" appears for midnight in some engines with hour12:false.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { weekday, minutes: hour * 60 + minute };
}

function parseRange(range: string | undefined): { open: number; close: number } | null {
  if (!range) return null;
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(range);
  if (!m) return null;
  return { open: Number(m[1]) * 60 + Number(m[2]), close: Number(m[3]) * 60 + Number(m[4]) };
}

function fmt(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

export function businessState(
  now: Date,
  timezone: string,
  hours: Record<string, string>,
): { state: "open" | "closed"; nextChange: string | null; evidence: string } {
  const { weekday, minutes } = localClock(now, timezone);
  const today = parseRange(hours[weekday]);
  if (today && minutes >= today.open && minutes < today.close) {
    return {
      state: "open",
      nextChange: `closes ${fmt(today.close)}`,
      evidence: `hours:open ${weekday} ${hours[weekday]}`,
    };
  }
  if (today && minutes < today.open) {
    return { state: "closed", nextChange: `${fmt(today.open)} today`, evidence: `hours:closed before open ${weekday}` };
  }
  // After close (or no hours today): find the next day with hours.
  const idx = WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]);
  for (let i = 1; i <= 7; i++) {
    const day = WEEKDAYS[(idx + i) % 7];
    const r = parseRange(hours[day]);
    if (r) {
      const label = i === 1 ? "tomorrow" : day.charAt(0).toUpperCase() + day.slice(1);
      return { state: "closed", nextChange: `${fmt(r.open)} ${label}`, evidence: `hours:closed after ${weekday}` };
    }
  }
  return { state: "closed", nextChange: null, evidence: "hours:none configured" };
}

export function capacityBand(c: ShopStateInputs["capacity"]): { band: Band; fresh: boolean; evidence: string } {
  if (!c || !c.waitIsFresh) return { band: "unknown", fresh: false, evidence: "capacity:unknown (no fresh booking data)" };
  const open = Math.max(0, Math.min(c.openBays, c.totalBays));
  const band: Band = open >= 3 ? "light" : open >= 1 ? "steady" : "busy";
  return { band, fresh: true, evidence: `capacity:${open}/${c.totalBays} bays open (bookings)` };
}

export function lotBand(l: ShopStateInputs["lot"], now: Date): { band: Band; sensorHealth: SensorHealth; evidence: string } {
  if (!l || !l.lastObservationAt) return { band: "unknown", sensorHealth: "offline", evidence: "lot:offline" };
  const age = now.getTime() - l.lastObservationAt.getTime();
  if (!Number.isFinite(age) || age > LOT_STALE_MS) return { band: "unknown", sensorHealth: "offline", evidence: "lot:offline (no recent observation)" };
  if (age > LOT_FRESH_MS) return { band: "unknown", sensorHealth: "stale", evidence: `lot:stale (${Math.round(age / 60_000)}m old)` };
  const n = Math.max(0, Math.floor(l.activeVisits));
  const band: Band = n <= 1 ? "light" : n <= 3 ? "steady" : "busy";
  return { band, sensorHealth: "fresh", evidence: `lot:${n} vehicles on lot (camera aggregate)` };
}

/** WMO code -> operational risk. Rain is deliberately NOT a risk: Cleveland rains; a banner for it is a nag. */
export function weatherRisk(w: ShopStateInputs["weather"]): { risk: WeatherRisk; tempF: number | null; evidence: string } {
  if (!w) return { risk: "unknown", tempF: null, evidence: "weather:unknown" };
  const c = w.code;
  let risk: WeatherRisk = "none";
  if ([56, 57, 66, 67].includes(c)) risk = "ice";
  else if ([71, 73, 75, 77, 85, 86].includes(c)) risk = "snow";
  else if (w.tempF >= 90) risk = "heat";
  return { risk, tempF: w.tempF, evidence: `weather:code ${c} ${Math.round(w.tempF)}F -> ${risk}` };
}

const BAND_ORDER: Record<Band, number> = { light: 0, steady: 1, busy: 2, unknown: -1 };

export function deriveShopState(input: ShopStateInputs): ShopState {
  const biz = businessState(input.now, input.timezone, input.hours);
  const cap = capacityBand(input.capacity);
  const lot = lotBand(input.lot, input.now);
  const wx = weatherRisk(input.weather);

  // The busiest KNOWN signal wins; two unknowns is "we don't know", not "quiet".
  const known = [cap.band, lot.band].filter((b) => b !== "unknown") as Band[];
  const effective: Band = known.length ? known.reduce((a, b) => (BAND_ORDER[b] > BAND_ORDER[a] ? b : a)) : "unknown";

  let recommendation: Recommendation = "normal";
  if (biz.state === "closed") recommendation = "normal";
  else if (effective === "light") recommendation = "pull_up";
  else if (effective === "busy") recommendation = "drop_off";
  else if (effective === "unknown" && wx.risk === "snow") recommendation = "call_first";

  return {
    generatedAt: input.now.toISOString(),
    business: { state: biz.state, nextChange: biz.nextChange },
    capacity: { band: cap.band, fresh: cap.fresh },
    lot: { band: lot.band, sensorHealth: lot.sensorHealth },
    weather: { risk: wx.risk, tempF: wx.tempF },
    recommendation,
    evidence: [biz.evidence, cap.evidence, lot.evidence, wx.evidence],
  };
}

/** The contract Home.tsx's WeatherBanner has rendered since the first version of the hook. */
export interface WeatherCTA {
  message: string;
  sub: string;
  urgency: "high" | "medium" | "low";
  ctaLabel: string;
  ctaHref: string;
}

/**
 * Weather CTA as a projection of ShopState. Fires ONLY on snow, ice or heat —
 * the operational cases — and every claim in the copy is one the site already
 * makes (free check, written quote first, first come first served).
 */
export function weatherCtaFromShopState(s: ShopState | null | undefined): WeatherCTA | null {
  if (!s) return null;
  switch (s.weather.risk) {
    case "snow":
      return {
        message: "Snow on Cleveland roads right now.",
        sub: "Worn tread is what fails in this. Free tread check, written quote first.",
        urgency: "high",
        ctaLabel: "Check my tires",
        ctaHref: "/tires",
      };
    case "ice":
      return {
        message: "Freezing rain right now.",
        sub: "Stopping distance is the danger. Free brake and tire check, written quote first.",
        urgency: "high",
        ctaLabel: "Get checked",
        ctaHref: "/brakes",
      };
    case "heat":
      return {
        message: `${s.weather.tempF !== null ? `${Math.round(s.weather.tempF)}°F today.` : "Heat advisory today."}`,
        sub: "Heat is hard on batteries and AC. Free check, first come first served.",
        urgency: "medium",
        ctaLabel: "Pull up for a check",
        ctaHref: "/booking",
      };
    default:
      return null;
  }
}
