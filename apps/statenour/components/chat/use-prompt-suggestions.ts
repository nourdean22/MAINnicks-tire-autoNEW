"use client";

/**
 * usePromptSuggestions — live "as you type" completions for the chat
 * composer. v7.4 · Apr 29 first cut.
 *
 * Behavior:
 *   1. While the user types ≥2 chars AND hasn't typed a newline,
 *      debounce 250ms then hit /api/ai/autocomplete with the current
 *      draft. The endpoint is heuristic-first (~5ms response on a
 *      match, empty array on miss).
 *   2. Hook returns up to 3 string suggestions. Caller chooses how
 *      to render — collapsible bar above input, ghost-text inline,
 *      etc.
 *   3. Each new keystroke ABORTS any in-flight request so we never
 *      flash stale suggestions for a draft the user has moved past.
 *
 * Future: Tab-to-accept + tab-cycle through alternates, optional LLM
 * fallback for low-heuristic-confidence drafts. For now: keep it
 * snappy + zero-jitter on slow networks.
 */

import { useEffect, useRef, useState } from "react";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface UsePromptSuggestionsOptions {
  /** Draft text from the textarea. */
  draft: string;
  /** Pause before firing the API call (default 250ms). */
  debounceMs?: number;
  /** Minimum chars before requesting. Default 2. */
  minChars?: number;
}

interface UsePromptSuggestionsResult {
  suggestions: string[];
  loading: boolean;
  /** True when the user has manually collapsed for this draft session. */
  collapsed: boolean;
  collapse: () => void;
  reopen: () => void;
}

export function usePromptSuggestions(
  opts: UsePromptSuggestionsOptions,
): UsePromptSuggestionsResult {
  const { draft, debounceMs = 250, minChars = 2 } = opts;
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reopen the bar when the user starts a fresh draft (cleared input)
  useEffect(() => {
    if (draft.length === 0 && collapsed) setCollapsed(false);
  }, [draft, collapsed]);

  useEffect(() => {
    // Abort any in-flight request whenever the draft changes
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const trimmed = draft.trim();
    // Skip multi-line drafts (user is composing a real prompt) and very
    // short ones (heuristic endpoint will return [] anyway).
    if (
      trimmed.length < minChars ||
      trimmed.includes("\n") ||
      collapsed
    ) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await authedFetch("/api/ai/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partial: trimmed }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = (await res.json()) as { suggestions?: string[] };
        const list = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [];
        // Drop any suggestion that just echoes the draft verbatim
        setSuggestions(list.filter((s) => s.trim().toLowerCase() !== trimmed.toLowerCase()));
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // v10.0.116 audit fix · also abort the in-flight fetch so its
      // setSuggestions / setLoading callbacks don't fire after unmount.
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [draft, debounceMs, minChars, collapsed]);

  return {
    suggestions,
    loading,
    collapsed,
    collapse: () => setCollapsed(true),
    reopen: () => setCollapsed(false),
  };
}
