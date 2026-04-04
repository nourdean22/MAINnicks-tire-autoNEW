/**
 * NOUR OS Command Center — unified operator dashboard.
 * Combines: Execution, Drift, Strategy, Tasks, Decisions, Commitments, Loops.
 * Single tab. No fluff.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Target, Flame, AlertTriangle, CheckCircle2, Circle, Clock, Plus,
  Trash2, ChevronDown, ChevronUp, Zap, Brain, Shield, RotateCcw,
  ArrowRight, TrendingUp, XCircle, Loader2, Sparkles, Timer,
  CheckSquare, Square, Edit3, Save, X,
  DollarSign, Users, UserPlus, Receipt, Wrench, Car, FileText, CreditCard,
  ExternalLink, Hash, Search, BarChart3, Radio, Activity, Wifi, Globe,
} from "lucide-react";

// ─── LOCAL STORAGE HELPERS (tasks, decisions, commitments, loops) ───
type Task = { id: string; text: string; done: boolean; priority: "high" | "normal" | "low"; createdAt: number };
type Decision = { id: string; question: string; answer: string; date: string; category: string };
type Commitment = { id: string; text: string; deadline: string; status: "active" | "done" | "broken" };
type Loop = { id: string; name: string; frequency: "daily" | "weekly"; lastDone: string | null; streak: number };

function getLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`nouros_${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function setLS<T>(key: string, value: T) {
  localStorage.setItem(`nouros_${key}`, JSON.stringify(value));
}

const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const uid = () => Math.random().toString(36).slice(2, 10);

// ─── STATUS COLORS ───────────────────────────────────────
const STATUS_STYLES = {
  on_track: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", label: "ON TRACK", icon: CheckCircle2 },
  focused: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", label: "FOCUSED", icon: Target },
  drifting: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", label: "DRIFTING", icon: AlertTriangle },
  off_track: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", label: "OFF TRACK", icon: XCircle },
} as const;

const MODE_STYLES = {
  fire: { bg: "bg-red-500/15", text: "text-red-400", label: "FIRE", icon: Flame },
  recovery: { bg: "bg-orange-500/15", text: "text-orange-400", label: "RECOVERY", icon: RotateCcw },
  mvd: { bg: "bg-amber-500/15", text: "text-amber-400", label: "MINIMUM VIABLE DAY", icon: Shield },
  normal: { bg: "bg-blue-500/15", text: "text-blue-400", label: "NORMAL OPS", icon: Target },
  clear: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "CLEAR", icon: Sparkles },
} as const;

// ─── RING COMPONENT ──────────────────────────────────────
function ScoreRing({ score, size = 96, strokeWidth = 6 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke="oklch(0.20 0.005 260)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        className="transition-all duration-700 ease-out" />
    </svg>
  );
}

// ─── CARD WRAPPER ────────────────────────────────────────
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card/50 border border-border/40 rounded-lg p-4 ${className}`}>
      {children}
    </div>
  );
}

function SectionLabel({ icon: Icon, label }: { icon: React.ComponentType<any>; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-primary/60" />
      <span className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">{label}</span>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────
export default function CommandCenterSection() {
  const { data: brief, isLoading: briefLoading, refetch: refetchBrief } = trpc.controlCenter.getDailyBrief.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: yesterday } = trpc.controlCenter.getYesterday.useQuery();
  const { data: overview } = trpc.controlCenter.getOverview.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: stats } = trpc.adminDashboard.stats.useQuery(undefined, { refetchInterval: 60_000 });

  // ─── LOCAL STATE (must be before queries that reference them) ───
  const [laborSearch, setLaborSearch] = useState("");

  // ─── FINANCIAL / SHOP DATA ────────────────────────────
  const { data: kpis } = trpc.kpi.current.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: recentInvoices } = trpc.invoices.list.useQuery({ limit: 8 }, { refetchInterval: 60_000 });
  const { data: customerStats } = trpc.customers.stats.useQuery(undefined, { refetchInterval: 120_000 });
  const { data: laborStatus } = trpc.autoLabor.status.useQuery(undefined, { refetchInterval: 300_000 });
  const { data: laborResults } = trpc.autoLabor.searchJobs.useQuery(
    { query: laborSearch },
    { enabled: laborSearch.length >= 2 }
  );
  const { data: kpiHistory } = trpc.kpi.history.useQuery({ weeks: 4 }, { refetchInterval: 300_000 });

  // ─── BRIDGE & PIPELINE DATA ───────────────────────────
  const { data: bridgeStatus } = trpc.nourOsBridge.status.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: bridgeEvents } = trpc.nourOsBridge.recentEvents.useQuery({ limit: 10 }, { refetchInterval: 30_000 });
  const { data: pipelineDash } = trpc.pipelines.dashboard.useQuery(undefined, { refetchInterval: 120_000 });

  // ─── SHOP PULSE (real-time awareness) ─────────────────
  const { data: shopPulse } = trpc.nickActions.shopPulse.useQuery(undefined, { refetchInterval: 30_000 });

  // ─── REAL-TIME SSE (instant updates) ──────────────────
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/admin/events");
      es.onmessage = () => {
        // Any event = refetch shop pulse + brief
        refetchBrief();
      };
      es.addEventListener("lead_captured", () => { refetchBrief(); toast.info("New lead captured"); });
      es.addEventListener("tire_order_placed", () => { refetchBrief(); toast.info("New tire order"); });
      es.addEventListener("payment_received", () => { refetchBrief(); toast.success("Payment received"); });
      es.addEventListener("invoice_created", () => { refetchBrief(); });
      es.addEventListener("emergency_request", () => { refetchBrief(); toast.error("Emergency request!"); });
      es.onerror = () => { /* reconnect handled by EventSource */ };
    } catch {}
    return () => { es?.close(); };
  }, [refetchBrief]);

  // ─── CAMERAS ──────────────────────────────────────────
  const { data: cameras } = trpc.nickActions.cameras.useQuery(undefined, { refetchInterval: 300_000 });

  const toggleHabit = trpc.controlCenter.toggleHabit.useMutation({
    onSuccess: () => refetchBrief(),
  });
  const setMissionMut = trpc.controlCenter.setMission.useMutation({
    onSuccess: () => { refetchBrief(); toast.success("Mission locked in"); },
  });

  // ─── LOCAL STATE ───────────────────────────────────────
  const [tasks, setTasks] = useState<Task[]>(() => getLS("tasks", []));
  const [decisions, setDecisions] = useState<Decision[]>(() => getLS("decisions", []));
  const [commitments, setCommitments] = useState<Commitment[]>(() => getLS("commitments", []));
  const [loops, setLoops] = useState<Loop[]>(() => getLS("loops", []));

  const [missionDraft, setMissionDraft] = useState("");
  const [editingMission, setEditingMission] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newDecisionQ, setNewDecisionQ] = useState("");
  const [newDecisionA, setNewDecisionA] = useState("");
  const [newCommitment, setNewCommitment] = useState("");
  const [newCommitmentDeadline, setNewCommitmentDeadline] = useState("");
  const [newLoopName, setNewLoopName] = useState("");
  const [newLoopFreq, setNewLoopFreq] = useState<"daily" | "weekly">("daily");
  const [activePanel, setActivePanel] = useState<"tasks" | "decisions" | "commitments" | "loops">("tasks");

  // Nick AI command state
  const [nickCommand, setNickCommand] = useState("");
  const [nickHistory, setNickHistory] = useState<Array<{ role: "user" | "nick"; content: string; ts: number }>>(() => getLS("nick_history", []));
  const operatorCmd = trpc.nickActions.operatorCommand.useMutation({
    onSuccess: (data) => {
      setNickHistory(prev => {
        const next = [...prev, { role: "nick" as const, content: data.reply, ts: Date.now() }];
        setLS("nick_history", next.slice(-20));
        return next.slice(-20);
      });
    },
    onError: (err) => {
      toast.error(`Nick AI error: ${err.message}`);
    },
  });

  const sendNickCommand = useCallback(() => {
    if (!nickCommand.trim() || operatorCmd.isPending) return;
    const cmd = nickCommand.trim();
    setNickHistory(prev => {
      const next = [...prev, { role: "user" as const, content: cmd, ts: Date.now() }];
      setLS("nick_history", next.slice(-20));
      return next.slice(-20);
    });
    operatorCmd.mutate({ command: cmd });
    setNickCommand("");
  }, [nickCommand, operatorCmd]);

  // Persist to localStorage on change
  useEffect(() => { setLS("tasks", tasks); }, [tasks]);
  useEffect(() => { setLS("decisions", decisions); }, [decisions]);
  useEffect(() => { setLS("commitments", commitments); }, [commitments]);
  useEffect(() => { setLS("loops", loops); }, [loops]);

  // ─── TASK HANDLERS ─────────────────────────────────────
  const addTask = useCallback(() => {
    if (!newTask.trim()) return;
    setTasks(prev => [{ id: uid(), text: newTask.trim(), done: false, priority: "normal", createdAt: Date.now() }, ...prev]);
    setNewTask("");
  }, [newTask]);

  const toggleTask = useCallback((id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  // ─── DECISION HANDLERS ─────────────────────────────────
  const addDecision = useCallback(() => {
    if (!newDecisionQ.trim() || !newDecisionA.trim()) return;
    setDecisions(prev => [{
      id: uid(), question: newDecisionQ.trim(), answer: newDecisionA.trim(),
      date: todayStr(), category: "general",
    }, ...prev]);
    setNewDecisionQ(""); setNewDecisionA("");
  }, [newDecisionQ, newDecisionA]);

  // ─── COMMITMENT HANDLERS ───────────────────────────────
  const addCommitment = useCallback(() => {
    if (!newCommitment.trim()) return;
    setCommitments(prev => [{
      id: uid(), text: newCommitment.trim(),
      deadline: newCommitmentDeadline || "", status: "active",
    }, ...prev]);
    setNewCommitment(""); setNewCommitmentDeadline("");
  }, [newCommitment, newCommitmentDeadline]);

  const toggleCommitment = useCallback((id: string) => {
    setCommitments(prev => prev.map(c =>
      c.id === id ? { ...c, status: c.status === "done" ? "active" : "done" } : c
    ));
  }, []);

  // ─── LOOP HANDLERS ─────────────────────────────────────
  const addLoop = useCallback(() => {
    if (!newLoopName.trim()) return;
    setLoops(prev => [{ id: uid(), name: newLoopName.trim(), frequency: newLoopFreq, lastDone: null, streak: 0 }, ...prev]);
    setNewLoopName("");
  }, [newLoopName, newLoopFreq]);

  const checkInLoop = useCallback((id: string) => {
    const today = todayStr();
    setLoops(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (l.lastDone === today) return l; // already done today
      return { ...l, lastDone: today, streak: l.streak + 1 };
    }));
  }, []);

  // ─── COMPUTED ──────────────────────────────────────────
  const activeTasks = useMemo(() => tasks.filter(t => !t.done), [tasks]);
  const doneTasks = useMemo(() => tasks.filter(t => t.done), [tasks]);
  const activeCommitments = useMemo(() => commitments.filter(c => c.status === "active"), [commitments]);

  // ─── LOADING STATE ─────────────────────────────────────
  if (briefLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
      </div>
    );
  }

  const exec = brief?.execution;
  const drift = brief?.driftIndicator;
  const time = brief?.timeContext;
  const mode = brief?.mode ?? "normal";
  const bottleneck = brief?.bottleneck;
  const modeStyle = MODE_STYLES[mode as keyof typeof MODE_STYLES] || MODE_STYLES.normal;
  const ModeIcon = modeStyle.icon;
  const driftStyle = STATUS_STYLES[(drift?.status as keyof typeof STATUS_STYLES) ?? "focused"] || STATUS_STYLES.focused;
  const DriftIcon = driftStyle.icon;

  return (
    <div className="space-y-5">
      {/* ─── TOP BAR: Greeting + Mode + Time ─── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">
            {time?.greeting || "Loading..."}
          </h2>
          {time && (
            <p className="text-xs text-muted-foreground mt-1">
              {time.hoursLeft > 0 ? `${time.hoursLeft}h left today` : "Day complete"} · {time.period}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider ${modeStyle.bg} ${modeStyle.text}`}>
            <ModeIcon className="w-3 h-3" />
            {modeStyle.label}
          </div>
          {exec && (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider ${driftStyle.bg} ${driftStyle.text}`}>
              <DriftIcon className="w-3 h-3" />
              {driftStyle.label}
            </div>
          )}
        </div>
      </div>

      {/* ─── BOTTLENECK BANNER ─── */}
      {bottleneck && bottleneck.area !== "none" && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
          bottleneck.severity === "critical" ? "bg-red-500/10 border-red-500/30 text-red-400" :
          bottleneck.severity === "high" ? "bg-orange-500/10 border-orange-500/30 text-orange-400" :
          bottleneck.severity === "medium" ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
          "bg-blue-500/10 border-blue-500/30 text-blue-400"
        }`}>
          <Zap className="w-4 h-4 shrink-0" />
          <div>
            <span className="text-[10px] font-bold tracking-wider uppercase">{bottleneck.area}</span>
            <p className="text-sm font-medium">{bottleneck.message}</p>
          </div>
        </div>
      )}

      {/* ─── NICK AI COMMAND BAR ─── */}
      <Card className="!p-3 border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-primary" />
          </div>
          <span className="text-[10px] font-bold tracking-[0.15em] text-primary/80 uppercase">Nick AI</span>
          {operatorCmd.isPending && <Loader2 className="w-3 h-3 animate-spin text-primary/60 ml-1" />}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={nickCommand}
            onChange={(e) => setNickCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendNickCommand()}
            placeholder="Give Nick a command... (e.g. 'show me today's revenue' or 'draft a follow-up for stale leads')"
            className="flex-1 bg-background/80 border border-border/40 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/40"
          />
          <button
            onClick={sendNickCommand}
            disabled={operatorCmd.isPending || !nickCommand.trim()}
            className="px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground rounded-lg text-xs font-semibold tracking-wide flex items-center gap-1.5 transition-all"
          >
            <ArrowRight className="w-3.5 h-3.5" /> Execute
          </button>
        </div>
        {/* Nick AI response history */}
        {nickHistory.length > 0 && (
          <div className="mt-3 space-y-2 max-h-[250px] overflow-y-auto">
            {nickHistory.slice(-6).map((msg, i) => (
              <div key={i} className={`px-3 py-2 rounded-lg text-sm ${
                msg.role === "user"
                  ? "bg-primary/5 border border-primary/10 text-foreground/80"
                  : "bg-background/60 border border-border/30 text-foreground"
              }`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {msg.role === "user" ? (
                    <span className="text-[9px] font-bold tracking-wider text-primary/60">YOU</span>
                  ) : (
                    <span className="text-[9px] font-bold tracking-wider text-emerald-400/80">NICK AI</span>
                  )}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed text-[13px]">{msg.content}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ─── ROW 1: Execution Score + Mission + Habits ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Execution Score Ring */}
        <Card className="flex flex-col items-center justify-center py-6">
          <div className="relative">
            <ScoreRing score={exec?.completionScore ?? 0} size={120} strokeWidth={8} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold">{exec?.completionScore ?? 0}%</span>
              <span className="text-[10px] text-muted-foreground tracking-wide">EXECUTION</span>
            </div>
          </div>
          {exec && exec.streak > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
              <Flame className="w-3 h-3" />
              <span className="font-semibold">{exec.streak} day streak</span>
            </div>
          )}
          {yesterday && (
            <div className="mt-2 text-[10px] text-muted-foreground">
              Yesterday: {yesterday.score}% — {yesterday.status?.replace("_", " ")}
            </div>
          )}
        </Card>

        {/* Mission */}
        <Card>
          <SectionLabel icon={Target} label="Today's Mission" />
          {exec?.mission && !editingMission ? (
            <div>
              <p className="text-sm font-medium text-foreground leading-relaxed">{exec.mission}</p>
              <button onClick={() => { setEditingMission(true); setMissionDraft(exec.mission || ""); }}
                className="mt-3 text-[10px] text-primary/60 hover:text-primary flex items-center gap-1">
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={missionDraft}
                onChange={(e) => setMissionDraft(e.target.value)}
                placeholder="What's the ONE thing that makes today count?"
                className="w-full bg-background/50 border border-border/40 rounded px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:border-primary/40"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (missionDraft.trim()) {
                      setMissionMut.mutate({ mission: missionDraft.trim() });
                      setEditingMission(false);
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded text-xs font-medium"
                >
                  <Save className="w-3 h-3" /> Lock In
                </button>
                {editingMission && (
                  <button onClick={() => setEditingMission(false)}
                    className="flex items-center gap-1 px-3 py-1.5 text-muted-foreground hover:text-foreground text-xs">
                    <X className="w-3 h-3" /> Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Non-Negotiables */}
        <Card>
          <SectionLabel icon={Shield} label="Non-Negotiables" />
          <div className="space-y-2">
            {exec?.nonNegotiables.map((h) => (
              <button
                key={h.key}
                onClick={() => toggleHabit.mutate({ habitKey: h.key, completed: !h.completed })}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-left transition-all ${
                  h.completed
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-background/50 text-foreground/70 hover:bg-background/80"
                }`}
              >
                {h.completed ? <CheckSquare className="w-4 h-4 shrink-0" /> : <Square className="w-4 h-4 shrink-0" />}
                <span className={`text-sm ${h.completed ? "line-through opacity-60" : ""}`}>{h.label}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* ─── DRIFT SIGNALS ─── */}
      {drift && drift.signals.length > 0 && (
        <Card>
          <SectionLabel icon={AlertTriangle} label="Drift Signals" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {drift.signals.map((signal, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/20 rounded text-sm text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {signal}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── REVENUE WAITING ─── */}
      {brief?.revenueWaiting && (brief.revenueWaiting.staleLeadsCount > 0 || brief.revenueWaiting.pendingCallbacks > 0 || brief.revenueWaiting.staleQuotesCount > 0) && (
        <Card>
          <SectionLabel icon={TrendingUp} label="Revenue Waiting" />
          <div className="grid grid-cols-3 gap-3">
            {brief.revenueWaiting.staleLeadsCount > 0 && (
              <div className="text-center p-3 bg-red-500/5 border border-red-500/20 rounded">
                <div className="text-2xl font-bold text-red-400">{brief.revenueWaiting.staleLeadsCount}</div>
                <div className="text-[10px] text-muted-foreground tracking-wide mt-1">STALE LEADS</div>
              </div>
            )}
            {brief.revenueWaiting.pendingCallbacks > 0 && (
              <div className="text-center p-3 bg-orange-500/5 border border-orange-500/20 rounded">
                <div className="text-2xl font-bold text-orange-400">{brief.revenueWaiting.pendingCallbacks}</div>
                <div className="text-[10px] text-muted-foreground tracking-wide mt-1">CALLBACKS</div>
              </div>
            )}
            {brief.revenueWaiting.staleQuotesCount > 0 && (
              <div className="text-center p-3 bg-amber-500/5 border border-amber-500/20 rounded">
                <div className="text-2xl font-bold text-amber-400">{brief.revenueWaiting.staleQuotesCount}</div>
                <div className="text-[10px] text-muted-foreground tracking-wide mt-1">STALE QUOTES</div>
              </div>
            )}
          </div>
          {brief.revenueWaiting.topOpportunities.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <span className="text-[10px] text-muted-foreground tracking-wider">TOP OPPORTUNITIES</span>
              {brief.revenueWaiting.topOpportunities.slice(0, 3).map((opp) => (
                <div key={opp.id} className="flex items-center justify-between px-3 py-2 bg-background/50 rounded text-sm">
                  <div>
                    <span className="font-medium">{opp.name}</span>
                    <span className="text-muted-foreground ml-2">· {opp.service}</span>
                  </div>
                  <a href={`tel:${opp.phone}`} className="text-primary hover:underline text-xs">{opp.phone}</a>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ─── ROW 2: OPERATOR TOOLS (Tasks / Decisions / Commitments / Loops) ─── */}
      <Card>
        {/* Tab Bar */}
        <div className="flex gap-1 mb-4 border-b border-border/30 pb-2">
          {[
            { key: "tasks" as const, label: "Tasks", icon: CheckSquare, count: activeTasks.length },
            { key: "decisions" as const, label: "Decisions", icon: Brain, count: decisions.length },
            { key: "commitments" as const, label: "Commitments", icon: Shield, count: activeCommitments.length },
            { key: "loops" as const, label: "Loops", icon: RotateCcw, count: loops.length },
          ].map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActivePanel(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-t text-xs font-medium transition-all ${
                activePanel === key
                  ? "bg-primary/10 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {count > 0 && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                  activePanel === key ? "bg-primary/20 text-primary" : "bg-foreground/5 text-muted-foreground"
                }`}>{count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ─── TASKS PANEL ─── */}
        {activePanel === "tasks" && (
          <div>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTask()}
                placeholder="Add a task..."
                className="flex-1 bg-background/50 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
              />
              <button onClick={addTask}
                className="px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded text-xs font-medium">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {activeTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2 bg-background/50 rounded group">
                  <button onClick={() => toggleTask(t.id)} className="text-muted-foreground hover:text-emerald-400">
                    <Square className="w-4 h-4" />
                  </button>
                  <span className="flex-1 text-sm">{t.text}</span>
                  <button onClick={() => deleteTask(t.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {activeTasks.length === 0 && (
                <div className="text-center py-6 text-muted-foreground text-sm">No active tasks. Add one above.</div>
              )}
              {doneTasks.length > 0 && (
                <details className="mt-3">
                  <summary className="text-[10px] text-muted-foreground tracking-wider cursor-pointer hover:text-foreground">
                    COMPLETED ({doneTasks.length})
                  </summary>
                  <div className="space-y-1 mt-2">
                    {doneTasks.slice(0, 10).map((t) => (
                      <div key={t.id} className="flex items-center gap-3 px-3 py-1.5 rounded opacity-50">
                        <button onClick={() => toggleTask(t.id)} className="text-emerald-400">
                          <CheckSquare className="w-4 h-4" />
                        </button>
                        <span className="flex-1 text-sm line-through">{t.text}</span>
                        <button onClick={() => deleteTask(t.id)} className="text-muted-foreground hover:text-red-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        )}

        {/* ─── DECISIONS PANEL ─── */}
        {activePanel === "decisions" && (
          <div>
            <div className="space-y-2 mb-3">
              <input
                type="text"
                value={newDecisionQ}
                onChange={(e) => setNewDecisionQ(e.target.value)}
                placeholder="What was the decision?"
                className="w-full bg-background/50 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDecisionA}
                  onChange={(e) => setNewDecisionA(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addDecision()}
                  placeholder="The answer / reasoning..."
                  className="flex-1 bg-background/50 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
                />
                <button onClick={addDecision}
                  className="px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded text-xs font-medium">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {decisions.map((d) => (
                <div key={d.id} className="px-3 py-3 bg-background/50 border border-border/30 rounded">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{d.question}</p>
                      <p className="text-xs text-primary/80 mt-1">{d.answer}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">{d.date}</span>
                      <button onClick={() => setDecisions(prev => prev.filter(x => x.id !== d.id))}
                        className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {decisions.length === 0 && (
                <div className="text-center py-6 text-muted-foreground text-sm">No decisions logged. Record one above.</div>
              )}
            </div>
          </div>
        )}

        {/* ─── COMMITMENTS PANEL ─── */}
        {activePanel === "commitments" && (
          <div>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newCommitment}
                onChange={(e) => setNewCommitment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCommitment()}
                placeholder="I commit to..."
                className="flex-1 bg-background/50 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
              />
              <input
                type="date"
                value={newCommitmentDeadline}
                onChange={(e) => setNewCommitmentDeadline(e.target.value)}
                className="bg-background/50 border border-border/40 rounded px-2 py-2 text-xs text-muted-foreground focus:outline-none focus:border-primary/40"
              />
              <button onClick={addCommitment}
                className="px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded text-xs font-medium">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {commitments.map((c) => (
                <div key={c.id} className={`flex items-center gap-3 px-3 py-2 rounded ${
                  c.status === "done" ? "bg-emerald-500/5 opacity-60" : "bg-background/50"
                }`}>
                  <button onClick={() => toggleCommitment(c.id)}
                    className={c.status === "done" ? "text-emerald-400" : "text-muted-foreground hover:text-emerald-400"}>
                    {c.status === "done" ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>
                  <span className={`flex-1 text-sm ${c.status === "done" ? "line-through" : ""}`}>{c.text}</span>
                  {c.deadline && (
                    <span className="text-[10px] text-muted-foreground">{c.deadline}</span>
                  )}
                  <button onClick={() => setCommitments(prev => prev.filter(x => x.id !== c.id))}
                    className="text-muted-foreground hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {commitments.length === 0 && (
                <div className="text-center py-6 text-muted-foreground text-sm">No commitments. Make one above.</div>
              )}
            </div>
          </div>
        )}

        {/* ─── LOOPS PANEL ─── */}
        {activePanel === "loops" && (
          <div>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newLoopName}
                onChange={(e) => setNewLoopName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLoop()}
                placeholder="New recurring loop..."
                className="flex-1 bg-background/50 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary/40"
              />
              <select
                value={newLoopFreq}
                onChange={(e) => setNewLoopFreq(e.target.value as "daily" | "weekly")}
                className="bg-background/50 border border-border/40 rounded px-2 py-2 text-xs text-muted-foreground focus:outline-none"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
              <button onClick={addLoop}
                className="px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded text-xs font-medium">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {loops.map((l) => {
                const today = todayStr();
                const doneToday = l.lastDone === today;
                return (
                  <div key={l.id} className={`flex items-center gap-3 px-3 py-2.5 rounded ${
                    doneToday ? "bg-emerald-500/10" : "bg-background/50"
                  }`}>
                    <button onClick={() => checkInLoop(l.id)}
                      className={doneToday ? "text-emerald-400" : "text-muted-foreground hover:text-emerald-400"}>
                      {doneToday ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                    <div className="flex-1">
                      <span className="text-sm font-medium">{l.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-2">{l.frequency}</span>
                    </div>
                    {l.streak > 0 && (
                      <div className="flex items-center gap-1 text-xs text-amber-400">
                        <Flame className="w-3 h-3" />
                        <span className="font-semibold">{l.streak}</span>
                      </div>
                    )}
                    <button onClick={() => setLoops(prev => prev.filter(x => x.id !== l.id))}
                      className="text-muted-foreground hover:text-red-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              {loops.length === 0 && (
                <div className="text-center py-6 text-muted-foreground text-sm">No loops. Create a recurring habit above.</div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ─── SHOP PULSE (real-time) ─── */}
      {shopPulse && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider ${
              shopPulse.shopStatus === "busy" ? "bg-emerald-500/15 text-emerald-400" :
              shopPulse.shopStatus === "steady" ? "bg-blue-500/15 text-blue-400" :
              shopPulse.shopStatus === "slow" ? "bg-amber-500/15 text-amber-400" :
              "bg-foreground/5 text-muted-foreground"
            }`}>{shopPulse.shopStatus.toUpperCase()}</div>
            <span className="text-xs text-muted-foreground">{shopPulse.shopInsight}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "JOBS CLOSED", value: shopPulse.today.jobsClosed, color: "text-emerald-400", bg: "from-emerald-500/10" },
              { label: "WALKED", value: shopPulse.today.customersWalked, color: "text-red-400", bg: "from-red-500/10" },
              { label: "REVENUE", value: `$${shopPulse.today.revenue.toLocaleString()}`, color: "text-primary", bg: "from-primary/10" },
              { label: "AVG TICKET", value: `$${shopPulse.today.avgTicket}`, color: "text-blue-400", bg: "from-blue-500/10" },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`glow-on-hover bg-gradient-to-br ${bg} to-transparent border border-border/30 rounded-lg p-4`}>
                <div className={`text-3xl font-bold tracking-tight ${color}`}>{value}</div>
                <div className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground mt-1">{label}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { label: "DROP-OFFS", value: shopPulse.today.dropOffs },
              { label: "PENDING $", value: shopPulse.today.pendingPayments },
              { label: "CALLBACKS", value: shopPulse.today.callbacksWaiting },
              { label: "WEEK JOBS", value: shopPulse.thisWeek.jobsClosed },
              { label: "WEEK REV", value: `$${Math.round(shopPulse.thisWeek.revenue).toLocaleString()}` },
              { label: "WALK RATE", value: `${shopPulse.thisWeek.walkRate}%` },
            ].map(({ label, value }) => (
              <div key={label} className="px-3 py-2 bg-background/50 rounded text-center">
                <div className="text-sm font-bold text-foreground">{value}</div>
                <div className="text-[8px] tracking-wider text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── LIVE BUSINESS PULSE (fallback if no shop pulse) ─── */}
      {!shopPulse && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "LEADS TODAY", value: overview?.todayStats.leadsToday ?? 0, color: "text-blue-400", bg: "from-blue-500/10" },
            { label: "BOOKINGS TODAY", value: overview?.todayStats.bookingsToday ?? 0, color: "text-emerald-400", bg: "from-emerald-500/10" },
            { label: "CALLBACKS", value: overview?.todayStats.callbacksPending ?? 0, color: "text-orange-400", bg: "from-orange-500/10" },
            { label: "QUOTES PENDING", value: overview?.todayStats.quotesToday ?? 0, color: "text-purple-400", bg: "from-purple-500/10" },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`bg-gradient-to-br ${bg} to-transparent border border-border/30 rounded-lg p-4`}>
              <div className={`text-3xl font-bold tracking-tight ${color}`}>{value}</div>
              <div className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ─── FINANCIAL KPIs ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "MONTH REVENUE", value: kpis ? `$${(kpis.monthRevenue / 1000).toFixed(1)}k` : "—", color: "text-emerald-400", bg: "from-emerald-500/10", icon: DollarSign },
          { label: "AVG TICKET", value: kpis ? `$${kpis.avgTicket}` : "—", color: "text-blue-400", bg: "from-blue-500/10", icon: Receipt },
          { label: "CONVERSION", value: kpis ? `${kpis.conversionRate}%` : "—", color: "text-purple-400", bg: "from-purple-500/10", icon: TrendingUp },
          { label: "CUSTOMERS", value: customerStats ? customerStats.total.toLocaleString() : "—", color: "text-amber-400", bg: "from-amber-500/10", icon: Users },
          { label: "NEW THIS MONTH", value: kpis ? `${kpis.newCustomersThisMonth}` : "—", color: "text-cyan-400", bg: "from-cyan-500/10", icon: UserPlus },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className={`bg-gradient-to-br ${bg} to-transparent border border-border/30 rounded-lg p-4`}>
            <div className="flex items-center justify-between mb-2">
              <Icon className={`w-4 h-4 ${color} opacity-60`} />
            </div>
            <div className={`text-2xl font-bold tracking-tight ${color}`}>{value}</div>
            <div className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* ─── RECENT INVOICES + SHOP INTEGRATIONS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* WINS — Completed Jobs */}
        <Card className="lg:col-span-2">
          <SectionLabel icon={Receipt} label="Wins — Jobs Completed" />
          {recentInvoices && recentInvoices.items.length > 0 ? (
            <div className="space-y-1.5">
              {recentInvoices.items.slice(0, 6).map((inv: any) => (
                <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5 bg-background/50 rounded-lg group">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    inv.paymentStatus === "paid" ? "bg-emerald-400" :
                    inv.paymentStatus === "pending" ? "bg-amber-400" : "bg-red-400"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{inv.customerName}</span>
                      {inv.vehicleInfo && (
                        <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">{inv.vehicleInfo}</span>
                      )}
                    </div>
                    {inv.serviceDescription && (
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{inv.serviceDescription}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-foreground">${((inv.totalAmount ?? 0) / 100).toLocaleString()}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    </div>
                  </div>
                  <div className={`text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full ${
                    inv.paymentStatus === "paid" ? "bg-emerald-500/10 text-emerald-400" :
                    inv.paymentStatus === "pending" ? "bg-amber-500/10 text-amber-400" :
                    inv.paymentStatus === "partial" ? "bg-blue-500/10 text-blue-400" : "bg-red-500/10 text-red-400"
                  }`}>
                    {(inv.paymentStatus || "pending").toUpperCase()}
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2">
                <span className="text-[10px] text-muted-foreground">
                  <strong className="text-emerald-400">{recentInvoices.total}</strong> jobs won
                </span>
                {kpis && (
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>This month: <strong className="text-emerald-400">{kpis.completedThisMonth}</strong> completed</span>
                    <span>Reviews: <strong className="text-foreground">{kpis.reviewsSent}</strong> sent</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">No invoices found</div>
          )}
        </Card>

        {/* Shop Integrations / Auto Labor + Customer Breakdown */}
        <div className="space-y-4">
          {/* Auto Labor Guide */}
          <Card>
            <SectionLabel icon={Wrench} label="Auto Labor Guide" />
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${laborStatus?.connected ? "bg-emerald-400" : laborStatus?.usingFallback ? "bg-amber-400" : "bg-red-400"}`} />
                <span className="text-xs font-medium">
                  {laborStatus?.connected ? "ShopDriver Connected" : laborStatus?.usingFallback ? "Using Built-in Guide" : "Checking..."}
                </span>
              </div>
              {laborStatus && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="px-3 py-2 bg-background/50 rounded text-center">
                    <div className="text-lg font-bold text-foreground">{laborStatus.fallbackCategories}</div>
                    <div className="text-[9px] text-muted-foreground tracking-wider">CATEGORIES</div>
                  </div>
                  <div className="px-3 py-2 bg-background/50 rounded text-center">
                    <div className="text-lg font-bold text-foreground">{laborStatus.fallbackJobs}</div>
                    <div className="text-[9px] text-muted-foreground tracking-wider">JOBS</div>
                  </div>
                </div>
              )}
              {laborStatus?.totalLookups !== undefined && laborStatus.totalLookups > 0 && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                  <Hash className="w-3 h-3" />
                  {laborStatus.totalLookups} lookups this session
                </div>
              )}
              <a
                href="https://secure.autolaborexperts.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[10px] text-primary/60 hover:text-primary font-medium"
              >
                <ExternalLink className="w-3 h-3" /> Open ShopDriver Portal
              </a>
            </div>
          </Card>

          {/* Customer Breakdown */}
          <Card>
            <SectionLabel icon={Users} label="Customer Database" />
            {customerStats ? (
              <div className="space-y-2">
                {[
                  { label: "Total", value: customerStats.total, color: "text-foreground" },
                  { label: "Recent", value: customerStats.recent, color: "text-emerald-400" },
                  { label: "Lapsed", value: customerStats.lapsed, color: "text-amber-400" },
                  { label: "Commercial", value: customerStats.commercial, color: "text-blue-400" },
                  { label: "Has Email", value: customerStats.withEmail, color: "text-purple-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between px-3 py-1.5 bg-background/50 rounded">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className={`text-sm font-bold ${color}`}>{value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-xs">Loading...</div>
            )}
          </Card>
        </div>
      </div>

      {/* ─── QUICK LABOR LOOKUP + WEEKLY TRENDS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quick Labor Lookup */}
        <Card>
          <SectionLabel icon={Search} label="Quick Labor Lookup" />
          <input
            type="text"
            value={laborSearch}
            onChange={(e) => setLaborSearch(e.target.value)}
            placeholder="Search jobs... (e.g. brake pads, timing belt, oil change)"
            className="w-full bg-background/50 border border-border/40 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/40 mb-3"
          />
          {laborSearch.length >= 2 && laborResults && (
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
              {laborResults.results.length > 0 ? (
                laborResults.results.slice(0, 8).map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 bg-background/50 rounded">
                    <Wrench className="w-3.5 h-3.5 text-primary/40 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.job.name}</div>
                      <div className="text-[10px] text-muted-foreground">{r.categoryName}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-primary">{r.job.avgHours}h</div>
                      <div className="text-[9px] text-muted-foreground">{r.job.minHours}–{r.job.maxHours}h</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-muted-foreground text-xs">No jobs match "{laborSearch}"</div>
              )}
            </div>
          )}
          {laborSearch.length < 2 && (
            <div className="text-center py-6 text-muted-foreground text-xs">
              Type 2+ characters to search {laborStatus?.fallbackJobs ?? 60}+ jobs across {laborStatus?.fallbackCategories ?? 8} categories
            </div>
          )}
        </Card>

        {/* Weekly Performance Trends */}
        <Card>
          <SectionLabel icon={BarChart3} label="Weekly Performance" />
          {kpis ? (
            <div className="space-y-3">
              {/* This Week vs Month */}
              <div className="grid grid-cols-2 gap-3">
                <div className="px-3 py-3 bg-background/50 rounded-lg">
                  <div className="text-[10px] text-muted-foreground tracking-wider mb-1">THIS WEEK</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-bold text-foreground">{kpis.weekBookings}</span>
                    <span className="text-[10px] text-muted-foreground">drop-offs</span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-lg font-bold text-foreground">{kpis.weekLeads}</span>
                    <span className="text-[10px] text-muted-foreground">leads</span>
                  </div>
                </div>
                <div className="px-3 py-3 bg-background/50 rounded-lg">
                  <div className="text-[10px] text-muted-foreground tracking-wider mb-1">THIS MONTH</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-bold text-foreground">{kpis.monthBookings}</span>
                    <span className="text-[10px] text-muted-foreground">drop-offs</span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-lg font-bold text-foreground">{kpis.monthLeads}</span>
                    <span className="text-[10px] text-muted-foreground">leads</span>
                  </div>
                </div>
              </div>

              {/* Key Metrics */}
              <div className="space-y-2">
                {[
                  { label: "Completed This Week", value: kpis.completedThisWeek, total: kpis.weekBookings, color: "bg-emerald-400" },
                  { label: "Completed This Month", value: kpis.completedThisMonth, total: kpis.monthBookings, color: "bg-blue-400" },
                  { label: "Lead → Booking Rate", value: kpis.conversionRate, total: 100, color: "bg-purple-400" },
                ].map(({ label, value, total, color }) => (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                      <span className="text-xs font-bold">{value}{total === 100 ? "%" : `/${total}`}</span>
                    </div>
                    <div className="h-1.5 bg-foreground/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${color} rounded-full transition-all duration-500`}
                        style={{ width: `${total > 0 ? Math.min((value / total) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Emergency Jobs */}
              {kpis.emergencyThisWeek > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-red-400 font-medium">{kpis.emergencyThisWeek} emergency jobs this week</span>
                </div>
              )}

              {/* Review Performance */}
              {kpis.reviewsSent > 0 && (
                <div className="flex items-center justify-between px-3 py-2 bg-background/50 rounded text-xs">
                  <span className="text-muted-foreground">Reviews: {kpis.reviewsSent} sent</span>
                  <span className="font-bold text-foreground">
                    {kpis.reviewsClicked > 0 ? `${Math.round((kpis.reviewsClicked / kpis.reviewsSent) * 100)}% click rate` : "0 clicks yet"}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-xs">Loading KPIs...</div>
          )}
        </Card>
      </div>

      {/* ─── DROP-OFF QUEUE NOTE ─── */}
      <Card className="!py-3 !px-4 border-primary/10 bg-primary/5">
        <div className="flex items-center gap-3">
          <Car className="w-4 h-4 text-primary/60 shrink-0" />
          <div>
            <span className="text-xs font-semibold text-foreground">First Come First Serve</span>
            <span className="text-[11px] text-muted-foreground ml-2">Drop-offs encouraged — holds your place in line. No appointments needed.</span>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-lg font-bold text-primary">{kpis?.weekBookings ?? 0}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">DROP-OFFS/WK</div>
            </div>
          </div>
        </div>
      </Card>

      {/* ─── CAMERAS ─── */}
      {cameras && cameras.length > 0 && (
        <Card>
          <SectionLabel icon={Radio} label="Shop Cameras" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cameras.map((cam: any) => (
              <div key={cam.id} className="bg-background/50 rounded-lg overflow-hidden border border-border/30">
                <div className="aspect-video bg-black/50 flex items-center justify-center relative">
                  {cam.type === "mjpeg" || cam.type === "http" ? (
                    <img
                      src={cam.url}
                      alt={cam.name}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="text-muted-foreground text-xs text-center p-4">
                      <p className="font-medium">{cam.type.toUpperCase()} Stream</p>
                      <p className="mt-1 text-[10px]">Open in VLC: {cam.url}</p>
                    </div>
                  )}
                  <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 bg-black/70 rounded text-[9px] text-white/80">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    LIVE
                  </div>
                </div>
                <div className="px-3 py-2">
                  <div className="text-xs font-medium">{cam.name}</div>
                  {cam.location && <div className="text-[10px] text-muted-foreground">{cam.location}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── SYSTEM & BRIDGE STATUS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* System + Bridge Health */}
        <Card>
          <SectionLabel icon={Zap} label="System Health" />
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            {[
              { label: "Database", status: overview?.systemHealth.dbStatus ?? "unknown", ok: overview?.systemHealth.dbStatus === "connected" },
              { label: "AI Gateway", status: overview?.aiGateway.ollamaHealthy ? "Venice Active" : "Cloud", ok: true },
              { label: "Uptime", status: overview?.systemHealth.uptime ? `${Math.floor(overview.systemHealth.uptime / 3600)}h ${Math.floor((overview.systemHealth.uptime % 3600) / 60)}m` : "—", ok: true },
              { label: "AI Reqs (5m)", status: `${overview?.aiGateway.recentRequests ?? 0}`, ok: (overview?.aiGateway.fallbackRate ?? 0) < 50 },
            ].map(({ label, status, ok }) => (
              <div key={label} className="flex items-center gap-2.5 px-3 py-2 bg-background/50 rounded">
                <div className={`w-2 h-2 rounded-full shrink-0 ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
                <div>
                  <div className="text-[9px] text-muted-foreground tracking-wider">{label}</div>
                  <div className="text-xs font-medium">{status}</div>
                </div>
              </div>
            ))}
          </div>

          {/* NOUR OS Bridge */}
          <SectionLabel icon={Radio} label="NOUR OS Bridge" />
          {bridgeStatus ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="px-3 py-2 bg-background/50 rounded text-center">
                  <div className="text-lg font-bold text-emerald-400">{bridgeStatus.totalEventsLocal}</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider">LOCAL</div>
                </div>
                <div className="px-3 py-2 bg-background/50 rounded text-center">
                  <div className="text-lg font-bold text-blue-400">{bridgeStatus.totalEventsSent}</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider">CLOUD</div>
                </div>
                <div className="px-3 py-2 bg-background/50 rounded text-center">
                  <div className="text-lg font-bold text-foreground">{bridgeStatus.eventsInMemory}</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider">IN MEM</div>
                </div>
              </div>
              {bridgeStatus.lastSyncTime && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                  <Wifi className="w-3 h-3" />
                  Last sync: {new Date(bridgeStatus.lastSyncTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </div>
              )}
              {bridgeStatus.lastError && (
                <div className="text-[10px] text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  {bridgeStatus.lastError.slice(0, 60)}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-3 text-muted-foreground text-xs">Loading bridge status...</div>
          )}
        </Card>

        {/* Pipelines + Event Feed */}
        <Card>
          <SectionLabel icon={Activity} label="Pipelines & Events" />
          {/* Pipeline Status */}
          {pipelineDash && (
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${
                  pipelineDash.overallHealth === "healthy" ? "bg-emerald-400" :
                  pipelineDash.overallHealth === "degraded" ? "bg-amber-400" : "bg-red-400"
                }`} />
                <span className="text-[10px] font-bold tracking-wider text-muted-foreground">
                  {pipelineDash.overallHealth.toUpperCase()} · {pipelineDash.totalRunsToday} runs today
                </span>
              </div>
              {pipelineDash.pipelines.map((p: any, _pIdx: number) => (
                <div key={p.name} className="stagger-in flex items-center gap-3 px-3 py-2 bg-background/50 rounded" style={{ animationDelay: `${_pIdx * 60}ms` }}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    p.health === "healthy" ? "bg-emerald-400" :
                    p.health === "degraded" ? "bg-amber-400" :
                    p.health === "failing" ? "bg-red-400" : "bg-foreground/20"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">{p.displayName}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {p.lastRun ? new Date(p.lastRun.startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "never"}
                  </span>
                  <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${
                    p.health === "healthy" ? "bg-emerald-500/10 text-emerald-400" :
                    p.health === "never-run" ? "bg-foreground/5 text-muted-foreground" :
                    "bg-amber-500/10 text-amber-400"
                  }`}>{p.health.toUpperCase()}</span>
                </div>
              ))}
            </div>
          )}

          {/* Recent Bridge Events */}
          <div className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground uppercase mb-2">Recent Events</div>
          {bridgeEvents && bridgeEvents.length > 0 ? (
            <div className="space-y-1 max-h-[160px] overflow-y-auto">
              {bridgeEvents.slice(0, 8).map((evt: any, i: number) => (
                <div key={evt.eventId || i} className="stagger-in flex items-center gap-2 px-2.5 py-1.5 bg-background/30 rounded text-[11px]" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    evt.type.includes("booking") ? "bg-blue-400" :
                    evt.type.includes("lead") ? "bg-amber-400" :
                    evt.type.includes("invoice") ? "bg-emerald-400" :
                    evt.type.includes("callback") ? "bg-orange-400" :
                    evt.type.includes("emergency") ? "bg-red-400" : "bg-foreground/30"
                  }`} />
                  <span className="text-muted-foreground font-mono">{evt.type.replace("nickstire:", "")}</span>
                  <span className="flex-1" />
                  <span className="text-muted-foreground/60">
                    {new Date(evt.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-xs">No recent events</div>
          )}
        </Card>
      </div>
    </div>
  );
}
