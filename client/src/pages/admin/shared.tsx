/**
 * Shared admin types, constants, and small utility components.
 */
import React from "react";
import {
  CheckCircle2, XCircle, Loader2, AlertTriangle,
  Phone, Mail, MessageSquare, CalendarClock, Users,
  LayoutDashboard, FileText, Globe, Wrench, Gauge,
  ClipboardList, Trophy, Gift, Send, Star, UserCheck, RotateCcw, Timer,
  Settings, Upload, DollarSign, Activity, TrendingUp, Plug, ShoppingCart,
  BarChart3, PhoneCall, Download, CreditCard, Zap, Brain, Tag,
  Shield, Package, ListOrdered, Search, Sparkles,
} from "lucide-react";

// ─── TYPES ──────────────────────────────────────────────
// 2026-04-24 admin audit: down from 45 sections to 16 active routes.
// Deleted 27 dead/redundant sections. See commit log for rationale.
export type AdminSection =
  | "commandCenter" | "overview" | "leads" | "content" | "customers"
  | "campaigns" | "settings" | "revenue" | "callTrackingView" | "intelligence"
  | "declinedEstimates" | "reEngagement" | "noShowRisk" | "walkInCalc"
  | "snapDashboard" | "trafficFunnel" | "conversionPreview";
export type BookingStatus = "new" | "confirmed" | "completed" | "cancelled";
export type LeadStatus = "new" | "contacted" | "booked" | "completed" | "closed" | "lost";

