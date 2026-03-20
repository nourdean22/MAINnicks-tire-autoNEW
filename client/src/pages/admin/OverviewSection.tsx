/**
 * OverviewSection — Premium admin dashboard overview with CEO-level polish.
 */
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  StatCard, ActivityIcon, StatusDot, CHART_COLORS,
} from "./shared";
import {
  Activity, AlertTriangle, BarChart3, Bell, CalendarClock, CheckCircle2,
  ChevronRight, ExternalLink, FileSpreadsheet, FileText, Globe, Hash,
  Loader2, MessageSquare, Newspaper, PieChart, Send, Sparkles, Star,
  TrendingUp, Users, XCircle, Zap,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Legend,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "oklch(0.12 0.005 260)",
  border: "1px solid oklch(0.20 0.005 260)",
  borderRadius: "6px",
  fontFamily: "'Roboto Mono', monospace",
  fontSize: 11,
  padding: "8px 12px",
};

export default function OverviewSection() {
  const { data: stats, isLoading } = trpc.adminDashboard.stats.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: health } = trpc.adminDashboard.siteHealth.useQuery(undefined, {
    refetchInterval: 300000,
  });
  const { data: sheetInfo } = trpc.lead.sheetUrl.useQuery();
  const { data: customerStats } = trpc.customers.stats.useQuery();
  const { data: campaignStats } = trpc.customers.campaignStats.useQuery(undefined, { refetchInterval: 30000 });

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
      </div>
    );
  }

  const serviceChartData = stats.bookings.byService.slice(0, 6).map((s, i) => ({
    name: s.service.length > 15 ? s.service.substring(0, 15) + "\u2026" : s.service,
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
    <div className="space-y-6">
      {/* ─── PRIMARY METRICS ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Bookings" value={stats.bookings.total}
          icon={<CalendarClock className="w-4 h-4" />} color="text-foreground"
          trend={stats.bookings.thisWeek > 0 ? "up" : "neutral"}
          trendLabel={`${stats.bookings.thisWeek} this week`}
        />
        <StatCard
          label="Active Leads" value={stats.leads.new + stats.leads.contacted}
          icon={<Users className="w-4 h-4" />} color="text-blue-400"
          trend={stats.leads.thisWeek > 0 ? "up" : "neutral"}
          trendLabel={`${stats.leads.thisWeek} this week`}
        />
        <StatCard
          label="Urgent Leads" value={stats.leads.urgent}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={stats.leads.urgent > 0 ? "text-red-400" : "text-muted-foreground"}
          trend={stats.leads.urgent > 0 ? "up" : "neutral"}
          trendLabel={stats.leads.urgent > 0 ? "Needs attention" : "All clear"}
        />
        <StatCard
          label="Chat Sessions" value={stats.chat.totalSessions}
          icon={<MessageSquare className="w-4 h-4" />} color="text-purple-400"
          trend={stats.chat.thisWeek > 0 ? "up" : "neutral"}
          trendLabel={`${stats.chat.thisWeek} this week`}
        />
      </div>

      {/* ─── SECONDARY METRICS ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label="New Bookings" value={stats.bookings.new} icon={<Hash className="w-3.5 h-3.5" />} color="text-blue-400" />
        <StatCard label="Confirmed" value={stats.bookings.confirmed} icon={<CheckCircle2 className="w-3.5 h-3.5" />} color="text-primary" />
        <StatCard label="Completed" value={stats.bookings.completed} icon={<CheckCircle2 className="w-3.5 h-3.5" />} color="text-emerald-400" />
        <StatCard label="Published" value={stats.content.published} icon={<FileText className="w-3.5 h-3.5" />} color="text-emerald-400" />
        <StatCard label="Drafts" value={stats.content.drafts} icon={<Newspaper className="w-3.5 h-3.5" />} color="text-amber-400" />
        <StatCard label="Notifications" value={stats.content.activeNotifications} icon={<Bell className="w-3.5 h-3.5" />} color="text-primary" />
      </div>

      {/* ─── QUICK ACTIONS ─── */}
      <div className="stat-card !p-5">
        <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-primary" />
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {[
            { href: "/admin/content", icon: <Sparkles className="w-4 h-4 text-primary" />, label: "Generate Content" },
            { onClick: () => toast.info('Navigate to Customers \u2192 Send Next 50'), icon: <Send className="w-4 h-4 text-emerald-400" />, label: "Resume SMS" },
            { href: "/admin", icon: <FileSpreadsheet className="w-4 h-4 text-blue-400" />, label: "Export Customers" },
            { href: sheetInfo?.url || '#', external: true, icon: <ExternalLink className="w-4 h-4 text-amber-400" />, label: "CRM Sheet" },
            { href: "/estimate", icon: <TrendingUp className="w-4 h-4 text-cyan-400" />, label: "Estimator" },
            { href: "/blog", icon: <Globe className="w-4 h-4 text-purple-400" />, label: "View Blog" },
          ].map((action, i) => {
            const cls = "flex flex-col items-center gap-2 p-3 rounded-md border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-all text-center";
            if (action.onClick) {
              return (
                <button key={i} onClick={action.onClick} className={cls}>
                  {action.icon}
                  <span className="text-[11px] text-muted-foreground font-medium">{action.label}</span>
                </button>
              );
            }
            if (action.external) {
              return (
                <a key={i} href={action.href} target="_blank" rel="noopener noreferrer" className={cls}>
                  {action.icon}
                  <span className="text-[11px] text-muted-foreground font-medium">{action.label}</span>
                </a>
              );
            }
            return (
              <Link key={i} href={action.href!} className={cls}>
                {action.icon}
                <span className="text-[11px] text-muted-foreground font-medium">{action.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ─── SMS CAMPAIGN ROI ─── */}
      {campaignStats && campaignStats.total > 0 && (
        <div className="stat-card !border-primary/15 !p-5">
          <h3 className="text-xs font-semibold text-primary tracking-wide uppercase mb-4 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" />
            SMS Campaign ROI Estimator
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Texts Sent</span>
              <span className="text-2xl font-bold text-foreground tracking-tight">{campaignStats.sent}</span>
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Est. Responses (3%)</span>
              <span className="text-2xl font-bold text-blue-400 tracking-tight">{Math.round(campaignStats.sent * 0.03)}</span>
              <span className="text-[10px] text-muted-foreground block">potential customers</span>
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Avg Ticket Value</span>
              <span className="text-2xl font-bold text-emerald-400 tracking-tight">$350</span>
              <span className="text-[10px] text-muted-foreground block">industry average</span>
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Potential Revenue</span>
              <span className="text-2xl font-bold text-primary tracking-tight">${(Math.round(campaignStats.sent * 0.03) * 350).toLocaleString()}</span>
              <span className="text-[10px] text-muted-foreground block">from {campaignStats.sent} texts</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border/20">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between mb-1.5">
                  <span className="text-[10px] text-muted-foreground">Campaign Progress</span>
                  <span className="text-[10px] font-semibold text-primary">{Math.round((campaignStats.sent / campaignStats.total) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${(campaignStats.sent / campaignStats.total) * 100}%` }} />
                </div>
              </div>
              <span className="text-[11px] text-muted-foreground">{campaignStats.remaining} remaining</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── CUSTOMER & SMS STATS ─── */}
      {(customerStats || campaignStats) && (
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <Send className="w-3.5 h-3.5 text-primary" />
            Customer Database & SMS
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { value: customerStats?.total ?? 0, label: "Total Customers", color: "text-foreground" },
              { value: customerStats?.recent ?? 0, label: "Recent", color: "text-emerald-400" },
              { value: customerStats?.lapsed ?? 0, label: "Lapsed", color: "text-amber-400" },
              { value: campaignStats?.sent ?? 0, label: "Texts Sent", color: "text-primary" },
              { value: campaignStats?.remaining ?? 0, label: "Remaining", color: "text-muted-foreground" },
              { value: campaignStats && campaignStats.total > 0 ? `${Math.round((campaignStats.sent / campaignStats.total) * 100)}%` : "\u2014", label: "Progress", color: "text-primary" },
            ].map((item, i) => (
              <div key={i} className="text-center p-3 rounded-md border border-border/30">
                <p className={`text-xl font-bold tracking-tight ${item.color}`}>{item.value}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── CHARTS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Service Breakdown */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-5 flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-primary" />
            Bookings by Service
          </h3>
          {serviceChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={serviceChartData} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" tick={{ fill: "oklch(0.48 0.008 260)", fontSize: 10, fontFamily: "'Roboto Mono', monospace" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "oklch(0.60 0.008 260)", fontSize: 10, fontFamily: "'Roboto Mono', monospace" }} width={110} axisLine={false} tickLine={false} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#F5A623" }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {serviceChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-muted-foreground">
              <p className="text-sm">No booking data yet</p>
            </div>
          )}
        </div>

        {/* Lead Pipeline */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-5 flex items-center gap-2">
            <PieChart className="w-3.5 h-3.5 text-primary" />
            Lead Pipeline
          </h3>
          {leadPipelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <RPieChart>
                <Pie
                  data={leadPipelineData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {leadPipelineData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="bottom"
                  formatter={(value: string) => <span style={{ fontSize: 11, color: "oklch(0.55 0.008 260)", fontFamily: "'Roboto Mono', monospace" }}>{value}</span>}
                />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
              </RPieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-muted-foreground">
              <p className="text-sm">No lead data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── BOTTOM ROW: Actions + Sources + Activity ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Quick Links */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-primary" />
            Quick Links
          </h3>
          <div className="space-y-1.5">
            {[
              { href: "/admin/content", icon: <Sparkles className="w-4 h-4 text-primary" />, title: "Generate Content", sub: "AI articles & notifications", internal: true },
              ...(sheetInfo?.configured ? [{ href: sheetInfo.url, icon: <FileSpreadsheet className="w-4 h-4 text-emerald-400" />, title: "Open CRM Sheet", sub: "Google Sheets CRM", internal: false }] : []),
              { href: "https://business.google.com/", icon: <Star className="w-4 h-4 text-blue-400" />, title: "Google Business", sub: "Reviews & profile", internal: false },
              { href: "https://search.google.com/search-console", icon: <Globe className="w-4 h-4 text-amber-400" />, title: "Search Console", sub: "Indexing & performance", internal: false },
            ].map((link, i) => {
              const cls = "flex items-center gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors group";
              const content = (
                <>
                  {link.icon}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground">{link.title}</p>
                    <p className="text-[11px] text-muted-foreground">{link.sub}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </>
              );
              if (link.internal) {
                return <Link key={i} href={link.href!} className={cls}>{content}</Link>;
              }
              return <a key={i} href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>{content}</a>;
            })}
          </div>
        </div>

        {/* Lead Sources */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            Lead Sources
          </h3>
          {leadSourceData.length > 0 ? (
            <div className="space-y-3.5">
              {leadSourceData.map((s, i) => {
                const pct = stats.leads.total > 0 ? Math.round((s.value / stats.leads.total) * 100) : 0;
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12px] font-medium text-foreground/70">{s.name}</span>
                      <span className="text-[11px] text-muted-foreground">{s.value} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-3 border-t border-border/20">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Avg Urgency Score</span>
                  <span className="text-lg font-bold text-primary">{stats.leads.avgUrgency}/5</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <p className="text-sm">No lead data yet</p>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Recent Activity
          </h3>
          {stats.recentActivity.length > 0 ? (
            <div className="space-y-0">
              {stats.recentActivity.slice(0, 8).map((item, i) => (
                <div key={i} className="flex items-start gap-2.5 py-2.5 border-b border-border/10 last:border-0">
                  <div className="mt-0.5 shrink-0">
                    <ActivityIcon type={item.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[12px] font-medium text-foreground truncate">{item.title}</p>
                      {item.status && <StatusDot status={item.status} />}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{item.subtitle}</p>
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                      {new Date(item.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <p className="text-sm">No activity yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── SITE OVERVIEW ─── */}
      {health && (
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-primary" />
            Site Overview
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { value: health.domains.length, label: "Domains", color: "text-foreground" },
              { value: `${health.sitemapPageCount}+`, label: "Sitemap Pages", color: "text-primary" },
              { value: health.totalBlogPosts, label: "Blog Posts", color: "text-foreground" },
              { value: stats.users.total, label: "Users", color: "text-foreground" },
              { value: stats.content.generationLogs, label: "AI Generations", color: "text-emerald-400" },
              { value: health.sheetsConfigured ? "Active" : "Inactive", label: "CRM Sheet", color: health.sheetsConfigured ? "text-emerald-400" : "text-red-400" },
            ].map((item, i) => (
              <div key={i} className="text-center p-3 rounded-md border border-border/30">
                <p className={`text-xl font-bold tracking-tight ${item.color}`}>{item.value}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
