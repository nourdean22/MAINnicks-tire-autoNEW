/**
 * Weather Intelligence — Triggers marketing campaigns based on Cleveland weather.
 * Reads the National Weather Service 7-day forecast and active alerts
 * (lib/nwsWeather.ts — public-domain data, no key) and detects freeze, heavy
 * rain, snow, heat, pothole season and salt-season end days ahead, not only
 * when the condition is already here. Alerts the operator with a GBP post
 * draft for review.
 *
 * Customer SMS stays in SHADOW until the operator arms it: the
 * weather_triggered_sms flag AND env WEATHER_SMS_SEND=1 (see sendWeatherSms),
 * and even armed it only acts on triggers imminent within 24h. Before
 * 2026-09-23 the lane read OpenWeather current conditions (OPENWEATHER_API_KEY,
 * first set on Railway that day), which saw weather only once it arrived.
 */

import { createLogger } from "../lib/logger";
import { alertSystem } from "./telegram";
import { getActiveAlerts, getForecastPeriods, type NwsAlert, type NwsPeriod } from "../lib/nwsWeather";
import { describeFreezeTiming } from "../lib/clevelandFreezeNormals";

const log = createLogger("weather-intel");

const TZ = "America/New_York";

interface WeatherTrigger {
  id: string;
  name: string;
  check: (data: WeatherData) => boolean;
  gbpDraft: string;
}

export interface WeatherData {
  /** Highest forecast temperature over the forecast window (°F). */
  tempMax: number;
  /** Lowest forecast temperature over the forecast window (°F). */
  tempMin: number;
  /** First forecast period at or below 32°F, or an active NWS freeze alert. */
  freezeAt: Date | null;
  /** Heavy rain in the next 48h (named in the forecast, >=80% rain chance, or a flood alert). */
  heavyRain: boolean;
  /** Snow in the next 72h (>=50% chance) or an active winter-weather alert. */
  snowExpected: boolean;
  /** Active NWS heat alert. */
  heatAlert: boolean;
  description: string;
  /** Current month (1-12) in shop time. */
  month: number;
}

const monthInShopTz = (d: Date) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric" }).format(d));

const TRIGGERS: WeatherTrigger[] = [
  {
    id: "first_freeze",
    name: "First Freeze",
    // Month of the FORECAST freeze, so a freeze a few days out is seen now.
    check: (d) => d.freezeAt !== null && monthInShopTz(d.freezeAt) >= 10,
    gbpDraft: "First freeze of the season! Time to check your tires for winter readiness. We have winter tires starting at $60/tire installed with our free premium package. Book now: nickstire.org/booking",
  },
  {
    id: "heavy_rain",
    name: "Heavy Rain",
    check: (d) => d.heavyRain,
    gbpDraft: "Heavy rain in Cleveland today. Worn tires = hydroplaning risk. Free tread depth check — drive in anytime. Stay safe out there! (216) 862-0005",
  },
  {
    id: "snow_forecast",
    name: "Snow Forecast",
    // Operator alert + GBP draft only: no SMS template exists for this id.
    check: (d) => d.snowExpected,
    gbpDraft: "Snow is in the Cleveland forecast. Check your tread and wiper blades before it lands. Free tread depth check — drive in anytime. (216) 862-0005",
  },
  {
    id: "pothole_season",
    name: "Pothole Season",
    check: (d) => d.tempMax > 40 && d.tempMin < 32 && d.month >= 2 && d.month <= 4,
    gbpDraft: "Pothole season is here. If your car is pulling or vibrating, your alignment may be off. Free alignment check with any service at Nick's Tire & Auto.",
  },
  {
    id: "extreme_heat",
    name: "Extreme Heat",
    check: (d) => d.tempMax >= 92 || d.heatAlert,
    gbpDraft: "Extreme heat today! Is your AC blowing cold? We do full AC diagnostics and recharges. Keep your family cool — book now: nickstire.org/booking",
  },
  {
    id: "salt_season_end",
    name: "Salt Season End",
    check: (d) => d.month === 4 && d.tempMin > 40,
    gbpDraft: "Salt season is over. Protect your undercarriage from rust damage. We offer undercarriage inspections — catch corrosion early. (216) 862-0005",
  },
];

