/**
 * lib/trpc/vanilla-client.ts · tRPC migration (2026-05-22)
 *
 * The non-React tRPC client. `lib/trpc/client.ts` exports the
 * React-Query-bound `trpc` instance — but a handful of call-sites in
 * the REST→tRPC migration are NOT React components and so cannot use
 * hooks: plain modules like `lib/chat/direct-actions.ts`,
 * `lib/ultron/client-cache.ts`, and `lib/services/client/tasks.ts`.
 *
 * Those modules used `authedFetch()` directly. Their typed replacement
 * is this vanilla client: imperative `.query()` / `.mutate()` calls
 * with full AppRouter type inference, no hook, no provider.
 *
 *   import { trpcVanilla } from "@/lib/trpc/vanilla-client";
 *   const goals = await trpcVanilla.task.goals.query();
 *   await trpcVanilla.task.update.mutate({ id, status: "DONE" });
 *
 * SCOPE — browser only. The `url` below is relative ("/api/trpc"),
 * which resolves against the current origin. That is correct for
 * client-side modules (the same assumption `lib/trpc/client.ts`
 * makes) but has no origin in a Node/SSR context. Server-side code
 * must NOT use this client — it should call the router directly via
 * a server caller (`appRouter.createCaller(ctx)`) instead.
 *
 * Auth: fetch defaults to `credentials: "same-origin"`, so the
 * NextAuth session cookie rides along automatically — same as the
 * React client and the legacy `authedFetch`.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "./root";

export const trpcVanilla = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      // x-trpc-source · disambiguates these imperative non-React calls
      // from browser-react (`"react"`) and server-caller invocations
      // in server logs. Mirrors the header set in trpc-provider.tsx.
      headers: () => ({ "x-trpc-source": "vanilla" }),
    }),
  ],
});
