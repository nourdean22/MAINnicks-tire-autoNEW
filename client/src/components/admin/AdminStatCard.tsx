/**
 * AdminStatCard — codified KPI card per ADMIN_PHILOSOPHY.md +
 * ADMIN_KPI_FRAMEWORK.md.
 *
 * Pattern (from ADMIN_PHILOSOPHY.md):
 *   ┌──────────────────────────────────────┐
 *   │ TODAY'S DROPS                        │  ← 10px label
 *   │                                      │
 *   │ 23                            ▲ +12% │  ← big mono + delta
 *   │                                      │
 *   │ vs 21 yesterday  · 28 weekly avg    │  ← tertiary context
 *   └──────────────────────────────────────┘
 *
 * Built 2026-05-07 (wave-54). Future admin sections should use this
 * component instead of inline stat-display markup.
 */
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import CountUpNumber from "@/components/CountUpNumber";

type DeltaDirection = "up" | "down" | "flat";
type DeltaSemantics = "good-up" | "good-down" | "neutral";
//   "good-up" — up is positive (revenue, drops, retention)
//   "good-down" — down is positive (cycle time, error rate)
//   "neutral" — neither direction is good or bad

interface AdminStatCardProps {
  label: string;
  value: number;
  /** Optional prefix on value display (e.g., '$') */
  prefix?: string;
  /** Optional suffix on value display (e.g., '%', 'hr') */
  suffix?: string;
  /** Decimal places */
  decimals?: number;
  /** Delta percentage (e.g., +12 = +12%). undefined = no delta shown */
  deltaPct?: number;
  /** Whether 'up' on this metric is good or bad */
  deltaSemantics?: DeltaSemantics;
  /** Tertiary context line (e.g., "vs 21 yesterday · 28 weekly avg") */
  context?: string;
  /** Optional sparkline data (last N values) */
  sparkline?: number[];
  /** Loading state — render skeleton */
  loading?: boolean;
  /** Click handler — makes card a button if provided */
  onClick?: () => void;
}

function deltaDirection(pct: number | undefined): DeltaDirection {
  if (pct === undefined || Math.abs(pct) < 0.5) return "flat";
  return pct > 0 ? "up" : "down";
}

function deltaColor(direction: DeltaDirection, semantics: DeltaSemantics): string {
  if (direction === "flat" || semantics === "neutral") {
    return "text-[var(--data-neutral)]";
  }
  const isGood = (direction === "up" && semantics === "good-up") ||
                 (direction === "down" && semantics === "good-down");
  return isGood ? "text-[var(--data-up)]" : "text-[var(--data-down)]";
}

/** Inline sparkline — minimal SVG, no axes, brand-aware coloring */
function Sparkline({ data, color = "var(--brand-yellow)" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 80;
    const y = 20 - ((v - min) / range) * 16;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width="80" height="20" className="opacity-60" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AdminStatCard({
  label,
  value,
  prefix,
  suffix,
  decimals,
  deltaPct,
  deltaSemantics = "good-up",
  context,
  sparkline,
  loading = false,
  onClick,
}: AdminStatCardProps) {
  const direction = deltaDirection(deltaPct);
  const colorClass = deltaColor(direction, deltaSemantics);

  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      onClick={onClick}
      className={[
        "block w-full text-left p-3 lg:p-4 rounded-[1rem]",
        "bg-[var(--bg-card-raised)] ring-1 ring-[var(--ring-neutral)]",
        "shadow-[var(--inset-highlight)]",
        "transition-all duration-[var(--dur-admin-snap)]",
        onClick ? "hover:ring-[var(--ring-neutral-strong)] cursor-pointer active:scale-[0.99]" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] font-semibold text-foreground/45 mb-2">
        {label}
      </div>

      {loading ? (
        <div className="h-8 w-24 bg-[var(--bg-card-elevated)] rounded animate-pulse" />
      ) : (
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-mono font-bold text-2xl lg:text-3xl tracking-tight text-foreground tabular-nums">
            {prefix}<CountUpNumber to={value} decimals={decimals} suffix={suffix} duration={900} />
          </div>
          {deltaPct !== undefined && (
            <div className={`inline-flex items-center gap-1 text-xs font-semibold ${colorClass}`}>
              <Icon className="w-3 h-3" />
              {Math.abs(deltaPct).toFixed(1)}%
            </div>
          )}
        </div>
      )}

      {(context || sparkline) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {context && (
            <p className="text-[11px] text-foreground/40 leading-tight truncate">{context}</p>
          )}
          {sparkline && sparkline.length >= 2 && (
            <Sparkline data={sparkline} />
          )}
        </div>
      )}
    </Wrapper>
  );
}
