import { cronHandler } from "@/lib/utils/http";
import { runDailyReflection, runWeeklyReflection } from "@/lib/brain/reflection-engine";
export const maxDuration = 60;

/**
 * GET /api/cron/reflect — Layer 4 Reflection Engine
 *
 * Runs daily by default. On Sundays, runs the deeper weekly analysis.
 * Analyzes ALL memory layers and generates higher-order insights.
 */
export const GET = cronHandler(async () => {
  const dayOfWeek = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  });

  const isWeekly = dayOfWeek === "Sunday";

  const daily = await runDailyReflection();

  let weekly = null;
  if (isWeekly) {
    weekly = await runWeeklyReflection();
  }

  return {
    scope: isWeekly ? "daily+weekly" : "daily",
    daily: {
      saved: daily.saved,
      reflections: daily.reflections,
    },
    ...(weekly && {
      weekly: {
        saved: weekly.saved,
        reflections: weekly.reflections,
      },
    }),
  };
});
