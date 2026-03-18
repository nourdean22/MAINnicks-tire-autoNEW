/*
 * ADMIN DASHBOARD — Comprehensive Management Hub for Nick's Tire & Auto
 * Sidebar navigation with: Overview, Bookings, Leads, Content, Chat Sessions, Site Health
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  Phone, Mail, Car, Calendar, Clock, MessageSquare,
  CheckCircle2, XCircle, Loader2, ArrowLeft, Shield,
  CalendarClock, Filter, Search, RefreshCw, Users,
  AlertTriangle, ExternalLink, FileSpreadsheet, Zap,
  PhoneCall, UserCheck, LayoutDashboard, FileText,
  Globe, TrendingUp, Activity, Bell, Wrench, Gauge,
  ChevronRight, Star, Eye, BarChart3, Hash, Sparkles,
  ArrowUpRight, ArrowDownRight, CircleDot, MapPin,
  Newspaper, PieChart, Menu, X
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Legend
} from "recharts";

// ─── TYPES ──────────────────────────────────────────────
type AdminSection = "overview" | "bookings" | "leads" | "content" | "chats" | "health";
type BookingStatus = "new" | "confirmed" | "completed" | "cancelled";
type LeadStatus = "new" | "contacted" | "booked" | "closed" | "lost";

const BOOKING_STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  new: { label: "NEW", color: "text-blue-400", bgColor: "bg-blue-500/10 border-blue-500/30", icon: <CalendarClock className="w-4 h-4" /> },
  confirmed: { label: "CONFIRMED", color: "text-primary", bgColor: "bg-primary/10 border-primary/30", icon: <CheckCircle2 className="w-4 h-4" /> },
  completed: { label: "COMPLETED", color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30", icon: <CheckCircle2 className="w-4 h-4" /> },
  cancelled: { label: "CANCELLED", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/30", icon: <XCircle className="w-4 h-4" /> },
};

const LEAD_STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bgColor: string }> = {
  new: { label: "NEW", color: "text-blue-400", bgColor: "bg-blue-500/10 border-blue-500/30" },
  contacted: { label: "CONTACTED", color: "text-primary", bgColor: "bg-primary/10 border-primary/30" },
  booked: { label: "BOOKED", color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30" },
  closed: { label: "CLOSED", color: "text-foreground/40", bgColor: "bg-foreground/5 border-foreground/20" },
  lost: { label: "LOST", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/30" },
};

const TIME_LABELS: Record<string, string> = {
  morning: "Morning (8AM–12PM)",
  afternoon: "Afternoon (12PM–6PM)",
  "no-preference": "No Preference",
};

const CHART_COLORS = ["#F5A623", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#F97316", "#06B6D4"];

// ─── SIDEBAR NAV ────────────────────────────────────────
const NAV_ITEMS: { id: AdminSection; label: string; icon: React.ReactNode; badge?: string }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="w-5 h-5" /> },
  { id: "bookings", label: "Bookings", icon: <CalendarClock className="w-5 h-5" /> },
  { id: "leads", label: "Leads", icon: <Users className="w-5 h-5" /> },
  { id: "content", label: "Content", icon: <FileText className="w-5 h-5" /> },
  { id: "chats", label: "Chat Sessions", icon: <MessageSquare className="w-5 h-5" /> },
  { id: "health", label: "Site Health", icon: <Globe className="w-5 h-5" /> },
];

// ─── HELPER COMPONENTS ──────────────────────────────────
function StatCard({ label, value, icon, color = "text-foreground", trend, trendLabel }: {
  label: string; value: number | string; icon: React.ReactNode; color?: string;
  trend?: "up" | "down" | "neutral"; trendLabel?: string;
}) {
  return (
    <div className="bg-card border border-border/30 p-5 hover:border-border/50 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="font-mono text-xs text-foreground/50 tracking-wider uppercase">{label}</p>
        <div className="text-foreground/30">{icon}</div>
      </div>
      <p className={`font-heading font-bold text-3xl ${color}`}>{value}</p>
      {trendLabel && (
        <div className="flex items-center gap-1 mt-2">
          {trend === "up" && <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />}
          {trend === "down" && <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />}
          {trend === "neutral" && <Activity className="w-3.5 h-3.5 text-foreground/40" />}
          <span className={`font-mono text-xs ${
            trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-foreground/40"
          }`}>{trendLabel}</span>
        </div>
      )}
    </div>
  );
}

function UrgencyBadge({ score }: { score: number }) {
  const config = score >= 4
    ? { label: "URGENT", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" }
    : score >= 3
    ? { label: "MODERATE", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" }
    : { label: "ROUTINE", color: "text-foreground/50", bg: "bg-foreground/5 border-foreground/20" };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 border font-mono text-[10px] tracking-wider ${config.color} ${config.bg}`}>
      {score >= 4 && <AlertTriangle className="w-3 h-3" />}
      {config.label} ({score}/5)
    </span>
  );
}

function ActivityIcon({ type }: { type: string }) {
  switch (type) {
    case "booking": return <CalendarClock className="w-4 h-4 text-primary" />;
    case "lead": return <Users className="w-4 h-4 text-blue-400" />;
    case "article": return <FileText className="w-4 h-4 text-emerald-400" />;
    case "chat": return <MessageSquare className="w-4 h-4 text-purple-400" />;
    default: return <CircleDot className="w-4 h-4 text-foreground/40" />;
  }
}

function StatusDot({ status }: { status?: string }) {
  const colors: Record<string, string> = {
    new: "bg-blue-400", confirmed: "bg-primary", completed: "bg-emerald-400",
    cancelled: "bg-red-400", contacted: "bg-primary", booked: "bg-emerald-400",
    closed: "bg-foreground/40", lost: "bg-red-400", published: "bg-emerald-400",
    draft: "bg-amber-400", rejected: "bg-red-400",
  };
  return <span className={`w-2 h-2 rounded-full ${colors[status || ""] || "bg-foreground/30"}`} />;
}

// ─── OVERVIEW SECTION ───────────────────────────────────
function OverviewSection() {
  const { data: stats, isLoading } = trpc.adminDashboard.stats.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: health } = trpc.adminDashboard.siteHealth.useQuery(undefined, {
    refetchInterval: 300000,
  });
  const { data: sheetInfo } = trpc.lead.sheetUrl.useQuery();

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const serviceChartData = stats.bookings.byService.slice(0, 6).map((s, i) => ({
    name: s.service.length > 15 ? s.service.substring(0, 15) + "…" : s.service,
    count: s.count,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const leadSourceData = stats.leads.bySource.map((s, i) => ({
    name: s.source.charAt(0).toUpperCase() + s.source.slice(1),
    value: s.count,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const leadPipelineData = [
    { name: "New", value: stats.leads.new, fill: "#3B82F6" },
    { name: "Contacted", value: stats.leads.contacted, fill: "#F5A623" },
    { name: "Booked", value: stats.leads.booked, fill: "#10B981" },
    { name: "Closed", value: stats.leads.closed, fill: "#6B7280" },
    { name: "Lost", value: stats.leads.lost, fill: "#EF4444" },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-8">
      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Bookings" value={stats.bookings.total}
          icon={<CalendarClock className="w-5 h-5" />} color="text-foreground"
          trend={stats.bookings.thisWeek > 0 ? "up" : "neutral"}
          trendLabel={`${stats.bookings.thisWeek} this week`}
        />
        <StatCard
          label="Active Leads" value={stats.leads.new + stats.leads.contacted}
          icon={<Users className="w-5 h-5" />} color="text-blue-400"
          trend={stats.leads.thisWeek > 0 ? "up" : "neutral"}
          trendLabel={`${stats.leads.thisWeek} this week`}
        />
        <StatCard
          label="Urgent Leads" value={stats.leads.urgent}
          icon={<AlertTriangle className="w-5 h-5" />}
          color={stats.leads.urgent > 0 ? "text-red-400" : "text-foreground/40"}
          trend={stats.leads.urgent > 0 ? "up" : "neutral"}
          trendLabel={stats.leads.urgent > 0 ? "Needs attention" : "All clear"}
        />
        <StatCard
          label="Chat Sessions" value={stats.chat.totalSessions}
          icon={<MessageSquare className="w-5 h-5" />} color="text-purple-400"
          trend={stats.chat.thisWeek > 0 ? "up" : "neutral"}
          trendLabel={`${stats.chat.thisWeek} this week`}
        />
      </div>

      {/* Booking Status + Content Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard label="New Bookings" value={stats.bookings.new} icon={<Hash className="w-4 h-4" />} color="text-blue-400" />
        <StatCard label="Confirmed" value={stats.bookings.confirmed} icon={<CheckCircle2 className="w-4 h-4" />} color="text-primary" />
        <StatCard label="Completed" value={stats.bookings.completed} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Published Articles" value={stats.content.published} icon={<FileText className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Draft Articles" value={stats.content.drafts} icon={<Newspaper className="w-4 h-4" />} color="text-amber-400" />
        <StatCard label="Active Notifications" value={stats.content.activeNotifications} icon={<Bell className="w-4 h-4" />} color="text-primary" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service Breakdown Chart */}
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-6 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            BOOKINGS BY SERVICE
          </h3>
          {serviceChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={serviceChartData} layout="vertical" margin={{ left: 0, right: 20 }}>
                <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11, fontFamily: "Roboto Mono" }} />
                <YAxis type="category" dataKey="name" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: "Roboto Mono" }} width={120} />
                <RechartsTooltip
                  contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 0, fontFamily: "Roboto Mono", fontSize: 12 }}
                  labelStyle={{ color: "#F5A623" }}
                />
                <Bar dataKey="count" radius={[0, 2, 2, 0]}>
                  {serviceChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-foreground/30">
              <p className="font-mono text-sm">No booking data yet</p>
            </div>
          )}
        </div>

        {/* Lead Pipeline */}
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-6 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-primary" />
            LEAD PIPELINE
          </h3>
          {leadPipelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <RPieChart>
                <Pie
                  data={leadPipelineData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {leadPipelineData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="bottom"
                  formatter={(value: string) => <span className="font-mono text-xs text-foreground/60">{value}</span>}
                />
                <RechartsTooltip
                  contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 0, fontFamily: "Roboto Mono", fontSize: 12 }}
                />
              </RPieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-foreground/30">
              <p className="font-mono text-sm">No lead data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions + Lead Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-5 flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            QUICK ACTIONS
          </h3>
          <div className="space-y-3">
            <Link href="/admin/content" className="flex items-center gap-3 p-3 border border-border/30 hover:border-primary/30 hover:bg-primary/5 transition-colors group">
              <Sparkles className="w-5 h-5 text-primary" />
              <div className="flex-1">
                <p className="font-heading font-bold text-sm text-foreground tracking-wider">GENERATE CONTENT</p>
                <p className="font-mono text-xs text-foreground/40">AI articles & notifications</p>
              </div>
              <ChevronRight className="w-4 h-4 text-foreground/30 group-hover:text-primary transition-colors" />
            </Link>
            {sheetInfo?.configured && (
              <a href={sheetInfo.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 border border-border/30 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-colors group">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div className="flex-1">
                  <p className="font-heading font-bold text-sm text-foreground tracking-wider">OPEN CRM SHEET</p>
                  <p className="font-mono text-xs text-foreground/40">Google Sheets CRM</p>
                </div>
                <ExternalLink className="w-4 h-4 text-foreground/30 group-hover:text-emerald-400 transition-colors" />
              </a>
            )}
            <a href="https://business.google.com/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 border border-border/30 hover:border-blue-500/30 hover:bg-blue-500/5 transition-colors group">
              <Star className="w-5 h-5 text-blue-400" />
              <div className="flex-1">
                <p className="font-heading font-bold text-sm text-foreground tracking-wider">GOOGLE BUSINESS</p>
                <p className="font-mono text-xs text-foreground/40">Reviews & profile</p>
              </div>
              <ExternalLink className="w-4 h-4 text-foreground/30 group-hover:text-blue-400 transition-colors" />
            </a>
            <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 border border-border/30 hover:border-amber-500/30 hover:bg-amber-500/5 transition-colors group">
              <Globe className="w-5 h-5 text-amber-400" />
              <div className="flex-1">
                <p className="font-heading font-bold text-sm text-foreground tracking-wider">SEARCH CONSOLE</p>
                <p className="font-mono text-xs text-foreground/40">Indexing & performance</p>
              </div>
              <ExternalLink className="w-4 h-4 text-foreground/30 group-hover:text-amber-400 transition-colors" />
            </a>
          </div>
        </div>

        {/* Lead Sources */}
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-5 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            LEAD SOURCES
          </h3>
          {leadSourceData.length > 0 ? (
            <div className="space-y-4">
              {leadSourceData.map((s, i) => {
                const pct = stats.leads.total > 0 ? Math.round((s.value / stats.leads.total) * 100) : 0;
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-sm text-foreground/70">{s.name}</span>
                      <span className="font-mono text-sm text-foreground/50">{s.value} ({pct}%)</span>
                    </div>
                    <div className="h-2 bg-nick-dark/50 overflow-hidden">
                      <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-border/20">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-foreground/40">Avg Urgency Score</span>
                  <span className="font-heading font-bold text-lg text-primary">{stats.leads.avgUrgency}/5</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-foreground/30">
              <p className="font-mono text-sm">No lead data yet</p>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-5 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            RECENT ACTIVITY
          </h3>
          {stats.recentActivity.length > 0 ? (
            <div className="space-y-0">
              {stats.recentActivity.slice(0, 8).map((item, i) => (
                <div key={i} className="flex items-start gap-3 py-3 border-b border-border/10 last:border-0">
                  <div className="mt-0.5 shrink-0">
                    <ActivityIcon type={item.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm text-foreground truncate">{item.title}</p>
                      {item.status && <StatusDot status={item.status} />}
                    </div>
                    <p className="font-mono text-xs text-foreground/40 truncate">{item.subtitle}</p>
                    <p className="font-mono text-[10px] text-foreground/25 mt-0.5">
                      {new Date(item.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-foreground/30">
              <p className="font-mono text-sm">No activity yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Site Health Summary */}
      {health && (
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-5 flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            SITE OVERVIEW
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="text-center p-3 border border-border/20">
              <p className="font-heading font-bold text-2xl text-foreground">{health.domains.length}</p>
              <p className="font-mono text-xs text-foreground/40 mt-1">Domains</p>
            </div>
            <div className="text-center p-3 border border-border/20">
              <p className="font-heading font-bold text-2xl text-primary">{health.sitemapPageCount}+</p>
              <p className="font-mono text-xs text-foreground/40 mt-1">Sitemap Pages</p>
            </div>
            <div className="text-center p-3 border border-border/20">
              <p className="font-heading font-bold text-2xl text-foreground">{health.totalBlogPosts}</p>
              <p className="font-mono text-xs text-foreground/40 mt-1">Blog Posts</p>
            </div>
            <div className="text-center p-3 border border-border/20">
              <p className="font-heading font-bold text-2xl text-foreground">{stats.users.total}</p>
              <p className="font-mono text-xs text-foreground/40 mt-1">Users</p>
            </div>
            <div className="text-center p-3 border border-border/20">
              <p className="font-heading font-bold text-2xl text-emerald-400">{stats.content.generationLogs}</p>
              <p className="font-mono text-xs text-foreground/40 mt-1">AI Generations</p>
            </div>
            <div className="text-center p-3 border border-border/20">
              <p className="font-heading font-bold text-2xl text-foreground">
                {health.sheetsConfigured ? <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" /> : <XCircle className="w-6 h-6 text-red-400 mx-auto" />}
              </p>
              <p className="font-mono text-xs text-foreground/40 mt-1">CRM Sheet</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BOOKINGS SECTION ───────────────────────────────────
function BookingNotesEditor({ bookingId, initialNotes }: { bookingId: number; initialNotes: string | null }) {
  const [notes, setNotes] = useState(initialNotes || "");
  const [editing, setEditing] = useState(false);
  const utils = trpc.useUtils();
  const updateNotes = trpc.booking.updateNotes.useMutation({
    onSuccess: () => {
      setEditing(false);
      utils.booking.list.invalidate();
      toast.success("Notes saved");
    },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-start gap-2 w-full text-left p-2 border border-dashed border-border/30 hover:border-primary/30 transition-colors group"
      >
        <FileText className="w-3.5 h-3.5 text-foreground/30 group-hover:text-primary shrink-0 mt-0.5" />
        <span className={`font-mono text-xs leading-relaxed ${notes ? "text-foreground/60" : "text-foreground/30 italic"}`}>
          {notes || "Add admin notes..."}
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        autoFocus
        className="w-full bg-background/60 border border-primary/30 text-foreground px-3 py-2 font-mono text-xs focus:outline-none focus:border-primary/50 resize-none"
        placeholder="Internal notes about this booking..."
      />
      <div className="flex gap-2">
        <button
          onClick={() => updateNotes.mutate({ id: bookingId, notes })}
          disabled={updateNotes.isPending}
          className="px-3 py-1.5 bg-primary text-primary-foreground font-mono text-xs tracking-wider uppercase hover:bg-primary/90 disabled:opacity-50"
        >
          {updateNotes.isPending ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => { setNotes(initialNotes || ""); setEditing(false); }}
          className="px-3 py-1.5 border border-border/30 text-foreground/50 font-mono text-xs tracking-wider uppercase hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function PrioritySelector({ bookingId, currentPriority }: { bookingId: number; currentPriority: number }) {
  const utils = trpc.useUtils();
  const updatePriority = trpc.booking.updatePriority.useMutation({
    onSuccess: () => {
      utils.booking.list.invalidate();
      toast.success("Priority updated");
    },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  const priorities = [
    { value: 0, label: "Normal", color: "text-foreground/40", bg: "bg-foreground/5 border-foreground/20" },
    { value: 1, label: "High", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
    { value: 2, label: "Urgent", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
  ];

  const current = priorities.find(p => p.value === currentPriority) || priorities[0];

  return (
    <div className="flex items-center gap-1.5">
      {priorities.map(p => (
        <button
          key={p.value}
          onClick={() => updatePriority.mutate({ id: bookingId, priority: p.value })}
          disabled={updatePriority.isPending}
          className={`px-2 py-1 border font-mono text-[10px] tracking-wider uppercase transition-all ${
            currentPriority === p.value
              ? `${p.color} ${p.bg} ring-1 ring-current/20`
              : "border-border/20 text-foreground/20 hover:text-foreground/50"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function BookingPhotoThumbnails({ photoUrlsJson }: { photoUrlsJson: string | null }) {
  if (!photoUrlsJson) return null;
  try {
    const urls: string[] = JSON.parse(photoUrlsJson);
    if (!urls.length) return null;
    return (
      <div className="flex gap-2 mt-2">
        {urls.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block w-16 h-16 border border-border/30 overflow-hidden hover:border-primary/50 transition-colors">
            <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
          </a>
        ))}
      </div>
    );
  } catch {
    return null;
  }
}

function BookingsSection() {
  const [bookingFilter, setBookingFilter] = useState<BookingStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "priority">("date");

  const { data: bookings, isLoading, refetch } = trpc.booking.list.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const updateBookingStatus = trpc.booking.updateStatus.useMutation({
    onSuccess: () => { refetch(); toast.success("Booking status updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  const filteredBookings = useMemo(() => {
    if (!bookings) return [];
    let list = [...bookings];
    if (bookingFilter !== "all") list = list.filter(b => b.status === bookingFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b =>
        b.name.toLowerCase().includes(q) || b.phone.includes(q) ||
        (b.email && b.email.toLowerCase().includes(q)) ||
        b.service.toLowerCase().includes(q) || (b.vehicle && b.vehicle.toLowerCase().includes(q))
      );
    }
    // Sort by priority (urgent first) or date
    if (sortBy === "priority") {
      list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }
    return list;
  }, [bookings, bookingFilter, searchQuery, sortBy]);

  const bookingStats = useMemo(() => {
    if (!bookings) return { new: 0, confirmed: 0, completed: 0, cancelled: 0, total: 0 };
    return {
      new: bookings.filter(b => b.status === "new").length,
      confirmed: bookings.filter(b => b.status === "confirmed").length,
      completed: bookings.filter(b => b.status === "completed").length,
      cancelled: bookings.filter(b => b.status === "cancelled").length,
      total: bookings.length,
    };
  }, [bookings]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Total", value: bookingStats.total, color: "text-foreground", icon: <Hash className="w-4 h-4" /> },
          { label: "New", value: bookingStats.new, color: "text-blue-400", icon: <CalendarClock className="w-4 h-4" /> },
          { label: "Confirmed", value: bookingStats.confirmed, color: "text-primary", icon: <CheckCircle2 className="w-4 h-4" /> },
          { label: "Completed", value: bookingStats.completed, color: "text-emerald-400", icon: <CheckCircle2 className="w-4 h-4" /> },
          { label: "Cancelled", value: bookingStats.cancelled, color: "text-red-400", icon: <XCircle className="w-4 h-4" /> },
        ].map(stat => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} color={stat.color} />
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
          <input
            type="text"
            placeholder="Search bookings..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-card border border-border/50 text-foreground pl-10 pr-4 py-3 font-mono text-sm placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-foreground/40" />
          {(["all", "new", "confirmed", "completed", "cancelled"] as const).map(f => (
            <button
              key={f}
              onClick={() => setBookingFilter(f)}
              className={`px-3 py-2 font-mono text-xs tracking-wider uppercase transition-colors ${
                bookingFilter === f ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
          <div className="h-6 w-px bg-border/30 mx-1" />
          <button
            onClick={() => setSortBy(sortBy === "date" ? "priority" : "date")}
            className={`px-3 py-2 font-mono text-xs tracking-wider uppercase transition-colors border ${
              sortBy === "priority" ? "border-amber-500/30 text-amber-400 bg-amber-500/10" : "border-border/30 text-foreground/60 hover:text-foreground"
            }`}
          >
            {sortBy === "priority" ? "⚡ Priority" : "📅 Date"}
          </button>
          <button onClick={() => refetch()} className="p-2 text-foreground/50 hover:text-primary transition-colors ml-2">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bookings List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="text-center py-20 border border-border/30 bg-card">
          <CalendarClock className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
          <p className="font-heading font-bold text-xl text-foreground/40 tracking-wider">NO BOOKINGS</p>
          <p className="text-foreground/30 font-mono text-sm mt-2">Bookings from the website will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredBookings.map(booking => {
            const priorityLevel = booking.priority || 0;
            const borderColor = priorityLevel >= 2 ? "border-red-500/30" : priorityLevel >= 1 ? "border-amber-500/30" : "border-border/30";

            return (
              <div key={booking.id} className={`bg-card border ${borderColor} p-6 hover:border-border/50 transition-colors`}>
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    {/* Header: Name + Status + Priority */}
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-heading font-bold text-lg text-foreground tracking-wider">{booking.name}</h3>
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 border font-mono text-xs tracking-wider ${BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.color} ${BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.bgColor}`}>
                        {BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.icon}
                        {BOOKING_STATUS_CONFIG[booking.status as BookingStatus]?.label}
                      </span>
                      {priorityLevel > 0 && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 border font-mono text-[10px] tracking-wider ${
                          priorityLevel >= 2 ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-amber-400 bg-amber-500/10 border-amber-500/30"
                        }`}>
                          <AlertTriangle className="w-3 h-3" />
                          {priorityLevel >= 2 ? "URGENT" : "HIGH"}
                        </span>
                      )}
                    </div>

                    {/* Contact + Vehicle Info Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="flex items-center gap-2 text-foreground/70">
                        <Phone className="w-4 h-4 text-primary shrink-0" />
                        <a href={`tel:${booking.phone}`} className="font-mono text-sm hover:text-primary">{booking.phone}</a>
                      </div>
                      {booking.email && (
                        <div className="flex items-center gap-2 text-foreground/70">
                          <Mail className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-mono text-sm truncate">{booking.email}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-foreground/70">
                        <Wrench className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-mono text-sm">{booking.service}</span>
                      </div>
                      {(booking.vehicleYear || booking.vehicleMake || booking.vehicle) && (
                        <div className="flex items-center gap-2 text-foreground/70">
                          <Car className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-mono text-sm">
                            {booking.vehicleYear && booking.vehicleMake
                              ? `${booking.vehicleYear} ${booking.vehicleMake} ${booking.vehicleModel || ""}`.trim()
                              : booking.vehicle}
                          </span>
                        </div>
                      )}
                      {booking.preferredDate && (
                        <div className="flex items-center gap-2 text-foreground/70">
                          <Calendar className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-mono text-sm">{booking.preferredDate}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-foreground/70">
                        <Clock className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-mono text-sm">{TIME_LABELS[booking.preferredTime] || booking.preferredTime}</span>
                      </div>
                    </div>

                    {/* Customer Message */}
                    {booking.message && (
                      <div className="flex items-start gap-2 text-foreground/60 bg-nick-dark/50 p-3 border border-border/20">
                        <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <p className="font-mono text-sm leading-relaxed">{booking.message}</p>
                      </div>
                    )}

                    {/* Customer Photos */}
                    <BookingPhotoThumbnails photoUrlsJson={booking.photoUrls} />

                    {/* Priority Selector */}
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[10px] text-foreground/30 tracking-wider uppercase">Priority:</span>
                      <PrioritySelector bookingId={booking.id} currentPriority={booking.priority || 0} />
                    </div>

                    {/* Admin Notes */}
                    <BookingNotesEditor bookingId={booking.id} initialNotes={booking.adminNotes} />

                    <p className="font-mono text-xs text-foreground/30">
                      Submitted {new Date(booking.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-row lg:flex-col gap-2 shrink-0">
                    {booking.status === "new" && (
                      <>
                        <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "confirmed" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/90 disabled:opacity-50">
                          <CheckCircle2 className="w-4 h-4" /> CONFIRM
                        </button>
                        <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "cancelled" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-red-500/10 disabled:opacity-50">
                          <XCircle className="w-4 h-4" /> CANCEL
                        </button>
                      </>
                    )}
                    {booking.status === "confirmed" && (
                      <>
                        <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "completed" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-emerald-700 disabled:opacity-50">
                          <CheckCircle2 className="w-4 h-4" /> COMPLETE
                        </button>
                        <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "cancelled" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-red-500/10 disabled:opacity-50">
                          <XCircle className="w-4 h-4" /> CANCEL
                        </button>
                      </>
                    )}
                    {(booking.status === "completed" || booking.status === "cancelled") && (
                      <button onClick={() => updateBookingStatus.mutate({ id: booking.id, status: "new" })} disabled={updateBookingStatus.isPending} className="flex items-center gap-2 border border-border/30 text-foreground/50 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:text-foreground disabled:opacity-50">
                        <RefreshCw className="w-4 h-4" /> REOPEN
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── LEADS SECTION ──────────────────────────────────────
function LeadsSection() {
  const [leadFilter, setLeadFilter] = useState<LeadStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: leadsData, isLoading, refetch } = trpc.lead.list.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const updateLead = trpc.lead.update.useMutation({
    onSuccess: () => { refetch(); toast.success("Lead updated"); },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  const filteredLeads = useMemo(() => {
    if (!leadsData) return [];
    let list = [...leadsData];
    if (leadFilter !== "all") list = list.filter(l => l.status === leadFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(l =>
        l.name.toLowerCase().includes(q) || l.phone.includes(q) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.vehicle && l.vehicle.toLowerCase().includes(q)) ||
        (l.problem && l.problem.toLowerCase().includes(q))
      );
    }
    return list;
  }, [leadsData, leadFilter, searchQuery]);

  const leadStats = useMemo(() => {
    if (!leadsData) return { new: 0, contacted: 0, urgent: 0, total: 0, booked: 0 };
    return {
      new: leadsData.filter(l => l.status === "new").length,
      contacted: leadsData.filter(l => l.status === "contacted").length,
      urgent: leadsData.filter(l => (l.urgencyScore ?? 0) >= 4).length,
      total: leadsData.length,
      booked: leadsData.filter(l => l.status === "booked").length,
    };
  }, [leadsData]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Leads" value={leadStats.total} icon={<Hash className="w-4 h-4" />} color="text-foreground" />
        <StatCard label="New (Uncalled)" value={leadStats.new} icon={<Users className="w-4 h-4" />} color="text-blue-400" />
        <StatCard label="Contacted" value={leadStats.contacted} icon={<PhoneCall className="w-4 h-4" />} color="text-primary" />
        <StatCard label="Booked" value={leadStats.booked} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Urgent (4-5)" value={leadStats.urgent} icon={<AlertTriangle className="w-4 h-4" />} color="text-red-400" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
          <input
            type="text"
            placeholder="Search leads..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-card border border-border/50 text-foreground pl-10 pr-4 py-3 font-mono text-sm placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-foreground/40" />
          {(["all", "new", "contacted", "booked", "closed", "lost"] as const).map(f => (
            <button
              key={f}
              onClick={() => setLeadFilter(f)}
              className={`px-3 py-2 font-mono text-xs tracking-wider uppercase transition-colors ${
                leadFilter === f ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
          <button onClick={() => refetch()} className="p-2 text-foreground/50 hover:text-primary transition-colors ml-2">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Leads List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="text-center py-20 border border-border/30 bg-card">
          <Users className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
          <p className="font-heading font-bold text-xl text-foreground/40 tracking-wider">NO LEADS</p>
          <p className="text-foreground/30 font-mono text-sm mt-2">Leads from the popup and chat will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredLeads.map(lead => (
            <div
              key={lead.id}
              className={`bg-card border p-6 transition-colors ${
                (lead.urgencyScore ?? 0) >= 4 ? "border-red-500/30 hover:border-red-500/50" : "border-border/30 hover:border-border/50"
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-heading font-bold text-lg text-foreground tracking-wider">{lead.name}</h3>
                    <UrgencyBadge score={lead.urgencyScore ?? 3} />
                    <span className={`inline-flex items-center px-2 py-0.5 border font-mono text-[10px] tracking-wider ${LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.color} ${LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.bgColor}`}>
                      {LEAD_STATUS_CONFIG[lead.status as LeadStatus]?.label}
                    </span>
                    <span className="font-mono text-[10px] text-foreground/30 uppercase tracking-wider">
                      via {lead.source}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="flex items-center gap-2 text-foreground/70">
                      <Phone className="w-4 h-4 text-primary shrink-0" />
                      <a href={`tel:${lead.phone}`} className="font-mono text-sm hover:text-primary">{lead.phone}</a>
                    </div>
                    {lead.email && (
                      <div className="flex items-center gap-2 text-foreground/70">
                        <Mail className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-mono text-sm truncate">{lead.email}</span>
                      </div>
                    )}
                    {lead.vehicle && (
                      <div className="flex items-center gap-2 text-foreground/70">
                        <Car className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-mono text-sm">{lead.vehicle}</span>
                      </div>
                    )}
                    {lead.recommendedService && (
                      <div className="flex items-center gap-2 text-foreground/70">
                        <Wrench className="w-4 h-4 text-primary shrink-0" />
                        <span className="font-mono text-sm">{lead.recommendedService}</span>
                      </div>
                    )}
                  </div>

                  {lead.problem && (
                    <div className="flex items-start gap-2 text-foreground/60 bg-nick-dark/50 p-3 border border-border/20">
                      <MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <p className="font-mono text-sm leading-relaxed">{lead.problem}</p>
                    </div>
                  )}

                  {lead.urgencyReason && (
                    <div className="flex items-start gap-2 text-foreground/50">
                      <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="font-mono text-xs leading-relaxed italic">{lead.urgencyReason}</p>
                    </div>
                  )}

                  {lead.contactNotes && (
                    <div className="flex items-start gap-2 text-foreground/50 bg-emerald-500/5 p-2 border border-emerald-500/20">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <p className="font-mono text-xs leading-relaxed">
                        <span className="text-emerald-400">Contacted by {lead.contactedBy || "staff"}: </span>
                        {lead.contactNotes}
                      </p>
                    </div>
                  )}

                  <p className="font-mono text-xs text-foreground/30">
                    Received {new Date(lead.createdAt).toLocaleString()}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-row lg:flex-col gap-2 shrink-0">
                  {lead.status === "new" && (
                    <>
                      <a
                        href={`tel:${lead.phone}`}
                        className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/90"
                      >
                        <PhoneCall className="w-4 h-4" /> CALL
                      </a>
                      <button
                        onClick={() => {
                          const notes = prompt("Contact notes (what was discussed?):");
                          if (notes !== null) {
                            updateLead.mutate({
                              id: lead.id,
                              status: "contacted",
                              contacted: 1,
                              contactNotes: notes || "Called, no notes.",
                            });
                          }
                        }}
                        disabled={updateLead.isPending}
                        className="flex items-center gap-2 border border-primary/30 text-primary px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/10 disabled:opacity-50"
                      >
                        <UserCheck className="w-4 h-4" /> MARK CONTACTED
                      </button>
                    </>
                  )}
                  {lead.status === "contacted" && (
                    <>
                      <button
                        onClick={() => updateLead.mutate({ id: lead.id, status: "booked" })}
                        disabled={updateLead.isPending}
                        className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" /> BOOKED
                      </button>
                      <button
                        onClick={() => updateLead.mutate({ id: lead.id, status: "lost" })}
                        disabled={updateLead.isPending}
                        className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-red-500/10 disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4" /> LOST
                      </button>
                    </>
                  )}
                  {(lead.status === "booked" || lead.status === "closed" || lead.status === "lost") && (
                    <button
                      onClick={() => updateLead.mutate({ id: lead.id, status: "new", contacted: 0 })}
                      disabled={updateLead.isPending}
                      className="flex items-center gap-2 border border-border/30 text-foreground/50 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className="w-4 h-4" /> REOPEN
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CONTENT SECTION ────────────────────────────────────
function ContentSection() {
  const { data: articles, isLoading: articlesLoading } = trpc.contentAdmin.allArticles.useQuery();
  const { data: notifications, isLoading: notifsLoading } = trpc.contentAdmin.allNotifications.useQuery();
  const { data: genLog } = trpc.contentAdmin.generationLog.useQuery();

  const updateArticle = trpc.contentAdmin.updateArticleStatus.useMutation({
    onSuccess: () => toast.success("Article updated"),
    onError: (err) => toast.error("Failed: " + err.message),
  });

  const toggleNotif = trpc.contentAdmin.toggleNotification.useMutation({
    onSuccess: () => toast.success("Notification updated"),
    onError: (err) => toast.error("Failed: " + err.message),
  });

  if (articlesLoading || notifsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Content Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Articles" value={articles?.length ?? 0} icon={<FileText className="w-4 h-4" />} color="text-foreground" />
        <StatCard label="Published" value={articles?.filter(a => a.status === "published").length ?? 0} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Drafts" value={articles?.filter(a => a.status === "draft").length ?? 0} icon={<Newspaper className="w-4 h-4" />} color="text-amber-400" />
        <StatCard label="AI Generations" value={genLog?.length ?? 0} icon={<Sparkles className="w-4 h-4" />} color="text-purple-400" />
      </div>

      {/* Quick Link to Full Content Manager */}
      <div className="bg-card border border-border/30 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-primary" />
          <div>
            <p className="font-heading font-bold text-sm text-foreground tracking-wider">FULL CONTENT MANAGER</p>
            <p className="font-mono text-xs text-foreground/40">Generate articles, manage notifications, view generation logs</p>
          </div>
        </div>
        <Link href="/admin/content" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase hover:bg-primary/90">
          OPEN <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Articles List */}
      <div>
        <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          ARTICLES ({articles?.length ?? 0})
        </h3>
        {articles && articles.length > 0 ? (
          <div className="space-y-3">
            {articles.map(article => (
              <div key={article.id} className="bg-card border border-border/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusDot status={article.status} />
                    <h4 className="font-heading font-bold text-sm text-foreground tracking-wider truncate">{article.title}</h4>
                  </div>
                  <div className="flex items-center gap-3 text-foreground/40">
                    <span className="font-mono text-xs">{article.category}</span>
                    <span className="font-mono text-xs">{article.readTime}</span>
                    <span className="font-mono text-xs">{new Date(article.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {article.status === "draft" && (
                    <button
                      onClick={() => updateArticle.mutate({ id: article.id, status: "published" })}
                      disabled={updateArticle.isPending}
                      className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 font-heading font-bold text-[10px] tracking-wider uppercase hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3 h-3" /> PUBLISH
                    </button>
                  )}
                  {article.status === "published" && (
                    <button
                      onClick={() => updateArticle.mutate({ id: article.id, status: "draft" })}
                      disabled={updateArticle.isPending}
                      className="flex items-center gap-1.5 border border-amber-500/30 text-amber-400 px-3 py-1.5 font-heading font-bold text-[10px] tracking-wider uppercase hover:bg-amber-500/10 disabled:opacity-50"
                    >
                      UNPUBLISH
                    </button>
                  )}
                  {article.status === "rejected" && (
                    <button
                      onClick={() => updateArticle.mutate({ id: article.id, status: "draft" })}
                      disabled={updateArticle.isPending}
                      className="flex items-center gap-1.5 border border-border/30 text-foreground/50 px-3 py-1.5 font-heading font-bold text-[10px] tracking-wider uppercase hover:text-foreground disabled:opacity-50"
                    >
                      RESTORE
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 border border-border/30 bg-card">
            <FileText className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
            <p className="font-mono text-sm text-foreground/40">No articles generated yet</p>
          </div>
        )}
      </div>

      {/* Notifications List */}
      <div>
        <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-4 flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          NOTIFICATION BAR MESSAGES ({notifications?.length ?? 0})
        </h3>
        {notifications && notifications.length > 0 ? (
          <div className="space-y-2">
            {notifications.map(notif => (
              <div key={notif.id} className="bg-card border border-border/30 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${notif.isActive === 1 ? "bg-emerald-400" : "bg-foreground/30"}`} />
                  <p className="font-mono text-sm text-foreground/70 truncate">{notif.message}</p>
                </div>
                <button
                  onClick={() => toggleNotif.mutate({ id: notif.id, isActive: notif.isActive === 1 ? 0 : 1 })}
                  disabled={toggleNotif.isPending}
                  className={`shrink-0 px-3 py-1.5 font-heading font-bold text-[10px] tracking-wider uppercase disabled:opacity-50 ${
                    notif.isActive === 1
                      ? "border border-red-500/30 text-red-400 hover:bg-red-500/10"
                      : "border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  }`}
                >
                  {notif.isActive === 1 ? "DISABLE" : "ENABLE"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 border border-border/30 bg-card">
            <Bell className="w-8 h-8 text-foreground/20 mx-auto mb-2" />
            <p className="font-mono text-sm text-foreground/40">No notification messages yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CHAT SESSIONS SECTION ──────────────────────────────
function ChatSessionsSection() {
  const { data: stats, isLoading } = trpc.adminDashboard.stats.useQuery();

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const chatActivity = stats.recentActivity.filter(a => a.type === "chat");

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Sessions" value={stats.chat.totalSessions} icon={<MessageSquare className="w-4 h-4" />} color="text-purple-400" />
        <StatCard label="Converted to Lead" value={stats.chat.converted} icon={<UserCheck className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="This Week" value={stats.chat.thisWeek} icon={<TrendingUp className="w-4 h-4" />} color="text-blue-400" />
      </div>

      {/* Conversion Rate */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-4">CHAT CONVERSION RATE</h3>
        <div className="flex items-end gap-4">
          <span className="font-heading font-bold text-5xl text-primary">
            {stats.chat.totalSessions > 0 ? Math.round((stats.chat.converted / stats.chat.totalSessions) * 100) : 0}%
          </span>
          <span className="font-mono text-sm text-foreground/40 pb-2">
            {stats.chat.converted} of {stats.chat.totalSessions} sessions converted to leads
          </span>
        </div>
        <div className="mt-4 h-3 bg-nick-dark/50 overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-700"
            style={{ width: `${stats.chat.totalSessions > 0 ? (stats.chat.converted / stats.chat.totalSessions) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Recent Chat Sessions */}
      <div>
        <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-4 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          RECENT CHAT SESSIONS
        </h3>
        {chatActivity.length > 0 ? (
          <div className="space-y-3">
            {chatActivity.map((chat, i) => (
              <div key={i} className="bg-card border border-border/30 p-4 flex items-start gap-4">
                <div className="w-10 h-10 bg-purple-500/10 border border-purple-500/30 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-heading font-bold text-sm text-foreground tracking-wider">{chat.title}</p>
                  <p className="font-mono text-xs text-foreground/50 mt-1">{chat.subtitle}</p>
                  <p className="font-mono text-[10px] text-foreground/25 mt-2">
                    {new Date(chat.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 border border-border/30 bg-card">
            <MessageSquare className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
            <p className="font-heading font-bold text-xl text-foreground/40 tracking-wider">NO CHAT SESSIONS</p>
            <p className="text-foreground/30 font-mono text-sm mt-2">Customer chat sessions will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SITE HEALTH SECTION ────────────────────────────────
function SiteHealthSection() {
  const { data: health, isLoading } = trpc.adminDashboard.siteHealth.useQuery();
  const { data: reviews } = trpc.reviews.google.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!health) return null;

  return (
    <div className="space-y-8">
      {/* Domain Status */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-5 flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          DOMAINS
        </h3>
        <div className="space-y-3">
          {health.domains.map(domain => (
            <div key={domain} className="flex items-center justify-between p-3 border border-border/20">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="font-mono text-sm text-foreground">{domain}</span>
              </div>
              <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="text-foreground/40 hover:text-primary transition-colors">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* SEO & Sitemap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-5 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            SEO STATUS
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="font-mono text-sm text-foreground/70">Sitemap Pages</span>
              <span className="font-heading font-bold text-lg text-primary">{health.sitemapPageCount}+</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="font-mono text-sm text-foreground/70">Total Blog Posts</span>
              <span className="font-heading font-bold text-lg text-foreground">{health.totalBlogPosts}</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="font-mono text-sm text-foreground/70">Hardcoded Articles</span>
              <span className="font-mono text-sm text-foreground/50">{health.hardcodedBlogPosts}</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="font-mono text-sm text-foreground/70">AI-Generated Articles</span>
              <span className="font-mono text-sm text-foreground/50">{health.dynamicBlogPosts}</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="font-mono text-sm text-foreground/70">Google Search Console</span>
              <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:text-primary/80 font-mono text-sm">
                View <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-5 flex items-center gap-2">
            <Star className="w-4 h-4 text-primary" />
            GOOGLE REVIEWS
          </h3>
          {reviews ? (
            <div className="space-y-4">
              <div className="text-center p-6 border border-border/20">
                <div className="flex items-center justify-center gap-1 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`w-6 h-6 ${i < Math.round(reviews.rating || 4.9) ? "fill-primary text-primary" : "text-foreground/20"}`} />
                  ))}
                </div>
                <p className="font-heading font-bold text-4xl text-foreground">{reviews.rating || "4.9"}</p>
                <p className="font-mono text-sm text-foreground/50 mt-1">{reviews.totalReviews || "1,683"}+ reviews</p>
              </div>
              {reviews.reviews && reviews.reviews.length > 0 && (
                <div className="space-y-3">
                  <p className="font-mono text-xs text-foreground/40 tracking-wider uppercase">Recent Reviews</p>
                  {reviews.reviews.slice(0, 3).map((review: { authorName?: string; rating?: number; text?: string }, i: number) => (
                    <div key={i} className="p-3 border border-border/20">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm text-foreground">{review.authorName || "Customer"}</span>
                        <div className="flex gap-0.5">
                          {[...Array(review.rating || 5)].map((_, j) => (
                            <Star key={j} className="w-3 h-3 fill-primary text-primary" />
                          ))}
                        </div>
                      </div>
                      <p className="font-mono text-xs text-foreground/50 line-clamp-2">{review.text || ""}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <Star className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
              <p className="font-mono text-sm text-foreground/40">Reviews data loading...</p>
            </div>
          )}
        </div>
      </div>

      {/* Integrations */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground mb-5 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          INTEGRATIONS
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { name: "Google Sheets CRM", status: health.sheetsConfigured, icon: <FileSpreadsheet className="w-5 h-5" />, link: health.sheetsUrl },
            { name: "Google Reviews", status: !!reviews, icon: <Star className="w-5 h-5" />, link: "https://business.google.com/" },
            { name: "Instagram Feed", status: true, icon: <Eye className="w-5 h-5" />, link: "https://instagram.com/nicks_tire_euclid" },
            { name: "AI Content Gen", status: true, icon: <Sparkles className="w-5 h-5" />, link: undefined },
          ].map(integration => (
            <div key={integration.name} className="flex items-center gap-3 p-4 border border-border/20">
              <div className={`${integration.status ? "text-emerald-400" : "text-red-400"}`}>
                {integration.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm text-foreground truncate">{integration.name}</p>
                <p className={`font-mono text-xs ${integration.status ? "text-emerald-400" : "text-red-400"}`}>
                  {integration.status ? "Connected" : "Not configured"}
                </p>
              </div>
              {integration.link && (
                <a href={integration.link} target="_blank" rel="noopener noreferrer" className="text-foreground/30 hover:text-primary">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ADMIN COMPONENT ───────────────────────────────
export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [section, setSection] = useState<AdminSection>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: stats } = trpc.adminDashboard.stats.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
    refetchInterval: 60000,
  });

  // ─── AUTH GATE ───────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-nick-dark flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-nick-dark flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <Shield className="w-12 h-12 text-primary mx-auto mb-4" />
          <h1 className="font-heading font-bold text-3xl text-foreground tracking-wider mb-4">ADMIN ACCESS</h1>
          <p className="text-foreground/60 mb-8">Sign in with your admin account to manage bookings and leads.</p>
          <a href={getLoginUrl()} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors">
            SIGN IN
          </a>
        </div>
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="min-h-screen bg-nick-dark flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="font-heading font-bold text-3xl text-foreground tracking-wider mb-4">ACCESS DENIED</h1>
          <p className="text-foreground/60 mb-8">You do not have admin privileges.</p>
          <Link href="/" className="inline-flex items-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase hover:border-primary hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
            BACK TO SITE
          </Link>
        </div>
      </div>
    );
  }

  // Badge counts
  const newBookings = stats?.bookings.new ?? 0;
  const urgentLeads = stats?.leads.urgent ?? 0;
  const newLeads = stats?.leads.new ?? 0;

  const sectionTitles: Record<AdminSection, string> = {
    overview: "Dashboard Overview",
    bookings: "Booking Management",
    leads: "Lead Management",
    content: "Content Management",
    chats: "Chat Sessions",
    health: "Site Health & SEO",
  };

  return (
    <div className="min-h-screen bg-nick-dark flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen w-64 bg-card border-r border-border/30 flex flex-col transition-transform duration-200 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      }`}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-border/30">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-9 h-9 bg-primary flex items-center justify-center rounded-sm">
                <span className="font-heading font-bold text-primary-foreground text-base">N</span>
              </div>
              <div className="flex flex-col">
                <span className="font-heading font-bold text-primary text-sm leading-tight tracking-wider">NICK'S ADMIN</span>
                <span className="text-foreground/40 text-[10px] font-mono tracking-wider">MANAGEMENT HUB</span>
              </div>
            </Link>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-foreground/50 hover:text-foreground p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const isActive = section === item.id;
            let badge = 0;
            if (item.id === "bookings") badge = newBookings;
            if (item.id === "leads") badge = urgentLeads + newLeads;

            return (
              <button
                key={item.id}
                onClick={() => { setSection(item.id); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary border-l-2 border-primary"
                    : "text-foreground/60 hover:text-foreground hover:bg-foreground/5 border-l-2 border-transparent"
                }`}
              >
                {item.icon}
                <span className="font-heading font-bold text-xs tracking-wider uppercase flex-1 text-left">{item.label}</span>
                {badge > 0 && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    item.id === "leads" ? "bg-red-500 text-white" : "bg-blue-500 text-white"
                  }`}>{badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-border/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-foreground/10 flex items-center justify-center rounded-full">
              <span className="font-heading font-bold text-foreground/60 text-xs">
                {user.name?.charAt(0)?.toUpperCase() || "A"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs text-foreground truncate">{user.name || "Admin"}</p>
              <p className="font-mono text-[10px] text-foreground/30">Admin</p>
            </div>
          </div>
          <Link href="/" className="flex items-center gap-2 mt-3 text-foreground/40 hover:text-primary transition-colors font-mono text-xs">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to site
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-nick-dark/95 backdrop-blur-md border-b border-border/30 h-14 flex items-center px-4 lg:px-8 gap-4">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-foreground/60 hover:text-foreground p-1">
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="font-heading font-bold text-sm tracking-wider uppercase text-foreground">
            {sectionTitles[section]}
          </h1>
          <div className="flex-1" />
          <Link href="/admin/content" className="flex items-center gap-1.5 bg-card border border-border/30 px-3 py-1.5 text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="font-heading font-bold text-[10px] tracking-wider uppercase hidden sm:inline">AI Content</span>
          </Link>
        </header>

        {/* Section Content */}
        <div className="p-4 lg:p-8">
          {section === "overview" && <OverviewSection />}
          {section === "bookings" && <BookingsSection />}
          {section === "leads" && <LeadsSection />}
          {section === "content" && <ContentSection />}
          {section === "chats" && <ChatSessionsSection />}
          {section === "health" && <SiteHealthSection />}
        </div>
      </main>
    </div>
  );
}
