"use client";

/**
 * ULTRON CLIENT FETCH CACHE
 *
 * Tiny request coalescer + TTL cache for the Ultron composite endpoints.
 * Solves two specific pain points observed in the session logs:
 *
 *   1. BrainCarousel, BetDesk, and the Ultron root component ALL fetch
 *      /api/ultron/signal on mount. Three concurrent identical queries →
 *      three Prisma round-trips → connection-pool pressure on Neon.
 *
 *   2. PulseStack and WorkWidget both fetch /api/ultron/pulse and
 *      /api/ultron/work-context on similar cadences — duplicate load.
 *
 * This module provides `fetchUltron<T>(key, loader)` which:
 *   - Dedupes concurrent calls for the same key (single in-flight Promise)
 *   - Caches successful responses for a short TTL (default 30s) so a
 *     follow-up component mounting the same key gets cached data instantly
 *   - Exposes `useUltronFetch(url, ttlMs)` as a React hook that handles
 *     the effect boilerplate and subscribes to shared updates
 *
 * This is NOT react-query. It's a ~100-line surgical tool for the Ultron
 * homepage's specific fetch graph. If we need more (revalidation, mutation,
 * global invalidation beyond simple tags) we'll adopt TanStack Query — but
 * for today, this is enough.
 */

import { useCallback, useEffect, useState } from "react";

// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice. `fetchUltron`
// is a GENERIC URL-keyed request coalescer — `loader()` may target ANY
// of ~10 Ultron-tree endpoints (/api/ultron/{signal,pulse,work-context},
// /api/system/{health,ai-cost,anticipated}, /api/actions-brain, …),
// most of which have no 1:1 tRPC procedure. A generic `fetch(url)`
// primitive has no typed tRPC equivalent — and synthesising a procedure
// per URL would explode this slice for zero benefit (YAGNI). So the
// `authedFetch` import is replaced with a bare `fetch` carrying
// `credentials: "include"` (the only behaviour `authedFetch` added over
// `fetch` here) — the same plain-fetch carve-out the prior slice made
// for endpoints with no procedure. The `use-authed-fetch` import is
// gone; this stays a generic cache, not a tRPC client.

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

interface InflightEntry<T = unknown> {
  promise: Promise<T>;
}

// Module-level singletons so every component on the Ultron tree shares them
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightEntry>();

// Subscribers notified on cache writes so hooks can re-render
type Subscriber = () => void;
const subscribers = new Map<string, Set<Subscriber>>();

function notify(key: string): void {
  const subs = subscribers.get(key);
  if (!subs) return;
  for (const s of subs) s();
}

function subscribe(key: string, fn: Subscriber): () => void {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key)!.add(fn);
  return () => {
    subscribers.get(key)?.delete(fn);
  };
}

/**
 * Fetch (or read from cache) an Ultron endpoint. Dedupes concurrent calls.
 * Returns the .data payload already unwrapped.
 *
 * @param key  Stable cache key (typically the URL)
 * @param loader  Function that returns the raw JSON-decoded body
 * @param ttlMs  How long to keep the result cached (default 30s)
 */
export async function fetchUltron<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = 30_000,
): Promise<T> {
  const now = Date.now();

  // 1) Serve from cache if fresh
  const entry = cache.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.value as T;
  }

  // 2) Share an in-flight request if one is already running
  const pending = inflight.get(key);
  if (pending) {
    return pending.promise as Promise<T>;
  }

  // 3) Launch a fresh fetch, record it so siblings dedupe
  const promise = (async () => {
    try {
      const value = await loader();
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      notify(key);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, { promise });
  return promise as Promise<T>;
}

/**
 * Invalidate a cached key. Next fetchUltron call re-fetches.
 * Used after mutations so stale data doesn't show.
 */
export function invalidateUltron(key: string): void {
  cache.delete(key);
  notify(key);
}

/**
 * React hook — fetch a JSON endpoint with coalescing + TTL cache. Returns
 * { data, loading } — null data means "still loading, no data yet."
 *
 * Example:
 *   const { data, loading } = useUltronFetch<SignalPayload>("/api/ultron/signal");
 */
export function useUltronFetch<T>(
  url: string,
  options: { ttlMs?: number; pollMs?: number } = {},
): { data: T | null; loading: boolean; refetch: () => void } {
  const { ttlMs = 30_000, pollMs } = options;
  const [, setTick] = useState(0);
  const [state, setState] = useState<{ data: T | null; loading: boolean }>(() => {
    const cached = cache.get(url);
    const initialData = cached && cached.expiresAt > Date.now() ? (cached.value as T) : null;
    return {
      data: initialData,
      loading: initialData === null,
    };
  });

  const run = useCallback(async (opts?: { alive?: () => boolean }) => {
    try {
      const data = await fetchUltron<T>(
        url,
        async () => {
          // v10.0.117 audit fix · was bare fetch(url) with no
          // credentials · /api/ultron/signal + /api/ultron/pulse fired
          // unauthenticated, got 401, swallowed it, left data:null
          // forever. `credentials: "include"` sends the session cookie
          // (the legacy `authedFetch` default · the hooks-lib REST→tRPC
          // slice replaced the import with this bare fetch — see the
          // file-level note · this is a generic URL fetcher with no
          // typed tRPC procedure).
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const raw = (await res.json()) as { data?: T } | T;
          // Unwrap envelope when present
          return ((raw as { data?: T })?.data ?? (raw as T));
        },
        ttlMs,
      );
      if (!opts?.alive || opts.alive()) setState({ data, loading: false });
    } catch {
      if (!opts?.alive || opts.alive()) setState((s) => ({ data: s.data, loading: false }));
    }
  }, [url, ttlMs]);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => { run({ alive: () => alive }); });

    // Subscribe to cache updates from other components using the same key
    const unsub = subscribe(url, () => {
      const c = cache.get(url);
      if (c && c.expiresAt > Date.now()) {
        setState({ data: c.value as T, loading: false });
        setTick((t) => t + 1);
      }
    });

    // Optional polling — respects cache dedup, so multiple components with
    // the same URL polling won't multiply the request count.
    let iv: ReturnType<typeof setInterval> | null = null;
    if (pollMs) {
      iv = setInterval(() => run({ alive: () => alive }), pollMs);
    }

    return () => {
      alive = false;
      unsub();
      if (iv) clearInterval(iv);
    };
  }, [url, pollMs, run]);

  const refetch = useCallback(() => {
    invalidateUltron(url);
    run();
  }, [url, run]);

  return { ...state, refetch };
}
