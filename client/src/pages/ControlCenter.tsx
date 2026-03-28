/**
 * Control Center — Tesla Governor Mode.
 * Calm. Decisive. Revenue-first. Action-forcing. Anti-drift.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useRef, useState, useCallback, useEffect } from "react";
import { Link } from "wouter";
import {
  Loader2, ArrowRight, RefreshCw, ChevronRight, ChevronDown,
  Check, Flame, AlertTriangle, Clock, Phone, DollarSign,
  Command, X,
} from "lucide-react";

const REFRESH_INTERVAL = 30_000;

// ─── Types ──────────────────────────
type ActionItem = { type: string; message: string; action: string; priority?: string };

export default function ControlCenter() {
  const { user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: getLoginUrl() });
  const [systemOpen, setSystemOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

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

  // ─── Derive fire items from urgent items ───
  const urgentItems: ActionItem[] = o?.urgentItems ?? [];
  const fireItems = urgentItems.filter(i => i.priority === "high");
  const isOnFire = fireItems.length > 0;

  // ─── Build action queue (fire items first, then top action, then medium urgents) ───
  const actionQueue: ActionItem[] = [];
  const seen = new Set<string>();

  for (const item of fireItems) {
    const key = `${item.type}:${item.message}`;
    if (!dismissed.has(key) && !seen.has(key)) {
      actionQueue.push(item);
      seen.add(key);
    }
  }

  if (b?.topAction) {
    const key = `${b.topAction.type}:${b.topAction.message}`;
    if (!dismissed.has(key) && !seen.has(key)) {
      actionQueue.push(b.topAction);
      seen.add(key);
    }
  }

  for (const item of urgentItems.filter(i => i.priority === "medium")) {
    const key = `${item.type}:${item.message}`;
    if (!dismissed.has(key) && !seen.has(key)) {
      actionQueue.push(item);
      seen.add(key);
    }
  }

  const currentAction = actionQueue[0] ?? null;
  const queueDepth = actionQueue.length;

  const dismissAction = (item: ActionItem) => {
    setDismissed(prev => new Set(prev).add(`${item.type}:${item.message}`));
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-[#FDB913]/20">

      {/* ─── Header ─── */}
      <header className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-md border-b border-white/[0.04]">
        <div className="max-w-lg mx-auto px-5 h-11 flex items-center justify-between">
          <SystemDots o={o} open={systemOpen} onToggle={() => setSystemOpen(!systemOpen)} isOnFire={isOnFire} />
          <div className="flex items-center gap-3">
            <button onClick={() => setCommandOpen(true)} className="text-white/20 hover:text-white/50 transition-colors active:scale-95">
              <Command className="w-3.5 h-3.5" />
            </button>
            <button onClick={refetchAll} className="text-white/20 hover:text-white/50 transition-colors active:scale-95">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <Link href="/admin" className="text-[11px] text-white/20 hover:text-white/40 transition-colors flex items-center gap-0.5">
              Admin <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
        {systemOpen && o && <TruthSheet o={o} />}
      </header>

      <main className="max-w-lg mx-auto px-5 pt-8 pb-16">

        {/* ═══ FIRE MODE ═══ */}
        {isOnFire && (
          <div className="mb-6 border-l-2 border-red-500/40 pl-4">
            <p className="text-[10px] font-semibold tracking-wider text-red-400/60 uppercase mb-1">
              {fireItems.length} critical
            </p>
            {fireItems.slice(0, 3).map((item, i) => (
              <p key={i} className="text-sm text-red-300/70 leading-relaxed">
                {item.message}
              </p>
            ))}
          </div>
        )}

        {/* ═══ MODE BANNER ═══ */}
        {b?.mode === "recovery" && (
          <div className="mb-4 py-2 px-3 rounded-lg bg-amber-500/[0.06] border border-amber-500/10">
            <p className="text-[11px] text-amber-400/70 font-medium">Recovery mode — too many things overdue. Triage. Close the biggest fires first.</p>
          </div>
        )}
        {b?.mode === "mvd" && (
          <div className="mb-4 py-2 px-3 rounded-lg bg-blue-500/[0.06] border border-blue-500/10">
            <p className="text-[11px] text-blue-400/60 font-medium">Minimum viable day — non-negotiables + one business action. Protect the streak.</p>
          </div>
        )}

        {/* ═══ GREETING ═══ */}
        <div className="mb-6">
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

        {/* ═══ NEXT ACTION LOOP ═══ */}
        <ActionLoop
          current={currentAction}
          queueDepth={queueDepth}
          onDismiss={dismissAction}
          loading={!b}
        />

        {/* ═══ MISSION ═══ */}
        <MissionBlock brief={b} loading={!b} setMission={setMissionMut} />

        {/* ═══ NON-NEGOTIABLES ═══ */}
        <HabitsBlock brief={b} loading={!b} toggleHabit={toggleHabit} />

        {/* ═══ REVENUE NOW (hidden in MVD mode — focus on basics) ═══ */}
        {b?.mode !== "mvd" && <RevenueQueue brief={b} loading={!b} />}

        {/* ═══ DRIFT WHISPER ═══ */}
        {b?.driftIndicator?.status !== "focused" && b?.driftIndicator?.signals?.length > 0 && (
          <div className="mt-8 flex items-start gap-2.5 px-0.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400/40 shrink-0 mt-0.5" />
            <p className="text-xs text-white/25 leading-relaxed">
              {b.driftIndicator.signals.join(". ")}.
            </p>
          </div>
        )}

        {/* ═══ TODAY FOOTER ═══ */}
        {o && (
          <div className="mt-10 flex items-center justify-between text-xs text-white/15 font-mono tabular-nums px-0.5">
            <span>{o.todayStats.leadsToday} leads</span>
            <span className="text-white/6">·</span>
            <span>{o.todayStats.quotesToday} quoted</span>
            <span className="text-white/6">·</span>
            <span>{o.todayStats.bookingsToday} booked</span>
            <span className="text-white/6">·</span>
            <span className={o.todayStats.callbacksPending > 0 ? "text-amber-400/40" : ""}>{o.todayStats.callbacksPending} calls</span>
          </div>
        )}
      </main>

      {/* ═══ COMMAND PALETTE ═══ */}
      {commandOpen && (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          setMission={setMissionMut}
          refetch={refetchAll}
        />
      )}
    </div>
  );
}

