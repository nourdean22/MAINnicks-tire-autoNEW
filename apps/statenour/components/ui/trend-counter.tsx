/**
 * TrendCounter · v10.0.217 · counter that knows where it came from.
 *
 * Composes AnimatedCounter (the easing) + a delta indicator + an
 * inline sparkline so every dashboard stat earns its space. Replaces
 * the bare `<AnimatedCounter value={n} />` pattern that gave 71 pages
 * the same "12 today" feel without context.
 *
 * Three signals folded together:
 *   1. The headline number (animated, tabular-nums)
 *   2. Direction: ↑ ↓ — vs a baseline (avg, prev period, target)
 *   3. Optional sparkline of recent buckets (1-12 values is the sweet
 *      spot · uses the existing Sparkline primitive)
 *
 * Tone is derived from `goodWhen`:
 *   "high" — positive direction = green (calls completed, leads landed)
 *   "low"  — positive direction = red   (errors, failures, anti-pattern revisits)
 *   "neutral" — direction colored neutrally (counts, info)
 *
 * Anti-slop: tabular-nums everywhere · no emoji arrows · uses CSS
 * vars · industrial monospace caption.
 *
 * Examples:
 *   <TrendCounter value={12} baseline={18} label="errors" goodWhen="low" />
 *     → "12 ↓ vs 18" (green — fewer errors is good)
 *
 *   <TrendCounter value={47} baseline={32} label="lessons" goodWhen="high"
 *                 history={[12,18,24,29,33,40,47]} />
 *     → "47 ↑ vs 32 [sparkline]"
 */

import { AnimatedCounter } from "./animated-counter";
import { Sparkline } from "./sparkline";
import { cn } from "@/lib/utils";

export interface TrendCounterProps {
  /** Current value · animated on change */
  value: number;
  /** Optional baseline for the delta arrow (avg, prev period, target). */
  baseline?: number | null;
  /** Optional inline sparkline · 4-12 values renders well. */
  history?: number[];
  /** Tiny-caps label below the number (e.g. "errors", "revisited"). */
  label: string;
  /** Direction polarity. "high"=up is good, "low"=down is good. */
  goodWhen?: "high" | "low" | "neutral";
  /** Force a tone override · usually leave undefined. */
  tone?: "gold" | "emerald" | "rose" | "amber" | "tertiary";
  /** Optional value formatter (default: integer with locale commas). */
  format?: (n: number) => string;
  /** Caption rendered alongside the delta (e.g. "vs 7d avg"). */
  baselineLabel?: string;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<TrendCounterProps["tone"]>, string> = {
  gold: "text-accent",
  emerald: "text-emerald-300",
  rose: "text-rose-300",
  amber: "text-amber-300",
  tertiary: "text-[var(--text-tertiary)]",
};

const DELTA_NEUTRAL = "text-[var(--text-tertiary)]";

function deriveTone(
  value: number,
  baseline: number | null | undefined,
  goodWhen: "high" | "low" | "neutral",
): NonNullable<TrendCounterProps["tone"]> {
  if (goodWhen === "neutral" || baseline == null) return "tertiary";
  if (value === baseline) return "tertiary";
  const trendingUp = value > baseline;
  if (goodWhen === "high") return trendingUp ? "emerald" : "rose";
  return trendingUp ? "rose" : "emerald";
}

function formatDelta(value: number, baseline: number): string {
  if (baseline === 0) return value > 0 ? `+${value}` : "0";
  const diff = value - baseline;
  if (diff === 0) return "flat";
  const pct = Math.round((diff / Math.abs(baseline)) * 100);
  // Show absolute if percent overflows · keep it tight
  if (Math.abs(pct) >= 1000) return `${diff > 0 ? "+" : ""}${diff}`;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export function TrendCounter({
  value,
  baseline,
  history,
  label,
  goodWhen = "neutral",
  tone,
  format,
  baselineLabel,
  className,
}: TrendCounterProps) {
  const resolvedTone = tone ?? deriveTone(value, baseline, goodWhen);
  const hasBaseline = typeof baseline === "number";
  const arrow = !hasBaseline || baseline === value
    ? null
    : value > (baseline ?? 0)
      ? "↑"
      : "↓";

  // Sparkline tone follows the headline tone (subtle alignment).
  const sparkColor =
    resolvedTone === "emerald" ? "var(--status-green)"
    : resolvedTone === "rose" ? "var(--danger, #f43f5e)"
    : resolvedTone === "gold" ? "var(--accent)"
    : resolvedTone === "amber" ? "var(--status-yellow, #f59e0b)"
    : "var(--text-tertiary)";

  return (
    <div className={cn("rounded-surface border border-edge-subtle bg-content px-3 py-2.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("stat-number text-[22px] leading-none", TONE_CLASS[resolvedTone])}>
          {format
            ? format(value)
            : <AnimatedCounter value={value} />}
        </span>
        {arrow && hasBaseline && (
          <span className={cn("text-[11px] font-mono tabular-nums shrink-0", TONE_CLASS[resolvedTone])}>
            {arrow} {formatDelta(value, baseline)}
          </span>
        )}
      </div>

      {history && history.length > 1 && (
        <div className="mt-1.5 -mx-1">
          <Sparkline
            data={history}
            width={120}
            height={18}
            color={sparkColor}
            showDot={false}
            animate={false}
          />
        </div>
      )}

      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          {label}
        </span>
        {hasBaseline && (
          <span className={cn("text-[11px] font-mono tabular-nums", DELTA_NEUTRAL)}>
            {baselineLabel ?? `vs ${baseline}`}
          </span>
        )}
      </div>
    </div>
  );
}
