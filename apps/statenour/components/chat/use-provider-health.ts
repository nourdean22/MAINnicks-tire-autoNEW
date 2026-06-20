"use client";

/**
 * useProviderHealth — polls the multi-provider fleet snapshot every 30s
 * and reports whether the fleet is healthy. Nick-Header V2 uses the
 * boolean to decide whether the status dot goes amber (degraded) or
 * stays gold-idle (healthy · silent).
 *
 * Quiet: silence is the reward for health. No dot-flashing when
 * everything is fine. overallTone 'amber'/'red' is the only unhealthy
 * signal; undefined data (initial load or transport error) and 'green'
 * resolve to healthy — same default as the legacy hook's useState(true).
 */

import { trpc } from "@/lib/trpc/client";

export function useProviderHealth(): boolean {
  const query = trpc.system.providerHealth.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return query.data?.overallTone !== "amber" && query.data?.overallTone !== "red";
}
