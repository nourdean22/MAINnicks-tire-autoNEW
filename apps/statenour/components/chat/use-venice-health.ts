"use client";

/**
 * useVeniceHealth — polls Venice status every 30s and reports whether
 * Venice is healthy. Nick-Header V2 uses the boolean to decide whether
 * the status dot goes amber (unhealthy) or stays gold-idle (healthy ·
 * silent).
 *
 * Quiet: silence is the reward for health. No dot-flashing when
 * everything is fine.
 *
 * Cross-domain residuals slice (2026-05-22) · migrated off
 * `authedFetch("/api/ai/venice-status")` onto `trpc.system.veniceStatus`.
 * The 30s poll is now React Query's `refetchInterval`. The procedure
 * never throws — a missing key / network failure resolves to
 * `{ ok: false }` — so the health boolean is just `query.data?.ok`,
 * defaulting to healthy (true) until the first response lands or on a
 * transport error (the legacy hook also defaulted healthy on its
 * `useState(true)`).
 */

import { trpc } from "@/lib/trpc/client";

export function useVeniceHealth(): boolean {
  const query = trpc.system.veniceStatus.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    // A transport-level failure leaves `data` undefined · the `?? true`
    // below keeps the dot gold-idle (healthy) rather than false-alarming
    // — same default as the legacy `useState(true)`.
    retry: false,
  });

  // `data.ok === false` is the only unhealthy signal. Undefined data
  // (initial load or transport error) → healthy.
  return query.data?.ok ?? true;
}
