"use client";

/**
 * useChatPrefetch — warm the chat lambda while the user is typing.
 *
 * Call this hook with the current draft text and a debounce. When
 * the draft is stable for 300ms + at least 8 chars long, fires a
 * background POST to /api/ai/chat/prefetch which warms the system
 * prompt cache, pre-fetches likely DB data, and detects the chat
 * mode. The real /api/ai/chat call then starts with everything hot.
 *
 * Fire-and-forget: we don't await and we don't block the UI on
 * errors. Worst case = wasted network request, which is fine.
 *
 * Usage:
 *   const [input, setInput] = useState("");
 *   useChatPrefetch(input);
 *   ...
 *   <textarea value={input} onChange={(e) => setInput(e.target.value)} />
 */

import { useEffect, useRef } from "react";
import { readClientId } from "./use-prefetch-client-id";

import { authedFetch } from "@/hooks/use-authed-fetch";
const DEBOUNCE_MS = 300;
const MIN_LENGTH = 8;
// Don't re-fire on every keystroke — enforce a minimum time between
// prefetches so rapid typing doesn't hammer the endpoint.
const MIN_INTERVAL_MS = 2000;

export function useChatPrefetch(draft: string) {
  const lastFiredRef = useRef<number>(0);
  const lastDraftRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending debounce
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const trimmed = draft.trim();

    // Nothing meaningful to prefetch on
    if (trimmed.length < MIN_LENGTH) return;

    // Draft hasn't changed substantively — skip
    if (trimmed === lastDraftRef.current) return;

    // Rate-limit: don't fire more than once per MIN_INTERVAL_MS
    const now = Date.now();
    if (now - lastFiredRef.current < MIN_INTERVAL_MS) return;

    timerRef.current = setTimeout(() => {
      lastFiredRef.current = Date.now();
      lastDraftRef.current = trimmed;

      // Fire and forget — no await, no error surfacing to UI
      authedFetch("/api/ai/chat/prefetch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Prefetch-Client-Id": readClientId(),
        },
        body: JSON.stringify({ draft: trimmed }),
        // Abortable if the user sends / navigates away fast
        keepalive: true,
      }).catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [draft]);
}
