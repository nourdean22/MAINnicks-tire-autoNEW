"use client";

/**
 * useChatHaptics — send tap + stream-end tick.
 *
 * Extracted from `app/(mastery)/chat/page.tsx` as part of the v11.1
 * B2 decomp. The page previously owned a `prevStreamingRef` and a
 * useEffect that fired `haptic.select()` on the stream's true→false
 * transition. Identical logic, now isolated.
 *
 * Call this at component scope. It owns no visible state; only a
 * private ref that tracks the previous `isStreaming` value.
 */
import { useEffect, useRef } from "react";
import { haptic } from "@/lib/ui/haptic";

export function useChatHaptics(isStreaming: boolean): void {
  const prevRef = useRef(false);
  useEffect(() => {
    if (prevRef.current && !isStreaming) {
      haptic.select();
    }
    prevRef.current = isStreaming;
  }, [isStreaming]);
}
