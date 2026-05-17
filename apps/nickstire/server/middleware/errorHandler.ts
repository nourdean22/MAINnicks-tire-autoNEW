/**
 * Global Error Handler — Catches all unhandled Express errors
 * Returns sanitized responses (no stack traces in production)
 */

import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../lib/logger";

const log = createLogger("error-handler");

// ─── Custom Error Classes ───────────────────────
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = "INTERNAL_ERROR",
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super(401, message, "AUTHENTICATION_ERROR");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Insufficient permissions") {
    super(403, message, "AUTHORIZATION_ERROR");
    this.name = "AuthorizationError";
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super(429, "Too many requests", "RATE_LIMIT");
    this.details = { retryAfter };
    this.name = "RateLimitError";
  }
}

// ─── Error Handler Middleware ───────────────────
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as { id?: string }).id;
  const isDev = process.env.NODE_ENV !== "production";

  if (err instanceof AppError) {
    log.warn(err.message, {
      statusCode: err.statusCode,
      code: err.code,
      path: req.path,
      method: req.method,
      requestId,
    });

    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
      ...(requestId ? { requestId } : {}),
    });
    return;
  }

  // Unhandled error — always 500
  log.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId,
  });

  res.status(500).json({
    error: isDev ? err.message : "Internal server error",
    code: "INTERNAL_ERROR",
    ...(isDev && err.stack ? { stack: err.stack } : {}),
    ...(requestId ? { requestId } : {}),
  });
}
