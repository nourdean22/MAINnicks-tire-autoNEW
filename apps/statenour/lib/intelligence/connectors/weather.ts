import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connector/weather");

export interface WeatherAlert {
  event: string;
  severity: string;
  description: string;
  opportunity: string;
}

export interface WeatherData {
  location: string;
  temperature: number;
  condition: string;
  forecast: string;
  alerts: WeatherAlert[];
}

export async function fetchWeatherMetrics(): Promise<WeatherData> {
  const url = "https://api.weather.gov/gridpoints/CLE/85,73/forecast";
  
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "ClevelandTireNourishing nourdean22@gmail.com"
      },
      signal: AbortSignal.timeout(6000)
    });
    
    if (!res.ok) {
      throw new Error(`NOAA API returned ${res.status}`);
    }
    
    const data = await res.json() as { properties?: { periods?: Array<{ name: string; temperature: number; detailedForecast: string; shortForecast: string }> } };
    const periods = data.properties?.periods || [];
    
    if (periods.length === 0) {
      throw new Error("No periods in NOAA response");
    }
    
    const currentPeriod = periods[0];
    const temp = currentPeriod.temperature;
    const condition = currentPeriod.shortForecast;
    const forecast = currentPeriod.detailedForecast;
    
    const alerts: WeatherAlert[] = [];
    
    // Auto-generate alerts based on forecast text
    const textLower = forecast.toLowerCase();
    if (textLower.includes("snow") || textLower.includes("freeze") || textLower.includes("ice") || temp <= 35) {
      alerts.push({
        event: "Winter Hazard Alert",
        severity: "HIGH",
        description: `Freezing temperatures or snow predicted in Cleveland. Current forecast: ${forecast}`,
        opportunity: "Promote immediate winter tire swap packages and battery diagnostics to VIP customers via SMS."
      });
    } else if (textLower.includes("rain") || textLower.includes("thunderstorm") || textLower.includes("flood")) {
      alerts.push({
        event: "Wet Road Advisory",
        severity: "MEDIUM",
        description: `Rain or wet conditions predicted. Forecast: ${forecast}`,
        opportunity: "Promote brake inspections and premium wiper blade replacements to customers overdue for maintenance."
      });
    } else if (temp >= 85) {
      alerts.push({
        event: "High Heat Advisory",
        severity: "LOW",
        description: `Summer heat wave predicted (${temp}°F). Forecast: ${forecast}`,
        opportunity: "Send heat-wave alerts suggesting tire pressure checks (avoiding blowouts) and AC recharge service specials."
      });
    }

    return {
      location: "Cleveland, OH",
      temperature: temp,
      condition,
      forecast,
      alerts
    };
  } catch (err) {
    log.error("Failed to fetch weather from NOAA, falling back to mock data.", {
      error: err instanceof Error ? err.message : String(err)
    });
    
    // Simulate typical seasonal Cleveland weather based on current month
    const month = new Date().getMonth(); // 0 = Jan, 11 = Dec
    let temp = 72;
    let condition = "Partly Cloudy";
    let forecast = "Partly cloudy with a gentle breeze. High near 72.";
    const alerts: WeatherAlert[] = [];
    
    if (month >= 10 || month <= 2) { // Nov - Mar (Winter)
      temp = 28;
      condition = "Light Snow";
      forecast = "Light snow showers expected in the Cleveland metro area. Total snow accumulation of 1 to 3 inches possible. Low near 28.";
      alerts.push({
        event: "Winter Hazard Alert",
        severity: "HIGH",
        description: `Freezing temperatures or snow predicted in Cleveland. Current forecast: ${forecast}`,
        opportunity: "Promote immediate winter tire swap packages and battery diagnostics to VIP customers via SMS."
      });
    } else if (month === 3 || month === 4 || month === 8 || month === 9) { // Apr, May, Sep, Oct (Rainy / Transitional)
      temp = 55;
      condition = "Showers";
      forecast = "Periods of rain showers. High near 55. Chance of precipitation is 80%.";
      alerts.push({
        event: "Wet Road Advisory",
        severity: "MEDIUM",
        description: `Rain or wet conditions predicted. Forecast: ${forecast}`,
        opportunity: "Promote brake inspections and premium wiper blade replacements to customers overdue for maintenance."
      });
    } else { // Summer (Jun, Jul, Aug)
      temp = 88;
      condition = "Sunny";
      forecast = "Mostly sunny and hot. High near 88. Heat index values up to 93.";
      alerts.push({
        event: "High Heat Advisory",
        severity: "LOW",
        description: `Summer heat wave predicted (88°F). Forecast: ${forecast}`,
        opportunity: "Send heat-wave alerts suggesting tire pressure checks (avoiding blowouts) and AC recharge service specials."
      });
    }

    return {
      location: "Cleveland, OH",
      temperature: temp,
      condition,
      forecast,
      alerts
    };
  }
}
