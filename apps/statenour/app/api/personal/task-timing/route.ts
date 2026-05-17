/**
 * GET /api/personal/task-timing · v10.0.92 · 2026-05-02.
 *
 * Returns best-hour-of-day predictions for open tasks based on
 * past completion patterns. Surfaces "you usually finish quick
 * health-domain tasks at 7-8am" so the operator can plan their
 * day around predicted completion windows.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { predictBestHoursForOpenTasks } from "@/lib/personal/task-timing-predictor";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") ?? "10", 10) || 10,
      30,
    );
    const hints = await predictBestHoursForOpenTasks(limit);
    return {
      generatedAt: new Date().toISOString(),
      hints,
      summary: {
        totalTasks: hints.length,
        withHint: hints.filter(
          (h) => h.hint?.topHours && h.hint.topHours.length > 0,
        ).length,
        bestSignalBucket:
          hints[0]?.hint?.signalBucket ?? null,
      },
    };
  },
  { auth: "owner" },
);
