/**
 * Structured Logger — Container-friendly JSON logging
 *
 * - JSON output in production, pretty-print in dev
 * - Child loggers via createLogger(module).child(...)
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

/**
 * Logger interface is tolerant of any arg shape so we can rewrite
 * `console.log(a, b, c)` straight to `log.info(a, b, c)` without
 * every caller having to reshape. Normalization happens inside:
 *   - Record<string, unknown>  → merged into structured meta
 *   - Error                    → { error: msg, stack }
 *   - string / number / bool   → appended to message (primitive args)
 *   - anything else            → { arg{n}: serialized }
 * A call with multiple extra args collects them under `args: [...]`.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  fatal(message: string, ...args: unknown[]): void;
  child(extra: Record<string, unknown>): Logger;
}

function normalizeArgs(args: unknown[]): {
  extraMessage: string;
  meta: Record<string, unknown>;
} {
  const meta: Record<string, unknown> = {};
  const extraStrings: string[] = [];
  let miscIdx = 0;

  for (const arg of args) {
    if (arg === undefined) continue;
    if (arg === null) {
      extraStrings.push("null");
    } else if (arg instanceof Error) {
      meta.error = arg.message;
      if (arg.stack) meta.stack = arg.stack;
    } else if (typeof arg === "string") {
      extraStrings.push(arg);
    } else if (typeof arg === "number" || typeof arg === "boolean") {
      extraStrings.push(String(arg));
    } else if (typeof arg === "object" && !Array.isArray(arg)) {
      // Merge plain objects into meta
      Object.assign(meta, arg as Record<string, unknown>);
    } else {
      // Arrays, functions, etc.
      try {
        meta[`arg${miscIdx++}`] = arg;
      } catch {
        meta[`arg${miscIdx++}`] = String(arg);
      }
    }
  }

  return { extraMessage: extraStrings.join(" "), meta };
}

export function createLogger(module: string, defaults?: Record<string, unknown>): Logger {
  function log(level: LogLevel, message: string, ...args: unknown[]): void {
    const { extraMessage, meta } = normalizeArgs(args);
    const finalMessage = extraMessage ? `${message} ${extraMessage}` : message;
    emit({
      level,
      timestamp: new Date().toISOString(),
      module,
      message: finalMessage,
      ...defaults,
      ...meta,
    });
  }

  return {
    debug: (msg, ...args) => log("debug", msg, ...args),
    info: (msg, ...args) => log("info", msg, ...args),
    warn: (msg, ...args) => log("warn", msg, ...args),
    error: (msg, ...args) => log("error", msg, ...args),
    fatal: (msg, ...args) => log("fatal", msg, ...args),
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
