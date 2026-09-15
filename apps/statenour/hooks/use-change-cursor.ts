"use client";

import { useEffect, useState } from "react";
import { CHANGE_CURSOR_SETTLE_MS, cursorKey, readCursor, writeCursor } from "@/lib/ui/change-cursor";

/**
 * The per-surface "last visit" cursor · 2026-09-15 (wave 3).
 *
 * Lifted from components/home/change-line.tsx, semantics intact:
 *   · 0 until the effect runs (SSR-safe; localStorage is read only inside
 *     effects — the home-hydration-safety rule), deferred a tick (the
 *     react-compiler cascading-render idiom the morning-brief chip uses).
 *   · First visit ever starts the clock, so the NEXT visit has a diff.
 *   · Once the consumer's query has loaded, the cursor advances to NOW
 *     after SETTLE_MS — long enough to have READ the line. Navigating away
 *     sooner leaves the cursor where it was: an unread change is still a
 *     change.
 *
 * Two hooks, because the settle needs the query's `isSuccess` and the query
 * needs the cursor: call `useChangeCursor` before the query and
 * `useSettleChangeCursor` after it. Query with `enabled: cursor > 0`.
 */
export function useChangeCursor(surface: string): number {
  const key = cursorKey(surface);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      const storage = typeof window === "undefined" ? null : window.localStorage;
      const c = readCursor(storage, key);
      if (c > 0) setCursor(c);
      else writeCursor(storage, key, Date.now());
    }, 0);
    return () => clearTimeout(t);
  }, [key]);

  return cursor;
}

export function useSettleChangeCursor(surface: string, cursor: number, loaded: boolean, settleMs = CHANGE_CURSOR_SETTLE_MS): void {
  const key = cursorKey(surface);
  useEffect(() => {
    if (cursor === 0 || !loaded) return;
    const t = window.setTimeout(() => {
      writeCursor(window.localStorage, key, Date.now());
    }, settleMs);
    return () => window.clearTimeout(t);
  }, [cursor, loaded, key, settleMs]);
}