// ─── System Dots + Truth Sheet ──────────────────────────

function SystemDots({ o, open, onToggle, isOnFire }: { o: any; open: boolean; onToggle: () => void; isOnFire: boolean }) {
  if (!o) return <div className="w-12" />;

  const allGood = o.aiGateway.ollamaHealthy && o.systemHealth.dbStatus === "connected";

  return (
    <button onClick={onToggle} className="flex items-center gap-1.5 group py-1">
      <span className={`w-1.5 h-1.5 rounded-full transition-colors ${
        isOnFire ? "bg-red-500/80 animate-pulse" : allGood ? "bg-emerald-500/50" : "bg-amber-400/60"
      }`} />
      {!allGood && !isOnFire && (
        <span className="text-[10px] text-white/20 group-hover:text-white/35 transition-colors">
          {!o.aiGateway.ollamaHealthy && "cloud"}
          {o.systemHealth.dbStatus !== "connected" && " db"}
        </span>
      )}
    </button>
  );
}

function TruthSheet({ o }: { o: any }) {
  return (
    <div className="max-w-lg mx-auto px-5 pb-3 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="flex items-center gap-4 text-[10px] text-white/25 font-mono">
        <TruthItem label="AI" value={o.aiGateway.ollamaHealthy ? "local" : "cloud fallback"} ok={o.aiGateway.ollamaHealthy} />
        <TruthItem label="DB" value={o.systemHealth.dbStatus} ok={o.systemHealth.dbStatus === "connected"} />
        <TruthItem label="Net" value={o.systemHealth.tunnelMode !== "none" ? "remote" : "local only"} ok={o.systemHealth.tunnelMode !== "none"} />
        <span className="ml-auto text-white/15">{o.systemHealth.env?.toUpperCase()}</span>
      </div>
    </div>
  );
}

