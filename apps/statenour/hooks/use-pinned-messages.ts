/**
 * Pinned messages for the chat page.
 *
 * Persists to localStorage as "nour-pinned-messages". Capped at 5 pins.
 * Each pin is a snippet (up to 200 chars) with the original message id.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

export interface PinnedMessage {
  id: string;
  text: string;
  pinnedAt: number;
}

const STORAGE_KEY = "nour-pinned-messages";
const MAX_PINS = 5;
const SNIPPET_LEN = 200;

export function usePinnedMessages() {
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setTimeout(() => setPinned(parsed), 0);
      }
    } catch {}
  }, []);

  const pin = useCallback((id: string, text: string) => {
    setPinned((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      const updated = [
        { id, text: text.slice(0, SNIPPET_LEN), pinnedAt: Date.now() },
        ...prev,
      ].slice(0, MAX_PINS);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const unpin = useCallback((id: string) => {
    setPinned((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const isPinned = useCallback(
    (id: string) => pinned.some((p) => p.id === id),
    [pinned]
  );

  const toggle = useCallback(
    (id: string, text: string) => {
      if (pinned.some((p) => p.id === id)) unpin(id);
      else pin(id, text);
    },
    [pinned, pin, unpin]
  );

  return { pinned, pin, unpin, toggle, isPinned };
}
