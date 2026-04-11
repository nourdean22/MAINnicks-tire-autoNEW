/**
 * Burnout Radar Agent — Productivity health monitoring endpoint.
 *
 * POST /api/agents/burnout-radar
 * Body: { taskHistory: Array<{ status: string; [key: string]: unknown }>; lastAction: string }
 *
 * Analyzes task history for burnout signals:
 *   - 3+ tasks with status === 'skipped'
 *   - lastAction contains 'bored' (case-insensitive)
 *
 * Returns:
 *   { status: 'ALERT', message: string } — when burnout pattern detected
 *   { status: 'OPTIMAL' }               — when productivity is healthy
 */

import type { Express, Request, Response } from "express";

interface Task {
  status: string;
  [key: string]: unknown;
}

export function registerBurnoutRadarRoute(app: Express): void {
  app.post("/api/agents/burnout-radar", (req: Request, res: Response) => {
    try {
      const { taskHistory, lastAction } = req.body as {
        taskHistory?: unknown;
        lastAction?: unknown;
      };

      if (!Array.isArray(taskHistory)) {
        res.status(400).json({
          error: "Request body must include a 'taskHistory' array",
        });
        return;
      }

      if (typeof lastAction !== "string") {
        res.status(400).json({
          error: "Request body must include a 'lastAction' string",
        });
        return;
      }

      const missedTasks = (taskHistory as Task[]).filter(
        (task) => task?.status === "skipped"
      ).length;

      const isBored = lastAction.toLowerCase().includes("bored");

      if (missedTasks >= 3 || isBored) {
        res.json({
          status: "ALERT",
          message:
            "CRITICAL: Productivity death spiral. You need a Low Friction Win.",
        });
        return;
      }

      res.json({ status: "OPTIMAL" });
    } catch (err: unknown) {
      console.error("[burnout-radar] Agent failed:", err);
      res.status(500).json({
        error:
          err instanceof Error ? err.message : "Burnout radar agent failed",
      });
    }
  });
}
