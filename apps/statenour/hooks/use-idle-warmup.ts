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

import { authedFetch } from "@/hooks/use-authed-fetch";
const REFIRE_INTERVAL_MS = 45_000;

export function useIdleWarmup(enabled = true) {
  const lastFiredRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const fire = () => {
      const now = Date.now();
      if (now - lastFiredRef.current < REFIRE_INTERVAL_MS) return;
      lastFiredRef.current = now;
      authedFetch("/api/ai/chat/prefetch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Prefetch-Client-Id": readClientId(),
        },
        // Empty-ish draft so the server short-circuits before hitting
        // the heavy prefetch path but still warms prompt cache.
        body: JSON.stringify({ draft: "warmup-idle" }),
        keepalive: true,
      }).catch(() => {});
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
  }, [enabled]);
}
