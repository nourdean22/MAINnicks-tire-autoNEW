/**
 * Shared statenour auth middleware — v1.7 (audit pass 2026-05-02).
 *
 * Validates the X-Statenour-Sync-Key header against STATENOUR_SYNC_KEY
 * env using node:crypto.timingSafeEqual. Used by:
 *   · server/_core/statenour-bridge-routes.ts (cross-ring contract)
 *   · server/routes/{nour-strategy,nour-chief-strategist,psych-dominance,
 *     simulator,burnout-radar}.ts (statenour-driven AI agents)
 *
 * Pre-fix the 5 routes/* files were unauthenticated. Anyone on the
 * public internet could POST and burn the operator's OpenAI tokens
 * (gpt-4o-mini calls per request, multiple per route). This middleware
 * closes the cost-bleed.
 *
 * Fail-closed: if STATENOUR_SYNC_KEY is unset, returns 503 (not 200).
 */

import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("middleware:statenour-auth");

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    // Compare against self on length mismatch to hold the comparison time
    // constant (a bare early-return leaks whether the lengths matched).
    if (bufA.length !== bufB.length) {
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function statenourAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const key = process.env.STATENOUR_SYNC_KEY;
  if (!key) {
    res.status(503).json({ error: "Statenour bridge not configured" });
    return;
  }
  const provided = req.headers["x-statenour-sync-key"];
  if (typeof provided !== "string" || !safeCompare(provided, key)) {
    log.warn("statenour auth failed", {
      path: req.path,
      ip: req.ip,
      hasHeader: !!provided,
    });
    res.status(401).json({ error: "Invalid sync key" });
    return;
  }
  next();
}
