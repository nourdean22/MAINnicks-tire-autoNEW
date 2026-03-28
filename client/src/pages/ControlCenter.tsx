/**
 * Control Center — Primary admin entrypoint.
 * Operator-focused: urgent items, today's numbers, system status, quick actions.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, Shield, AlertTriangle, ArrowRight,
  Users, CalendarClock, Phone, MessageSquare,
  Activity, Cpu, Database, Globe, RefreshCw,
  ChevronRight, Zap, Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const REFRESH_INTERVAL = 30_000;

export default function ControlCenter() {
  const { user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: getLoginUrl() });
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const { data, isLoading, refetch } = trpc.controlCenter.getOverview.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL,
    enabled: !!user,
  });

  // Track refresh time
  useEffect(() => {
    if (data) setLastRefresh(Date.now());
  }, [data]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#FDB913]" />
      </div>
    );
  }

  const loading = isLoading || !data;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {/* Header */}
      <div className="border-b border-white/5 bg-[#0A0A0A]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-[#FDB913]" />
            <h1 className="text-lg font-bold tracking-tight">Control Center</h1>
            <Badge variant="outline" className="text-[10px] border-white/10 text-white/40">ADMIN</Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-white/30 tracking-wide">
              Updated {Math.round((Date.now() - lastRefresh) / 1000)}s ago
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="h-7 px-2 text-white/50 hover:text-white"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Link href="/admin" className="text-xs text-white/40 hover:text-[#FDB913] transition-colors flex items-center gap-1">
              Full Admin <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* SECTION 1: What Needs Attention */}
        <section>
          <h2 className="text-xs font-semibold tracking-wider text-white/40 uppercase mb-3 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> What Needs Attention
          </h2>
          {loading ? (
            <Card className="bg-white/[0.02] border-white/5">
              <CardContent className="py-8 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-white/20" />
              </CardContent>
            </Card>
          ) : data.urgentItems.length === 0 ? (
            <Card className="bg-white/[0.02] border-white/5">
              <CardContent className="py-6 text-center">
                <p className="text-sm text-white/30">All clear. Nothing urgent.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {data.urgentItems.map((item, i) => (
                <Card key={i} className={`bg-white/[0.02] border-l-2 ${
                  item.priority === "high" ? "border-l-red-500 border-white/5" :
                  item.priority === "medium" ? "border-l-amber-500 border-white/5" :
                  "border-l-white/20 border-white/5"
                }`}>
                  <CardContent className="py-3 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${
                        item.priority === "high" ? "border-red-500/30 text-red-400" :
                        item.priority === "medium" ? "border-amber-500/30 text-amber-400" :
                        "border-white/10 text-white/40"
                      }`}>
                        {item.priority.toUpperCase()}
                      </Badge>
                      <span className="text-sm text-white/80">{item.message}</span>
                    </div>
                    <Link href={item.action}>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-white/40 hover:text-[#FDB913]">
                        View <ArrowRight className="w-3 h-3 ml-1" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* SECTION 2: Today's Numbers */}
        <section>
          <h2 className="text-xs font-semibold tracking-wider text-white/40 uppercase mb-3 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Today's Numbers
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Leads"
              value={loading ? "--" : data.todayStats.leadsToday}
              icon={<Users className="w-4 h-4" />}
              color="text-blue-400"
            />
            <StatCard
              label="Quotes"
              value={loading ? "--" : data.todayStats.quotesToday}
              icon={<MessageSquare className="w-4 h-4" />}
              color="text-amber-400"
            />
            <StatCard
              label="Bookings"
              value={loading ? "--" : data.todayStats.bookingsToday}
              icon={<CalendarClock className="w-4 h-4" />}
              color="text-emerald-400"
            />
            <StatCard
              label="Callbacks Pending"
              value={loading ? "--" : data.todayStats.callbacksPending}
              icon={<Phone className="w-4 h-4" />}
              color={!loading && data.todayStats.callbacksPending > 0 ? "text-red-400" : "text-white/60"}
            />
          </div>
        </section>

        {/* SECTION 3: System Status */}
        <section>
          <h2 className="text-xs font-semibold tracking-wider text-white/40 uppercase mb-3 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" /> System Status
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* AI Gateway */}
            <Card className="bg-white/[0.02] border-white/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-white/40 flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5" /> AI Gateway
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Ollama</span>
                  <StatusDot healthy={!loading && data.aiGateway.ollamaHealthy} loading={loading} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Requests (5m)</span>
                  <span className="text-xs text-white/70 font-mono">{loading ? "--" : data.aiGateway.recentRequests}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Fallback rate</span>
                  <span className="text-xs text-white/70 font-mono">{loading ? "--" : `${data.aiGateway.fallbackRate}%`}</span>
                </div>
                {!loading && data.aiGateway.topModels.length > 0 && (
                  <div className="pt-1 flex flex-wrap gap-1">
                    {data.aiGateway.topModels.map(m => (
                      <Badge key={m} variant="outline" className="text-[9px] border-white/10 text-white/30">{m}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Database */}
            <Card className="bg-white/[0.02] border-white/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-white/40 flex items-center gap-2">
                  <Database className="w-3.5 h-3.5" /> Database
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Status</span>
                  <StatusDot healthy={!loading && data.systemHealth.dbStatus === "connected"} loading={loading} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Uptime</span>
                  <span className="text-xs text-white/70 font-mono">{loading ? "--" : formatUptime(data.systemHealth.uptime)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Tunnel */}
            <Card className="bg-white/[0.02] border-white/5">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-white/40 flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5" /> Tunnel
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Status</span>
                  <StatusDot healthy={!loading && !!data.systemHealth.tunnelUrl} loading={loading} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Mode</span>
                  <span className="text-xs text-white/70 font-mono">{loading ? "--" : data.systemHealth.tunnelMode}</span>
                </div>
                {!loading && data.systemHealth.tunnelUrl && (
                  <p className="text-[10px] text-white/30 truncate">{data.systemHealth.tunnelUrl}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* SECTION 4: Quick Actions */}
        <section>
          <h2 className="text-xs font-semibold tracking-wider text-white/40 uppercase mb-3 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" /> Quick Actions
          </h2>
          <div className="flex flex-wrap gap-2">
            <QuickAction href="/admin" label="Full Admin" />
            <QuickAction href="/admin#leads" label="View Leads" />
            <QuickAction href="/admin#bookings" label="View Bookings" />
            <QuickAction href="/admin#chats" label="View Chat" />
            <QuickAction href="/admin#health" label="Site Health" />
            <QuickAction href="/admin#sms" label="SMS" />
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────

function StatCard({ label, value, icon, color }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card className="bg-white/[0.02] border-white/5">
      <CardContent className="py-4 px-4">
        <div className="flex items-start justify-between mb-2">
          <span className="text-[10px] font-medium text-white/40 tracking-wide uppercase">{label}</span>
          <div className="text-white/20">{icon}</div>
        </div>
        <div className={`text-2xl font-bold tracking-tight ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusDot({ healthy, loading }: { healthy: boolean; loading: boolean }) {
  if (loading) return <span className="w-2 h-2 rounded-full bg-white/10 inline-block" />;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full inline-block ${healthy ? "bg-emerald-400" : "bg-red-400"}`} />
      <span className={`text-[10px] font-medium ${healthy ? "text-emerald-400" : "text-red-400"}`}>
        {healthy ? "OK" : "DOWN"}
      </span>
    </span>
  );
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href}>
      <Button variant="outline" size="sm" className="h-8 text-xs border-white/10 text-white/60 hover:text-[#FDB913] hover:border-[#FDB913]/30 bg-transparent">
        {label}
      </Button>
    </Link>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
