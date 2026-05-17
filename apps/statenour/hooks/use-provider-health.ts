"use client";

/**
 * useProviderHealth — polls /api/system/rate-limits every 30s.
 *
 * v6 · BATCH 2 · Apr 28. Powers the header rate-limit pill — shows
 * green/amber/red provider state + a one-line label.
 *
 * Stays silent when everything is green. Only renders an actual pill
 * when there's something operator-relevant (fallback active, cooldown,
 * or AI offline). That keeps the chat surface quiet during the 99% of
 * time when nothing's wrong.
 */

import { useEffect, useState } from "react";

import { authedFetch } from "@/hooks/use-authed-fetch";
export interface ProviderHealthCompact {
  tone: "green" | "amber" | "red";
  label: string;
  providers: Array<{
    name: string;
    available: boolean;
    cooldownMs: number;
    tools: boolean;
    errorRate: number;
    recentCalls: number;
  }>;
  generatedAt: string;
}

const POLL_MS = 30_000;

export function useProviderHealth(): ProviderHealthCompact | null {
  const [health, setHealth] = useState<ProviderHealthCompact | null>(null);

  useEffect(() => {
    let alive = true;
    let inflight: AbortController | null = null;

    async function poll() {
      inflight?.abort();
      const ac = new AbortController();
      inflight = ac;
      try {
        const res = await authedFetch("/api/system/rate-limits", {
          signal: ac.signal,
          credentials: "include",
        });
        if (!res.ok) {
          if (alive && res.status !== 401) {
            // 401 means not signed in — leave health null, pill won't render
            setHealth(null);
          }
          return;
        }
        const json = (await res.json()) as ProviderHealthCompact;
        if (alive) setHealth(json);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        if (alive) setHealth(null);
      }
    }

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      inflight?.abort();
      clearInterval(id);
    };
  }, []);

  return health;
}
