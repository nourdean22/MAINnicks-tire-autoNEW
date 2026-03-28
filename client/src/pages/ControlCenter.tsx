/**
 * Control Center — Tesla Mode.
 * One screen. One dominant action. Calm. Fast. Premium.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useRef, useState, useCallback } from "react";
import { Link } from "wouter";
import {
  Loader2, ArrowRight, RefreshCw, ChevronRight,
  Check, Flame, AlertTriangle,
} from "lucide-react";

const REFRESH_INTERVAL = 30_000;

export default function ControlCenter() {
  const { user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: getLoginUrl() });
  const [systemOpen, setSystemOpen] = useState(false);

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

  const refetchAll = useCallback(() => {
    overview.refetch();
    brief.refetch();
  }, [overview, brief]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-white/20" />
      </div>
    );
  }

  const o = overview.data;
  const b = brief.data;

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-[#FDB913]/20">

      {/* ─── Minimal Header ─── */}
      <header className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-md border-b border-white/[0.04]">
        <div className="max-w-lg mx-auto px-5 h-11 flex items-center justify-between">
          <SystemDots o={o} open={systemOpen} onToggle={() => setSystemOpen(!systemOpen)} />
          <div className="flex items-center gap-3">
            <button onClick={refetchAll} className="text-white/20 hover:text-white/50 transition-colors active:scale-95">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <Link href="/admin" className="text-[11px] text-white/20 hover:text-white/40 transition-colors flex items-center gap-0.5">
              Admin <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
        {/* System detail — slides open */}
        {systemOpen && o && (
          <div className="max-w-lg mx-auto px-5 pb-3 flex items-center gap-4 text-[10px] text-white/25 font-mono animate-in fade-in slide-in-from-top-1 duration-200">
            <span>AI {o.aiGateway.ollamaHealthy ? "local" : "cloud"}</span>
            <span>DB {o.systemHealth.dbStatus}</span>
            <span>{o.systemHealth.tunnelMode !== "none" ? "tunnel ok" : "local"}</span>
            <span className="ml-auto">{o.systemHealth.env?.toUpperCase()}</span>
          </div>
        )}
      </header>

      <main className="max-w-lg mx-auto px-5 pt-8 pb-16">

        {/* ═══ LAYER 1: THE DOMINANT CENTER ═══ */}

        {/* Greeting — the biggest text on screen */}
        <div className="mb-8">
          {b?.timeContext ? (
            <h1 className="text-[22px] font-semibold text-white/90 leading-tight tracking-tight">
              {b.timeContext.greeting}
            </h1>
          ) : (
            <div className="h-7 w-48 bg-white/[0.03] rounded animate-pulse" />
          )}
          {b?.timeContext && b.timeContext.hoursLeft > 0 && (
            <p className="text-xs text-white/20 mt-1.5 font-mono tabular-nums">{b.timeContext.hoursLeft}h left today</p>
          )}
        </div>

        {/* Drift — only when off track, calm not aggressive */}
        {b?.driftIndicator?.status === "off_track" && (
          <div className="mb-6 flex items-start gap-2.5 px-0.5">
            <AlertTriangle className="w-4 h-4 text-red-400/80 shrink-0 mt-0.5" />
            <p className="text-sm text-red-400/70 leading-relaxed">
              {b.driftIndicator.signals.join(". ")}.
            </p>
          </div>
        )}

        {/* Next Action — the one thing */}
        <NextAction brief={b} loading={!b} />

        {/* Mission — inline, not carded */}
        <MissionBlock brief={b} loading={!b} setMission={setMissionMut} />

        {/* ═══ LAYER 2: THE CHECKLIST ═══ */}

        <HabitsBlock brief={b} loading={!b} toggleHabit={toggleHabit} />

        {/* ═══ LAYER 3: THE SECONDARY ═══ */}

        <RevenueBlock brief={b} loading={!b} />

        {/* Today — single compact line */}
        {o && (
          <div className="mt-10 flex items-center justify-between text-xs text-white/20 font-mono tabular-nums px-0.5">
            <span>{o.todayStats.leadsToday} leads</span>
            <span className="text-white/8">·</span>
            <span>{o.todayStats.quotesToday} quoted</span>
            <span className="text-white/8">·</span>
            <span>{o.todayStats.bookingsToday} booked</span>
            <span className="text-white/8">·</span>
            <span className={o.todayStats.callbacksPending > 0 ? "text-amber-400/50" : ""}>{o.todayStats.callbacksPending} calls</span>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── System Dots (header) ──────────────────────────

function SystemDots({ o, open, onToggle }: { o: any; open: boolean; onToggle: () => void }) {
  if (!o) return <div className="w-12" />;

  const allGood = o.aiGateway.ollamaHealthy && o.systemHealth.dbStatus === "connected";

  return (
    <button onClick={onToggle} className="flex items-center gap-1.5 group py-1">
      <span className={`w-1.5 h-1.5 rounded-full transition-colors ${allGood ? "bg-emerald-500/60" : "bg-amber-400/60"}`} />
      {!allGood && (
        <span className="text-[10px] text-white/25 group-hover:text-white/40 transition-colors">
          {o.aiGateway.ollamaHealthy ? "" : "AI fallback"}
          {o.systemHealth.dbStatus !== "connected" ? " DB issue" : ""}
        </span>
      )}
    </button>
  );
}

// ─── Next Action ──────────────────────────

function NextAction({ brief, loading }: { brief: any; loading: boolean }) {
  if (loading) {
    return <div className="h-16 bg-white/[0.02] rounded-2xl animate-pulse mb-6" />;
  }

  const action = brief?.topAction;

  if (!action) {
    return (
      <div className="mb-6 py-4 text-center">
        <p className="text-sm text-emerald-400/60">Nothing urgent. Execute your mission.</p>
      </div>
    );
  }

  return (
    <Link href={action.action || "/admin#leads"}>
      <div className="mb-6 group cursor-pointer bg-[#FDB913]/[0.06] hover:bg-[#FDB913]/[0.10] rounded-2xl px-5 py-4 transition-all duration-200 active:scale-[0.99]">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[15px] font-medium text-white/90 leading-snug">{action.message}</p>
          <ArrowRight className="w-4 h-4 text-[#FDB913]/60 group-hover:text-[#FDB913] group-hover:translate-x-0.5 transition-all shrink-0" />
        </div>
      </div>
    </Link>
  );
}

// ─── Mission ──────────────────────────

function MissionBlock({ brief, loading, setMission }: { brief: any; loading: boolean; setMission: any }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const mission = brief?.execution?.mission || "";
  const score = brief?.execution?.completionScore ?? 0;
  const streak = brief?.execution?.streak ?? 0;

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

  if (loading) return null;

  return (
    <div className="mb-10 px-0.5">
      {/* Mission text — large, tappable */}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => e.key === "Enter" && save()}
          className="w-full bg-transparent text-lg text-white/90 outline-none border-b border-[#FDB913]/20 pb-1 font-light"
          placeholder="What's today's mission?"
        />
      ) : (
        <p
          onClick={startEdit}
          className={`text-lg font-light leading-relaxed cursor-pointer transition-colors ${
            mission ? "text-white/50 hover:text-white/70" : "text-white/15 hover:text-white/30"
          }`}
        >
          {mission || "Tap to set today's mission..."}
        </p>
      )}

      {/* Score + Streak — subtle, inline */}
      <div className="flex items-center gap-3 mt-3">
        {/* Thin progress line */}
        <div className="flex-1 h-[2px] bg-white/[0.04] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#FDB913]/40 rounded-full transition-all duration-500"
            style={{ width: `${score}%` }}
          />
        </div>
        <span className="text-[11px] text-white/20 font-mono tabular-nums">{score}%</span>
        {streak > 0 && (
          <span className="text-[11px] text-white/20 flex items-center gap-0.5">
            <Flame className="w-3 h-3 text-orange-400/50" />{streak}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Habits ──────────────────────────

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

  if (!habits.length) return null;

  return (
    <div className="mb-8 space-y-0.5">
      {habits.map(({ key, label, completed }) => {
        const checked = optimistic[key] ?? completed;
        return (
          <button
            key={key}
            onClick={() => !loading && toggle(key, checked)}
            className="w-full flex items-center gap-3.5 py-3 px-0.5 group active:scale-[0.995] transition-transform"
            disabled={loading}
          >
            <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-all duration-200 ${
              checked
                ? "bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.15)]"
                : "border border-white/10 group-hover:border-white/20"
            }`}>
              {checked && <Check className="w-3.5 h-3.5 text-white" />}
            </div>
            <span className={`text-[15px] transition-all duration-200 ${
              checked ? "text-white/20 line-through" : "text-white/70 group-hover:text-white/90"
            }`}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Revenue ──────────────────────────

function RevenueBlock({ brief, loading }: { brief: any; loading: boolean }) {
  const rev = brief?.revenueWaiting;
  if (loading || !rev) return null;

  const { staleLeadsCount, staleQuotesCount, pendingCallbacks } = rev;
  const total = staleLeadsCount + staleQuotesCount + pendingCallbacks;
  if (!total) return null;

  return (
    <Link href="/admin#leads">
      <div className="group cursor-pointer border-t border-white/[0.04] pt-6 mt-2 flex items-center justify-between active:scale-[0.99] transition-transform">
        <div>
          <p className="text-sm text-white/40 group-hover:text-white/60 transition-colors">
            <strong className="text-white/70 font-medium">{total}</strong> waiting on you
          </p>
          <p className="text-[11px] text-white/15 mt-0.5">
            {[
              staleLeadsCount > 0 && `${staleLeadsCount} cold`,
              staleQuotesCount > 0 && `${staleQuotesCount} stale`,
              pendingCallbacks > 0 && `${pendingCallbacks} callbacks`,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ArrowRight className="w-4 h-4 text-white/10 group-hover:text-white/30 group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}
