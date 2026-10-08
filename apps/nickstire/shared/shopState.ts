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

/**
 * The next opening moment as a real Date — or null when it cannot be derived.
 *
 * `businessState().nextChange` is a human-readable STRING ("8:00 AM tomorrow").
 * That is correct for speech and SMS copy and useless for a deadline. A promise
 * needs a machine-comparable instant, and the only honest source for one is the
 * shop's own configured hours — the same `BUSINESS.hours.structured` this file
 * already reads, so no second definition of "when we open" is created.
 *
 * RETURNS NULL RATHER THAN GUESSING. If hours are unconfigured, or no day in
 * the next week has hours, the caller gets null and must NOT fabricate a
 * deadline. A promise with an invented due time is worse than no promise: it
 * manufactures a breach the shop never agreed to, and the Promise Ledger scores
 * kept-vs-missed against exactly that field.
 *
 * Minute-accurate rather than second-accurate on purpose: the shop's hours are
 * configured to the minute, so seconds would be false precision.
 *
 * Exported for the obligation mirror (ADR-0020 §4), which dates a callback or
 * emergency request that arrived while the shop was closed from the next opening.
 */
export function nextOpenAt(
  now: Date,
  timezone: string,
  hours: Record<string, string>,
): Date | null {
  const { weekday, minutes } = localClock(now, timezone);
  const idx = WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]);
  if (idx < 0) return null;

  const today = parseRange(hours[weekday]);
  // Already open → the next "open" moment is now.
  if (today && minutes >= today.open && minutes < today.close) return now;
  // Closed but opening later today.
  if (today && minutes < today.open) return shiftLocalMinutes(now, timezone, today.open - minutes);

  // After close, or no hours today: walk forward to the next day WITH hours.
  for (let i = 1; i <= 7; i++) {
    const r = parseRange(hours[WEEKDAYS[(idx + i) % 7]]);
    if (r) {
      // Minutes remaining today, plus whole days, plus the open offset.
      return shiftLocalMinutes(now, timezone, (1440 - minutes) + (i - 1) * 1440 + r.open);
    }
  }
  return null;
}

/**
 * WHEN A "WE'LL CALL YOU BACK" PROMISE IS DUE: the CLOSE of the business day on
 * which the shop can next act.
 *
 * `nextOpenAt` is the wrong deadline and shipping it as one was a real defect,
 * caught in review on PR #2479. It returns `now` when the shop is already open,
 * so a callback promised at 10am on a Tuesday was due at 10am on that Tuesday —
 * overdue one second later. The overdue sweep would then escalate it into the
 * Decision Inbox and, after 48h, stamp it `missed`, reporting a broken promise
 * that the shop had every intention of keeping and plenty of day left to keep.
 *
 * Refusing during open hours was the other option and it is worse: most calls
 * arrive while the shop is open, so voice promises would have existed only for
 * after-hours calls — a silent hole in the exact hours the business runs.
 *
 * THIS IS DERIVED, NOT INVENTED, which is the constraint that matters here:
 *   - The outbound follow-up assistant's own script says "we'll have someone
 *     call you back TODAY" (FOLLOW_UP_SYSTEM_PROMPT), so close-of-business is
 *     the bound the shop itself stated.
 *   - The inbound script promises "someone will call you back when we're open"
 *     and names no hour (it said "first thing when we open" until 2026-09-23,
 *     which this bound did not match). The shop can only act while it is
 *     open, so the last moment it can honour that on the next open day is
 *     closing time. That is a property of the hours, not a guess about intent.
 *
 * Returns null when no deadline is derivable, and callers must skip rather than
 * substitute one.
 */
export function nextCloseAt(
  now: Date,
  timezone: string,
  hours: Record<string, string>,
): Date | null {
  // Reuse nextOpenAt so both answers come from one walk of the schedule; a
  // second copy of that loop would be free to disagree about which day is next.
  const openAt = nextOpenAt(now, timezone, hours);
  if (!openAt) return null;

  // Which business day did that land on, and when does it close?
  const at = localClock(openAt, timezone);
  const range = parseRange(hours[at.weekday]);
  if (!range) return null;

  // Already past close on that day should be impossible (nextOpenAt never
  // returns a moment after close), but refuse rather than emit a past deadline.
  if (at.minutes >= range.close) return null;
  return shiftLocalMinutes(openAt, timezone, range.close - at.minutes);
}

