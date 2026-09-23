import { createLogger } from "./lib/logger";
import { getHourlyPeriods, type NwsPeriod } from "./lib/nwsWeather";
const log = createLogger("weather");

/**
 * Current weather for the shop, from the National Weather Service hourly
 * forecast (lib/nwsWeather.ts — public-domain, commercial use allowed). The
 * first hourly period is the current hour. Drives the weather-reactive
 * notification bar, shop state and the voice agent's greeting.
 *
 * 2026-09-23 · this read Open-Meteo's free endpoint, whose terms allow
 * non-commercial use only; a business website is commercial use. The public
 * shape (WMO weather_code) is kept so no consumer changes: NWS forecast text
 * is mapped onto the WMO codes below by nwsForecastToWmoCode().
 */

// WMO Weather interpretation codes (the public weather_code vocabulary)
const WMO_CODES: Record<number, string> = {
  0: "clear",
  1: "mainly_clear",
  2: "partly_cloudy",
  3: "overcast",
  45: "fog",
  48: "rime_fog",
  51: "light_drizzle",
  53: "moderate_drizzle",
  55: "dense_drizzle",
  56: "freezing_drizzle_light",
  57: "freezing_drizzle_dense",
  61: "light_rain",
  63: "moderate_rain",
  65: "heavy_rain",
  66: "freezing_rain_light",
  67: "freezing_rain_heavy",
  71: "light_snow",
  73: "moderate_snow",
  75: "heavy_snow",
  77: "snow_grains",
  80: "light_showers",
  81: "moderate_showers",
  82: "violent_showers",
  85: "light_snow_showers",
  86: "heavy_snow_showers",
  95: "thunderstorm",
  96: "thunderstorm_hail_light",
  99: "thunderstorm_hail_heavy",
};

export interface WeatherData {
  temperature_f: number;
  wind_speed_mph: number;
  weather_code: number;
  weather_condition: string;
  is_day: boolean;
  precipitation_mm: number;
}

export interface WeatherAlert {
  active: boolean;
  severity: "info" | "warning" | "danger";
  message: string;
  cta: string;
  ctaHref: string;
  icon: string; // icon name for the frontend
}

let cachedWeather: { data: WeatherData; timestamp: number } | null = null;
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * NWS forecast text ("Chance Rain Showers", "Heavy Snow", "Mostly Sunny") ->
 * the nearest WMO code, most severe match first. A low-probability "chance"
 * of precipitation this hour is not weather happening now: it maps to cloudy.
 */
export function nwsForecastToWmoCode(shortForecast: string, precipChancePct: number | null = null): number {
  const t = shortForecast.toLowerCase();
  const precip = /snow|rain|showers|drizzle|sleet|thunderstorm|t-storm|ice|flurries/.test(t);
  if (precip && /^(slight )?chance/.test(t) && (precipChancePct ?? 0) < 50) return 3;
  if (/thunderstorm|t-storm/.test(t)) return /hail/.test(t) ? 96 : 95;
  if (/blizzard|heavy snow/.test(t)) return 75;
  if (/freezing rain|sleet|ice pellets|ice storm/.test(t)) return 66;
  if (/freezing drizzle/.test(t)) return 56;
  if (/snow showers/.test(t)) return /heavy/.test(t) ? 86 : 85;
  if (/light snow|flurries/.test(t)) return 71;
  if (/snow/.test(t)) return 73;
  if (/heavy rain/.test(t)) return 65;
  if (/showers/.test(t)) return /light|chance/.test(t) ? 80 : 81;
  if (/drizzle/.test(t)) return 51;
  if (/light rain/.test(t)) return 61;
  if (/rain/.test(t)) return 63;
  if (/fog/.test(t)) return 45;
  if (/partly/.test(t)) return 2;
  if (/mostly (sunny|clear)/.test(t)) return 1;
  if (/sunny|clear/.test(t)) return 0;
  return 3; // cloudy, overcast, haze, or text we do not recognise
}

