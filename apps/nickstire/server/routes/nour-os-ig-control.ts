/**
 * NOUR OS Instagram control — the two StateNour-triggered IG actions that
 * MUTATE: a run that can publish live, and the live-posting switch.
 *
 * POST /api/nour-os/ig-control
 * Header: x-ig-control-key (required) — NOUR_OS_IG_CONTROL_KEY
 * Body: { action: "autopost_run" | "autopost_set_config", filters?: object }
 *
 * Why this is not in /api/nour-os/query (Q-13, estate doc §10.1 S2): the query
 * API is authenticated by STATENOUR_SYNC_KEY, the one key every cross-app
 * caller holds (sync, escalations, backups, camera fallback). Anyone holding it
 * could publish to the shop's public Instagram. This route takes its own key,
 * so the sync key alone can no longer post.
 *
 * Fail-closed, with no fallback: an unset control key, or one equal to
 * STATENOUR_SYNC_KEY, answers 503 and runs nothing. A fallback to the sync
 * key (the camera-ingest pattern) would keep the exact exposure this route
 * exists to remove.
 */

import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("nour-os-ig-control");

export const IG_CONTROL_PATH = "/api/nour-os/ig-control";
export const IG_CONTROL_HEADER = "x-ig-control-key";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

type IgControlHandler = (filters: Record<string, unknown>) => Promise<unknown>;

const IG_CONTROL_HANDLERS: Record<string, IgControlHandler> = {
  // Moved verbatim from the query API. A live run on a disarmed lane arms
  // legacy_autopost_live for the duration of this run and restores it after.
  autopost_run: async (filters) => {
    const { runIgAutopost } = await import("../services/igAutopost");
    const { isEnabled, setFlag } = await import("../services/featureFlags");

    const dryRun = filters.dryRun !== false;
    const forceArchetype = filters.forceArchetype as any;

    const initialFlag = await isEnabled("legacy_autopost_live");

    if (!initialFlag && !dryRun) {
      await setFlag("legacy_autopost_live", true);
    }

    try {
      return await runIgAutopost({
        dryRun,
        forceArchetype,
        source: "admin",
      });
    } finally {
      if (!initialFlag && !dryRun) {
        await setFlag("legacy_autopost_live", false);
      }
    }
  },

  autopost_set_config: async (filters) => {
    const { setFlag } = await import("../services/featureFlags");
    const enabled = filters.enabled === true;
    await setFlag("legacy_autopost_live", enabled);
    return { success: true, livePostingEnabled: enabled };
  },
};

export function registerNourOsIgControlRoute(app: Express): void {
  app.post(IG_CONTROL_PATH, async (req: Request, res: Response) => {
    const controlKey = process.env.NOUR_OS_IG_CONTROL_KEY || "";
    const syncKey = process.env.STATENOUR_SYNC_KEY || "";

    if (!controlKey || (syncKey && safeCompare(controlKey, syncKey))) {
      log.warn("IG control refused: NOUR_OS_IG_CONTROL_KEY is unset or equals STATENOUR_SYNC_KEY");
      return res.status(503).json({ error: "Instagram control is not configured" });
    }

    const provided = req.headers[IG_CONTROL_HEADER];
    if (typeof provided !== "string" || !safeCompare(provided, controlKey)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { action, filters } = (req.body ?? {}) as { action?: unknown; filters?: unknown };
    const handler = typeof action === "string" && Object.hasOwn(IG_CONTROL_HANDLERS, action)
      ? IG_CONTROL_HANDLERS[action]
      : undefined;
    if (!handler) {
      return res.status(400).json({ error: "Unknown action", available: Object.keys(IG_CONTROL_HANDLERS) });
    }
    if (filters !== undefined && filters !== null && (typeof filters !== "object" || Array.isArray(filters))) {
      return res.status(400).json({ error: "filters must be an object" });
    }
    const safeFilters = (filters ?? {}) as Record<string, unknown>;

    try {
      const result = await handler(safeFilters);
      log.info(`IG control: ${action}`, { filters: safeFilters });
      return res.json({ action, timestamp: new Date().toISOString(), data: result });
    } catch (err) {
      log.error(`IG control failed: ${action}`, { error: err instanceof Error ? err.message : String(err) });
      return res.status(500).json({ error: "IG control action failed" });
    }
  });
}
