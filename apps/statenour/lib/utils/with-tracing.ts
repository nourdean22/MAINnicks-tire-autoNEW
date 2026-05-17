/**
 * withTracing · v10.0.377
 *
 * Wrap a route handler to capture per-request observability. Routes
 * opt in by exporting `withTracing(handler)` instead of the raw handler.
 *
 * USAGE
 *   import { withTracing } from "@/lib/utils/with-tracing";
 *   async function handler(req: NextRequest) { ... }
 *   export const GET = withTracing(handler, { name: "ai/chat" });
 *
 * Captures: method, path, status, duration. Stores in the in-process
 * ring buffer (lib/observability/tracer.ts).
 *
 * Errors propagate · we capture the error trace then rethrow so the
 * caller's error handling is unchanged.
 */

import type { NextRequest } from "next/server";
import { recordTrace } from "@/lib/observability/tracer";

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response> | Response;

export function withTracing(handler: Handler, opts: { name?: string } = {}): Handler {
  return async function tracedHandler(req: NextRequest, ctx?: unknown) {
    const startedAt = Date.now();
    const at = new Date().toISOString();
    const method = req.method ?? "GET";
    const path = opts.name ?? new URL(req.url).pathname;
    let status = 0;
    let errorClass: string | undefined;

    try {
      const res = await handler(req, ctx);
      status = res.status ?? 200;
      return res;
    } catch (err) {
      status = 500;
      errorClass = (err as Error)?.name ?? "UnknownError";
      throw err;
    } finally {
      try {
        recordTrace({
          at,
          method,
          path,
          status,
          durationMs: Date.now() - startedAt,
          errorClass,
        });
      } catch {
        // never let observability break the route
      }
    }
  };
}