/** The current-hour NWS period -> this module's public WeatherData. */
function weatherFromNwsPeriod(p: NwsPeriod): WeatherData {
  const code = nwsForecastToWmoCode(p.shortForecast, p.precipChancePct);
  return {
    temperature_f: Math.round(p.temperatureF),
    wind_speed_mph: Math.round(p.windMph ?? 0),
    weather_code: code,
    weather_condition: WMO_CODES[code] || "unknown",
    is_day: p.isDaytime,
    // The NWS hourly forecast carries a chance of precipitation, not an
    // amount. Precipitation is expressed through weather_code instead.
    precipitation_mm: 0,
  };
}

export async function getWeather(): Promise<WeatherData | null> {
  // Return cached data if fresh
  if (cachedWeather && Date.now() - cachedWeather.timestamp < CACHE_DURATION_MS) {
    return cachedWeather.data;
  }

  try {
    const periods = await getHourlyPeriods();
    // The hourly list is cached up to 45 min, so its first period can be an
    // hour that has already ended: pick the one covering now.
    const now = Date.now();
    const current = periods.find((p) => Date.parse(p.startTime) <= now && now < Date.parse(p.endTime)) ?? periods[0];
    const data = weatherFromNwsPeriod(current);
    cachedWeather = { data, timestamp: Date.now() };
    return data;
  } catch (error) {
    // Display path: a failed read degrades to the last good reading, or to
    // "no weather" (the notification bar then shows its default).
    log.warn("[Weather] NWS read failed:", error);
    return cachedWeather?.data || null;
  }
}

/** Test-only. */
export function __resetWeatherCacheForTests(): void {
  cachedWeather = null;
}