/**
 * The next opening as "8:00 AM Wednesday": always the weekday, never "today"
 * or "tomorrow". For text that may be READ later than it is written: the
 * after-hours SMS is held through quiet hours and delivered after 8 AM, so a
 * relative "8:00 AM tomorrow" written at 9 PM Tuesday was false by the time
 * Wednesday's reader saw it (issue #2579). `businessState().nextChange` stays
 * relative, because it is spoken at the moment it is computed.
 *
 * The next opening strictly after `now`: while open, that is the next day's.
 * Null when no day has hours, never an invented time.
 */
export function nextOpeningLabel(now: Date, timezone: string, hours: Record<string, string>): string | null {
  const { weekday, minutes } = localClock(now, timezone);
  const idx = WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]);
  if (idx < 0) return null;
  for (let i = 0; i <= 7; i++) {
    const day = WEEKDAYS[(idx + i) % 7];
    const r = parseRange(hours[day]);
    if (r && (i > 0 || minutes < r.open)) return `${fmt(r.open)} ${day.charAt(0).toUpperCase()}${day.slice(1)}`;
  }
  return null;
}

/**
 * Advance `now` by N wall-clock minutes in the shop's timezone.
 *
 * Adding milliseconds directly is wrong across a DST boundary — the shop opens
 * at 8:00 local whether or not the clocks moved overnight. This walks the
 * offset and then corrects for any UTC-offset shift the jump crossed, so the
 * result lands on the intended local wall-clock minute.
 */
/**
 * The shop's business window for the local calendar day that contains `now`, as epoch ms:
 * `dayStartMs` is local midnight; `openMs` / `closeMs` are the configured hours for that
 * weekday, null when the day has none. Built for the camera coverage read (lot.health, camera
 * audit N2): "watched 83% of business time so far" must be measured against the same
 * `BUSINESS.hours.structured` everything else reads, never a second definition of the day.
 * DST-safe through shiftLocalMinutes, like nextOpenAt; minute-accurate like the hours.
 */
export function shopDayWindow(
  now: Date,
  timezone: string,
  hours: Record<string, string>,
): { weekday: string; dayStartMs: number; openMs: number | null; closeMs: number | null } {
  const { weekday, minutes } = localClock(now, timezone);
  const subMinute = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  const dayStartMs = shiftLocalMinutes(now, timezone, -minutes).getTime() - subMinute;
  const range = parseRange(hours[weekday]);
  return {
    weekday,
    dayStartMs,
    openMs: range ? shiftLocalMinutes(now, timezone, range.open - minutes).getTime() - subMinute : null,
    closeMs: range ? shiftLocalMinutes(now, timezone, range.close - minutes).getTime() - subMinute : null,
  };
}

function shiftLocalMinutes(now: Date, timezone: string, deltaMinutes: number): Date {
  const naive = new Date(now.getTime() + deltaMinutes * 60_000);
  const before = localClock(now, timezone).minutes;
  const after = localClock(naive, timezone).minutes;
  // Expected local minutes-of-day after the shift, modulo the day (negative deltas too).
  const expected = (((before + deltaMinutes) % 1440) + 1440) % 1440;
  // Wrapped into [-720, 720): a shift that lands on the far side of midnight (back to 00:00
  // on the spring-forward day reads 23:00 the day before) is a one-hour drift, not a 23-hour
  // one, and must be corrected like any other DST jump.
  const drift = ((((after - expected) + 720) % 1440) + 1440) % 1440 - 720;
  // A DST jump shows up as a whole-hour drift; correct it back.
  if (drift !== 0 && Math.abs(drift) <= 120) {
    return new Date(naive.getTime() - drift * 60_000);
  }
  return naive;
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