function TruthItem({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-1 h-1 rounded-full ${ok ? "bg-emerald-500/50" : "bg-amber-400/50"}`} />
      <span className="text-white/30">{label}</span>
      <span className={ok ? "text-white/20" : "text-amber-400/40"}>{value}</span>
    </span>
  );
}

// ─── Action Loop ──────────────────────────

function ActionLoop({ current, queueDepth, onDismiss, loading }: {
  current: ActionItem | null;
  queueDepth: number;
  onDismiss: (item: ActionItem) => void;
  loading: boolean;
}) {
  if (loading) {
    return <div className="h-16 bg-white/[0.02] rounded-2xl animate-pulse mb-6" />;
  }

  if (!current) {
    return (
      <div className="mb-6 py-4 text-center">
        <p className="text-sm text-emerald-400/50">Clear. Execute your mission.</p>
      </div>
    );
  }

  const isFire = current.priority === "high";

  return (
    <div className="mb-6">
      <Link href={current.action || "/admin#leads"}>
        <div className={`group cursor-pointer rounded-2xl px-5 py-4 transition-all duration-200 active:scale-[0.99] ${
          isFire
            ? "bg-red-500/[0.06] hover:bg-red-500/[0.10]"
            : "bg-[#FDB913]/[0.06] hover:bg-[#FDB913]/[0.10]"
        }`}>
          <div className="flex items-center justify-between gap-4">
            <p className="text-[15px] font-medium text-white/90 leading-snug">{current.message}</p>
            <ArrowRight className={`w-4 h-4 shrink-0 group-hover:translate-x-0.5 transition-all ${
              isFire ? "text-red-400/60 group-hover:text-red-400" : "text-[#FDB913]/60 group-hover:text-[#FDB913]"
            }`} />
          </div>
        </div>
      </Link>
      {/* Loop controls */}
      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[10px] text-white/15 font-mono">
          {queueDepth > 1 ? `${queueDepth - 1} more` : "last item"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDismiss(current)}
            className="text-[10px] text-white/20 hover:text-white/40 transition-colors px-2 py-0.5 rounded hover:bg-white/[0.03]"
          >
            done
          </button>
          <button
            onClick={() => onDismiss(current)}
            className="text-[10px] text-white/20 hover:text-white/40 transition-colors px-2 py-0.5 rounded hover:bg-white/[0.03]"
          >
            skip
          </button>
        </div>
      </div>
    </div>
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

  // If no mission set, make it prominent
  if (!mission && !editing) {
    return (
      <div className="mb-10 px-0.5">
        <button
          onClick={startEdit}
          className="w-full text-left py-3 px-4 rounded-xl border border-dashed border-[#FDB913]/15 hover:border-[#FDB913]/30 transition-colors group"
        >
          <p className="text-sm text-[#FDB913]/40 group-hover:text-[#FDB913]/60 transition-colors">
            Set today's mission
          </p>
        </button>
      </div>
    );
  }

  return (
    <div className="mb-10 px-0.5">
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
          className="text-lg font-light leading-relaxed cursor-pointer text-white/50 hover:text-white/70 transition-colors"
        >
          {mission}
        </p>
      )}

      <div className="flex items-center gap-3 mt-3">
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

// ─── Revenue Queue ──────────────────────────

function RevenueQueue({ brief, loading }: { brief: any; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rev = brief?.revenueWaiting;
  if (loading || !rev) return null;

  const { staleLeadsCount, staleQuotesCount, pendingCallbacks, topOpportunities } = rev;
  const total = staleLeadsCount + staleQuotesCount + pendingCallbacks;
  if (!total) return null;

  const opps = (topOpportunities ?? []).slice(0, 3);

  return (
    <div className="border-t border-white/[0.04] pt-5 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5 text-[#FDB913]/30" />
          <p className="text-sm text-white/40 group-hover:text-white/60 transition-colors">
            <strong className="text-white/70 font-medium">{total}</strong> waiting on you
          </p>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-white/15 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Summary chips */}
      <div className="flex items-center gap-3 mt-2 text-[11px] text-white/20">
        {staleLeadsCount > 0 && <span>{staleLeadsCount} cold leads</span>}
        {staleQuotesCount > 0 && <span>{staleQuotesCount} stale quotes</span>}
        {pendingCallbacks > 0 && (
          <span className="flex items-center gap-0.5 text-amber-400/40">
            <Phone className="w-3 h-3" /> {pendingCallbacks}
          </span>
        )}
      </div>

      {/* Expanded: Top opportunities */}
      {expanded && opps.length > 0 && (
        <div className="mt-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {opps.map((opp: any, i: number) => {
            const ageDays = Math.floor((Date.now() - new Date(opp.createdAt).getTime()) / 86400000);
            return (
              <Link key={opp.id ?? i} href="/admin#leads">
                <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.02] transition-colors group cursor-pointer">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white/60 group-hover:text-white/80 truncate transition-colors">{opp.name}</p>
                    <p className="text-[11px] text-white/20">{opp.service}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className={`text-[11px] font-mono tabular-nums ${ageDays > 2 ? "text-red-400/60" : "text-white/25"}`}>
                      {ageDays}d
                    </span>
                    <ArrowRight className="w-3 h-3 text-white/10 group-hover:text-white/30 transition-colors" />
                  </div>
                </div>
              </Link>
            );
          })}
          {total > 3 && (
            <Link href="/admin#leads">
              <p className="text-[11px] text-white/20 hover:text-white/40 transition-colors text-center py-1">
                View all {total} →
              </p>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Command Palette ──────────────────────────

function CommandPalette({ onClose, setMission, refetch }: { onClose: () => void; setMission: any; refetch: () => void }) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const execute = () => {
    const cmd = input.trim().toLowerCase();
    if (!cmd) return;

    if (cmd.startsWith("mission ") || cmd.startsWith("set mission ")) {
      const text = input.replace(/^(set )?mission /i, "").trim();
      if (text) setMission.mutate({ mission: text });
      onClose();
      return;
    }

    // Quick navigation commands
    const routes: Record<string, string> = {
      leads: "/admin#leads",
      bookings: "/admin#bookings",
      callbacks: "/admin#bookings",
      sms: "/admin#sms",
      chat: "/admin#chats",
      health: "/admin#health",
      admin: "/admin",
    };

    for (const [key, route] of Object.entries(routes)) {
      if (cmd.includes(key)) {
        window.location.href = route;
        onClose();
        return;
      }
    }

    if (cmd === "refresh" || cmd === "reload") {
      refetch();
      onClose();
      return;
    }

    // Default: set as mission
    setMission.mutate({ mission: input.trim() });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div
        className="w-full max-w-md mx-4 bg-[#0A0A0A] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04]">
          <Command className="w-4 h-4 text-white/20" />
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") execute(); }}
            className="flex-1 bg-transparent text-sm text-white/90 outline-none placeholder:text-white/20"
            placeholder="mission, leads, callbacks, refresh..."
          />
          <button onClick={onClose} className="text-white/20 hover:text-white/40">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-2 text-[10px] text-white/15 flex gap-4">
          <span>mission [text]</span>
          <span>leads</span>
          <span>callbacks</span>
          <span>refresh</span>
        </div>
      </div>
    </div>
  );
}
