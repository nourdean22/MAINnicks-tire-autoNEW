/**
 * Request Logger Middleware — Logs every HTTP request with timing
 * Skips health check and static asset requests.
 * Warns on slow requests (>2000ms).
 */

import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

const log = createLogger("http");

// Paths to skip logging (health checks, static assets)
const SKIP_PATHS = new Set(["/api/ping", "/api/health", "/api/ready"]);
const SKIP_PREFIXES = ["/assets/", "/favicon", "/manifest", "/@vite", "/@fs", "/node_modules"];

function shouldSkip(path: string): boolean {
  if (SKIP_PATHS.has(path)) return true;
  return SKIP_PREFIXES.some((p) => path.startsWith(p));
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (shouldSkip(req.path)) {
    next();
    return;
  }

  const startTime = Date.now();
  const requestId = randomUUID().slice(0, 8);

  // Attach request ID for downstream use
  (req as { id?: string }).id = requestId;
  res.setHeader("X-Request-ID", requestId);

  // Log on response finish
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const meta = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      requestId,
      ip: req.ip,
      userAgent: req.get("user-agent")?.slice(0, 100),
    };

    if (duration > 2000) {
      log.warn(`Slow request: ${req.method} ${req.path} (${duration}ms)`, meta);
    } else if (res.statusCode >= 500) {
      log.error(`${req.method} ${req.path} ${res.statusCode}`, meta);
    } else if (res.statusCode >= 400) {
      log.warn(`${req.method} ${req.path} ${res.statusCode}`, meta);
    } else {
      log.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`, meta);
    }
  });

  next();
}
