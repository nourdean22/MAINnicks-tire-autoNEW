"use client";

/**
 * useStreamingErrorGuard — clear stale error when a new stream begins.
 *
 * Extracted from `app/(mastery)/chat/page.tsx` as part of the v11.1
 * B2 decomp. Previous inline effect:
 *
 *   useEffect(() => {
 *     if (isStreaming && error) setError(null);
 *   }, [isStreaming]);
 *
 * Rationale: without this, a prior turn's error card persists across
 * the next send — looks like the new turn is also broken. See
 * commit 161050e for the original fix.
 *
 * Dependency is intentionally limited to [isStreaming] — we only
 * want the clear to fire on the false→true transition. Listing
 * `error` + `clearError` in deps would re-fire whenever error
 * changes, which is the wrong signal.
 */
import { useEffect } from "react";

export function useStreamingErrorGuard(opts: {
  isStreaming: boolean;
  error: string | null;
  clearError: () => void;
}): void {
  const { isStreaming, error, clearError } = opts;
  useEffect(() => {
    if (isStreaming && error) clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);
}
