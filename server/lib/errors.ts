/**
 * Structured Error Types — Typed error hierarchy for the entire application.
 *
 * Every error carries: code, message, statusCode, isOperational, context metadata.
 * Operational errors are expected (bad input, rate limit). Non-operational = bugs.
 *
 * Usage:
 *   throw new ValidationError("Email is required", { field: "email" });
 *   throw new DatabaseError("Connection timeout", { query: "SELECT..." });
 *   throw AppError.fromUnknown(err, "booking.create");
 */

// ─── Error Codes ────────────────────────────────────
export type ErrorCode =
  | "APP_ERROR"
  | "VALIDATION_ERROR"
  | "DATABASE_ERROR"
  | "AI_ERROR"
  | "RATE_LIMIT_ERROR"
  | "EXTERNAL_SERVICE_ERROR"
  | "AUTH_ERROR"
  | "NOT_FOUND_ERROR";

// ─── Base Error ─────────────────────────────────────
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context: Record<string, unknown>;
  public readonly timestamp: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      statusCode?: number;
      isOperational?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.code = options.code ?? "APP_ERROR";
    this.statusCode = options.statusCode ?? 500;
    this.isOperational = options.isOperational ?? true;
    this.context = options.context ?? {};
    this.timestamp = new Date().toISOString();

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      isOperational: this.isOperational,
      context: this.context,
      timestamp: this.timestamp,
      stack: process.env.NODE_ENV !== "production" ? this.stack : undefined,
    };
  }

  /**
   * Convert any unknown error into an AppError.
   * Preserves original error as cause for debugging.
   */
  static fromUnknown(err: unknown, source?: string): AppError {
    if (err instanceof AppError) return err;

    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error ? err : undefined;

    return new AppError(message, {
      code: "APP_ERROR",
      statusCode: 500,
      isOperational: false,
      context: { source, originalType: err?.constructor?.name },
      cause,
    });
  }
}

// ─── Validation Error ───────────────────────────────
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: "VALIDATION_ERROR",
      statusCode: 400,
      isOperational: true,
      context,
    });
  }
}

// ─── Database Error ─────────────────────────────────
export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: "DATABASE_ERROR",
      statusCode: 503,
      isOperational: true,
      context,
    });
  }

  static fromUnknown(err: unknown, source?: string): DatabaseError {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error ? err : undefined;

    // Detect common DB errors and provide better messages
    let friendlyMessage = message;
    if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT")) {
      friendlyMessage = "Database connection failed";
    } else if (message.includes("deadlock")) {
      friendlyMessage = "Database deadlock detected, please retry";
    } else if (message.includes("ER_DUP_ENTRY") || message.includes("Duplicate entry")) {
      friendlyMessage = "Duplicate record";
    }

    return new DatabaseError(friendlyMessage, {
      source,
      originalMessage: message,
      ...(cause ? { cause: cause.constructor.name } : {}),
    });
  }
}

// ─── AI Error ───────────────────────────────────────
export class AIError extends AppError {
  constructor(
    message: string,
    context?: Record<string, unknown> & { provider?: string; model?: string }
  ) {
    super(message, {
      code: "AI_ERROR",
      statusCode: 503,
      isOperational: true,
      context,
    });
  }
}

// ─── Rate Limit Error ───────────────────────────────
export class RateLimitError extends AppError {
  public readonly retryAfterMs: number;

  constructor(message?: string, options?: { retryAfterMs?: number; context?: Record<string, unknown> }) {
    super(message ?? "Too many requests. Please try again later or call us at (216) 862-0005.", {
      code: "RATE_LIMIT_ERROR",
      statusCode: 429,
      isOperational: true,
      context: options?.context,
    });
    this.retryAfterMs = options?.retryAfterMs ?? 60_000;
  }
}

// ─── External Service Error ─────────────────────────
export class ExternalServiceError extends AppError {
  constructor(
    service: string,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(`[${service}] ${message}`, {
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 502,
      isOperational: true,
      context: { service, ...context },
    });
  }
}

// ─── Auth Error ─────────────────────────────────────
export class AuthError extends AppError {
  constructor(message?: string, context?: Record<string, unknown>) {
    super(message ?? "Authentication required", {
      code: "AUTH_ERROR",
      statusCode: 401,
      isOperational: true,
      context,
    });
  }
}

// ─── Not Found Error ────────────────────────────────
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string | number) {
    super(`${resource} not found${identifier ? `: ${identifier}` : ""}`, {
      code: "NOT_FOUND_ERROR",
      statusCode: 404,
      isOperational: true,
      context: { resource, identifier },
    });
  }
}

// ─── Type guard ─────────────────────────────────────
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

// ─── Map AppError to HTTP response ──────────────────
export function errorToHttpResponse(err: AppError): {
  status: number;
  body: { error: string; code: ErrorCode; requestId?: string };
} {
  return {
    status: err.statusCode,
    body: {
      error: err.isOperational
        ? err.message
        : "Something went wrong. Please try again or call us at (216) 862-0005.",
      code: err.code,
    },
  };
}
