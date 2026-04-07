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
} from "lucide-react";

// ─── TYPES ──────────────────────────────────────────────
export type AdminSection = "commandCenter" | "overview" | "bookings" | "leads" | "content" | "chats" | "health" | "coupons" | "qa" | "referrals" | "jobs" | "inspections" | "loyalty" | "followups" | "sms" | "reviewRequests" | "customers" | "winback" | "campaigns" | "autoFollowUp" | "settings" | "shopdriver" | "estimates" | "activity" | "revenue" | "integrations" | "tireOrders" | "analyticsView" | "callTrackingView" | "exportView" | "financing" | "workOrders" | "dispatch" | "intelligence" | "specials";
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
    label: "NOUR OS",
    items: [
      { id: "commandCenter", label: "NOUR OS Bridge", icon: <Zap className="w-4 h-4" /> },
    ],
  },
  {
    label: "Shop",
    items: [
      { id: "overview", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: "customers", label: "Customers", icon: <UserCheck className="w-4 h-4" /> },
      { id: "workOrders", label: "Work Orders", icon: <Wrench className="w-4 h-4" /> },
      { id: "dispatch", label: "Dispatch & QC", icon: <ClipboardList className="w-4 h-4" /> },
      { id: "tireOrders", label: "Tire Orders", icon: <ShoppingCart className="w-4 h-4" /> },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { id: "leads", label: "Website Leads", icon: <Users className="w-4 h-4" />, badge: "leads" },
      { id: "bookings", label: "Online Bookings", icon: <CalendarClock className="w-4 h-4" />, badge: "bookings" },
      { id: "estimates", label: "Walk-In Estimates", icon: <DollarSign className="w-4 h-4" /> },
    ],
  },
  {
    label: "Revenue",
    items: [
      { id: "revenue", label: "Revenue", icon: <TrendingUp className="w-4 h-4" /> },
      { id: "intelligence", label: "Intelligence", icon: <Brain className="w-4 h-4" /> },
      { id: "financing", label: "Financing", icon: <CreditCard className="w-4 h-4" /> },
      { id: "callTrackingView", label: "Calls", icon: <PhoneCall className="w-4 h-4" /> },
    ],
  },
  {
    label: "Outreach",
    items: [
      { id: "campaigns", label: "Outreach Hub", icon: <Send className="w-4 h-4" /> },
      { id: "loyalty", label: "Loyalty", icon: <Trophy className="w-4 h-4" /> },
      { id: "referrals", label: "Referrals", icon: <Gift className="w-4 h-4" /> },
      { id: "coupons", label: "Coupons", icon: <Star className="w-4 h-4" /> },
      { id: "specials", label: "Specials", icon: <Tag className="w-4 h-4" /> },
    ],
  },
  {
    label: "System",
    items: [
      { id: "settings", label: "ShopDriver HQ", icon: <Plug className="w-4 h-4" /> },
      { id: "content", label: "Content", icon: <FileText className="w-4 h-4" /> },
      { id: "analyticsView", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
      { id: "exportView", label: "Export", icon: <Download className="w-4 h-4" /> },
      { id: "health", label: "Site Health", icon: <Globe className="w-4 h-4" /> },
      { id: "activity", label: "Activity", icon: <Activity className="w-4 h-4" /> },
    ],
  },
];

// Flat list for backward compatibility
export const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);

export const SECTION_TITLES: Record<AdminSection, string> = {
  commandCenter: "NOUR OS Bridge",
  overview: "Shop Dashboard",
  bookings: "Online Bookings",
  leads: "Website Leads",
  content: "Content",
  chats: "Chat Sessions",
  health: "Site Health",
  coupons: "Coupons",
  qa: "Q&A",
  referrals: "Referrals",
  jobs: "Job Board",
  inspections: "Inspections",
  loyalty: "Loyalty",
  followups: "Follow-Ups",
  sms: "SMS",
  reviewRequests: "Reviews",
  customers: "Customers",
  winback: "Win-Back",
  campaigns: "Outreach Hub",
  autoFollowUp: "Auto Follow-Up",
  settings: "ShopDriver HQ",
  shopdriver: "ShopDriver Sync",
  estimates: "Walk-In Estimates",
  activity: "Activity",
  revenue: "Revenue",
  integrations: "Integrations",
  tireOrders: "Tire Orders",
  analyticsView: "Analytics",
  callTrackingView: "Call Tracking",
  exportView: "Export",
  financing: "Financing",
  workOrders: "Work Orders",
  dispatch: "Dispatch",
  intelligence: "Intelligence",
  specials: "Specials",
};

// ─── SMALL UTILITY COMPONENTS ───────────────────────────
export function StatCard({ label, value, icon, color = "text-foreground", trend, trendLabel }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
}) {
  return (
    <div className="stat-card group glow-on-hover">
      <div className="flex items-start justify-between mb-2.5">
        <span className="text-[11px] font-medium text-muted-foreground tracking-wide">{label}</span>
        <div className="text-muted-foreground/30 group-hover:text-primary/50 transition-colors">{icon}</div>
      </div>
      <div className={`font-bold text-2xl tracking-tight ${color}`}>{value}</div>
      {trendLabel && (
        <div className={`mt-2 text-[10px] font-medium tracking-wide flex items-center gap-1 ${
          trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-muted-foreground"
        }`}>
          {trend === "up" && "\u2191"}{trend === "down" && "\u2193"} {trendLabel}
        </div>
      )}
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
