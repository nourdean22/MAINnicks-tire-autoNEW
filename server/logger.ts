/**
 * Structured Logger for Nick's Tire & Auto
 * JSON logging with sensitive data masking and correlation IDs.
 */

import { nanoid } from "nanoid";
import type { Request, Response, NextFunction } from "express";

type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

const SENSITIVE_KEYS = /password|token|secret|apikey|authtoken|authorization|cookie/i;
const PHONE_REGEX = /(\+?1?\s*[-.]?\s*)?(\(?\d{3}\)?)\s*[-.]?\s*(\d{3})\s*[-.]?\s*(\d{4})/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function getMinLevel(): LogLevel {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL as LogLevel;
  return process.env.NODE_ENV === "production" ? "warn" : "debug";
}

/** Recursively mask sensitive values in an object. */
function maskSensitive(data: unknown, depth = 0): unknown {
  if (depth > 5 || data === null || data === undefined) return data;

  if (typeof data === "string") {
    let masked = data.replace(PHONE_REGEX, "***-***-$4");
    masked = masked.replace(EMAIL_REGEX, (match) => {
      const [local, domain] = match.split("@");
      return `${local[0]}***@***.${domain.split(".").pop()}`;
    });
    return masked;
  }

  if (Array.isArray(data)) {
    return data.map((item) => maskSensitive(item, depth + 1));
  }

  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = maskSensitive(value, depth + 1);
      }
    }
    return result;
  }

  return data;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getMinLevel()];
}

function writeLog(level: LogLevel, message: string, data?: unknown, correlationId?: string): void {
  if (!shouldLog(level)) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    correlationId: correlationId || undefined,
    message,
    data: data ? maskSensitive(data) : undefined,
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case "error":
    case "critical":
      process.stderr.write(line + "\n");
      break;
    default:
      process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (msg: string, data?: unknown, correlationId?: string) =>
    writeLog("debug", msg, data, correlationId),
  info: (msg: string, data?: unknown, correlationId?: string) =>
    writeLog("info", msg, data, correlationId),
  warn: (msg: string, data?: unknown, correlationId?: string) =>
    writeLog("warn", msg, data, correlationId),
  error: (msg: string, data?: unknown, correlationId?: string) =>
    writeLog("error", msg, data, correlationId),
  critical: (msg: string, data?: unknown, correlationId?: string) =>
    writeLog("critical", msg, data, correlationId),
};

/** Express middleware: logs every request with method, path, status, timing. */
export function createRequestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const correlationId = nanoid(12);
    (res as any).locals.correlationId = correlationId;
    const start = Date.now();

    res.on("finish", () => {
      const duration = Date.now() - start;
      const level: LogLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      writeLog(level, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip,
        userAgent: req.get("user-agent")?.slice(0, 100),
      }, correlationId);
    });

    next();
  };
}
