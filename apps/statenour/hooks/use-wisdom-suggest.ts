"use client";

/**
 * hooks/use-wisdom-suggest.ts · v10.0.526 · Arc B Feature 2
 *
 * Debounced fetch hook for the at-write-time wisdom pill above the
 * /chat composer. Pairs with components/chat/wisdom-pill.tsx + the
 * /api/ai/chat/wisdom-suggest endpoint.
 *
 * Behavior:
 *   · Debounce 600ms after last keystroke before firing.
 *   · Each new keystroke aborts any in-flight request so we never
 *     flash stale suggestions for a draft the operator has moved on
 *     from.
 *   · Skip while a Nick reply is streaming (passing `disabled`) ·
 *     don't compete for attention during an answer.
 *   · Skip on trivial drafts (< 25 chars) and pure-command drafts
 *     (starts with "/") · these never match anything useful.
 *   · `dismissedIds` follows the draft until it's cleared, so the
 *     same suggestion can't pop back after a dismiss.
 *   · `useThis` inserts the wisdom into the draft via the caller-
 *     supplied prefix; the parent textarea wires the new value into
 *     state.
 *   · `nour:wisdom-pill-disabled` localStorage flag · operator-level
 *     permanent kill switch · the hook respects it as a hard NO-OP.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice · migrated
// off `authedFetch("/api/ai/chat/wisdom-suggest")` onto `chat
// .wisdomSuggest` · the procedure delegates to the SAME `wisdom-
// suggest-feed.buildWisdomSuggestFeed` service the legacy REST route
// also calls · drift impossible. This hook needs per-keystroke ABORT
// (cancel the in-flight request when the operator types again) — only
// the VANILLA tRPC client's `.query(input, { signal })` accepts an
// AbortSignal (the React-Query `utils.*.fetch` options bag has no
// `signal`). `trpcVanilla` needs no provider, so it's valid inside a
// hook; this is the standard tRPC abort pattern.
import { trpcVanilla } from "@/lib/trpc/vanilla-client";

export interface WisdomSuggestion {
  id: string;
  text: string;
  source: string;
  similarity: number;
}

export interface UseWisdomSuggestOptions {
  /** Current draft text from the composer textarea. */
  draft: string;
  /**
   * Set true while Nick is actively streaming a reply · we skip
   * fetches during streams so the pill never appears in the middle
   * of an answer. Once the stream completes, the next keystroke will
   * re-fire the suggestion lane.
   */
  disabled?: boolean;
  /**
   * Optional · pause before firing (ms). Default 600ms · pairs with
   * the 800ms server target for an effective ~1.4s perceived feel.
   */
  debounceMs?: number;
}

export interface UseWisdomSuggestResult {
  suggestions: WisdomSuggestion[];
  loading: boolean;
  /** Permanently disabled via localStorage flag. */
  killed: boolean;
  /**
   * Dismiss a specific suggestion · only persists across re-fetches
   * for the SAME draft session (the dismissedIds[] resets when the
   * draft is cleared).
   */
  dismiss: (id: string) => void;
  /** Disable the pill entirely · sets the localStorage flag. */
  killForever: () => void;
}

const KILL_FLAG_KEY = "nour:wisdom-pill-disabled";

function readKillFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KILL_FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

export function useWisdomSuggest(
  opts: UseWisdomSuggestOptions,
): UseWisdomSuggestResult {
  const { draft, disabled = false, debounceMs = 600 } = opts;
  const [suggestions, setSuggestions] = useState<WisdomSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [killed, setKilled] = useState<boolean>(false);

  const [prevDraft, setPrevDraft] = useState(draft);
  const [prevKilled, setPrevKilled] = useState(killed);

  if (draft !== prevDraft) {
    setPrevDraft(draft);
    if (draft.length === 0) {
      if (dismissed.size > 0) setDismissed(new Set());
      if (suggestions.length > 0) setSuggestions([]);
    }
  }

  if (killed !== prevKilled) {
    setPrevKilled(killed);
    if (killed) {
      if (suggestions.length > 0) setSuggestions([]);
      if (loading) setLoading(false);
    }
  }

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate the kill-flag once on mount. Avoids an SSR/CSR mismatch ·
  // localStorage isn't available on the server, so the initial state
  // is always `false` and we read the real value here.
  useEffect(() => {
    setKilled(readKillFlag());
  }, []);

  useEffect(() => {
    // Always reset any in-flight work first.
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (killed) {
      return;
    }
    if (disabled) {
      // Don't surface · but DON'T clear what's there. If a wisdom is
      // already visible when a stream starts, keep showing it until
      // the next keystroke after the stream ends. Cuts flicker.
      setLoading(false);
      return;
    }

    const trimmed = draft.trim();
    if (trimmed.length < 25 || trimmed.startsWith("/")) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        // The vanilla client's `.query()` accepts the AbortSignal · the
        // next keystroke aborts the in-flight request exactly as the
        // legacy `fetch({ signal })` did.
        const result = await trpcVanilla.chat.wisdomSuggest.query(
          { draft: trimmed, dismissedIds: Array.from(dismissed) },
          { signal: ctrl.signal },
        );
        const list = result.suggestions ?? [];
        // Final client-side defense · the service already filters but a
        // stale cached payload (different tab, same process) could miss.
        const cleaned = list
          .filter((s) => s && typeof s.id === "string" && typeof s.text === "string")
          .filter((s) => !dismissed.has(s.id));
        setSuggestions(cleaned);
      } catch (err) {
        // React Query surfaces an aborted fetch as an error whose name
        // is "AbortError" — same guard as the legacy fetch path.
        if ((err as { name?: string }).name === "AbortError") return;
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [draft, disabled, killed, debounceMs, dismissed]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Optimistic UI · drop the dismissed suggestion immediately so
    // there's no perceptible delay between the click and the chip
    // disappearing. The next fetch cycle will refresh from the API
    // with the updated dismissedIds payload.
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const killForever = useCallback(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(KILL_FLAG_KEY, "true");
      }
    } catch {
      // Best-effort · if localStorage is blocked, we still flip the
      // in-memory flag so the current session honors the kill.
    }
    setKilled(true);
    setSuggestions([]);
  }, []);

  return { suggestions, loading, killed, dismiss, killForever };
}
