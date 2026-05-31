"use client";

/**
 * Shared dismissal cache for ticker items · May 02 · TTL added 2026-05-31.
 *
 * Both tickers (GlobalTopTicker + BottomPulseTicker) pull from
 * heterogeneous sources — live market data, shop pulse, brain insights,
 * captures, commitments. The user can X-out any item; the dismissal is
 * persisted to localStorage so it survives reloads.
 *
 * 2026-05-31 · Edge Feed: dismissal can now be **time-bound**. The old
 * behaviour was forever-dismiss (a `Set<string>`), which silently lost
 * live/recurring lanes — X-ing out today's market line killed the market
 * lane permanently. Callers may now pass `ttlMs` to make a dismissal a
 * snooze (e.g. 24h) instead of a permanent mute; the top ticker uses 24h
 * so live lanes return tomorrow. Omitting `ttlMs` preserves the original
 * forever-dismiss (the bottom ticker is unchanged).
 *
 * Storage: `{ [id]: expiryMs | null }` (null = forever). The legacy
 * `["id", ...]` array format is migrated on read to forever-dismissals,
 * so existing dismissals are preserved. Expired entries are pruned on
 * write. Reset via Settings → "reset dismissed ticker items" (clearAll).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "nour:dismissed-ticker-items";

/** id → expiry timestamp (ms). `null` = dismissed forever. */
type DismissMap = Record<string, number | null>;

export interface DismissMeta {
  kind?: string;
  source?: "top" | "bottom";
  /** If set, the dismissal expires after this many ms (a snooze). Omit for
   *  a permanent dismissal. */
  ttlMs?: number;
}

function readMap(): DismissMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Legacy format: array of string ids → forever-dismissed (preserve).
    if (Array.isArray(parsed)) {
      const m: DismissMap = {};
      for (const id of parsed) if (typeof id === "string") m[id] = null;
      return m;
    }
    if (parsed && typeof parsed === "object") {
      const m: DismissMap = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v === null || typeof v === "number") m[k] = v as number | null;
      }
      return m;
    }
    return {};
  } catch {
    return {};
  }
}

/** Drop entries whose snooze has elapsed (forever-entries are kept). */
function pruneExpired(m: DismissMap): DismissMap {
  const now = Date.now();
  const out: DismissMap = {};
  for (const [id, exp] of Object.entries(m)) {
    if (exp === null || exp > now) out[id] = exp;
  }
  return out;
}

function writeMap(m: DismissMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    // localStorage may be full / blocked; silently no-op.
  }
}

/** The set of ids currently still dismissed (forever, or not-yet-expired). */
function activeSet(m: DismissMap): Set<string> {
  const now = Date.now();
  const s = new Set<string>();
  for (const [id, exp] of Object.entries(m)) {
    if (exp === null || exp > now) s.add(id);
  }
  return s;
}

export function useDismissedTicker() {
  const [map, setMap] = useState<DismissMap>(() => readMap());

  // Sync across tabs — if another tab dismisses, mirror here so the same
  // item doesn't surface again.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setMap(readMap());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dismissed = useMemo(() => activeSet(map), [map]);

  const dismiss = useCallback((id: string, meta?: DismissMeta) => {
    setMap((prev) => {
      const expiry = meta?.ttlMs ? Date.now() + meta.ttlMs : null;
      const next = pruneExpired({ ...prev, [id]: expiry });
      writeMap(next);
      return next;
    });
    // May 02 · server-side ack — "exit means I acknowledge it." Fire and
    // forget; failure here just means localStorage is the only record. No
    // retry — the item is hidden either way.
    void fetch("/api/ultron/ticker/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: id, kind: meta?.kind, source: meta?.source }),
      credentials: "include",
    }).catch(() => {});
  }, []);

  const undismiss = useCallback((id: string) => {
    setMap((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      writeMap(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setMap({});
    writeMap({});
  }, []);

  return { dismissed, dismiss, undismiss, clearAll };
}
