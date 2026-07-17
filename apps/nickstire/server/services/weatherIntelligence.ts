/**
 * Weather Intelligence — Triggers marketing campaigns based on Cleveland weather
 * Uses OpenWeatherMap API to detect freeze, rain, heat, pothole season, salt end.
 * Stages GBP post drafts for owner review.
 *
 * Requires: OPENWEATHER_API_KEY env var
 */

import { createLogger } from "../lib/logger";
import { alertSystem } from "./telegram";

const log = createLogger("weather-intel");

// Cleveland/Euclid coordinates
const LAT = 41.5932;
const LON = -81.5268;

interface WeatherTrigger {
  id: string;
  name: string;
  check: (data: WeatherData) => boolean;
  gbpDraft: string;
}

interface WeatherData {
  tempMax: number;
  tempMin: number;
  rainMm: number;
  snowMm: number;
  description: string;
  month: number;
}

const TRIGGERS: WeatherTrigger[] = [
  {
    id: "first_freeze",
    name: "First Freeze",
    check: (d) => d.tempMin <= 32 && d.month >= 10,
    gbpDraft: "First freeze of the season! Time to check your tires for winter readiness. We have winter tires starting at $60/tire installed with our free premium package. Book now: nickstire.org/booking",
  },
  {
    id: "heavy_rain",
    name: "Heavy Rain",
    check: (d) => d.rainMm > 20,
    gbpDraft: "Heavy rain in Cleveland today. Worn tires = hydroplaning risk. Free tread depth check — drive in anytime. Stay safe out there! (216) 862-0005",
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
    check: (d) => d.tempMax >= 92,
    gbpDraft: "Extreme heat today! Is your AC blowing cold? We do full AC diagnostics and recharges. Keep your family cool — book now: nickstire.org/booking",
  },
  {
    id: "salt_season_end",
    name: "Salt Season End",
    check: (d) => d.month === 4 && d.tempMin > 40,
    gbpDraft: "Salt season is over. Protect your undercarriage from rust damage. We offer undercarriage inspections — catch corrosion early. (216) 862-0005",
  },
];

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
        if (result.success) sent++;
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
 * (shadow planner, dashboards) may use: #824 review found the Control tab's
 * shadow plan could fire live customer SMS through checkWeatherTriggers().
 */
export async function evaluateWeatherTriggers(): Promise<{ triggered: string[]; details: string }> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    log.debug("OPENWEATHER_API_KEY not set, skipping");
    return { triggered: [], details: "No API key" };
  }
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LON}&appid=${apiKey}&units=imperial`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { triggered: [], details: `API error: ${res.status}` };
    const raw = await res.json();
    const data: WeatherData = {
      tempMax: raw.main?.temp_max ?? 50,
      tempMin: raw.main?.temp_min ?? 40,
      rainMm: (raw.rain?.["1h"] ?? 0) * 25.4,
      snowMm: (raw.snow?.["1h"] ?? 0) * 25.4,
      description: raw.weather?.[0]?.description ?? "",
      month: new Date().getMonth() + 1,
    };
    const triggered = TRIGGERS.filter((t) => t.check(data)).map((t) => t.id);
    return { triggered, details: `Temp: ${data.tempMin}-${data.tempMax}°F, ${data.description}` };
  } catch (e) {
    return { triggered: [], details: e instanceof Error ? e.message : "weather evaluation failed" };
  }
}

export async function checkWeatherTriggers(): Promise<{ triggered: string[]; details: string }> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    log.debug("OPENWEATHER_API_KEY not set, skipping");
    return { triggered: [], details: "No API key" };
  }

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LON}&appid=${apiKey}&units=imperial`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { triggered: [], details: `API error: ${res.status}` };

    const raw = await res.json();
    const data: WeatherData = {
      tempMax: raw.main?.temp_max ?? 50,
      tempMin: raw.main?.temp_min ?? 40,
      rainMm: (raw.rain?.["1h"] ?? 0) * 25.4,
      snowMm: (raw.snow?.["1h"] ?? 0) * 25.4,
      description: raw.weather?.[0]?.description ?? "",
      month: new Date().getMonth() + 1,
    };

    const triggered: string[] = [];

    for (const trigger of TRIGGERS) {
      if (trigger.check(data)) {
        triggered.push(trigger.id);
        log.info(`Weather trigger fired: ${trigger.name}`, { data });
        alertSystem(
          `Weather: ${trigger.name}`,
          `${trigger.gbpDraft.slice(0, 200)}\n\nTemp: ${data.tempMin}-${data.tempMax}°F`
        ).catch((e) => { log.warn("[services/weatherIntelligence] fire-and-forget failed:", e); });

        // Send weather-triggered SMS to lapsed customers
        const smsSent = await sendWeatherSms(trigger.id);
        if (smsSent > 0) {
          alertSystem(
            `Weather SMS: ${trigger.name}`,
            `Sent ${smsSent} weather-triggered SMS for "${trigger.id}"`
          ).catch((e) => { log.warn("[services/weatherIntelligence] fire-and-forget failed:", e); });
        }
      }
    }

    return {
      triggered,
      details: `${data.tempMin}-${data.tempMax}°F, ${data.description}. ${triggered.length} triggers fired.`,
    };
  } catch (err) {
    log.warn("Weather check failed", { err });
    return { triggered: [], details: "Fetch failed" };
  }
}
