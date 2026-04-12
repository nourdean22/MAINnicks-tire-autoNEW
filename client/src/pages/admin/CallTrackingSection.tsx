/**
 * Call Intelligence Section — source tracking, missed call queue, peak hours analysis.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { StatCard, CHART_COLORS, CHART_THEME } from "./shared";
import {
  Phone, PhoneCall, MapPin, Loader2, Clock, AlertTriangle,
  TrendingUp, BarChart3, Users, CheckCircle2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "oklch(0.12 0.005 260)",
  border: "1px solid oklch(0.20 0.005 260)",
  borderRadius: "6px",
  fontFamily: "'Roboto Mono', monospace",
  fontSize: 11,
  padding: "8px 12px",
};

export default function CallTrackingSection() {
  const { data: stats, isLoading: statsLoading } = trpc.adminDashboard.stats.useQuery();
  const { data: calls, isLoading: callsLoading } = trpc.callTracking.list.useQuery();
  const { data: callbacks } = trpc.callback.list.useQuery();

  // Peak hours analysis
  const peakHours = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    const hourCounts: Record<number, number> = {};
    calls.forEach((c: any) => {
      const hour = new Date(c.createdAt).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    return Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`,
      count: hourCounts[h] || 0,
      fill: hourCounts[h] >= 3 ? CHART_THEME.primary : hourCounts[h] >= 1 ? CHART_THEME.secondary : "oklch(0.20 0.005 260)",
    })).filter(h => h.hour >= 7 && h.hour <= 21); // Business hours only
  }, [calls]);

  // Day-of-week analysis
  const dayOfWeek = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayCounts: Record<number, number> = {};
    calls.forEach((c: any) => {
      const day = new Date(c.createdAt).getDay();
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });
    return days.map((name, i) => ({
      name,
      count: dayCounts[i] || 0,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [calls]);

  // Source attribution breakdown
  const sourceBreakdown = useMemo(() => {
    if (!calls || calls.length === 0) return [];
    const sources: Record<string, number> = {};
    calls.forEach((c: any) => {
      const src = c.utmSource || "direct";
      sources[src] = (sources[src] || 0) + 1;
    });
    return Object.entries(sources)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
  }, [calls]);

  // Pending callbacks (missed call queue)
  const pendingCallbacks = useMemo(() => {
    if (!callbacks) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC returns any from untyped db
    return (callbacks as any[]).filter((c: any) => c.status === "new" || c.status === "pending");
  }, [callbacks]);

  const callTracking = stats?.callTracking;

  if (statsLoading || callsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── METRICS ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Total Calls" value={callTracking?.totalCalls ?? 0}
          icon={<PhoneCall className="w-4 h-4" />}
        />
        <StatCard
          label="This Week" value={callTracking?.thisWeek ?? 0}
          icon={<Clock className="w-4 h-4" />}
          trend={(callTracking?.thisWeek ?? 0) > 0 ? "up" : "neutral"}
          trendLabel="phone clicks"
        />
        <StatCard
          label="Missed / Pending" value={pendingCallbacks.length}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={pendingCallbacks.length > 0 ? "text-red-400" : "text-emerald-400"}
          trend={pendingCallbacks.length > 0 ? "up" : "neutral"}
          trendLabel={pendingCallbacks.length > 0 ? "Needs follow-up" : "All clear"}
        />
        <StatCard
          label="Callbacks Total" value={stats?.callbacks?.total ?? 0}
          icon={<Phone className="w-4 h-4" />}
          trendLabel={`${stats?.callbacks?.completed ?? 0} completed`}
        />
        <StatCard
          label="Top Source" value={sourceBreakdown[0]?.source ?? "—"}
          icon={<TrendingUp className="w-4 h-4" />} color="text-primary"
        />
      </div>

      {/* ─── MISSED CALL QUEUE ─── */}
      {pendingCallbacks.length > 0 && (
        <div className="stat-card !p-5 !border-red-500/20">
          <h3 className="text-xs font-semibold text-red-400 tracking-wide uppercase mb-3 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Missed Call Queue
            <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded-full font-bold ml-1">
              {pendingCallbacks.length}
            </span>
          </h3>
          <div className="space-y-2">
            {pendingCallbacks.slice(0, 10).map((cb: any) => (
              <div key={cb.id} className="flex items-center gap-3 px-3 py-2.5 bg-background/50 border border-border/20 hover:border-red-500/30 transition-colors">
                <PhoneCall className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{cb.name || "Unknown"}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{cb.phone}</span>
                  </div>
                  {cb.context && (
                    <span className="text-[11px] text-foreground/40 truncate block">{cb.context}</span>
                  )}
                  <span className="text-[10px] text-foreground/30">
                    {new Date(cb.createdAt).toLocaleString()}
                  </span>
                </div>
                <a
                  href={`tel:${cb.phone}`}
                  className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-medium hover:bg-emerald-500/20 rounded transition-all"
                >
                  <Phone className="w-3 h-3" /> Call Back
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── PEAK HOURS + DAY OF WEEK ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Peak Hours */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-primary" />
            Peak Call Hours
          </h3>
          {peakHours.length > 0 && peakHours.some(h => h.count > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={peakHours} margin={{ left: -10, right: 5 }}>
                <XAxis dataKey="label" tick={{ fill: "oklch(0.48 0.008 260)", fontSize: 9, fontFamily: "'Roboto Mono', monospace" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "oklch(0.48 0.008 260)", fontSize: 9, fontFamily: "'Roboto Mono', monospace" }} axisLine={false} tickLine={false} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {peakHours.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              <p className="text-sm">No call data for peak hours</p>
            </div>
          )}
        </div>

        {/* Day of Week */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            Calls by Day
          </h3>
          {dayOfWeek.length > 0 && dayOfWeek.some(d => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dayOfWeek} margin={{ left: -10, right: 5 }}>
                <XAxis dataKey="name" tick={{ fill: "oklch(0.48 0.008 260)", fontSize: 10, fontFamily: "'Roboto Mono', monospace" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "oklch(0.48 0.008 260)", fontSize: 9, fontFamily: "'Roboto Mono', monospace" }} axisLine={false} tickLine={false} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {dayOfWeek.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              <p className="text-sm">No call data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── SOURCE ATTRIBUTION ─── */}
      {sourceBreakdown.length > 0 && (
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-primary" />
            Call Source Attribution
          </h3>
          <div className="space-y-3">
            {sourceBreakdown.map((s, i) => {
              const maxCount = sourceBreakdown[0]?.count ?? 1;
              const pct = Math.round((s.count / maxCount) * 100);
              return (
                <div key={s.source}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] font-medium text-foreground/70 capitalize">{s.source}</span>
                    <span className="text-[11px] text-muted-foreground">{s.count} calls</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── CALLS BY PAGE ─── */}
      {callTracking?.byPage && callTracking.byPage.length > 0 && (
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-primary" />
            Calls by Page
          </h3>
          <div className="space-y-3">
            {callTracking.byPage.map((p, i) => {
              const maxCount = callTracking.byPage[0]?.count ?? 1;
              const pct = Math.round((p.count / maxCount) * 100);
              return (
                <div key={p.page}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground/80">{p.page}</span>
                    <span className="text-xs text-muted-foreground">{p.count} calls</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── RECENT CALL LOG ─── */}
      <div className="stat-card overflow-hidden !p-0">
        <div className="p-4 border-b border-border/20">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase flex items-center gap-2">
            <PhoneCall className="w-3.5 h-3.5 text-primary" />
            Recent Call Events
          </h3>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">Every phone click on the site with source attribution</p>
        </div>
        {!calls || calls.length === 0 ? (
          <div className="p-8 text-center">
            <PhoneCall className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No call events yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-foreground/[0.03]">
                  <th className="text-left p-3 font-medium text-muted-foreground">Phone</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Page</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Source</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Medium</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Campaign</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call: any) => (
                  <tr key={call.id} className="border-t border-border/10 hover:bg-foreground/[0.02]">
                    <td className="p-3 font-mono text-foreground">{call.phoneNumber}</td>
                    <td className="p-3 text-foreground/70">{call.sourcePage || "—"}</td>
                    <td className="p-3">
                      {call.utmSource ? (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">{call.utmSource}</span>
                      ) : (
                        <span className="text-foreground/30">direct</span>
                      )}
                    </td>
                    <td className="p-3 text-foreground/70">{call.utmMedium || "—"}</td>
                    <td className="p-3 text-foreground/70">{call.utmCampaign || "—"}</td>
                    <td className="p-3 text-muted-foreground">{new Date(call.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
