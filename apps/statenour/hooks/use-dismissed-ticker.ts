"use client";

/**
 * Shared dismissal cache for ticker items · May 02.
 *
 * Both tickers (GlobalTopTicker + BottomPulseTicker) pull from
 * heterogeneous sources — live market data, hardcoded macro fallbacks,
 * shop pulse, brain insights, captures, commitments. Some items go
 * stale (the fallback macro headlines from Apr 19 are a known case).
 * This hook lets the user X-out any item; the ID is persisted to
 * localStorage so it stays dismissed across reloads.
 *
 * Implementation: simple Set<string> kept in state + localStorage.
 * No expiry — if a server source re-emits a dismissed ID after some
 * window, the user can un-dismiss by clearing the cache (Settings →
 * "reset dismissed ticker items"). Out of scope here.
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "nour:dismissed-ticker-items";

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage may be full / blocked; silently no-op.
  }
}

export function useDismissedTicker() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  // Sync across tabs — if another tab dismisses, mirror here so the
  // marquee doesn't surface the same item again.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setDismissed(readDismissed());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dismiss = useCallback((id: string, meta?: { kind?: string; source?: "top" | "bottom" }) => {
    setDismissed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      writeDismissed(next);
      return next;
    });
    // May 02 · server-side ack — "exit means I acknowledge it." Fire and
    // forget; failure here just means localStorage is the only record
    // (Nour still sees the item hidden, brain just doesn't get the
    // signal for this dismissal). No retry — the marquee item is gone
    // either way.
    void fetch("/api/ultron/ticker/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: id, kind: meta?.kind, source: meta?.source }),
      credentials: "include",
    }).catch(() => {});
  }, []);

  const undismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      writeDismissed(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setDismissed(new Set());
    writeDismissed(new Set());
  }, []);

  return { dismissed, dismiss, undismiss, clearAll };
}
