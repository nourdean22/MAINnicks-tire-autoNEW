/**
 * Arsenal Activity Logger
 * Fire-and-forget logging for all tool/chain executions.
 * Used by API routes to persist activity for history, stats, and persistent results.
 */

import { prisma } from "@/lib/prisma";

export interface ArsenalLogEntry {
  toolId: string;
  action: string;
  status: "success" | "error" | "partial";
  durationMs: number;
  inputPreview?: string;
  resultPreview?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/** Truncate to max chars for DB storage */
function truncate(s: string | undefined | null, max = 2000): string | undefined {
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/**
 * Log an arsenal activity. Fire-and-forget — never throws.
 */
export async function logArsenalActivity(entry: ArsenalLogEntry): Promise<void> {
  try {
    await prisma.arsenalLog.create({
      data: {
        toolId: entry.toolId,
        action: entry.action,
        status: entry.status,
        durationMs: entry.durationMs,
        inputPreview: truncate(entry.inputPreview),
        resultPreview: truncate(entry.resultPreview),
        errorMessage: truncate(entry.errorMessage, 500),
        metadata: entry.metadata ? (entry.metadata as Record<string, string | number | boolean | null>) : undefined,
      },
    });
  } catch {
    // Silent — logging should never break the main flow
    console.error("[arsenal-log] Failed to log activity:", entry.toolId, entry.action);
  }
}

/**
 * Helper: wrap an async function call with automatic logging.
 * Returns the result and logs duration + status.
 */
export async function withArsenalLog<T>(
  toolId: string,
  action: string,
  inputPreview: string | undefined,
  fn: () => Promise<T>,
  extractPreview?: (result: T) => string
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const preview = extractPreview
      ? extractPreview(result)
      : typeof result === "string"
        ? result
        : JSON.stringify(result)?.slice(0, 500);
    logArsenalActivity({
      toolId,
      action,
      status: "success",
      durationMs,
      inputPreview,
      resultPreview: preview,
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    logArsenalActivity({
      toolId,
      action,
      status: "error",
      durationMs,
      inputPreview,
      errorMessage: message,
    });
    throw err; // Re-throw so the calling route still handles the error
  }
}
