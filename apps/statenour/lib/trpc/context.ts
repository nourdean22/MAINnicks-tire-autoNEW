/**
 * lib/trpc/context.ts · Phase J (2026-05-18 PM)
 *
 * Two context factories, per the trpc-fullstack skill guidance:
 *
 *   · createTRPCContext     · for the App Router fetch handler
 *                            (FetchCreateContextFnOptions input)
 *   · createServerContext   · for Server Components / cron jobs / RSC
 *                            callers that need a typed caller without
 *                            an HTTP request
 *
 * Both reuse the existing requireSession from lib/auth-guard.ts but
 * adapt the request shape · createTRPCContext receives a fetch
 * Request and adapts it to the Next.js-shaped guard. The session
 * lives on ctx · downstream middleware narrows it for protected
 * procedures.
 */

import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { loadFeatureFlagOverrides } from "@/lib/feature-flags";

export interface TRPCContext {
  /** Resolved operator session · null when unauthenticated */
  session: { id: string; email: string; role: string } | null;
  /** Prisma client · shared across procedures in a request */
  db: typeof prisma;
  /** Request headers · useful for cache hints, locale, etc */
  headers?: Headers;
}

/** Factory for the App Router fetch handler · the fetch Request is
 *  adapted to requireSession's NextRequest-ish shape internally. */
export async function createTRPCContext(
  opts: FetchCreateContextFnOptions,
): Promise<TRPCContext> {
  // Preload DB overrides before resolving any flags in this request
  await loadFeatureFlagOverrides().catch(() => {});

  // requireSession throws ServiceError on missing session · we catch
  // and surface as ctx.session=null. Middleware in trpc.ts decides
  // whether to reject (protectedProcedure) or proceed (publicProcedure).
  let session: TRPCContext["session"] = null;
  try {
    const result = await requireSession(opts.req as unknown as Request);
    session = {
      id: result.id,
      email: result.email,
      role: result.role,
    };
  } catch {
    // Unauthenticated · session stays null
  }
  return { session, db: prisma, headers: opts.req.headers };
}

/** Factory for direct server-side callers (no HTTP req involved).
 *  Used by Server Components, cron jobs, and anywhere we want a
 *  typed caller without spinning up an HTTP loop. */
export async function createServerContext(): Promise<TRPCContext> {
  // Preload DB overrides before resolving any flags in this server context
  await loadFeatureFlagOverrides().catch(() => {});

  // For server-only callers we trust the calling environment to have
  // already authenticated the operator. requireSession here would need
  // a request · we skip it and set a synthetic operator session. This
  // is safe because createServerContext is only reachable from
  // already-authenticated server code (RSC, cron, internal jobs).
  return {
    session: {
      id: process.env.AUTH_MOCK_USER_ID || "operator-1",
      email: process.env.AUTH_MOCK_USER_EMAIL || "operator@statenour.local",
      role: "operator",
    },
    db: prisma,
  };
}
