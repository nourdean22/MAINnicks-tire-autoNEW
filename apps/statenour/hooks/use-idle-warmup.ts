"use client";

/**
 * useIdleWarmup — fires a single /api/ai/chat/prefetch warmup call
 * on mount so switching to /chat later lands on a hot lambda.
 *
 * Differs from useChatPrefetch (which fires on typing debounce) in
 * that this is surface-boot warming: opening /command or /brain
 * should pre-heat the chat route in case Nour navigates to /chat
 * without typing anything first.
 *
 * Uses requestIdleCallback (with setTimeout fallback) so we don't
 * fight the page's own initial paint. Fire-and-forget — no UI
 * surface, no error handling beyond console.
 *
 * Re-enters cache every 45s (matches prompt-cache TTL) so long
 * sessions on /command stay warm without hammering the endpoint.
 */

import { useEffect, useRef } from "react";
import { readClientId } from "./use-prefetch-client-id";

// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice · migrated
// off `authedFetch("/api/ai/chat/prefetch")` onto `trpc.chat.prefetch`
// · the same procedure `useChatPrefetch` uses · delegates to the
// shared `chat-prefetch.runChatPrefetch` service · drift impossible.
// Fire-and-forget surface-boot warmup. `useIdleWarmup` is consumed by
// the Ultron cockpit + /brain page — both render inside <TRPCProvider>
// (the (mastery) layout), so the React-hooks tRPC client is valid here.
import { trpc } from "@/lib/trpc/client";

const REFIRE_INTERVAL_MS = 45_000;

export function useIdleWarmup(enabled = true) {
  const lastFiredRef = useRef<number>(0);
  const prefetchMutation = trpc.chat.prefetch.useMutation();

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const fire = () => {
      const now = Date.now();
      if (now - lastFiredRef.current < REFIRE_INTERVAL_MS) return;
      lastFiredRef.current = now;
      // Empty-ish draft so the service short-circuits before the heavy
      // prefetch path but still warms the system-prompt cache.
      // Fire-and-forget · errors swallowed.
      prefetchMutation.mutate(
        { draft: "warmup-idle", clientId: readClientId() },
        { onError: () => {} },
      );
    };

    // Kick off immediately via idle callback
    const ric =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback
        : (cb: IdleRequestCallback) =>
            setTimeout(() => cb({ didTimeout: false } as IdleDeadline), 1200);

    const handle = ric(fire);

    // Periodic re-warm while the surface stays open
    const id = setInterval(fire, REFIRE_INTERVAL_MS);

    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(handle as number);
      }
      clearInterval(id);
    };
    // `prefetchMutation.mutate` is referentially stable (React Query
    // memoizes it) — re-running this effect only on `enabled` change is
    // the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
