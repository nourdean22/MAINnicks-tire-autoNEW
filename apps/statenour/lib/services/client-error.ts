/**
 * lib/services/client-error.ts · scattered-components REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/ui/* slice).
 *
 * The client-side error-ingest writer · lifted verbatim from the POST
 * handler of app/api/errors/route.ts so the legacy REST endpoint AND the
 * new `system.recordClientError` tRPC procedure call the SAME function ·
 * drift between consumers structurally impossible.
 *
 * Telemetry-only · the ErrorLog write is best-effort (a failed
 * telemetry write must never cascade into a visible failure), so the
 * write is `.catch()`-swallowed and the function always resolves
 * `{ ok: true }`. No Prisma row is returned · the AppRouter stays
 * trivially shallow.
 */

import { prisma } from "@/lib/prisma";

/** The client-error payload · mirrors the legacy POST body. */
export interface ClientErrorInput {
  kind: "error" | "unhandledrejection" | "boundary";
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  timestamp?: number;
  componentStack?: string;
  errorBoundary?: string;
}

/**
 * Persist one client-side error to ErrorLog. The REST route and the
 * `system.recordClientError` procedure both call this. Best-effort —
 * the write is swallowed on failure and the result is always
 * `{ ok: true }` (telemetry must never surface its own failure).
 */
export async function recordClientError(
  input: ClientErrorInput,
): Promise<{ ok: true }> {
  // Cap sizes — nobody uploads novels.
  const message = input.message.slice(0, 1000);
  const stack = input.stack ? input.stack.slice(0, 4000) : null;
  const componentStack = input.componentStack
    ? input.componentStack.slice(0, 2000)
    : null;

  await prisma.errorLog
    .create({
      data: {
        level:
          input.kind === "boundary"
            ? "error"
            : input.kind === "unhandledrejection"
              ? "warn"
              : "error",
        message,
        stack: stack ?? undefined,
        context: {
          source: "client",
          kind: input.kind,
          url: input.url?.slice(0, 500),
          userAgent: input.userAgent?.slice(0, 300),
          timestamp: input.timestamp,
          componentStack: componentStack ?? undefined,
          errorBoundary: input.errorBoundary,
        },
      },
    })
    .catch(() => {
      // If the write itself fails, don't cascade — this endpoint is
      // best-effort. Failing a telemetry write to make the page return
      // 500 would be its own bug.
    });

  return { ok: true as const };
}
