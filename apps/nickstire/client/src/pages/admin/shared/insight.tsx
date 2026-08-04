/**
 * Shared admin insight strips — SectionInsightStrip, InsightStrip.
 */
import React from "react";
import { Sparkles, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { AdminSection } from "./types";
import { navigateToAdminSection } from "./navigation";

// ─── SECTION INSIGHT STRIP ─────────────────────────────────
// Drop this at the top of any admin section to surface a per-section
// actionable callout from `trpc.adminDashboard.sectionInsight`. Renders
// nothing when no actionable signal — silent on healthy sections.

const VARIANT_CLASS: Record<string, string> = {
  primary: "bg-primary/[0.06] border-primary/30 text-primary",
  warning: "bg-amber-500/[0.05] border-amber-500/30 text-amber-400",
  danger: "bg-red-500/[0.05] border-red-500/30 text-red-400",
  info: "bg-blue-500/[0.04] border-blue-500/25 text-blue-400",
  success: "bg-emerald-500/[0.04] border-emerald-500/25 text-emerald-400",
};

type SectionInsightSection =
  | "customers" | "revenue" | "leads" | "campaigns" | "callTrackingView"
  | "declinedEstimates" | "noShowRisk" | "content"
  | "settings" | "trafficFunnel" | "snapDashboard";

export function SectionInsightStrip({ section }: { section: SectionInsightSection }) {
  const { data } = trpc.adminDashboard.sectionInsight.useQuery(
    { section },
    { staleTime: 60_000, refetchInterval: 90_000 },
  );
  if (!data) return null;
  const variantClass = VARIANT_CLASS[data.variant] || VARIANT_CLASS.info;
  return (
    <div className={`flex items-center gap-3 border ${variantClass} px-4 py-2.5`}>
      <Sparkles className="w-4 h-4 shrink-0" />
      <div className="flex items-baseline gap-2 flex-wrap min-w-0 flex-1">
        <span className="font-bold text-sm whitespace-nowrap">{data.metric}</span>
        <span className="text-[12px] text-foreground/80 leading-snug">{data.message}</span>
      </div>
      <button
        onClick={() => navigateToAdminSection(
          data.cta.section as AdminSection,
          data.cta.settingsTab ? { settingsTab: data.cta.settingsTab } : undefined,
        )}
        className={`shrink-0 text-[11px] font-bold tracking-wider px-3 py-1 border rounded ${variantClass} hover:opacity-80 transition-opacity`}
      >
        {data.cta.label} →
      </button>
    </div>
  );
}

/**
 * InsightStrip — top-of-section actionable callout. Surfaces the
 * "what should I do RIGHT NOW" answer for whoever's looking at this
 * section. Variants:
 *
 *  - "primary"  → opportunity ($ on the table, CTA forward)
 *  - "warning"  → soft risk (something needs attention soon)
 *  - "danger"   → hard risk (something is failing now)
 *  - "info"     → status update / passive information
 *  - "success"  → green-light state, no action needed
 *
 * Use `metric` to anchor with a number ("$2,840 recoverable", "12 due
 * today"). Use `cta` for the action button.
 */
export function InsightStrip({
  variant = "info",
  icon,
  message,
  metric,
  cta,
  onDismiss,
}: {
  variant?: "primary" | "warning" | "danger" | "info" | "success";
  icon?: React.ReactNode;
  message: string;
  metric?: string;
  cta?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}) {
  const variants = {
    primary: "bg-primary/[0.06] border-primary/30 text-primary",
    warning: "bg-amber-500/[0.05] border-amber-500/30 text-amber-400",
    danger: "bg-red-500/[0.05] border-red-500/30 text-red-400",
    info: "bg-blue-500/[0.04] border-blue-500/25 text-blue-400",
    success: "bg-emerald-500/[0.04] border-emerald-500/25 text-emerald-400",
  };
  return (
    <div className={`flex items-center gap-3 border ${variants[variant]} px-4 py-2.5`}>
      {icon && <div className="shrink-0">{icon}</div>}
      <div className="flex items-baseline gap-2 flex-wrap min-w-0 flex-1">
        {metric && <span className="font-bold text-base whitespace-nowrap">{metric}</span>}
        <span className="text-[12px] text-foreground/80 leading-snug">{message}</span>
      </div>
      {cta && (
        <button
          onClick={cta.onClick}
          className={`shrink-0 text-[11px] font-bold tracking-wider px-3 py-1 border rounded ${variants[variant]} hover:bg-opacity-100 hover:bg-current hover:text-foreground transition-colors`}
        >
          {cta.label} →
        </button>
      )}
      {/* The dismiss below carries a 48x48 hit area behind its 16px glyph. It was
          a bare button with NO padding at all — a 16x16px target, the smallest
          control in the admin, on a one-handed-phone surface. Negative margins keep
          the ~40px row from growing to fit it. */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 -my-2 -mr-2 w-12 h-12 inline-flex items-center justify-center rounded-md text-foreground/30 hover:text-foreground/60 transition-colors"
          aria-label="Dismiss"
        >
          <XCircle className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
