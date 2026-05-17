"use client";

/**
 * ProviderDegradationBanner · v10.0.343 · Phase 3 of glitch taxonomy
 * hardening (Category 8 · operational silence).
 *
 * Surfaces when AI provider health is degraded · replaces the "silent
 * fallback" pattern where Venice goes down → Anthropic kicks in →
 * operator never knows the chat is 2× slower / 10× more expensive.
 *
 * Polls /api/ai/venice-status (existing endpoint) every 60s · renders
 * when overallTone is "amber" or "red". Hidden when green. Single-line
 * tile · expandable on click for per-provider detail.
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
 */

import { useEffect, useState } from "react";
import { AlertTriangle, AlertOctagon, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { authedFetch } from "@/hooks/use-authed-fetch";

interface ProviderHealth {
  name: string;
  available: boolean;
  cooldownMs?: number;
  recentErrorCount?: number;
  recentLatencyP95Ms?: number;
}

interface ProviderHealthPayload {
  overallTone: "green" | "amber" | "red";
  pillLabel: string;
  providers: ProviderHealth[];
  generatedAt: string;
}

const POLL_MS = 60_000;

export function ProviderDegradationBanner() {
  const [data, setData] = useState<ProviderHealthPayload | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // v10.0.347 · switched from /api/ai/venice-status (Venice-only
        // balance + rateLimits) to /api/system/provider-health (full
        // multi-provider snapshot · what we actually need).
        const r = await authedFetch("/api/system/provider-health");
        if (!r.ok) return;
        const j = (await r.json()) as ProviderHealthPayload;
        if (!cancelled) setData(j);
      } catch {
        // Silent fail · banner just stays in last-known state
      }
    }
    void load();
    const i = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  // Hidden when green or no data yet · only renders during degradation.
  // v10.0.347 · also defend against malformed payloads (missing providers
  // field) · the banner crashed at .filter() before the endpoint fix.
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
              {typeof p.cooldownMs === "number" && p.cooldownMs > 0 && (
                <span className="opacity-50 ml-auto">
                  cooldown {Math.round(p.cooldownMs / 1000)}s
                </span>
              )}
              {typeof p.recentErrorCount === "number" &&
                p.recentErrorCount > 0 && (
                  <span className="opacity-50 ml-2">
                    {p.recentErrorCount} err recent
                  </span>
                )}
              {typeof p.recentLatencyP95Ms === "number" &&
                p.recentLatencyP95Ms > 0 && (
                  <span className="opacity-50 ml-2">
                    p95 {p.recentLatencyP95Ms}ms
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
