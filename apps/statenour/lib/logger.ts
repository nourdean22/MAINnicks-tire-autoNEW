// ── Structured Logger ──────────────────────────────────────────────────
// JSON in production (Vercel runtime logs compatible), pretty in dev.

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  route?: string;
  method?: string;
  requestId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set([
  "password", "token", "secret", "key", "authorization",
  "cookie", "x-sync-key", "bearer", "api_key", "apikey",
  // PII fields — never log customer data
  "phone", "email", "phonenumber", "phone_number",
  "ssn", "social_security", "creditcard", "credit_card",
  "fullname", "full_name", "address", "dob", "date_of_birth",
]);

function redactSensitive(obj: unknown, depth = 0): unknown {
  if (obj === null || obj === undefined) return obj;
  if (depth > 3) {
    if (typeof obj === "object") {
      return "[REDACTED_SUBTREE]";
    }
    return obj;
  }
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactSensitive(v, depth + 1));
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        result[k] = "[REDACTED]";
      } else {
        result[k] = redactSensitive(v, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

const isProd = process.env.NODE_ENV === "production";

function formatDev(entry: LogEntry): string {
  const time = new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false });
  const icon = entry.level === "error" ? "\x1b[31m✗" :
               entry.level === "warn" ? "\x1b[33m⚠" :
               entry.level === "debug" ? "\x1b[36m◌" : "\x1b[32m✓";
  const reset = "\x1b[0m";

  const parts = [
    `${icon} ${time}${reset}`,
    entry.msg,
  ];

  if (entry.route) parts.push(`${entry.method ?? ""} ${entry.route}`);
  if (entry.ms !== undefined) parts.push(`[${entry.ms}ms]`);
  if (entry.requestId) parts.push(`reqId=${entry.requestId}`);

  return parts.filter(Boolean).join(" ");
}

function emit(level: LogLevel, msg: string, ctx?: LogContext, metadata?: Record<string, unknown>) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
    ...metadata,
  };

  // Redact sensitive fields from metadata
  const safeEntry = redactSensitive(entry) as LogEntry;

  if (isProd) {
    const fn = level === "error" ? console.error :
               level === "warn" ? console.warn : console.log;
    fn(JSON.stringify(safeEntry));
  } else {
    const fn = level === "error" ? console.error :
               level === "warn" ? console.warn :
               level === "debug" ? console.debug : console.log;
    fn(formatDev(safeEntry));
  }
}

function createLogger(baseCtx: LogContext = {}) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, baseCtx, meta),
    info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, baseCtx, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, baseCtx, meta),
    error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, baseCtx, meta),

    /** Create a child logger with pre-bound context */
    withContext: (ctx: LogContext) => createLogger({ ...baseCtx, ...ctx }),

    /**
     * v10 E.5 correlation — bind a traceId so every line emitted by
     * the returned logger correlates with the AgentTrace row for the
     * same operation. Pairs cleanly with mintTraceId() at the top of
     * a route + recordTrace() at the bottom.
     */
    withTraceId: (traceId: string) => createLogger({ ...baseCtx, traceId }),

    /**
     * v10.0.18 — bind a stable surface for the line. `surface` is the
     * subsystem owning the call (e.g. "ai/provider", "cron/weekly-review",
     * "brain-bus/dispatch"). Used by /system/* dashboards to slice logs
     * by domain without parsing free-form `msg`.
     */
    withSurface: (surface: string) => createLogger({ ...baseCtx, surface }),

    /** Start a timer, returns a stop function that logs the duration */
    time: (label: string) => {
      const start = Date.now();
      return {
        stop: (meta?: Record<string, unknown>) => {
          const ms = Date.now() - start;
          emit("info", label, baseCtx, { ms, ...meta });
          return ms;
        },
      };
    },
  };
}

export const logger = createLogger();
export type Logger = ReturnType<typeof createLogger>;
