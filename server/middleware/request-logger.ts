/**
 * Request logging middleware — logs method, path, status, and response time.
 * Skips noisy static asset requests in production.
 */

import type { Request, Response, NextFunction } from "express";

const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|webp|svg|ico|woff2?|ttf|map)$/;

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Skip static asset requests to keep logs clean
  if (STATIC_EXTENSIONS.test(req.path)) return next();

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;

    // Only log API calls and page requests, skip if under 1ms and successful
    if (req.path.startsWith("/api/") || !req.path.includes(".")) {
      const level = status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO";
      const slowTag = duration > 1000 ? " [SLOW]" : "";
      console.log(
        `[${level}] ${req.method} ${req.path} → ${status} (${duration}ms)${slowTag}`
      );
    }
  });

  next();
}