export function getWeatherAlert(weather: WeatherData): WeatherAlert {
  const temp = weather.temperature_f;
  const wind = weather.wind_speed_mph;
  const code = weather.weather_code;

  // ─── DANGER LEVEL: Severe conditions ─────────────────
  // Heavy snow
  if (code === 75 || code === 86) {
    return {
      active: true,
      severity: "danger",
      message: `Heavy snow in Cleveland right now (${temp}\u00B0F). Roads are dangerous \u2014 if you must drive, make sure your tires have tread.`,
      cta: "Check Tires",
      ctaHref: "tel:2168620005",
      icon: "snowflake",
    };
  }

  // Thunderstorm with hail
  if (code === 96 || code === 99) {
    return {
      active: true,
      severity: "danger",
      message: `Severe thunderstorm with hail in Cleveland. Stay safe \u2014 check your vehicle for damage after the storm passes.`,
      cta: "Call Us",
      ctaHref: "tel:2168620005",
      icon: "cloud_lightning",
    };
  }

  // Freezing rain
  if (code === 66 || code === 67) {
    return {
      active: true,
      severity: "danger",
      message: `Freezing rain in Cleveland (${temp}\u00B0F). Black ice is likely \u2014 drive slow and check your tires and brakes.`,
      cta: "Brake Check",
      ctaHref: "tel:2168620005",
      icon: "alert_triangle",
    };
  }

  // Extreme cold
  if (temp <= 10) {
    return {
      active: true,
      severity: "danger",
      message: `Extreme cold in Cleveland: ${temp}\u00B0F. Low temps drop tire pressure \u2014 check your TPMS and battery today.`,
      cta: "Free Check",
      ctaHref: "tel:2168620005",
      icon: "thermometer",
    };
  }

  // ─── WARNING LEVEL: Hazardous conditions ─────────────
  // Moderate/heavy snow
  if (code === 73 || code === 85) {
    return {
      active: true,
      severity: "warning",
      message: `Snow falling in Cleveland (${temp}\u00B0F). Make sure your tires have enough tread for safe stopping.`,
      cta: "Tire Check",
      ctaHref: "tel:2168620005",
      icon: "snowflake",
    };
  }

  // Thunderstorm
  if (code === 95) {
    return {
      active: true,
      severity: "warning",
      message: `Thunderstorm in Cleveland area. Drive carefully and check your wipers and tires.`,
      cta: "Call Us",
      ctaHref: "tel:2168620005",
      icon: "cloud_lightning",
    };
  }

  // Heavy rain
  if (code === 65 || code === 82) {
    return {
      active: true,
      severity: "warning",
      message: `Heavy rain in Cleveland. Worn tires hydroplane \u2014 if your tread is low, do not wait to replace them.`,
      cta: "Check Tires",
      ctaHref: "tel:2168620005",
      icon: "cloud_rain",
    };
  }

  // High winds
  if (wind >= 40) {
    return {
      active: true,
      severity: "warning",
      message: `High winds in Cleveland: ${wind} mph. Secure loose items and check your vehicle for damage.`,
      cta: "Call Us",
      ctaHref: "tel:2168620005",
      icon: "wind",
    };
  }

  // Cold enough for ice
  if (temp <= 32 && (code >= 51 || weather.precipitation_mm > 0)) {
    return {
      active: true,
      severity: "warning",
      message: `${temp}\u00B0F with precipitation in Cleveland \u2014 icy roads likely. Check your tires and brakes.`,
      cta: "Call Now",
      ctaHref: "tel:2168620005",
      icon: "alert_triangle",
    };
  }

  // ─── INFO LEVEL: Notable conditions ──────────────────
  // Light snow
  if (code === 71) {
    return {
      active: true,
      severity: "info",
      message: `Light snow in Cleveland (${temp}\u00B0F). Good time to check your tire tread and wiper blades.`,
      cta: "Schedule",
      ctaHref: "tel:2168620005",
      icon: "snowflake",
    };
  }

  // Fog
  if (code === 45 || code === 48) {
    return {
      active: true,
      severity: "info",
      message: `Foggy conditions in Cleveland. Make sure all your lights are working properly.`,
      cta: "Light Check",
      ctaHref: "tel:2168620005",
      icon: "cloud",
    };
  }

  // Moderate rain
  if (code === 63 || code === 81) {
    return {
      active: true,
      severity: "info",
      message: `Rainy in Cleveland today. Worn wipers and bald tires make wet driving dangerous.`,
      cta: "Check Tires",
      ctaHref: "tel:2168620005",
      icon: "cloud_rain",
    };
  }

  // Extreme heat
  if (temp >= 95) {
    return {
      active: true,
      severity: "warning",
      message: `${temp}\u00B0F in Cleveland. Extreme heat destroys underinflated tires \u2014 check your tire pressure today.`,
      cta: "Free Check",
      ctaHref: "tel:2168620005",
      icon: "thermometer",
    };
  }

  // Hot day
  if (temp >= 85) {
    return {
      active: true,
      severity: "info",
      message: `${temp}\u00B0F in Cleveland today. Hot pavement is hard on tires \u2014 make sure your pressure is right.`,
      cta: "Tire Check",
      ctaHref: "tel:2168620005",
      icon: "sun",
    };
  }

  // Cold morning \u2014 Cleveland fall/winter typically hits 36-45\u00B0F overnight,
  // and that's when TPMS lights start triggering. 45\u00B0F catches the "cold
  // morning, light just came on" walk-in window that 35\u00B0F misses.
  if (temp <= 45) {
    return {
      active: true,
      severity: "info",
      message: `${temp}\u00B0F in Cleveland. Cold temps drop tire pressure about 1 PSI per 10\u00B0F \u2014 check yours today.`,
      cta: "Free Check",
      ctaHref: "tel:2168620005",
      icon: "thermometer",
    };
  }

  // No notable weather
  return {
    active: false,
    severity: "info",
    message: "",
    cta: "",
    ctaHref: "",
    icon: "",
  };
}
