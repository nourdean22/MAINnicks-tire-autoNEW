"use client";

/**
 * TRPCProvider · Phase J (2026-05-18 PM)
 *
 * Wraps the mastery layout. Provides:
 *   · React Query client (one per provider instance · not global ·
 *     per trpc-fullstack skill best practice)
 *   · tRPC client with httpBatchLink pointed at /api/trpc
 *   · x-trpc-source header so server logs distinguish browser-react
 *     calls from server-side caller invocations
 *
 * Reads cookies via fetch's default credentials: same-origin · the
 * App Router handler's createTRPCContext picks up the session via
 * the existing NextAuth cookie. No additional auth wiring needed.
 */

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "@/lib/trpc/client";

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30s stale window keeps data feeling fresh without thrashing
            // the network. refetchOnWindowFocus is OFF: this app runs as
            // an iOS PWA where the operator foregrounds it constantly
            // (answering a text, app-switching), and every focus would
            // otherwise re-fire EVERY mounted query at once (12+ on
            // /system). Pages needing live data already poll via
            // refetchInterval, so they stay current on their own timer —
            // focus-refetch is pure redundant load on a PWA.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0, // mutations should not auto-retry · user re-fires
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          // x-trpc-source helps disambiguate browser-react calls from
          // server-side caller invocations in server logs.
          headers: () => ({ "x-trpc-source": "react" }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
