/**
 * Centralized error logging — writes to the ErrorLog table so the
 * system-audit script can surface recurring issues.
 *
 * Use in engines + services + catch blocks that don't go through the
 * apiHandler wrapper. Fire-and-forget — never throws, never blocks.
 *
 *   logError("synthesis.ai", err, { userId });
 *   logError("brain.contextual-recall", err);
 */

import { prisma } from "@/lib/prisma";

export type ErrorLevel = "error" | "warn" | "fatal";

export function logError(
  source: string,
  err: unknown,
  extra?: Record<string, unknown>,
  level: ErrorLevel = "error"
): void {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
  const stack = err instanceof Error ? err.stack : undefined;

  if (prisma?.errorLog?.create) {
    prisma.errorLog
      .create({
        data: {
          level,
          message: `[${source}] ${message}`.slice(0, 500),
          stack: stack?.slice(0, 4000) ?? null,
          context: extra ? ({ source, ...extra } as any) : ({ source } as any),
        },
      })
      .catch(() => {
        // Never let log writes break the caller — errors that can't be
        // logged aren't worth surfacing anywhere else.
      });
  }

  // Also send to console for local dev / Vercel function logs.
  if (level === "fatal" || level === "error") {
    console.error(`[${source}]`, message);
  } else {
    console.warn(`[${source}]`, message);
  }
}
