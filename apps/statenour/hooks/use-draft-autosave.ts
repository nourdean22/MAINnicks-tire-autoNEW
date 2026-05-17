"use client";

/**
 * useDraftAutosave — persist an in-progress text input to localStorage
 * so page refresh / accidental navigation / session expiry don't eat
 * work.
 *
 * Design:
 *   - Debounced writes (default 500ms) so we don't hammer localStorage
 *     on every keystroke.
 *   - Reads on mount and calls `setDraft(restored)` ONCE with the
 *     stored value — caller decides how to merge (usually: if current
 *     state is empty, restore; otherwise keep current).
 *   - `clearDraft()` returned so the caller can nuke the saved draft
 *     after successful send (otherwise we'd restore an already-sent
 *     message next time).
 *
 * Used by the chat composer. Can be reused for any long-form input
 * (journal reflections, capture box, etc).
 */

import { useEffect, useRef } from "react";

interface Options {
  /** localStorage key. Namespace it per-surface: "chat-composer", "journal" */
  key: string;
  /** Current value. Hook persists this to localStorage on change. */
  value: string;
  /** Max length — don't bother persisting extremely long strings. */
  maxLength?: number;
  /** Debounce window in ms. Default 500. */
  debounceMs?: number;
}

export function useDraftAutosave({
  key,
  value,
  maxLength = 50_000,
  debounceMs = 500,
}: Options): { clearDraft: () => void; restore: () => string | null } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist on change (debounced).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        if (!value || value.length === 0) {
          window.localStorage.removeItem(`draft:${key}`);
          return;
        }
        if (value.length > maxLength) return;
        window.localStorage.setItem(
          `draft:${key}`,
          JSON.stringify({ value, savedAt: Date.now() }),
        );
      } catch {
        /* quota exceeded / disabled — skip silently */
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [key, value, maxLength, debounceMs]);

  const clearDraft = () => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(`draft:${key}`);
    } catch {
      /* ignore */
    }
  };

  const restore = (): string | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(`draft:${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { value?: string; savedAt?: number };
      // Expire drafts older than 24h — stale drafts are usually intent
      // Nour abandoned on purpose.
      if (
        parsed?.savedAt &&
        Date.now() - parsed.savedAt > 24 * 3600_000
      ) {
        window.localStorage.removeItem(`draft:${key}`);
        return null;
      }
      return typeof parsed?.value === "string" ? parsed.value : null;
    } catch {
      return null;
    }
  };

  return { clearDraft, restore };
}
