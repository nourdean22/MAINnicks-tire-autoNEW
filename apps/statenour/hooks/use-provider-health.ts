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

// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice · migrated
// off `authedFetch("/api/system/rate-limits")` onto the EXISTING
// `system.providerHealth` query (Cross-domain residuals slice) · both
// the legacy `/api/system/rate-limits` route AND that procedure call
// the SAME `provider-health.getProviderHealth` — drift impossible. The
// legacy route returned a COMPACTED slice of the full snapshot;
// `system.providerHealth` returns the whole snapshot, so the compaction
// (`tone`/`label`/per-provider projection) is done here in the hook.
// This hook ABORTS the prior poll when the next 30s tick fires — only
// the VANILLA client's `.query(undefined, { signal })` accepts an
// AbortSignal (the React-Query `utils.*.fetch` options bag has no
// `signal`). `trpcVanilla` needs no provider, so it's valid in a hook.
import { trpcVanilla } from "@/lib/trpc/vanilla-client";

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
        // `system.providerHealth` returns the full snapshot — compact
        // it to the minimum the pill needs here (the legacy
        // /api/system/rate-limits route did this server-side).
        const snapshot = await trpcVanilla.system.providerHealth.query(
          undefined,
          { signal: ac.signal },
        );
        if (!alive) return;
        setHealth({
          tone: snapshot.overallTone,
          label: snapshot.pillLabel,
          providers: snapshot.providers.map((p) => ({
            name: p.name,
            available: p.available,
            cooldownMs: p.quotaCooldownRemainingMs,
            tools: p.toolsSupported,
            errorRate: Math.round(p.errorRate * 100),
            recentCalls: p.recentCalls,
          })),
          generatedAt: snapshot.generatedAt,
        });
      } catch (e) {
        // Aborted fetch (next poll) — ignore. Any other failure
        // (incl. UNAUTHORIZED when not signed in) leaves health null,
        // so the pill simply doesn't render.
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
