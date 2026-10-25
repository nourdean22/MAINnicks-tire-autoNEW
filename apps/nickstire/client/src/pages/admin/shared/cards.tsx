/**
 * Shared admin metric/card primitives —
 * StatCard, KpiTile, StatusDot.
 */
import React from "react";

/**
 * renderStatValue: the StatCard value, shown at once. Wave-64 counted every
 * number up from 0 over 900 ms; Admin UI v1 W1 (2026-10-16) removed that,
 * because a value the crew reads many times a day gets no animation and a
 * figure that starts at 0 reads as 0 for most of a second. Numbers get
 * rounded with locale grouping, digit-only strings get grouping; other strings ("$1,250", "85/100", "unknown") render as given.
 */
function renderStatValue(value: string | number): React.ReactNode {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value).toLocaleString() : String(value);
  // Digit-only strings ("1250", "1,250", "$1250") get grouping, as the count-up gave them.
  const m = /^(\$?)([\d,]+)$/.exec(value);
  return m ? m[1] + Number(m[2].replace(/,/g, "")).toLocaleString() : value;
}

export function StatCard({ label, value, icon, color = "text-foreground", trend, trendLabel, onClick, className }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  /** Optional click handler; the whole card becomes a button. */
  onClick?: () => void;
  /** Optional Tailwind className override — useful for grid-span hierarchy */
  className?: string;
}) {
  // wave-64 tabular-nums for hardware-style alignment, data-tokens for trend colors.
  // Preserves freeform string values ("Loading...", "—", "85/100") as-is.
  const renderedValue = renderStatValue(value);

  const inner = (
    <>
      <div className="flex items-start justify-between mb-2.5">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{label}</span>
        <div className="text-muted-foreground/30 group-hover:text-primary/50 transition-colors">{icon}</div>
      </div>
      <div className={`font-bold text-2xl tracking-tight tabular-nums stat-value ${color}`}>{renderedValue}</div>
      {trendLabel && (
        <div className={`mt-2 text-[10px] font-medium tracking-wide flex items-center gap-1 ${
          trend === "up" ? "text-[var(--data-up)]" : trend === "down" ? "text-[var(--data-down)]" : "text-muted-foreground"
        }`}>
          {trend === "up" && "↑"}{trend === "down" && "↓"} {trendLabel}
        </div>
      )}
    </>
  );

  const handleClick = onClick;

  // When `handleClick` is set, the entire card is a clickable button. Cursor
  // pointer + a primary hover ring give clear affordance.
  if (handleClick) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`stat-card stat-card-interactive group glow-on-hover card-enter cursor-pointer hover:ring-1 hover:ring-primary/40 transition-shadow text-left w-full${className ? ` ${className}` : ""}`}
        aria-label={`${label} · open detail`}
      >
        {inner}
      </button>
    );
  }

  // 2026-05-23 · drop `stat-card-interactive` here. That class applies
  // cursor:pointer + hover-lift + active-scale (index.css:848) which
  // made EVERY non-clickable stat look + feel like a button — operator
  // taps, nothing happens. Plain card affordance only when there is
  // no action to take.
  return (
    <div className={`stat-card group card-enter${className ? ` ${className}` : ""}`}>
      {inner}
    </div>
  );
}

/**
 * KpiTile — stronger StatCard variant for hero metrics. Larger value,
 * optional sparkline, supports trend with delta vs previous.
 *
 * Use for the 1-3 most important numbers per section. Use StatCard
 * for the rest.
 */
export function KpiTile({
  label,
  value,
  delta,
  deltaLabel,
  trend = "neutral",
  icon,
  onClick,
  accent = "neutral",
}: {
  label: string;
  value: string | number;
  delta?: string | number;
  deltaLabel?: string;
  trend?: "up" | "down" | "neutral";
  icon?: React.ReactNode;
  onClick?: () => void;
  accent?: "neutral" | "primary" | "success" | "warning" | "danger";
}) {
  const accentMap = {
    neutral: "border-border/30",
    primary: "border-primary/30 bg-primary/[0.03]",
    success: "border-emerald-500/30 bg-emerald-500/[0.03]",
    warning: "border-amber-500/30 bg-amber-500/[0.03]",
    danger: "border-red-500/30 bg-red-500/[0.03]",
  };
  // wave-64 — same KPI upgrade as StatCard above. Tokens for trend colors.
  const trendColor =
    trend === "up" ? "text-[var(--data-up)]" :
    trend === "down" ? "text-[var(--data-down)]" :
    "text-foreground/40";
  const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "·";
  const Wrapper: React.ElementType = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`bg-card border ${accentMap[accent]} p-5 ${onClick ? "text-left w-full hover:ring-1 hover:ring-primary/40 transition-shadow cursor-pointer" : ""}`}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] font-bold text-foreground/50">{label}</span>
        {icon && <div className="text-foreground/30">{icon}</div>}
      </div>
      <div className="font-bold text-3xl text-foreground tracking-tight tabular-nums stat-value">{renderStatValue(value)}</div>
      {(delta || deltaLabel) && (
        <div className={`mt-2 text-[11px] font-medium ${trendColor} flex items-center gap-1`}>
          <span>{trendArrow}</span>
          {delta && <span>{delta}</span>}
          {deltaLabel && <span className="text-foreground/40">· {deltaLabel}</span>}
        </div>
      )}
    </Wrapper>
  );
}

export function StatusDot({ status }: { status?: string }) {
  const colors: Record<string, string> = {
    new: "bg-blue-400", confirmed: "bg-amber-400", completed: "bg-emerald-400",
    cancelled: "bg-red-400", contacted: "bg-amber-400", booked: "bg-emerald-400",
    closed: "bg-foreground/30", lost: "bg-red-400",
    // Work order statuses
    draft: "bg-foreground/30", checked_in: "bg-blue-400", in_progress: "bg-primary",
    waiting_parts: "bg-amber-400", ready_for_pickup: "bg-emerald-400",
    invoiced: "bg-emerald-400", picked_up: "bg-emerald-400",
  };
  return <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors[status || ""] || "bg-foreground/20"}`} />;
}