const HOUR = 60 * 60 * 1000;
// Freeze Watch/Warning, Hard Freeze — not a Frost Advisory (33-36°F is not a freeze).
const FREEZE_ALERT = /freeze/i;
const WINTER_ALERT = /winter storm|winter weather|lake effect snow|blizzard|ice storm/i;
const HEAT_ALERT = /heat/i;
const FLOOD_ALERT = /flood/i;

function withinHours(p: NwsPeriod, now: Date, hours: number): boolean {
  const start = Date.parse(p.startTime);
  return Number.isFinite(start) && start - now.getTime() < hours * HOUR;
}

function deriveWeatherData(periods: NwsPeriod[], alerts: NwsAlert[], now: Date): WeatherData {
  const temps = periods.map((p) => p.temperatureF);
  const freezePeriod = periods.find((p) => p.temperatureF <= 32);
  const freezeAlert = alerts.find((a) => FREEZE_ALERT.test(a.event));
  const text = (p: NwsPeriod) => `${p.shortForecast} ${p.detailedForecast}`;
  const pop = (p: NwsPeriod) => p.precipChancePct ?? 0;

  let freezeAt: Date | null = freezePeriod ? new Date(freezePeriod.startTime) : null;
  if (!freezeAt && freezeAlert) freezeAt = new Date(freezeAlert.onset ?? now.toISOString());

  return {
    tempMax: Math.max(...temps),
    tempMin: Math.min(...temps),
    freezeAt,
    heavyRain:
      periods.some((p) => withinHours(p, now, 48) && (/heavy rain/i.test(text(p)) || (/rain|showers|thunderstorm/i.test(p.shortForecast) && pop(p) >= 80))) ||
      alerts.some((a) => FLOOD_ALERT.test(a.event)),
    snowExpected:
      periods.some((p) => withinHours(p, now, 72) && /snow/i.test(p.shortForecast) && pop(p) >= 50) ||
      alerts.some((a) => WINTER_ALERT.test(a.event)),
    heatAlert: alerts.some((a) => HEAT_ALERT.test(a.event)),
    description: periods[0].shortForecast,
    month: monthInShopTz(now),
  };
}

/** Customer SMS may only act on what is imminent: the next 24 hours. */
const IMMINENT_HOURS = 24;

/**
 * PURE: forecast periods + active alerts -> weather data, the triggers the
 * whole forecast fires (operator alerts, drafts, planners — days ahead), the
 * subset that is IMMINENT (next 24h; the only triggers customer SMS may use,
 * because the SMS copy says "today"/"alert"), and an operator summary.
 */
export function evaluateForecast(
  periods: NwsPeriod[],
  alerts: NwsAlert[],
  now: Date = new Date(),
): { data: WeatherData; triggered: string[]; imminent: string[]; details: string } {
  if (periods.length === 0) throw new Error("weather: no forecast periods to evaluate");
  const data = deriveWeatherData(periods, alerts, now);
  const triggered = TRIGGERS.filter((t) => t.check(data)).map((t) => t.id);

  const nearPeriods = periods.filter((p, i) => i === 0 || withinHours(p, now, IMMINENT_HOURS));
  const nearAlerts = alerts.filter((a) => a.onset === null || Date.parse(a.onset) - now.getTime() < IMMINENT_HOURS * HOUR);
  const nearData = deriveWeatherData(nearPeriods, nearAlerts, now);
  const imminent = TRIGGERS.filter((t) => t.check(nearData)).map((t) => t.id);

  const parts = [`NWS 7-day ${data.tempMin}-${data.tempMax}°F, now ${data.description}`];
  if (data.freezeAt) {
    const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(data.freezeAt);
    parts.push(`freeze ${day} (${describeFreezeTiming(data.freezeAt)})`);
  }
  if (alerts.length > 0) parts.push(`alerts: ${[...new Set(alerts.map((a) => a.event))].join(", ")}`);
  return { data, triggered, imminent, details: parts.join("; ") };
}

