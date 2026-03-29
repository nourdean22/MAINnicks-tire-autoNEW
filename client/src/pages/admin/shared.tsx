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
  BarChart3, PhoneCall, Download, CreditCard,
} from "lucide-react";

// ─── TYPES ──────────────────────────────────────────────
export type AdminSection = "overview" | "bookings" | "leads" | "content" | "chats" | "health" | "coupons" | "qa" | "referrals" | "jobs" | "inspections" | "loyalty" | "followups" | "sms" | "reviewRequests" | "customers" | "winback" | "campaigns" | "autoFollowUp" | "settings" | "shopdriver" | "estimates" | "activity" | "revenue" | "integrations" | "tireOrders" | "analyticsView" | "callTrackingView" | "exportView" | "financing" | "workOrders";
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

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Dashboard",
    items: [
      { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> },
      { id: "analyticsView", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
      { id: "callTrackingView", label: "Call Tracking", icon: <PhoneCall className="w-4 h-4" /> },
      { id: "revenue", label: "Revenue Center", icon: <TrendingUp className="w-4 h-4" /> },
      { id: "health", label: "Site Health", icon: <Globe className="w-4 h-4" /> },
      { id: "exportView", label: "Export Data", icon: <Download className="w-4 h-4" /> },
    ],
  },
  {
    label: "Sales Pipeline",
    items: [
      { id: "bookings", label: "Bookings", icon: <CalendarClock className="w-4 h-4" />, badge: "bookings" },
      { id: "tireOrders", label: "Tire Orders", icon: <ShoppingCart className="w-4 h-4" /> },
      { id: "leads", label: "Leads / CRM", icon: <Users className="w-4 h-4" />, badge: "leads" },
      { id: "financing", label: "Financing", icon: <CreditCard className="w-4 h-4" /> },
      { id: "chats", label: "Chat Sessions", icon: <MessageSquare className="w-4 h-4" /> },
    ],
  },
  {
    label: "Customers & SMS",
    items: [
      { id: "customers", label: "Customers", icon: <UserCheck className="w-4 h-4" /> },
      { id: "sms", label: "SMS", icon: <Phone className="w-4 h-4" /> },
      { id: "winback", label: "Win-Back", icon: <RotateCcw className="w-4 h-4" /> },
      { id: "campaigns", label: "Campaigns", icon: <MessageSquare className="w-4 h-4" /> },
      { id: "autoFollowUp", label: "Auto Follow-Up", icon: <Timer className="w-4 h-4" /> },
      { id: "followups", label: "Follow-Ups", icon: <Send className="w-4 h-4" /> },
    ],
  },
  {
    label: "Marketing",
    items: [
      { id: "content", label: "Content", icon: <FileText className="w-4 h-4" /> },
      { id: "coupons", label: "Coupons", icon: <Star className="w-4 h-4" /> },
      { id: "referrals", label: "Referrals", icon: <Gift className="w-4 h-4" /> },
      { id: "reviewRequests", label: "Reviews", icon: <Star className="w-4 h-4" /> },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "workOrders", label: "Work Orders", icon: <Wrench className="w-4 h-4" /> },
      { id: "inspections", label: "Inspections", icon: <ClipboardList className="w-4 h-4" /> },
      { id: "loyalty", label: "Loyalty", icon: <Trophy className="w-4 h-4" /> },
      { id: "qa", label: "Q&A", icon: <MessageSquare className="w-4 h-4" /> },
      { id: "jobs", label: "Job Board", icon: <Wrench className="w-4 h-4" /> },
      { id: "integrations", label: "Integrations", icon: <Plug className="w-4 h-4" /> },
    ],
  },
  {
    label: "System",
    items: [
      { id: "shopdriver", label: "ShopDriver Sync", icon: <Upload className="w-4 h-4" /> },
      { id: "estimates", label: "Estimate Pipeline", icon: <DollarSign className="w-4 h-4" /> },
      { id: "activity", label: "Activity Feed", icon: <Activity className="w-4 h-4" /> },
      { id: "settings", label: "Shop Settings", icon: <Settings className="w-4 h-4" /> },
    ],
  },
];

// Flat list for backward compatibility
export const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);

export const SECTION_TITLES: Record<AdminSection, string> = {
  overview: "Dashboard Overview",
  bookings: "Booking Management",
  leads: "Lead Management",
  content: "Content Management",
  chats: "Chat Sessions",
  health: "Site Health & SEO",
  coupons: "Coupon Management",
  qa: "Q&A Management",
  referrals: "Referral Tracking",
  jobs: "Job Board",
  inspections: "Vehicle Inspections",
  loyalty: "Loyalty Program",
  followups: "Follow-Up Manager",
  sms: "SMS Messaging",
  reviewRequests: "Review Requests",
  customers: "Customer Database",
  winback: "Win-Back Campaigns",
  campaigns: "SMS Campaigns",
  autoFollowUp: "Automated Follow-Ups",
  settings: "Shop Settings",
  shopdriver: "ShopDriver Sync",
  estimates: "Estimate Pipeline",
  activity: "Activity Feed",
  revenue: "Revenue Command Center",
  integrations: "Integrations Hub",
  tireOrders: "Tire Orders",
  analyticsView: "Analytics & Attribution",
  callTrackingView: "Call Tracking",
  exportView: "Export Data",
  financing: "Financing Command",
  workOrders: "Work Order Board",
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
    <div className="stat-card group">
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
    default: return <Gauge className="w-3.5 h-3.5 text-foreground/40" />;
  }
}

export function StatusDot({ status }: { status?: string }) {
  const colors: Record<string, string> = {
    new: "bg-blue-400", confirmed: "bg-amber-400", completed: "bg-emerald-400",
    cancelled: "bg-red-400", contacted: "bg-amber-400", booked: "bg-emerald-400",
    closed: "bg-foreground/30", lost: "bg-red-400",
  };
  return <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors[status || ""] || "bg-foreground/20"}`} />;
}
