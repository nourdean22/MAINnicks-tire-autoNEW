/**
 * tRPC onError for /api/trpc. Every error keeps its request log line; only server faults go to
 * errorTelemetry (the admin error report, the storm alarm and Sentry). errorTelemetry files any
 * non-AppError as an UNKNOWN 500, so a client-caused code recorded there read as a server crash
 * (Sentry NICKSTIRE-2: 196 curl hits on admin routes, 2026-10-22).
 */
import type { TRPCError } from "@trpc/server";
import { createLogger } from "../lib/logger";
import { errorTelemetry } from "../lib/error-telemetry";

const log = createLogger("server");

const CLIENT_CODES: ReadonlySet<TRPCError["code"]> = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "BAD_REQUEST",
  "NOT_FOUND",
  "PRECONDITION_FAILED",
  "TOO_MANY_REQUESTS",
  "PARSE_ERROR",
]);

export function onTrpcError({ path, error, ctx }: {
  path?: string;
  error: TRPCError;
  ctx?: { res?: { locals?: Record<string, unknown> } };
}): void {
  const route = path ? `/api/trpc/${path}` : "unknown";
  const requestId = ctx?.res?.locals?.requestId as string | undefined;
  log.error(`[tRPC] ${route}: ${error.message}`, { route, requestId });
  if (!CLIENT_CODES.has(error.code)) errorTelemetry.record(error, { route, requestId });
}
