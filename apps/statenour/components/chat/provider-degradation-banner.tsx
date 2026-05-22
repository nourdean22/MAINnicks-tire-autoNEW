"use client";

/**
 * ProviderDegradationBanner · v10.0.343 · Phase 3 of glitch taxonomy
 * hardening (Category 8 · operational silence).
 *
 * Surfaces when AI provider health is degraded · replaces the "silent
 * fallback" pattern where Venice goes down → Anthropic kicks in →
 * operator never knows the chat is 2× slower / 10× more expensive.
 *
 * Polls provider-health every 60s · renders when overallTone is "amber"
 * or "red". Hidden when green. Single-line tile · expandable on click
 * for per-provider detail.
 *
 * Design choices:
 *   · Polling cadence 60s · matches HUD refresh · operator sees state
 *     within one minute of degradation
 *   · Auto-hides on green · only takes vertical space when relevant
 *   · Click-to-expand shows per-provider state without forcing nav
 *     to /system/health
 *   · Cost tone: amber = "fallback active, slower" · red = "all providers
 *     down" (chat probably broken anyway)
 *
 * Per docs/glitch-taxonomy.md · Category 8 · "silent provider downgrade"
 * is one of the named failure modes.
 *
 * Cross-domain residuals slice (2026-05-22) · migrated off
 * `authedFetch("/api/system/provider-health")` onto
 * `trpc.system.providerHealth`. The 60s poll is now React Query's
 * `refetchInterval`. The query data is the strictly-typed
 * `ProviderHealthSnapshot` — the pre-fix local `ProviderHealthPayload`
 * interface had drifted field names (`cooldownMs` etc) that only
 * compiled because `authedFetch` returns untyped JSON; the render now
 * reads the real `quotaCooldownRemainingMs` / `recentErrors` /
 * `avgLatencyMs` fields.
 */

import { useState } from "react";
import { AlertTriangle, AlertOctagon, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

const POLL_MS = 60_000;

export function ProviderDegradationBanner() {
  const [expanded, setExpanded] = useState(false);
  const query = trpc.system.providerHealth.useQuery(undefined, {
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
    // Silent fail · the banner just stays in its last-known state on a
    // transport hiccup (the legacy fetch swallowed errors the same way).
    retry: false,
  });
  const data = query.data;

  // Hidden when green or no data yet · only renders during degradation.
  if (!data || data.overallTone === "green") return null;
  if (!Array.isArray(data.providers)) return null;

  const isRed = data.overallTone === "red";
  const Icon = isRed ? AlertOctagon : AlertTriangle;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-[11px] transition-all",
        isRed
          ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
          : "border-amber-500/40 bg-amber-500/10 text-amber-200",
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left"
        aria-expanded={expanded}
      >
        <Icon size={13} className="shrink-0" />
        <span className="flex-1 font-medium">
          {isRed
            ? "AI providers degraded"
            : `Provider lane degraded · ${data.pillLabel}`}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-wider opacity-70">
          {data.providers.filter((p) => p.available).length}/
          {data.providers.length} up
        </span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-current/10 space-y-1">
          {data.providers.map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-2 text-[10px] font-mono"
            >
              <span
                className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  p.available ? "bg-emerald-400" : "bg-rose-400",
                )}
              />
              <span className="font-bold uppercase tracking-wider w-16">
                {p.name}
              </span>
              <span className="opacity-70">
                {p.available ? "available" : "down"}
              </span>
              {p.quotaCooldownRemainingMs > 0 && (
                <span className="opacity-50 ml-auto">
                  cooldown {Math.round(p.quotaCooldownRemainingMs / 1000)}s
                </span>
              )}
              {p.recentErrors > 0 && (
                <span className="opacity-50 ml-2">
                  {p.recentErrors} err recent
                </span>
              )}
              {p.avgLatencyMs > 0 && (
                <span className="opacity-50 ml-2">
                  avg {Math.round(p.avgLatencyMs)}ms
                </span>
              )}
            </div>
          ))}
          <p className="text-[9px] font-mono opacity-50 mt-2">
            Updated · {new Date(data.generatedAt).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
}
