/**
 * Weather service for Cleveland, OH using Open-Meteo API (free, no API key required).
 * Fetches current conditions and generates weather-reactive notifications
 * that override the default notification bar during severe weather.
 *
 * Cleveland coordinates: 41.4993, -81.6944
 */

const CLEVELAND_LAT = 41.4993;
const CLEVELAND_LON = -81.6944;

// WMO Weather interpretation codes
// https://open-meteo.com/en/docs
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

export async function getWeather(): Promise<WeatherData | null> {
  // Return cached data if fresh
  if (cachedWeather && Date.now() - cachedWeather.timestamp < CACHE_DURATION_MS) {
    return cachedWeather.data;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CLEVELAND_LAT}&longitude=${CLEVELAND_LON}&current=temperature_2m,wind_speed_10m,weather_code,is_day,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn("[Weather] API returned status:", response.status);
      return cachedWeather?.data || null;
    }

    const json = await response.json();
    const current = json.current;

    const data: WeatherData = {
      temperature_f: Math.round(current.temperature_2m),
      wind_speed_mph: Math.round(current.wind_speed_10m),
      weather_code: current.weather_code,
      weather_condition: WMO_CODES[current.weather_code] || "unknown",
      is_day: current.is_day === 1,
      precipitation_mm: current.precipitation || 0,
    };

    cachedWeather = { data, timestamp: Date.now() };
    return data;
  } catch (error) {
    console.warn("[Weather] Failed to fetch:", error);
    return cachedWeather?.data || null;
  }
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

  // Cold morning
  if (temp <= 35) {
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