async function readForecast(): Promise<{ periods: NwsPeriod[]; alerts: NwsAlert[] }> {
  const [periods, alerts] = await Promise.all([getForecastPeriods(), getActiveAlerts()]);
  return { periods, alerts };
}

/** SMS messages for each weather trigger type */
const WEATHER_SMS_TEMPLATES: Record<string, string> = {
  first_freeze: "Hi {name}, first freeze alert! Free battery test at Nick's. Don't get stranded. Drop off anytime. (216) 862-0005",
  heavy_rain: "Hi {name}, heavy rain today in Cleveland. Worn tires = danger. Free tread depth check — drop by anytime. (216) 862-0005",
  pothole_season: "Hi {name}, pothole season is here in Cleveland. Free alignment check at Nick's — just drop off. (216) 862-0005",
  extreme_heat: "Hi {name}, extreme heat alert! Is your AC blowing cold? Free AC check at Nick's — drop off anytime. (216) 862-0005",
  salt_season_end: "Hi {name}, salt season is over — time to check for rust damage. Free undercarriage inspection at Nick's. (216) 862-0005",
};

/**
 * Send weather-triggered SMS to lapsed customers (60+ days since last visit).
 * Max 10 SMS per trigger event to keep costs controlled.
 */
async function sendWeatherSms(triggerId: string): Promise<number> {
  const { isEnabled } = await import("./featureFlags");
  if (!(await isEnabled("weather_triggered_sms"))) return 0;

  const template = WEATHER_SMS_TEMPLATES[triggerId];
  if (!template) return 0;
  // SHADOW until armed. The trigger source changed on 2026-09-23 (OpenWeather
  // current conditions -> NWS forecast), so what fires a text changed too. The
  // flag was armed against the OLD meaning; the operator re-arms against the
  // new one with WEATHER_SMS_SEND=1. The flag stays the kill switch.
  if (process.env.WEATHER_SMS_SEND !== "1") {
    log.info(`Weather SMS shadow for "${triggerId}": not sent (set WEATHER_SMS_SEND=1 to arm)`);
    return 0;
  }

  try {
    const { getDb } = await import("../db");
    const { customers, smsMessages, smsConversations } = await import("../../drizzle/schema");
    const { sendSms, withOptOut } = await import("../sms");
    const { logOutboundSms } = await import("./smsInstrumentation");
    const { sql, and, isNotNull, eq, gte, like } = await import("drizzle-orm");

    const db = await getDb();
    if (!db) return 0;

    // Per-customer cooldown window for this weather trigger.
    const variantKey = `weather_${triggerId}`;
    const cooldownStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Find customers who haven't visited in 60+ days, have valid phone, not opted out
    const targets = await db.select({
      id: customers.id,
      firstName: customers.firstName,
      phone: customers.phone,
    }).from(customers).where(
      and(
        isNotNull(customers.lastVisitDate),
        eq(customers.smsOptOut, 0),
        isNotNull(customers.phone),
        sql`DATEDIFF(CURDATE(), ${customers.lastVisitDate}) >= 60`
      )
    ).limit(10);

    let sent = 0;
    for (const c of targets) {
      if (!c.phone) continue;

      // Per-customer cooldown — skip anyone already texted for THIS
      // weather trigger in the last 30 days. Without it, sendWeatherSms
      // re-texts the same lapsed customers on every run a weather
      // condition persists (rain for hours -> 'heavy_rain' fires each run).
      const normalized = c.phone.replace(/\D/g, "").slice(-10);
      const recent = await db.select({ id: smsMessages.id })
        .from(smsMessages)
        .innerJoin(smsConversations, eq(smsMessages.conversationId, smsConversations.id))
        .where(and(
          like(smsConversations.phone, `%${normalized}`),
          eq(smsMessages.direction, "outbound"),
          gte(smsMessages.createdAt, cooldownStart),
          eq(smsMessages.variantKey, variantKey),
        ))
        .limit(1);
      if (recent.length > 0) continue;

      const firstName = c.firstName || "there";
      const msg = withOptOut(template.replace("{name}", firstName));
      try {
        const result = await sendSms(c.phone, msg, { via: "shop", skipPersist: true, variantKey });
        // Log with the weather variantKey so the cooldown above sees this
        // send on the next run and the admin SMS tile counts it.
        // wave-2026-06 (telemetry dedup) — a QUEUED send already has ONE tiered
        // row from queueForLater (now carries variantKey); logging here too
        // would double-count it as an untagged twin. Only log the online path.
        if (!result.queued) {
          await logOutboundSms(c.phone, msg, result, variantKey);
        }
        // Only a confirmed send counts as sent; queued/uncertain are logged (audit F-3).
        const { smsOutcome: weatherOutcome } = await import("../lib/smsOutcome");
        const wo = weatherOutcome(result);
        if (wo === "sent") sent++;
        else if (wo !== "failed") log.info(`Weather SMS ${wo} for customer #${c.id} (not counted as sent)`);
      } catch (err) {
        log.warn(`Weather SMS failed for customer #${c.id}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (sent > 0) {
      log.info(`Weather SMS: sent ${sent} messages for trigger "${triggerId}"`);
    }
    return sent;
  } catch (err) {
    log.warn(`sendWeatherSms failed for "${triggerId}"`, { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

/**
 * PURE weather evaluation — fetch + classify, ZERO side effects (no alerts,
 * no SMS). This is the ONLY weather entry point observational surfaces
 * (shadow planner, dashboards, content drafting) may use: #824 review found
 * the Control tab's shadow plan could fire live customer SMS through
 * checkWeatherTriggers(). Throws when the forecast cannot be read, so a caller
 * shows "unavailable", never "no weather triggers".
 */
export async function evaluateWeatherTriggers(): Promise<{ triggered: string[]; details: string }> {
  const { periods, alerts } = await readForecast();
  const { triggered, details } = evaluateForecast(periods, alerts);
  return { triggered, details };
}

/** Operator alerts repeat at most once per trigger per this window (twice-daily cron, multi-day forecasts). */
const ALERT_REPEAT_MS = 20 * HOUR;
const lastAlertAt = new Map<string, number>();

/** Test-only. */
export function __resetWeatherAlertMemoryForTests(): void {
  lastAlertAt.clear();
}

/**
 * The weather-intel cron handler: evaluate, alert the operator with the GBP
 * draft, and hand each trigger to sendWeatherSms (shadow unless armed).
 * Throws on a failed forecast read so cron_log records `failed`.
 */
export async function checkWeatherTriggers(): Promise<{ triggered: string[]; details: string }> {
  const { periods, alerts } = await readForecast();
  const { data, triggered, imminent, details } = evaluateForecast(periods, alerts);

  for (const id of triggered) {
    const trigger = TRIGGERS.find((t) => t.id === id)!;
    log.info(`Weather trigger fired: ${trigger.name}`, { data });
    const last = lastAlertAt.get(id);
    if (last === undefined || Date.now() - last >= ALERT_REPEAT_MS) {
      const delivered = await alertSystem(
        `Weather: ${trigger.name}`,
        `${trigger.gbpDraft.slice(0, 200)}\n\n${details}`
      );
      if (delivered) {
        lastAlertAt.set(id, Date.now());
      } else {
        log.warn("[services/weatherIntelligence] operator weather alert was not delivered; throttle remains open", { triggerId: id });
      }
    }

    // A forecast days out drafts and alerts; only an imminent one may text.
    if (!imminent.includes(id)) continue;
    const smsSent = await sendWeatherSms(trigger.id);
    if (smsSent > 0) {
      alertSystem(
        `Weather SMS: ${trigger.name}`,
        `Sent ${smsSent} weather-triggered SMS for "${trigger.id}"`
      ).catch((e) => { log.warn("[services/weatherIntelligence] fire-and-forget failed:", e); });
    }
  }

  return { triggered, details: `${details}. ${triggered.length} triggers fired.` };
}
