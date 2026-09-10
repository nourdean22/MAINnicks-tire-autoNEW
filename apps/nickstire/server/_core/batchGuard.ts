/**
 * tRPC batch-bypass guard — the mount pattern and the refusal, in one place.
 *
 * WHY IT LIVES HERE (2026-09-10). Both of these were local consts inside
 * `registerCoreMiddleware` in ./index.ts, so `server/rateLimitBypass.test.ts`
 * could not import them and hand-rolled its own copies instead, under a comment
 * saying "verbatim from server/_core/index.ts". A test that re-implements the
 * thing it is testing passes forever while the real one drifts: it is a
 * measurement of the copy, and it reports green about code it never ran. The
 * repo's own rule is to gate through the REAL production function, never a
 * hand-rolled reader. Exported here so there is exactly one of each.
 *
 * THE DEFECT THIS GUARD EXISTS FOR. express-rate-limit counts
 * `/api/trpc/candidates.submit,candidates.submit,...` as ONE request while tRPC
 * executes N procedure calls, so a single limiter unit buys an attacker N
 * inserts. The guard refuses any batched path on a rate-limited endpoint.
 *
 * AND THE ONE THAT MADE IT FIRE. It originally tested `req.path`. Inside an
 * `app.use(<RegExp>, ...)` mount Express strips the matched prefix, so `req.path`
 * is "/" — no comma, never a match, guard silently inert. `req.originalUrl`
 * carries the full path. The query string is stripped first because a comma in
 * `?tags=a,b` is not a tRPC batch.
 */
import type { NextFunction, Request, Response } from "express";

/**
 * Matches an endpoint whether it appears alone or anywhere inside a batch:
 * `/api/trpc/x.y`, `/api/trpc/a,x.y`, `/api/trpc/x.y,b`. Dots are escaped so
 * `chat.message` cannot match `chatXmessage`.
 */
export const withBatchRegex = (endpoint: string) =>
  new RegExp(`^/api/trpc/(.*,)?${endpoint.replace(/\./g, "\\.")}(,.*)?$`);

/** Refuses a batched call to a rate-limited endpoint. Mount BEFORE the limiter. */
export function blockBatchedLimits(req: Request, res: Response, next: NextFunction) {
  // originalUrl, not path: under a RegExp mount `req.path` is "/".
  // Query string stripped: a comma in ?foo=a,b is not a tRPC batch.
  const path = String(req.originalUrl ?? "").split("?")[0];
  if (path.includes(",")) {
    return res.status(429).json({ error: "Batched requests are not allowed for rate-limited endpoints." });
  }
  next();
}
