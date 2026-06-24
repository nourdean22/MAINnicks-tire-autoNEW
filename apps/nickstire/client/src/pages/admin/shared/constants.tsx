/**
 * Shared admin constants — status configs, palettes, section titles.
 */
import React from "react";
import { CheckCircle2, XCircle, CalendarClock } from "lucide-react";
import type { AdminSection, BookingStatus, LeadStatus } from "./types";

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

// ─── CANONICAL SIGNAL PALETTE ───────────────────────────
// 2026-05-19 · audit-aligned. The admin uses 3 semantic signal colors
// plus the brand primary. Anything outside this set is decorative.
//
//   emerald  →  good / done / safe / connected / clear
//   amber    →  warning / at-risk / VIP-gold / wait-time / blocked
//   red      →  danger / urgent / overdue / churn / lost
//   primary  →  brand action / value-in-flow / interactive accent
//   foreground/{40,50,60,70} → neutral text (subtle → strong)
//
// AVOID: text-purple-* · text-cyan-* · text-pink-* · text-yellow-* ·
// text-orange-* (these were decorative leftovers from the wall-of-info
// era). For VIP use amber. For info/action use primary. For neutral
// content use foreground/* shades.
//
// wave-181.26 · brand-yellow reconciliation: CHART_COLORS[0] +
// CHART_THEME.primary were #F5A623 (slightly orange) — 2% off the
// canonical brand yellow #FDB913 used on CTAs. Realigned so Recharts
// series visually match the rest of the UI.
// Slots 0-3 = canonical signal palette (gold/blue/green/red). Slots 4-7
// repeat the same four hues as lighter tints so Recharts series with >4
// categories stay on-palette instead of reaching for purple/pink/orange/cyan.
export const CHART_COLORS = ["#FDB913", "#3B82F6", "#10B981", "#EF4444", "#FFD54F", "#93C5FD", "#6EE7B7", "#FCA5A5"];

/** Shared chart styling — single source of truth for all Recharts components */
export const CHART_THEME = {
  grid: "#333",
  axis: "#666",
  tooltip: { background: "#1a1a1a", border: "1px solid #333", fontSize: 12 },
  primary: "#FDB913",
  secondary: "#3B82F6",
  tertiary: "#10B981",
  quaternary: "#8B5CF6",
} as const;

export const SECTION_TITLES: Record<AdminSection, string> = {
  overview: "Today",
  leads: "Sales Pipeline",
  content: "Content & AI",
  customers: "Customers",
  campaigns: "Winback",
  settings: "Settings / Safety",
  revenue: "Money",
  callTrackingView: "Call Tracking",
  voiceReceptionist: "Voice Receptionist",
  // wave-181.x Wave 3 · intelligence label removed (section retired) ·
  // URL alias redirects ?tab=intelligence → "overview"
  trafficFunnel: "Traffic → Revenue",
  memberships: "Nonstop Nick",
  tireOrders: "Tires",
  opsHub: "Reports",
  growth: "Marketing / Growth",
  intelligence: "Intelligence HQ",
};
