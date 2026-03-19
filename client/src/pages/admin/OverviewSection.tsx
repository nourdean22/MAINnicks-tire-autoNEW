/**
 * OverviewSection — extracted from Admin.tsx for maintainability.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { BUSINESS } from "@shared/business";
import {
  StatCard, UrgencyBadge, ActivityIcon, StatusDot,
  BOOKING_STATUS_CONFIG, LEAD_STATUS_CONFIG, TIME_LABELS, CHART_COLORS,
  type BookingStatus, type LeadStatus,
} from "./shared";
import {
  Activity, AlertTriangle, BarChart3, Bell, CalendarClock, CheckCircle2, ChevronRight, Clock, ExternalLink, FileSpreadsheet, FileText, Globe, Hash, Loader2, MessageSquare, Newspaper, PieChart, Sparkles, Star, TrendingUp, Users, XCircle, Zap
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Legend
} from "recharts";

export default function OverviewSection() {
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

