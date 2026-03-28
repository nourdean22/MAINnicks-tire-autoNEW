/**
 * Control Center — Daily driver command center.
 * One screen. Reduce thought. Drive action.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, Shield, ArrowRight, Users, CalendarClock, Phone,
  MessageSquare, Cpu, Database, Globe, RefreshCw, ChevronRight,
  ChevronDown, Zap, Clock, Target, Flame, AlertTriangle,
  Check, DollarSign,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const REFRESH_INTERVAL = 30_000;

// Non-negotiables are defined server-side and returned via getDailyBrief

export default function ControlCenter() {
  const { user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: getLoginUrl() });
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [systemExpanded, setSystemExpanded] = useState(false);

  const overview = trpc.controlCenter.getOverview.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL,
    enabled: !!user,
  });

  const brief = trpc.controlCenter.getDailyBrief.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL,
    enabled: !!user,
  });

  const toggleHabit = trpc.controlCenter.toggleHabit.useMutation();
  const setMissionMut = trpc.controlCenter.setMission.useMutation();

  useEffect(() => {
    if (overview.data) setLastRefresh(Date.now());
  }, [overview.data]);

  const refetchAll = useCallback(() => {
    overview.refetch();
    brief.refetch();
  }, [overview, brief]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#FDB913]" />
      </div>
    );
  }

  const o = overview.data;
  const b = brief.data;
  const loading = overview.isLoading || !o;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      {/* Header */}
      <div className="border-b border-white/5 bg-[#0A0A0A]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#FDB913]" />
            <span className="text-sm font-bold tracking-tight">Control Center</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/25">{Math.round((Date.now() - lastRefresh) / 1000)}s</span>
            <Button variant="ghost" size="sm" onClick={refetchAll} className="h-7 w-7 p-0 text-white/40 hover:text-white">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Link href="/admin" className="text-[10px] text-white/30 hover:text-[#FDB913] flex items-center gap-0.5">
              Admin <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">

        {/* 0. TIME GREETING */}
        {b?.timeContext && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/60 leading-snug">{b.timeContext.greeting}</p>
            {b.timeContext.hoursLeft > 0 && (
              <span className="text-[10px] text-white/25 font-mono shrink-0 ml-3">{b.timeContext.hoursLeft}h left</span>
            )}
          </div>
        )}

        {/* 0b. DRIFT ALERT */}
        {b?.driftIndicator?.status === "off_track" && (
          <Card className="bg-red-500/10 border-red-500/30 animate-pulse">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Drift Detected</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {b.driftIndicator.signals.map((s: string, i: number) => (
                  <span key={i} className="text-xs text-red-300/80">{s}{i < b.driftIndicator.signals.length - 1 ? " •" : ""}</span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 1. ONE NEXT ACTION */}
        <NextAction brief={b} loading={!b} />

        {/* 2. MISSION + EXECUTION */}
        <MissionBlock brief={b} loading={!b} setMission={setMissionMut} />

        {/* 3. NON-NEGOTIABLES */}
        <HabitsBlock brief={b} loading={!b} toggleHabit={toggleHabit} />

        {/* 4. REVENUE WAITING */}
        <RevenueBlock brief={b} loading={!b} />

        {/* 5. TODAY'S NUMBERS */}
        <section>
          <SectionLabel icon={<Zap className="w-3 h-3" />} text="Today" />
          <div className="grid grid-cols-4 gap-2">
            <MiniStat label="Leads" value={loading ? "--" : o.todayStats.leadsToday} color="text-blue-400" />
            <MiniStat label="Quotes" value={loading ? "--" : o.todayStats.quotesToday} color="text-amber-400" />
            <MiniStat label="Booked" value={loading ? "--" : o.todayStats.bookingsToday} color="text-emerald-400" />
            <MiniStat label="Calls" value={loading ? "--" : o.todayStats.callbacksPending} color={!loading && o.todayStats.callbacksPending > 0 ? "text-red-400" : "text-white/50"} />
          </div>
        </section>

        {/* 6. SYSTEM STATUS */}
        <section>
          <button
            onClick={() => setSystemExpanded(!systemExpanded)}
            className="w-full flex items-center justify-between mb-2"
          >
            <SectionLabel icon={<Cpu className="w-3 h-3" />} text="Systems" />
            <div className="flex items-center gap-2">
              {!loading && (
                <div className="flex gap-1.5">
                  <StatusDot healthy={o.aiGateway.ollamaHealthy} />
                  <StatusDot healthy={o.systemHealth.dbStatus === "connected"} />
                  <StatusDot healthy={!!o.systemHealth.tunnelUrl} />
                </div>
              )}
              <ChevronDown className={`w-3 h-3 text-white/20 transition-transform ${systemExpanded ? "rotate-180" : ""}`} />
            </div>
          </button>
          {systemExpanded && !loading && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <SystemItem label="AI" sublabel={`${o.aiGateway.recentRequests} req`} healthy={o.aiGateway.ollamaHealthy} />
                <SystemItem label="DB" sublabel={formatUptime(o.systemHealth.uptime)} healthy={o.systemHealth.dbStatus === "connected"} />
                <SystemItem label="Tunnel" sublabel={o.systemHealth.tunnelMode} healthy={!!o.systemHealth.tunnelUrl} />
              </div>
              <div className="flex items-center gap-3 text-[10px] text-white/20 font-mono px-1">
                <span>{o.systemHealth.env?.toUpperCase()}</span>
                <span>Up {formatUptime(o.systemHealth.uptime)}</span>
              </div>
            </div>
          )}
        </section>

        {/* 7. QUICK ACTIONS */}
        <section>
          <SectionLabel icon={<Clock className="w-3 h-3" />} text="Actions" />
          <div className="flex flex-wrap gap-1.5">
            {[
              ["/admin", "Admin"],
              ["/admin#leads", "Leads"],
              ["/admin#bookings", "Bookings"],
              ["/admin#chats", "Chat"],
              ["/admin#health", "Health"],
              ["/admin#sms", "SMS"],
            ].map(([href, label]) => (
              <Link key={href} href={href}>
                <Button variant="outline" size="sm" className="h-7 text-[11px] border-white/8 text-white/50 hover:text-[#FDB913] hover:border-[#FDB913]/30 bg-transparent">
                  {label}
                </Button>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Section 1: Next Action ──────────────────────────

function NextAction({ brief, loading }: { brief: any; loading: boolean }) {
  if (loading) {
    return (
      <Card className="bg-[#FDB913]/5 border-[#FDB913]/20">
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-[#FDB913]/40" />
        </CardContent>
      </Card>
    );
  }

  const action = brief?.topAction;

  if (!action) {
    return (
      <Card className="bg-emerald-500/5 border-emerald-500/20">
        <CardContent className="py-5 text-center">
          <p className="text-sm font-medium text-emerald-400">All clear. Execute your mission.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[#FDB913]/5 border-[#FDB913]/20">
      <CardContent className="py-4 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold tracking-wider text-[#FDB913]/60 uppercase mb-1">Next Action</p>
            <p className="text-sm font-medium text-white/90 leading-snug">{action.message}</p>
          </div>
          {action.action && (
            <Link href={action.action}>
              <Button size="sm" className="h-8 bg-[#FDB913] text-black hover:bg-[#FDB913]/90 text-xs font-semibold shrink-0">
                Go <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section 2: Mission + Execution ──────────────────

function MissionBlock({ brief, loading, setMission }: { brief: any; loading: boolean; setMission: any }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const mission = brief?.execution?.mission || "";
  const score = brief?.execution?.completionScore ?? 0;
  const streak = brief?.execution?.streak ?? 0;
  const driftSignals = brief?.driftIndicator?.signals ?? [];

  const status = score >= 80 ? "FOCUSED" : score >= 50 ? "DRIFTING" : "OFF TRACK";
  const statusColor = score >= 80 ? "text-emerald-400 border-emerald-500/30" : score >= 50 ? "text-amber-400 border-amber-500/30" : "text-red-400 border-red-500/30";

  const startEdit = () => {
    setDraft(mission);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== mission) {
      setMission.mutate({ mission: trimmed });
    }
  };

  if (loading) {
    return (
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-white/20" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/[0.02] border-white/5">
      <CardContent className="py-4 px-4 space-y-3">
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-white/30" />
          <span className="text-[10px] font-semibold tracking-wider text-white/30 uppercase">Mission</span>
          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${statusColor}`}>{status}</Badge>
          {streak > 0 && (
            <span className="text-[10px] text-white/30 flex items-center gap-0.5 ml-auto">
              <Flame className="w-3 h-3 text-orange-400" /> {streak}d
            </span>
          )}
        </div>

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={e => e.key === "Enter" && save()}
            className="w-full bg-transparent text-sm text-white/90 border-b border-[#FDB913]/30 outline-none pb-1"
            placeholder="What's today's mission?"
          />
        ) : (
          <p onClick={startEdit} className="text-sm text-white/80 cursor-pointer hover:text-white transition-colors leading-snug">
            {mission || "Tap to set today's mission..."}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Progress value={score} className="h-1.5 flex-1 bg-white/5 [&>[data-slot=progress-indicator]]:bg-[#FDB913]" />
          <span className="text-xs font-mono text-white/50 tabular-nums">{score}%</span>
        </div>

        {driftSignals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {driftSignals.map((d: string, i: number) => (
              <Badge key={i} variant="outline" className="text-[9px] border-amber-500/20 text-amber-400/70">
                <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> {d}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section 3: Non-Negotiables ──────────────────────

function HabitsBlock({ brief, loading, toggleHabit }: { brief: any; loading: boolean; toggleHabit: any }) {
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const habits: Array<{ key: string; label: string; completed: boolean }> = brief?.execution?.nonNegotiables ?? [];

  const toggle = (key: string, current: boolean) => {
    const next = !current;
    setOptimistic(prev => ({ ...prev, [key]: next }));
    toggleHabit.mutate(
      { habitKey: key, completed: next },
      { onError: () => setOptimistic(prev => { const n = { ...prev }; delete n[key]; return n; }) },
    );
  };

  return (
    <section>
      <SectionLabel icon={<Check className="w-3 h-3" />} text="Non-Negotiables" />
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="py-2 px-4 divide-y divide-white/5">
          {habits.map(({ key, label, completed }) => {
            const checked = optimistic[key] ?? completed;
            return (
              <button
                key={key}
                onClick={() => !loading && toggle(key, checked)}
                className="w-full flex items-center gap-3 py-2.5 text-left"
                disabled={loading}
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                  checked ? "bg-emerald-500 border-emerald-500" : "border-white/20"
                }`}>
                  {checked && <Check className="w-3 h-3 text-white" />}
                </div>
                <span className={`text-sm transition-colors ${checked ? "text-white/30 line-through" : "text-white/80"}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}

// ─── Section 4: Revenue Waiting ──────────────────────

function RevenueBlock({ brief, loading }: { brief: any; loading: boolean }) {
  const rev = brief?.revenueWaiting;
  if (loading || !rev) return null;

  const { staleLeadsCount, staleQuotesCount, pendingCallbacks, topOpportunities } = rev;
  if (!staleLeadsCount && !staleQuotesCount && !pendingCallbacks) return null;

  return (
    <section>
      <SectionLabel icon={<DollarSign className="w-3 h-3" />} text="Revenue Waiting" />
      <Card className="bg-white/[0.02] border-white/5">
        <CardContent className="py-3 px-4 space-y-3">
          <div className="flex gap-4 text-xs text-white/50">
            {staleLeadsCount > 0 && <span><strong className="text-white/70">{staleLeadsCount}</strong> leads cold</span>}
            {staleQuotesCount > 0 && <span><strong className="text-white/70">{staleQuotesCount}</strong> quotes stale</span>}
            {pendingCallbacks > 0 && <span><strong className="text-white/70">{pendingCallbacks}</strong> callbacks</span>}
          </div>
          {topOpportunities && topOpportunities.length > 0 && (
            <div className="space-y-1.5">
              {topOpportunities.slice(0, 5).map((opp: any, i: number) => {
                const ageDays = Math.floor((Date.now() - new Date(opp.createdAt).getTime()) / 86400000);
                return (
                  <div key={opp.id ?? i} className="flex items-center justify-between text-xs">
                    <span className="text-white/70 truncate flex-1 mr-2">{opp.name} — {opp.service}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`font-mono tabular-nums ${ageDays > 2 ? "text-red-400" : "text-white/40"}`}>
                        {ageDays}d
                      </span>
                      <Link href="/admin#leads">
                        <ArrowRight className="w-3 h-3 text-white/30 hover:text-[#FDB913]" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ─── Shared Components ───────────────────────────────

function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <h2 className="text-[10px] font-semibold tracking-wider text-white/30 uppercase mb-2 flex items-center gap-1.5">
      {icon} {text}
    </h2>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-lg py-2.5 px-2 text-center">
      <div className={`text-lg font-bold tracking-tight ${color}`}>{value}</div>
      <div className="text-[9px] text-white/30 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function StatusDot({ healthy }: { healthy: boolean }) {
  return <span className={`w-1.5 h-1.5 rounded-full inline-block ${healthy ? "bg-emerald-400" : "bg-red-400"}`} />;
}

function SystemItem({ label, sublabel, healthy }: { label: string; sublabel: string; healthy: boolean }) {
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-lg py-2 px-3">
      <div className="flex items-center gap-1.5 mb-1">
        <StatusDot healthy={healthy} />
        <span className="text-xs text-white/60">{label}</span>
      </div>
      <span className="text-[10px] text-white/30 font-mono">{sublabel}</span>
    </div>
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
