/**
 * Shared admin layout primitives — PageHeader, Panel, Section, MetricGrid, Toolbar.
 */
import React from "react";

// ─── PAGE HEADER ────────────────────────────────────────
// Standardized header for all admin sections. Use this at the top of every section.
export function PageHeader({ title, subtitle, icon, actions, badge }: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  badge?: { label: string; variant: "success" | "warning" | "danger" | "neutral" };
}) {
  const badgeColors = {
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    danger: "bg-red-500/10 text-red-400 border-red-500/20",
    neutral: "bg-foreground/5 text-foreground/50 border-border/30",
  };

  return (
    <div className="flex items-start justify-between mb-6">
      <div className="flex items-center gap-3">
        {icon && <div className="text-primary/70">{icon}</div>}
        <div>
          <h2 className="text-[15px] font-bold text-foreground tracking-[-0.01em]">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {badge && (
          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold tracking-wide border rounded ${badgeColors[badge.variant]}`}>
            {badge.label}
          </span>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── 2026-05-05 — UNIFIED LAYOUT PRIMITIVES ───────────────
// Standardize how every admin section renders. Replaces the scattered
// `bg-card border border-border/30 p-4` patterns and per-section
// PageHeader/Loading/Empty/Error variants. Net effect: one visual
// language across all 32 admin sections.

/**
 * Panel — the single canonical card wrapper for any content block in
 * admin. Replaces ~80 inline `bg-card border border-border/30 p-X`
 * usages with one component that has consistent padding, border,
 * radius, hover affordance, and accent variants.
 *
 * Use `accent` to communicate state without color spam: "info" (blue),
 * "warning" (amber), "danger" (red), "success" (emerald), "primary"
 * (yellow) for actionable callouts.
 */
export function Panel({
  title,
  subtitle,
  icon,
  actions,
  children,
  className = "",
  padding = "md",
  accent = "neutral",
  contentClassName = "",
}: {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  accent?: "neutral" | "info" | "warning" | "danger" | "success" | "primary";
  contentClassName?: string;
}) {
  const padMap = { none: "", sm: "p-3", md: "p-4", lg: "p-6" };
  const accentMap = {
    neutral: "border-border/30",
    info: "border-blue-500/30 bg-blue-500/[0.02]",
    warning: "border-amber-500/30 bg-amber-500/[0.02]",
    danger: "border-red-500/30 bg-red-500/[0.02]",
    success: "border-emerald-500/30 bg-emerald-500/[0.02]",
    primary: "border-primary/30 bg-primary/[0.02]",
  };
  return (
    <div className={`bg-card border ${accentMap[accent]} ${className}`}>
      {(title || actions) && (
        <div className={`flex items-start justify-between gap-3 ${padMap[padding] || "p-4"} ${children ? "border-b border-border/10 pb-3" : ""}`}>
          <div className="flex items-start gap-2.5 min-w-0">
            {icon && <div className="text-foreground/50 shrink-0 mt-0.5">{icon}</div>}
            <div className="min-w-0">
              {title && <h3 className="text-[13px] font-bold text-foreground tracking-wide truncate">{title}</h3>}
              {subtitle && <p className="text-[11px] text-foreground/50 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={`${padMap[padding]} ${title || actions ? "pt-3" : ""} ${contentClassName}`}>{children}</div>
    </div>
  );
}

/**
 * Section — top-level wrapper for an admin section. Combines PageHeader
 * + a vertical-rhythm content area. Replaces the scattered top-level
 * `<div className="space-y-6">` openings + manual title rendering.
 *
 * Pass `pageHeader` props directly — title/subtitle/icon/actions/badge.
 * Pass `intelligenceStrip` (optional) for a top-level "what to do now"
 * callout that scrolls with the page.
 */
export function Section({
  title,
  subtitle,
  icon,
  actions,
  badge,
  intelligenceStrip,
  children,
  spacing = "default",
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  badge?: { label: string; variant: "success" | "warning" | "danger" | "neutral" };
  intelligenceStrip?: React.ReactNode;
  children: React.ReactNode;
  spacing?: "tight" | "default" | "loose";
}) {
  const spacingMap = { tight: "space-y-4", default: "space-y-6", loose: "space-y-8" };
  return (
    <div className={spacingMap[spacing]}>
      <PageHeader title={title} subtitle={subtitle} icon={icon} actions={actions} badge={badge} />
      {intelligenceStrip}
      {children}
    </div>
  );
}

/**
 * MetricGrid — responsive grid wrapper for StatCards. Replaces the
 * scattered `grid grid-cols-2 lg:grid-cols-X gap-4` patterns.
 */
export function MetricGrid({ cols = 4, children }: {
  cols?: 2 | 3 | 4 | 5 | 6;
  children: React.ReactNode;
}) {
  const colMap = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 lg:grid-cols-5",
    6: "grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
  };
  return <div className={`grid ${colMap[cols]} gap-4`}>{children}</div>;
}

/**
 * Toolbar — horizontal button row with consistent gap + alignment.
 * Replaces inline `flex items-center gap-2` for action rows.
 */
export function Toolbar({ children, align = "right" }: {
  children: React.ReactNode;
  align?: "left" | "right" | "between";
}) {
  const alignMap = {
    left: "justify-start",
    right: "justify-end",
    between: "justify-between",
  };
  return <div className={`flex items-center gap-2 flex-wrap ${alignMap[align]}`}>{children}</div>;
}
