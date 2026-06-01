/**
 * Shared admin metric/card primitives —
 * StatCard, KpiTile, UrgencyBadge, StatusDot, ActivityIcon, TimestampLabel.
 */
import React from "react";
import {
  CalendarClock, Users, Phone, Wrench, Gauge,
} from "lucide-react";
import CountUpNumber from "@/components/CountUpNumber";
import type { AdminSection } from "./types";
import { navigateToAdminSection } from "./navigation";

/**
 * renderStatValue — value-shape detector for the legacy StatCard. The
 * StatCard used to render `value` as raw text. Wave-64 upgrades it to:
 *   • detect pure-number values → animate with CountUpNumber
 *   • detect `$X,XXX` revenue values → animate the numeric portion, keep prefix
 *   • detect `XX/100` score values → animate the numerator, keep denominator
 *   • leave freeform strings ("Loading...", "—", "Healthy") as-is
 *
 * Numeric formatting preserves the existing display contract — the only
 * change is the count-up animation on first viewport entry.
 */
function renderStatValue(value: string | number): React.ReactNode {
  // Pure number → straight count-up
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) return String(value);
    return <CountUpNumber to={value} duration={900} />;
  }

  // Strings — try common KPI shapes
  const s = value;

  // "$X,XXX" or "$X.XX" → strip prefix, parse, animate. Preserves "$" prefix.
  if (s.startsWith("$")) {
    const rest = s.slice(1).replace(/,/g, "");
    const num = Number(rest);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      const decimals = rest.includes(".") ? (rest.split(".")[1]?.length ?? 0) : 0;
      return <CountUpNumber to={num} prefix="$" duration={900} decimals={decimals} />;
    }
  }

  // "XX/100" or "XX/YY" score → animate numerator, keep "/YY"
  const scoreMatch = s.match(/^(\d+(?:\.\d+)?)(\/\d+(?:\.\d+)?)$/);
  if (scoreMatch) {
    const num = Number(scoreMatch[1]);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      return <CountUpNumber to={num} suffix={scoreMatch[2]} duration={900} />;
    }
  }

  // "X%" → animate numeric, keep "%"
  const pctMatch = s.match(/^(\d+(?:\.\d+)?)%$/);
  if (pctMatch) {
    const num = Number(pctMatch[1]);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      const decimals = pctMatch[1].includes(".") ? (pctMatch[1].split(".")[1]?.length ?? 0) : 0;
      return <CountUpNumber to={num} suffix="%" duration={900} decimals={decimals} />;
    }
  }

  // Plain integer-looking string ("23", "1,250") → parse + animate
  const plainMatch = s.match(/^[\d,]+$/);
  if (plainMatch) {
    const num = Number(s.replace(/,/g, ""));
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      return <CountUpNumber to={num} duration={900} />;
    }
  }

  // Freeform string fallback — render as-is.
  return s;
}

export function StatCard({ label, value, icon, color = "text-foreground", trend, trendLabel, onClick, targetSection, settingsTab, className }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  /** Optional generic click handler. Use this OR targetSection, not both. */
  onClick?: () => void;
  /** Optional shortcut: clicking the card jumps to this admin section. */
  targetSection?: AdminSection;
  /** Optional sub-tab for Settings section (health, integrations, etc.) */
  settingsTab?: string;
  /** Optional Tailwind className override — useful for grid-span hierarchy */
  className?: string;
}) {
  // wave-64 — surgical KPI upgrade: animated count-up for numeric values,
  // tabular-nums for hardware-style alignment, data-tokens for trend colors.
  // Preserves freeform string values ("Loading...", "—", "85/100") as-is.
  const renderedValue = renderStatValue(value);

  const inner = (
    <>
      <div className="flex items-start justify-between mb-2.5">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{label}</span>
        <div className="text-muted-foreground/30 group-hover:text-primary/50 transition-colors">{icon}</div>
      </div>
      <div className={`font-bold text-2xl tracking-tight tabular-nums number-animate ${color} ${String(value).startsWith('$') ? 'revenue-glow' : ''}`}>{renderedValue}</div>
      {trendLabel && (
        <div className={`mt-2 text-[10px] font-medium tracking-wide flex items-center gap-1 ${
          trend === "up" ? "text-[var(--data-up)]" : trend === "down" ? "text-[var(--data-down)]" : "text-muted-foreground"
        }`}>
          {trend === "up" && "↑"}{trend === "down" && "↓"} {trendLabel}
        </div>
      )}
    </>
  );

  const handleClick = onClick || (targetSection ? () => navigateToAdminSection(targetSection, { settingsTab }) : undefined);

  // When `handleClick` is set, the entire card is a clickable button. Cursor
  // pointer + a primary hover ring give clear affordance.
  if (handleClick) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`stat-card stat-card-interactive group glow-on-hover card-enter cursor-pointer hover:ring-1 hover:ring-primary/40 transition-shadow text-left w-full${className ? ` ${className}` : ""}`}
        aria-label={`${label} — open detail`}
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

export function UrgencyBadge({ score }: { score: number }) {
  const config = score >= 4
    ? { label: `URGENT (${score}/5)`, color: "text-red-400 bg-red-500/10 border-red-500/20" }
    : score >= 3
    ? { label: `MEDIUM (${score}/5)`, color: "text-amber-400 bg-amber-500/10 border-amber-500/20" }
    : { label: `LOW (${score}/5)`, color: "text-foreground/50 bg-foreground/5 border-border/30" };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${config.color}`}>
      {config.label}
    </span>
  );
}

export function ActivityIcon({ type }: { type: string }) {
  switch (type) {
    case "booking": return <CalendarClock className="w-3.5 h-3.5 text-blue-400" />;
    case "lead": return <Users className="w-3.5 h-3.5 text-amber-400" />;
    case "callback": return <Phone className="w-3.5 h-3.5 text-emerald-400" />;
    case "workOrder": return <Wrench className="w-3.5 h-3.5 text-primary" />;
    default: return <Gauge className="w-3.5 h-3.5 text-foreground/40" />;
  }
}

/**
 * TimestampLabel — "Last refreshed: 3 min ago" tag. Use to make
 * data-freshness explicit at the top of any data-heavy panel.
 *
 * Auto-updates the relative time every 30s.
 */
export function TimestampLabel({
  date,
  prefix = "Updated",
  className = "",
}: {
  date: Date | string | null | undefined;
  prefix?: string;
  className?: string;
}) {
  const [, forceUpdate] = React.useState(0);
  React.useEffect(() => {
    const tick = setInterval(() => forceUpdate((n) => n + 1), 30_000);
    return () => clearInterval(tick);
  }, []);

  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;

  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  let label: string;
  if (diffSec < 30) label = "just now";
  else if (diffSec < 60) label = `${diffSec}s ago`;
  else if (diffSec < 3600) label = `${Math.floor(diffSec / 60)}m ago`;
  else if (diffSec < 86400) label = `${Math.floor(diffSec / 3600)}h ago`;
  else label = `${Math.floor(diffSec / 86400)}d ago`;

  return (
    <span className={`text-[10px] text-foreground/40 ${className}`}>
      {prefix} {label}
    </span>
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
        <span className="text-[10px] font-bold text-foreground/50 tracking-[0.15em] uppercase">{label}</span>
        {icon && <div className="text-foreground/30">{icon}</div>}
      </div>
      <div className="font-bold text-3xl text-foreground tracking-tight tabular-nums number-animate">{renderStatValue(value)}</div>
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
