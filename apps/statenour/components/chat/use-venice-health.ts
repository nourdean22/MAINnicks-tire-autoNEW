"use client";

/**
 * useVeniceHealth — polls /api/ai/venice-status every 30s and
 * reports whether Venice is healthy. Nick-Header V2 uses the boolean
 * to decide whether the status dot goes amber (unhealthy) or stays
 * gold-idle (healthy · silent).
 *
 * Quiet: silence is the reward for health. No dot-flashing when
 * everything is fine.
 */

import { useEffect, useState } from "react";

import { authedFetch } from "@/hooks/use-authed-fetch";
export function useVeniceHealth(): boolean {
  const [healthy, setHealthy] = useState(true);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await authedFetch("/api/ai/venice-status").catch(() => null);
        if (!res || !res.ok) {
          if (alive) setHealthy(false);
          return;
        }
        const raw = await res.json();
        const data = (raw?.data ?? raw) as { healthy?: boolean };
        if (!alive) return;
        setHealthy(data.healthy !== false);
      } catch {
        if (alive) setHealthy(false);
      }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return healthy;
}
