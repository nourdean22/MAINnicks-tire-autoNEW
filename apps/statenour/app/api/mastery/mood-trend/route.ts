import { apiHandler } from "@/lib/utils/http";
import { recentScoreSnapshots } from "@/lib/brain/legacy-shims";

/**
 * GET /api/mastery/mood-trend?days=14
 *
 * Returns a lightweight 14-day (default) series of daily score data
 * for the /command Mood Trend card. Includes mood label + energy +
 * focus + overall so the UI can render a sparkline + delta + average
 * + today's mood indicator without a heavier /brain/arc call.
 *
 * Missing days are filled with nulls so the sparkline stays aligned
 * to the date axis.
 *
 * v10.0.60 · Wave A part 3 · Pre-fix this read a dead
 * `Promise.resolve([])` for the retired DailyScore table — the
 * mood card on /command was always blank. Now sourced from
 * legacy-shim (identity_snapshot JSON parse).
 */
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const days = Math.max(7, Math.min(90, Number(url.searchParams.get("days") || 14)));

  const scores = await recentScoreSnapshots(days);

  // Build an indexed map so we can fill missing days with null
  const byDate = new Map(scores.map((s) => [s.date, s]));
  const series: Array<{
    date: string;
    mood: string | null;
    energy: number | null;
    focus: number | null;
    overall: number | null;
  }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const s = byDate.get(key);
    series.push({
      date: key,
      mood: s?.mood ?? null,
      energy: s?.energyLevel ?? null,
      focus: s?.focusQuality ?? null,
      overall: s?.overallScore != null ? Math.round(s.overallScore * 10) / 10 : null,
    });
  }

  // Summary stats for the card header
  const overallValues = series.map((p) => p.overall).filter((v): v is number => v != null);
  const average =
    overallValues.length > 0
      ? overallValues.reduce((sum, v) => sum + v, 0) / overallValues.length
      : null;

  const recentN = Math.floor(days / 2);
  const recent = overallValues.slice(-recentN);
  const prior = overallValues.slice(0, overallValues.length - recentN);
  const recentAvg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  const priorAvg = prior.length > 0 ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
  const delta =
    recentAvg != null && priorAvg != null ? Math.round((recentAvg - priorAvg) * 10) / 10 : null;

  const today = series[series.length - 1];
  const loggedDays = overallValues.length;

  return {
    days,
    loggedDays,
    average: average != null ? Math.round(average * 10) / 10 : null,
    delta,
    todayMood: today?.mood ?? null,
    todayScore: today?.overall ?? null,
    series,
  };
}, { auth: "owner" }); // v10.0.37 — was unauthed
