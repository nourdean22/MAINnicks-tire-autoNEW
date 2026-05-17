"use client";

/**
 * NudgePanel — cross-system live deltas. Appears at the top of /brain
 * so Nour sees what the self-model is screaming about right now.
 */

import { useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, Info, Loader2 } from "lucide-react";
import { DismissButton } from "@/components/ui/dismiss-button";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { toast } from "sonner";
import { AnimatedCounter } from "@/components/ui/animated-counter";

interface Nudge {
  severity: "high" | "medium" | "low";
  source:
    | "identity"
    | "contradiction"
    | "ghost"
    | "skill"
    | "pin_hygiene"
    | "belief_refresh"
    // v11.1 meta-intelligence
    | "correlation"
    | "decision_drift"
    | "prediction_streak"
    | "blind_spot";
  text: string;
  link?: string;
}

// Per-source label + tint, mirroring the server-side taxonomy.
const SOURCE_META: Record<Nudge["source"], { label: string; tint: string }> = {
  identity: { label: "identity", tint: "text-violet-300" },
  contradiction: { label: "contradiction", tint: "text-amber-300" },
  ghost: { label: "ghost", tint: "text-violet-400" },
  skill: { label: "skill", tint: "text-emerald-300" },
  pin_hygiene: { label: "pins", tint: "text-[var(--gold)]" },
  belief_refresh: { label: "belief", tint: "text-sky-300" },
  correlation: { label: "correlation", tint: "text-fuchsia-300" },
  decision_drift: { label: "decision drift", tint: "text-rose-300" },
  prediction_streak: { label: "streak", tint: "text-emerald-300" },
  blind_spot: { label: "blind spot", tint: "text-rose-400" },
};

const SEVERITY_GLYPH = {
  high: <AlertTriangle size={12} className="text-red-400" />,
  medium: <AlertCircle size={12} className="text-amber-400" />,
  low: <Info size={12} className="text-[var(--text-tertiary)]" />,
};

export function NudgePanel() {
  const [nudges, setNudges] = useState<Nudge[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch("/api/brain/nudges");
        if (!res.ok) throw new Error("nudge fetch failed");
        const raw = (await res.json()) as { data?: { nudges?: Nudge[] } };
        if (!cancelled) {
          setNudges(raw.data?.nudges ?? []);
          setLoadedAt(Date.now());
        }
      } catch {
        if (!cancelled) setNudges([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (loading) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
          <Loader2 size={12} className="animate-spin" /> reading nudges…
        </div>
      </GlassCard>
    );
  }

  if (!nudges || nudges.length === 0) {
    return (
      <GlassCard>
        <div className="flex justify-end mb-1">
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => setNonce((n) => n + 1)} />
        </div>
        <EmptyState
          icon={AlertCircle}
          title="In rhythm"
          why="Cross-system nudges aggregate signals from identity, contradictions, ghost accuracy, skills, beliefs, correlations, decision drift, prediction streaks, and blind-spots. Silence here = all subsystems stable."
          unlock="Keep shipping. New signals surface within 15s of a state change; dismissed ones return after 7d if still real."
          tone="positive"
        />
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="section-label">Live nudges</p>
          <FreshnessChip lastFetchedAt={loadedAt} source="brain" compact onReload={() => setNonce((n) => n + 1)} />
        </div>
        <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
          <AnimatedCounter value={nudges.filter((n) => n.severity === "high").length} /> high ·{" "}
          <AnimatedCounter value={nudges.filter((n) => n.severity === "medium").length} /> med ·{" "}
          <AnimatedCounter value={nudges.filter((n) => n.severity === "low").length} /> low
        </span>
      </div>
      <div className="space-y-1.5">
        {nudges.map((n, i) => {
          const inner = (
            <div
              className={cn(
                "group flex items-start gap-2 px-2 py-1.5 rounded border transition-colors",
                n.severity === "high" ? "border-red-500/30 bg-red-500/5"
                  : n.severity === "medium" ? "border-amber-500/30 bg-amber-500/5"
                  : "border-[var(--border-default)] bg-[var(--bg-base)]",
              )}
            >
              <span className="mt-0.5">{SEVERITY_GLYPH[n.severity]}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-[var(--text-primary)]">{n.text}</p>
                <p className={cn("text-[9px] font-mono uppercase tracking-wider mt-0.5", SOURCE_META[n.source]?.tint ?? "text-[var(--text-tertiary)]")}>
                  {SOURCE_META[n.source]?.label ?? n.source}
                </p>
              </div>
              {/* v11.1 · Dismiss — hides nudge for 7d via
                  /api/brain/nudges/dismiss → BrainMemory
                  nudge_ack row with expiresAt. computeNudges on
                  the server filters by ack. */}
              <DismissButton
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    await authedFetch("/api/brain/nudges/dismiss", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ source: n.source, text: n.text, until: "7d" }),
                    });
                    toast.success("dismissed · back in 7d");
                    setNonce((v) => v + 1);
                  } catch {
                    toast.error("dismiss failed");
                  }
                }}
                label="Dismiss for 7 days"
                alwaysVisible
                size="sm"
                className="shrink-0 hover:text-rose-400"
              />
            </div>
          );
          return n.link ? (
            <a key={`${n.source}-${i}`} href={n.link} className="block hover:brightness-110">
              {inner}
            </a>
          ) : (
            <div key={`${n.source}-${i}`}>{inner}</div>
          );
        })}
      </div>
    </GlassCard>
  );
}
