/**
 * GET /api/brain/prediction-streaks
 *
 * v8.1 · F4 · 2026-04-29.
 *
 * Returns per-category prediction-accuracy streaks. Drives the brain
 * card "you're on a 6-streak in business predictions" + the streak-
 * break alert when an unbroken run snaps.
 *
 * `?windowDays=` overrides the lookback window (defaults 90).
 */

import { apiHandler } from "@/lib/utils/http";
import { computePredictionStreaks } from "@/lib/brain/prediction-streaks";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const windowDays = Math.min(
    Math.max(Number(url.searchParams.get("windowDays")) || 90, 7),
    365,
  );
  const report = await computePredictionStreaks(windowDays);
  return report;
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts