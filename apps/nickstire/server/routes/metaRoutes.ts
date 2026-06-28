import type { Express, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { appRouter } from "../routers";
import { createLogger } from "../lib/logger";

const log = createLogger("meta-routes");

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function metaAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Check Statenour Sync Key
  const syncKey = process.env.STATENOUR_SYNC_KEY;
  const providedSyncKey = req.headers["x-statenour-sync-key"] || req.headers["x-sync-key"];
  
  if (syncKey && typeof providedSyncKey === "string" && safeCompare(providedSyncKey, syncKey)) {
    return next();
  }

  // 2. Check Admin API Key
  const auth = req.headers.authorization;
  const expectedAdminKey = process.env.ADMIN_API_KEY;
  if (expectedAdminKey && typeof auth === "string") {
    const expectedFull = `Bearer ${expectedAdminKey}`;
    if (auth.length === expectedFull.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
      return next();
    }
  }

  // Neither valid
  log.warn("Unauthorized request to /api/_meta/procedures", {
    ip: req.ip,
    hasSyncKey: !!providedSyncKey,
    hasAuthHeader: !!auth,
  });
  res.status(401).json({ error: "Unauthorized" });
}

export function registerMetaRoutes(app: Express): void {
  app.get("/api/_meta/procedures", metaAuth, (req: Request, res: Response) => {
    try {
      const proceduresList = Object.entries(appRouter._def.procedures).map(([path, proc]: [string, any]) => {
        return {
          path,
          type: proc._def.type || "query",
          meta: proc._def.meta || null,
        };
      });

      res.json({
        success: true,
        count: proceduresList.length,
        procedures: proceduresList,
      });
    } catch (err) {
      log.error("Failed to compile procedures metadata:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