// ─── CONSTANTS ──────────────────────────────────────────
export const BOOKING_STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  new: { label: "New", color: "text-blue-400", bgColor: "bg-blue-500/10", icon: <CalendarClock className="w-3.5 h-3.5" /> },
  confirmed: { label: "Confirmed", color: "text-amber-400", bgColor: "bg-amber-500/10", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  completed: { label: "Completed", color: "text-emerald-400", bgColor: "bg-emerald-500/10", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  cancelled: { label: "Cancelled", color: "text-red-400", bgColor: "bg-red-500/10", icon: <XCircle className="w-3.5 h-3.5" /> },
};

export const LEAD_STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bgColor: string }> = {
  new: { label: "New", color: "text-blue-400", bgColor: "bg-blue-500/10" },
  contacted: { label: "Contacted", color: "text-amber-400", bgColor: "bg-amber-500/10" },
  booked: { label: "Booked", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  completed: { label: "Completed", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  closed: { label: "Closed", color: "text-foreground/40", bgColor: "bg-foreground/5" },
  lost: { label: "Lost", color: "text-red-400", bgColor: "bg-red-500/10" },
};

export const TIME_LABELS: Record<string, string> = {
  morning: "Morning (9-12)",
  afternoon: "Afternoon (12-6)",
  "no-preference": "No Preference",
};

export const CHART_COLORS = ["#F5A623", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#F97316", "#06B6D4"];

/** Shared chart styling — single source of truth for all Recharts components */
export const CHART_THEME = {
  grid: "#333",
  axis: "#666",
  tooltip: { background: "#1a1a1a", border: "1px solid #333", fontSize: 12 },
  primary: "#F5A623",
  secondary: "#3B82F6",
  tertiary: "#10B981",
  quaternary: "#8B5CF6",
} as const;

export type NavGroup = { label: string; items: { id: AdminSection; label: string; icon: React.ReactNode; badge?: string }[] };

/**
 * NAV STRUCTURE — Tesla-style: simple surface, powerful underneath.
 *
 * Auto Labor Guide (ALG) is the master. Invoices = completed sales.
 * Estimates = walk-in quotes. Bookings = online appointments.
 *
 * Removed: Bay Dispatch (useless), Inspections (useless), separate Financing,
 * separate Estimates page, all "More" tab clutter.
 *
 * Outreach consolidated: SMS + Follow-Ups + Campaigns + Reviews + Win-Back = ONE page.
 * "More" items distributed: Analytics → Dashboard, Chat → Dashboard, Content → Settings,
 * ShopDriver → Settings, everything else auto-syncs via brain.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "COMMAND",
    items: [
      { id: "overview", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: "trafficFunnel", label: "Traffic → Revenue", icon: <TrendingUp className="w-4 h-4" /> },
      { id: "walkInCalc", label: "Walk-In Quote", icon: <DollarSign className="w-4 h-4" /> },
      { id: "commandCenter", label: "NOUR OS Bridge", icon: <Zap className="w-4 h-4" /> },
      { id: "intelligence", label: "Intelligence", icon: <Brain className="w-4 h-4" /> },
      { id: "conversionPreview", label: "Conversion Preview", icon: <Sparkles className="w-4 h-4" /> },
    ],
  },
  {
    label: "PIPELINE",
    items: [
      { id: "leads", label: "Leads & Estimates", icon: <Users className="w-4 h-4" />, badge: "leads" },
      { id: "customers", label: "Customers", icon: <UserCheck className="w-4 h-4" /> },
      { id: "callTrackingView", label: "Call Tracking", icon: <PhoneCall className="w-4 h-4" />, badge: "callbacks" },
      { id: "declinedEstimates", label: "Declined Work", icon: <AlertTriangle className="w-4 h-4" /> },
      { id: "noShowRisk", label: "No-Show Risk", icon: <AlertTriangle className="w-4 h-4" /> },
      { id: "snapDashboard", label: "Snap Finance", icon: <CreditCard className="w-4 h-4" /> },
      { id: "revenue", label: "Revenue & Shop", icon: <TrendingUp className="w-4 h-4" /> },
    ],
  },
  {
    label: "OUTREACH",
    items: [
      { id: "campaigns", label: "Outreach Hub", icon: <Send className="w-4 h-4" /> },
      { id: "reEngagement", label: "Re-engagement", icon: <RotateCcw className="w-4 h-4" /> },
      { id: "content", label: "Content & AI", icon: <FileText className="w-4 h-4" /> },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      // One entry — ShopDriver HQ, System Health, Compliance, and Integrations
      // are now tabs INSIDE the Settings page (SettingsSection.tsx) per
      // "move all system stuff to the settings page". Deep links still work
      // via ?tab=settings&settingsTab=health (or compliance/integrations).
      { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
    ],
  },
];

// Flat list for backward compatibility
export const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);

export const SECTION_TITLES: Record<AdminSection, string> = {
  commandCenter: "NOUR OS Bridge",
  overview: "Shop Dashboard",
  leads: "Leads & Estimates",
  content: "Content & AI",
  customers: "Customers",
  campaigns: "Outreach Hub",
  settings: "Settings & System",
  revenue: "Revenue & Shop",
  callTrackingView: "Call Tracking",
  intelligence: "Intelligence",
  declinedEstimates: "Declined Work",
  reEngagement: "Re-engagement",
  noShowRisk: "No-Show Risk",
  walkInCalc: "Walk-In Quote",
  snapDashboard: "Snap Finance",
  trafficFunnel: "Traffic → Revenue",
  conversionPreview: "Conversion Preview",
};

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

// ─── STATE INDICATORS ───────────────────────────────────
// Loading, empty, and error states for consistent UX across all sections.
export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3" />
      <p className="text-[12px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function EmptyState({ icon, title, subtitle, action }: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="text-foreground/10 mb-3">{icon}</div>}
      <p className="text-[13px] font-medium text-foreground/40">{title}</p>
      {subtitle && <p className="text-[11px] text-foreground/20 mt-1 max-w-xs">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = "Something went wrong", onRetry }: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <AlertTriangle className="w-6 h-6 text-red-400/50 mb-3" />
      <p className="text-[12px] text-red-400/70">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 px-3 py-1.5 text-[11px] font-medium text-primary bg-primary/10 rounded hover:bg-primary/20 transition-colors">
          Try Again
        </button>
      )}
    </div>
  );
}

// ─── SMALL UTILITY COMPONENTS ───────────────────────────
/**
 * Section-navigation helper \u2014 fires the same `admin:navigate-section` event
 * that Admin.tsx listens for (see line 220-233). Optionally also writes
 * `settingsTab` to the URL so SettingsSection lands on the right inner tab.
 *
 * Why an event + URL write instead of a wouter <Link>: Admin.tsx is a
 * single-page component; clicking a Link to /admin?tab=X doesn't actually
 * remount Admin or re-resolve the section state. The event bridge is the
 * existing mechanism the codebase uses for cross-section nav.
 */
export function navigateToAdminSection(section: AdminSection, opts?: { settingsTab?: string }) {
  if (typeof window === "undefined") return;
  if (opts?.settingsTab) {
    const url = new URL(window.location.href);
    url.searchParams.set("settingsTab", opts.settingsTab);
    window.history.replaceState({}, "", url.toString());
  }
  window.dispatchEvent(
    new CustomEvent("admin:navigate-section", { detail: { section } })
  );
}

export function StatCard({ label, value, icon, color = "text-foreground", trend, trendLabel, onClick, targetSection, settingsTab }: {
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
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between mb-2.5">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{label}</span>
        <div className="text-muted-foreground/30 group-hover:text-primary/50 transition-colors">{icon}</div>
      </div>
      <div className={`font-bold text-2xl tracking-tight number-animate ${color} ${String(value).startsWith('$') ? 'revenue-glow' : ''}`}>{value}</div>
      {trendLabel && (
        <div className={`mt-2 text-[10px] font-medium tracking-wide flex items-center gap-1 ${
          trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-muted-foreground"
        }`}>
          {trend === "up" && "\u2191"}{trend === "down" && "\u2193"} {trendLabel}
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
        className="stat-card stat-card-interactive group glow-on-hover card-enter cursor-pointer hover:ring-1 hover:ring-primary/40 transition-shadow text-left w-full"
        aria-label={`${label} \u2014 open detail`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="stat-card stat-card-interactive group glow-on-hover card-enter">
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
