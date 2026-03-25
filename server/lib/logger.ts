/**
 * Structured Logger — Container-friendly JSON logging
 *
 * - JSON output in production, pretty-print in dev
 * - Request ID tracing via createRequestLogger()
 * - Named child loggers via createLogger(module)
 * - Levels: debug, info, warn, error, fatal
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const isDev = process.env.NODE_ENV !== "production";
const minLevel = isDev ? "debug" : "info";

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  module: string;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatDev(entry: LogEntry): string {
  const { level, timestamp, module, message, requestId, ...rest } = entry;
  const time = timestamp.slice(11, 23); // HH:MM:SS.mmm
  const levelColor: Record<LogLevel, string> = {
    debug: "\x1b[90m",   // gray
    info: "\x1b[36m",    // cyan
    warn: "\x1b[33m",    // yellow
    error: "\x1b[31m",   // red
    fatal: "\x1b[35m",   // magenta
  };
  const reset = "\x1b[0m";
  const prefix = `${levelColor[level]}${time} [${level.toUpperCase().padEnd(5)}]${reset} [${module}]`;
  const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  return `${prefix} ${message}${meta}`;
}

function emit(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;

  const output = isDev ? formatDev(entry) : JSON.stringify(entry);

  if (entry.level === "error" || entry.level === "fatal") {
    process.stderr.write(output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  fatal(message: string, meta?: Record<string, unknown>): void;
  child(extra: Record<string, unknown>): Logger;
}

export function createLogger(module: string, defaults?: Record<string, unknown>): Logger {
  function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    emit({
      level,
      timestamp: new Date().toISOString(),
      module,
      message,
      ...defaults,
      ...meta,
    });
  }

  return {
    debug: (msg, meta) => log("debug", msg, meta),
    info: (msg, meta) => log("info", msg, meta),
    warn: (msg, meta) => log("warn", msg, meta),
    error: (msg, meta) => log("error", msg, meta),
    fatal: (msg, meta) => log("fatal", msg, meta),
    child(extra) {
      return createLogger(module, { ...defaults, ...extra });
    },
  };
}

// ─── Global unhandled error handlers ─────────────
const globalLogger = createLogger("process");

process.on("uncaughtException", (err) => {
  globalLogger.fatal("Uncaught exception", { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  globalLogger.error("Unhandled promise rejection", { error: msg, stack });
});
