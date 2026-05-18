/**
 * /api/trpc/[trpc] · Phase J (2026-05-18 PM)
 *
 * The single tRPC fetch handler · routes every trpc.X.Y call through
 * the AppRouter. Coexists with legacy REST endpoints under /api/...
 * which keep working unchanged.
 *
 * Owner-only auth happens inside the operatorProcedure middleware ·
 * see lib/trpc/trpc.ts.
 *
 * Max duration matches the engine's worst-case mega run (180s) so the
 * SSE timeout slack matches and the handler doesn't get cut off mid-
 * reasoning.
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/lib/trpc/root";
import { createTRPCContext } from "@/lib/trpc/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: (opts) => createTRPCContext(opts),
  });

export { handler as GET, handler as POST };
