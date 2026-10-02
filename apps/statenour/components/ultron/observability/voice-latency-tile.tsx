"use client";

/**
 * v10.0.526 · VoiceLatencyTile — P50 end-to-end latency for live voice calls.
 *
 * The voice surface (Nick assistant on +1 216 424 9249) has a hard
 * user-perception ceiling at ~800ms (per voice-agents skill). Anything
 * over 500ms feels sluggish; anything over 800ms breaks the illusion.
 * This tile keeps the P50 visible during the morning HQ scan so silent
 * regressions surface within minutes, not after a complaint.
 *
 * Tiers (per voice-agents skill recall):
 *   · green:  P50 < 500ms (target band)
 *   · amber:  500ms ≤ P50 < 800ms (warning)
 *   · red:    P50 ≥ 800ms (broken-feel — page operator)
 *
 * Breach-streak indicator surfaces consecutive sub-800ms violations so
 * a single noisy call doesn't trigger panic — a streak of 3+ means the
 * provider/pipeline has actually degraded.
 *
 * Accessibility: tier color is paired with a textual label ("ok" / "slow"
 * / "broken") so color-blind operators still get the signal. SR-only
 * span describes the breach streak in plain language.
 */

import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { Phone, Zap, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { latencyTier, type VoiceLatencyShape, type TileState } from "@/hooks/use-observability";
import { EmptyTile, ErrorTile } from "./cost-slo-tile";

interface Props {
  state: TileState<VoiceLatencyShape>;
}

export function VoiceLatencyTile({ state }: Props) {
  if (state.kind === "loading") {
    return <ShimmerSkeleton variant="card" className="min-h-[112px]" />;
  }
  if (state.kind === "empty") {
    return <EmptyTile label="voice latency" hint="measured in Nick's Tire admin, not here" icon={<Phone size={14} />} />;
  }
  if (state.kind === "error") {
    return <ErrorTile label="voice latency" message={state.message} />;
  }

  const { data } = state;
  const p50 = data.p50Ms ?? 0;
  const p95 = data.p95Ms ?? 0;
  const amber = data.amberThresholdMs ?? 500;
  const red = data.redThresholdMs ?? 800;
  const streak = data.breachStreak ?? 0;
  const recent = data.recentMs ?? [];

  const tier = latencyTier(p50, amber, red);

  const tierBorder = {
    green: "border-l-emerald-400/70",
    amber: "border-l-amber-400",
    red: "border-l-rose-400",
  }[tier];

  const tierText = {
    green: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-rose-300",
  }[tier];

  const tierLabel = {
    green: "ok",
    amber: "slow",
    red: "broken",
  }[tier];

  const sparkColor = {
    green: "rgb(110 231 183)",
    amber: "rgb(252 211 77)",
    red: "rgb(253 164 175)",
  }[tier];

  // Streak threshold for "page-worthy" — single bad call ≠ alarm.
  const streakIsAlarming = streak >= 3;

  return (
    <GlassCard ruled className={cn("min-h-[112px]", tierBorder)}>
      <div className="flex items-center justify-between mb-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          <Phone size={11} />
          voice · p50
        </span>
        <span
          className={cn(
            "font-mono text-[11px] uppercase tracking-[0.12em]",
            tierText,
          )}
        >
          {tierLabel}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="stat-number text-[26px] leading-none text-fg">
          {Math.round(p50)}
          <span className="ml-1 text-[12px] font-mono text-fg-tertiary">ms</span>
        </span>
        {p95 > 0 && (
          <span className="font-mono text-[11px] text-fg-tertiary tabular-nums">
            p95 {Math.round(p95)}ms
          </span>
        )}
      </div>

      {/* Sub-line: target band as plain text · color is decorative. */}
      <p className="mt-1 font-mono text-[11px] text-fg-secondary">
        target &lt; <span className="text-fg tabular-nums">{amber}ms</span>
      </p>

      {recent.length >= 2 && (
        <div className="mt-2" aria-hidden>
          <Sparkline data={recent} width={140} height={20} color={sparkColor} showDot animate={false} />
        </div>
      )}

      {streak > 0 && (
        <div className={cn(
          "mt-2 flex items-center gap-1.5 font-mono text-[11px]",
          streakIsAlarming ? "text-rose-300" : "text-amber-300",
        )}>
          {streakIsAlarming ? <AlertCircle size={11} /> : <Zap size={11} />}
          <span className="tabular-nums">{streak}</span>
          <span className="text-fg-tertiary">
            in a row {streakIsAlarming ? "· investigate" : "near ceiling"}
          </span>
          {/* SR-only fuller text — color is supplementary. */}
          <span className="sr-only">
            {streakIsAlarming
              ? "Critical — three or more calls over the ceiling. Investigate."
              : "Warning — recent calls trending near the ceiling."}
          </span>
        </div>
      )}
    </GlassCard>
  );
}
