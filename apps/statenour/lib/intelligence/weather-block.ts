/**
 * Weather demand signal for the Daily Executive Brief — a pure sibling to
 * energy-block / attention-block / capacity-block, counted before the model and
 * prepended VERBATIM. Weather is a tire shop's largest demand driver: snow and
 * freeze sell winter swaps + batteries, heat sells blowout checks. That signal
 * must surface as a DEMAND MOVE, not a temperature reading buried in a claim the
 * model might drop — so it lives here, prisma-free and fully canaried, and the
 * DB read (loadWeatherSignal) stays in the composer.
 *
 * The producer/consumer format contract is the silent-break risk: ingest.ts
 * writes rawContent via connectors/weather.ts `renderWeatherRawContent`, and
 * `parseWeatherSignal` below reads it back. The canary round-trips BOTH ends
 * through those two pure functions so a format drift on either side turns red,
 * never silently blanks the block.
 */

export interface WeatherSignal {
  /** Attribution line, e.g. "weather.gov" or "open-meteo (fallback; weather.gov did not serve)". */
  source: string;
  /** The "Demand Alerts:" body, verbatim markdown. */
  alertsMarkdown: string;
  /** True on a HIGH-severity forecast alert OR any official active NWS alert — both mean "act now". */
  hasHigh: boolean;
}

/**
 * Parse a weather SourceDocument's rawContent into a demand signal. PURE, so the
 * canary pins it against the EXACT bytes `renderWeatherRawContent` emits.
 */
export function parseWeatherSignal(raw: string): WeatherSignal {
  const srcLine = /^Source:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? "weather";
  const idx = raw.indexOf("Demand Alerts:");
  const alertsMarkdown =
    idx >= 0 ? raw.slice(idx + "Demand Alerts:".length).trim() : "- No weather-driven demand signal today.";
  const hasHigh = /\(HIGH/.test(alertsMarkdown) || /ACTIVE NWS ALERT/.test(alertsMarkdown);
  return { source: srcLine, alertsMarkdown, hasHigh };
}

/**
 * Render the demand signal as the verbatim brief block. A HIGH/official alert
 * leads with an act-now banner; a quiet day still renders (dormant-but-visible);
 * a null signal says so out loud — "source dormant or failed", never a blank
 * that reads as "quiet day".
 */
export function renderWeatherBlock(signal: WeatherSignal | null): string {
  if (!signal) {
    return "## ❄️ Weather Demand Signal\n\n- No weather ingest in the last 26h (source dormant or failed — not a quiet day).";
  }
  const lead = signal.hasHigh ? " — **HIGH: act ahead of the surge**" : "";
  return `## ❄️ Weather Demand Signal${lead}\n\n*Source: ${signal.source}*\n\n${signal.alertsMarkdown}`;
}
