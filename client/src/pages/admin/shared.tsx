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

// ─── 2026-05-06 — useUrlFilter hook ────────────────────────
// Single source of truth for URL-persistent filter state across
// every admin list/grid. Replaces ~25 ad-hoc useState patterns
// for filters that were lost on reload.
//
// Design choices:
//   · Default values are NOT written to the URL (keeps URLs clean)
//   · Search inputs are debounced 300ms before writing to URL
//     (avoids one history entry per keystroke)
//   · Validator is optional but recommended for enum unions
//   · Multiple useUrlFilter calls in one component coexist via
//     unique `name` keys; replaceState batches them
//   · Initial render reads URL synchronously (no hydration flash)
//   · Returns [value, setValue, reset] tuple (reset = setValue(default))
//
// Usage:
//   const [filter, setFilter] = useUrlFilter("status", "all", {
//     validate: (v) => ["all","new","contacted","booked"].includes(v) ? v : null,
//   });
//   const [search, setSearch, resetSearch] = useUrlFilter("q", "", { debounce: true });

interface UseUrlFilterOptions<T> {
  /** Validator — return T if valid, null if invalid (uses default). */
  validate?: (raw: string) => T | null;
  /** If true, debounce URL writes by 300ms (for search inputs). */
  debounce?: boolean;
}

export function useUrlFilter<T extends string>(
  name: string,
  defaultValue: T,
  options: UseUrlFilterOptions<T> = {},
): [T, (next: T) => void, () => void] {
  const { validate, debounce = false } = options;

  const readUrlValue = React.useCallback((): T => {
    if (typeof window === "undefined") return defaultValue;
    const raw = new URLSearchParams(window.location.search).get(name);
    if (raw === null) return defaultValue;
    if (validate) {
      const v = validate(raw);
      return v === null ? defaultValue : v;
    }
    return raw as T;
  }, [name, defaultValue, validate]);

  const [value, setLocalValue] = React.useState<T>(readUrlValue);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeUrl = React.useCallback((next: T) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === defaultValue || next === "" || next === undefined || next === null) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, String(next));
    }
    window.history.replaceState({}, "", url.toString());
  }, [name, defaultValue]);

  const setValue = React.useCallback((next: T) => {
    setLocalValue(next);
    if (debounce) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => writeUrl(next), 300);
    } else {
      writeUrl(next);
    }
  }, [writeUrl, debounce]);

  const reset = React.useCallback(() => {
    setValue(defaultValue);
  }, [setValue, defaultValue]);

  // Cleanup debounce on unmount
  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return [value, setValue, reset];
}

// ─── 2026-05-06 — TABBAR / SEARCH / BREADCRUMBS / TIMESTAMP ──
// Unified secondary-navigation primitives. Replaces ~6 different
// in-section tab implementations + ad-hoc search + ad-hoc "last
// refreshed" timestamps. Net: identical interaction language
// everywhere in admin.

interface TabBarItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  badge?: number | string;
  /** Optional sub-label rendered under the label */
  subtitle?: string;
}

/**
 * TabBar — the canonical secondary navigation pattern. Used inside
 * a section to switch between sub-views (e.g. Customers → Loyalty →
 * Coupons, or Revenue → Daily → Invoices → Forecast).
 *
 * Two variants:
 *   - `border` (default): underline-style, tighter, fits long lists
 *   - `pill`: rounded-button style, fits 2-4 short tabs
 */
export function TabBar<T extends string>({
  tabs,
  activeTab,
  onChange,
  variant = "border",
  size = "default",
}: {
  tabs: TabBarItem<T>[];
  activeTab: T;
  onChange: (id: T) => void;
  variant?: "border" | "pill";
  size?: "default" | "compact";
}) {
  if (variant === "pill") {
    return (
      <div className="inline-flex items-center gap-1 bg-card/50 border border-border/30 p-1 rounded-md">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-1.5 px-3 ${size === "compact" ? "py-1" : "py-1.5"} text-[12px] font-bold tracking-wide rounded transition-all whitespace-nowrap ${
              activeTab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge !== "" && (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                activeTab === t.id ? "bg-primary-foreground/15 text-primary-foreground" : "bg-foreground/10 text-foreground/60"
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 border-b border-border/20 overflow-x-auto">
      {tabs.map((t) => {
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-1.5 px-4 ${size === "compact" ? "py-1.5" : "py-2.5"} text-[12px] font-bold tracking-wide border-b-2 transition-colors whitespace-nowrap ${
              active
                ? "border-primary text-primary"
                : "border-transparent text-foreground/40 hover:text-foreground/70"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge !== "" && (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                active ? "bg-primary/15 text-primary" : "bg-foreground/10 text-foreground/60"
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * SearchInput — canonical text-search field for any list/grid in admin.
 * Replaces ~12 different inline search input styles.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  size = "default",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  size?: "default" | "compact";
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-background border border-border/30 text-foreground pl-9 pr-3 ${size === "compact" ? "py-1.5 text-[12px]" : "py-2 text-[13px]"} rounded focus:border-primary focus:outline-none placeholder:text-foreground/30`}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60"
          aria-label="Clear search"
        >
          <XCircle className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Breadcrumbs — section / sub-section / detail. Used inside a section
 * when there's a deep view (e.g. Customers → John Smith → Edit).
 * onClick on a non-final crumb navigates back.
 */
export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; onClick?: () => void }>;
}) {
  return (
    <nav className="flex items-center gap-1.5 text-[11px] text-foreground/40 flex-wrap">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {item.onClick && !isLast ? (
              <button
                onClick={item.onClick}
                className="hover:text-foreground transition-colors"
              >
                {item.label}
              </button>
            ) : (
              <span className={isLast ? "text-foreground font-medium" : ""}>
                {item.label}
              </span>
            )}
            {!isLast && <span className="text-foreground/20">/</span>}
          </React.Fragment>
        );
      })}
    </nav>
  );
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

// ─── SECTION INSIGHT STRIP ─────────────────────────────────
// Drop this at the top of any admin section to surface a per-section
// actionable callout from `trpc.adminDashboard.sectionInsight`. Renders
// nothing when no actionable signal — silent on healthy sections.

import { trpc } from "@/lib/trpc";

const VARIANT_CLASS: Record<string, string> = {
  primary: "bg-primary/[0.06] border-primary/30 text-primary",
  warning: "bg-amber-500/[0.05] border-amber-500/30 text-amber-400",
  danger: "bg-red-500/[0.05] border-red-500/30 text-red-400",
  info: "bg-blue-500/[0.04] border-blue-500/25 text-blue-400",
  success: "bg-emerald-500/[0.04] border-emerald-500/25 text-emerald-400",
};

type SectionInsightSection =
  | "customers" | "revenue" | "leads" | "campaigns" | "callTrackingView"
  | "declinedEstimates" | "noShowRisk" | "reEngagement" | "content"
  | "intelligence" | "settings" | "trafficFunnel" | "snapDashboard";

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
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-foreground/30 hover:text-foreground/60 transition-colors"
          aria-label="Dismiss"
        >
          <XCircle className="w-4 h-4" />
        </button>
      )}
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
  const trendColor =
    trend === "up" ? "text-emerald-400" :
    trend === "down" ? "text-red-400" :
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
      <div className="font-bold text-3xl text-foreground tracking-tight number-animate">{value}</div>
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
