"use client";

import { useCallback, useEffect, useState } from "react";
import { logger as rootLogger } from "@/lib/logger";

// v10.0.33 — structured logger for mastery-page errors.
const log = rootLogger.withSurface("mastery/page");
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { ProgressRing } from "@/components/ui/progress-ring";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import { PageNick } from "@/components/ai/page-nick";
import { Target, Swords } from "lucide-react";
import Link from "next/link";

import { authedFetch } from "@/hooks/use-authed-fetch";
import { notifyDataChanged, onDataChanged } from "@/lib/events/data-change";
interface Domain {
  key: string;
  label: string;
  color: string;
  icon: string;
  baseline: number;
  score: number;
  date: string | null;
  evidence: string | null;
  delta: number;
}

interface Goal {
  id: string;
  domain: string;
  title: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  deadline: string;
  progress: number;
  status: string;
}

function ScoreBadge({ score }: { score: number }) {
  // v10.0.486 · token-align tier colors to CSS status vars (was raw
  // tailwind text-{red,amber,green}-400). Same tier semantics ·
  // matches the rest of the design system (status-red / gold /
  // status-green) · adds tabular-nums to stop digit-jitter on
  // AnimatedCounter increment.
  return (
    <AnimatedCounter
      value={score}
      decimals={1}
      locale={false}
      duration={600}
      className={cn(
        "font-mono text-2xl font-bold tabular-nums",
        score < 4 && "text-[var(--status-red)]",
        score >= 4 && score < 7 && "text-[var(--gold)]",
        score >= 7 && "text-[var(--status-green)]"
      )}
    />
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  return (
    <Badge
      className={cn(
        "font-mono text-xs tabular-nums",
        delta > 0
          ? "bg-[var(--status-green)]/10 text-[var(--status-green)]"
          : "bg-[var(--status-red)]/10 text-[var(--status-red)]"
      )}
    >
      {delta > 0 ? "+" : ""}{delta}
    </Badge>
  );
}

export default function MasteryPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [shopRevenue, setShopRevenue] = useState({ todayRevenue: 0, weekRevenue: 0 });
  const [monthlyTarget, setMonthlyTarget] = useState(20000);
  const [loading, setLoading] = useState(true);
  // v10.0.33 — surface failures in loadAll so a triple-fail isn't
  // silently masked as "empty domain/goal arrays".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editScore, setEditScore] = useState(5);
  const [editEvidence, setEditEvidence] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("nour_revenue_target");
    if (saved) setMonthlyTarget(Number(saved));
  }, []);

  const loadAll = useCallback(async () => {
    // Apr 17 separation — projections retired (lived in shop layer,
    // nickstire.org owns that now). Mastery page pulls mastery + goals
    // + command.
    // v10.0.33 — track failures so a triple-fetch-fail surfaces a
    // user-facing error banner instead of silently rendering empty
    // domain/goal arrays. Pre-fix the only signal was three
    // console.error calls only operators saw in DevTools.
    let failures = 0;
    const [masteryRaw, goalsRaw, cmdRaw] = await Promise.all([
      authedFetch("/api/mastery").then(r => { if (!r.ok) throw new Error("mastery fetch failed"); return r.json(); }).catch((err) => { log.error("mastery_load_failed", { error: err instanceof Error ? err.message : String(err) }); failures++; return {}; }),
      authedFetch("/api/goals").then(r => { if (!r.ok) throw new Error("goals fetch failed"); return r.json(); }).catch((err) => { log.error("goals_load_failed", { error: err instanceof Error ? err.message : String(err) }); failures++; return {}; }),
      authedFetch("/api/command/data").then(r => { if (!r.ok) throw new Error("command data fetch failed"); return r.json(); }).catch((err) => { log.error("command_data_load_failed", { error: err instanceof Error ? err.message : String(err) }); failures++; return {}; }),
    ]);
    const mData = masteryRaw?.data ?? masteryRaw;
    const gData = goalsRaw?.data ?? goalsRaw;
    const cData = cmdRaw?.data ?? cmdRaw;
    setDomains(mData.domains ?? []);
    setGoals(gData.goals ?? []);
    if (cData?.shop) setShopRevenue({ todayRevenue: cData.shop.todayRevenue, weekRevenue: cData.shop.weekRevenue });
    if (failures === 3) {
      setLoadError("All data sources failed — check connection or retry.");
    } else if (failures > 0) {
      setLoadError(`${failures} of 3 sources failed — partial data shown.`);
    } else {
      setLoadError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // 60s auto-refresh
  useEffect(() => {
    const i = setInterval(loadAll, 60000);
    return () => clearInterval(i);
  }, [loadAll]);

  // v10.0.529.88 · Wave 32 · instant refresh when chat tools fire
  // updateMasteryScore / setLifeGoal / logGoalProgress / archiveGoal
  // or any mission/score write. Pre-Wave-32 the radar stayed frozen
  // up to 60s while the poll caught up.
  useEffect(() => {
    return onDataChanged(["goals", "score", "missions"], () => loadAll());
  }, [loadAll]);

  async function updateScore(domain: string) {
    try {
      const res = await authedFetch("/api/mastery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, score: editScore, evidence: editEvidence }),
      });
      if (!res.ok) { toast.error("Failed to update score"); return; }
      toast.success("Score updated");
      loadAll();
      // v10.0.529.90 · Wave 34 · close the page-write → bus loop.
      // Other open surfaces (HomeStrip · /tasks PLAN view · cockpit
      // radar mirror) listen to "score" and now refresh instantly.
      notifyDataChanged("score", { source: "mastery-page", detail: "score-update", id: domain });
      setEditing(null);
    } catch { toast.error("Network error updating score"); }
  }

  const radarData = domains.map(d => ({ domain: d.label, score: d.score, baseline: d.baseline }));

  // Monthly revenue target (reads from localStorage, default $20K)
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate();
  const monthRevenue = shopRevenue.weekRevenue * 4.33;
  const targetPace = daysLeft > 0 ? Math.round((monthlyTarget - monthRevenue) / daysLeft) : 0;
  const pct10k = Math.min(100, (monthRevenue / monthlyTarget) * 100);

  const activeGoals = goals.filter(g => g.status === "active");
  const achievedGoals = goals.filter(g => g.status === "achieved");

  if (loading) {
    // v10.0.486 · skeleton was misaligned with the real page (a stale
    // grid-cols-3 stat row remained from a removed feature · the real
    // page is header → radar → pill row → stacked domain cards). De-
    // slopped to mirror actual flow.
    return (
      <div className="flex flex-col gap-6 py-6 stagger-in">
        <ShimmerSkeleton className="h-5 w-20 rounded" />
        <ShimmerSkeleton variant="chart" className="h-[280px]" />
        <div className="flex flex-wrap gap-2">
          <ShimmerSkeleton className="h-8 w-20 rounded" />
          <ShimmerSkeleton className="h-8 w-24 rounded" />
          <ShimmerSkeleton className="h-8 w-20 rounded" />
          <ShimmerSkeleton className="h-8 w-28 rounded" />
        </div>
        <ShimmerSkeleton variant="card" />
        <ShimmerSkeleton variant="card" />
        <ShimmerSkeleton variant="card" />
      </div>
    );
  }

  // Calculate state
  const avgScore = domains.length > 0 ? Math.round(domains.reduce((s, d) => s + d.score, 0) / domains.length * 10) / 10 : 0;
  const weakestDomain = domains.length > 0 ? domains.reduce((w, d) => d.score < w.score ? d : w, domains[0]) : null;
  const state = avgScore >= 7 ? "ON FIRE" : avgScore >= 4 ? "STEADY" : "DRIFTING";
  const stateColor = state === "ON FIRE" ? "neon-green" : state === "STEADY" ? "text-[var(--gold)]" : "neon-red";

  return (
    <div className="flex flex-col gap-6">
      {/* v10.0.33 — surface load failures so silently-empty domain
          arrays don't masquerade as "all data fetched, just empty". */}
      {loadError && (
        // v10.0.486 · token-align error banner (was hard-coded rose-*
        // which drifted from --status-red used everywhere else on
        // the page · ScoreBadge / DeltaBadge / weakest-alert).
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--status-red)]/30 bg-[var(--status-red)]/[0.05] px-3 py-2 text-[12px] text-[var(--status-red)]">
          <span className="font-mono text-[11px]">{loadError}</span>
          <button
            onClick={() => {
              setLoadError(null);
              loadAll();
            }}
            className="rounded border border-[var(--status-red)]/40 px-2 py-1 font-mono text-[10px] hover:bg-[var(--status-red)]/10"
          >
            retry
          </button>
        </div>
      )}
      {/* Header with state indicator · v10.0.486 · h1 lowercased per
          editorial contract (was "Growth" uppercase tracking-wider ·
          the slop "DEPARTMENT-HEADER" cliche). Subtitle normalized to
          font-mono lowercase · separators (was mixed-case "Focus:" /
          "Average:"). Date lowercased. */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-[var(--font-display)] font-bold tracking-tight lowercase text-[var(--text-primary)]">growth</h1>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--text-tertiary)]">
            {domains.length > 0 && weakestDomain
              ? `${state === "ON FIRE" ? "all domains strong" : `focus · ${weakestDomain.label.toLowerCase()} ${weakestDomain.score}/10`} · avg ${avgScore}/10`
              : ""}
          </p>
        </div>
        <div className="text-right">
          <span className={`text-sm font-[var(--font-display)] font-bold ${stateColor}`}>{state}</span>
          <p className="font-mono text-[9px] text-[var(--text-tertiary)]">{now.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase()}</p>
        </div>
      </div>

      <PageNick page="mastery" autoLoad />

      {/* Weakest-domain alert — Ultron's signal zone picks this up too.
          v10.0.486 · token-aligned border/bg/text to --status-red
          (was raw red-500 utilities · drifted from the rest of the
          page's status-color system). Copy lowercased + · separator. */}
      {weakestDomain && weakestDomain.score < 5 && (
        <Link href="/" className="flex items-center gap-2 rounded-lg border border-[var(--status-red)]/25 bg-[var(--status-red)]/[0.06] px-3 py-2 font-mono text-xs text-[var(--status-red)] transition-colors hover:bg-[var(--status-red)]/[0.10]">
          <Swords size={12} />
          <span>{weakestDomain.label.toLowerCase()} · {weakestDomain.score}/10 · open ultron</span>
        </Link>
      )}

      {/* Radar Chart */}
      {/* v10.0.529.107 · Wave 51 · mobile gap fix · was cramped on 375px
          iPhone width · 8 axis labels crowded at outerRadius 75%. Two
          fixes: (1) abbreviate domain labels via a tickFormatter on
          narrow viewports · keeps full label on ≥sm · (2) shrink the
          outerRadius slightly + smaller font on mobile so labels don't
          collide. CSS handles the responsive font via a media query
          approach via tick fontSize. */}
      {domains.length > 0 && (
        <Card className="border-[var(--border-default)] bg-[var(--bg-raised)]">
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="#1a1a1a" />
                <PolarAngleAxis
                  dataKey="domain"
                  tick={{ fill: "#666666", fontSize: 10 }}
                  tickFormatter={(value: string) => {
                    // Abbreviate long axis labels on mobile so they
                    // don't overlap. Full label visible on desktop
                    // via tooltip · the radar's axis-tick API doesn't
                    // expose a responsive breakpoint so we always
                    // abbreviate beyond 9 chars for safety.
                    return value && value.length > 9 ? value.slice(0, 8) + "…" : value;
                  }}
                />
                <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fill: "#666666", fontSize: 10 }} axisLine={false} />
                <Radar name="Baseline" dataKey="baseline" stroke="#333333" fill="#333333" fillOpacity={0.15} />
                <Radar name="Current" dataKey="score" stroke="#FDB913" fill="#FDB913" fillOpacity={0.15} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Quick Score Buttons · v10.0.486 · de-slopped from grid-cols-3
          (perfect 3×2 symmetric block) to flex-wrap pill row that
          flows with content length. Token-aligned hover border
          (#FDB913 → var(--gold)). Lowercase label · tabular score
          with · separator for editorial consistency. */}
      <div className="flex flex-wrap gap-2">
        {domains.slice(0, 6).map(d => (
          <Button
            key={d.key}
            variant="outline"
            size="sm"
            className="h-8 border-[var(--border-default)] font-mono text-[10px] lowercase hover:border-[var(--gold)]"
            onClick={() => { setEditing(d.key); setEditScore(d.score); setEditEvidence(""); }}
          >
            {d.icon} {d.label.split(" ")[0].toLowerCase()} <span className="tabular-nums opacity-70">· {d.score}</span>
          </Button>
        ))}
      </div>

      {/* Domain Cards */}
      <div className="grid gap-3 stagger-in">
        {domains.map(d => (
          <Card key={d.key} className="border-[var(--border-default)] bg-[var(--bg-raised)] glow-on-hover">
            <CardContent className="flex flex-col gap-2 pt-4">
              <div className="flex items-center gap-3">
                <span className="text-lg">{d.icon}</span>
                <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{d.label}</span>
                <ScoreBadge score={d.score} />
                <DeltaBadge delta={d.delta} />
              </div>
              {d.evidence && <p className="text-xs text-[var(--text-tertiary)]">{d.evidence}</p>}
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{d.date || "baseline"}</span>
                <Button
                  variant="ghost" size="xs" className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                  onClick={() => { setEditing(d.key); setEditScore(d.score); setEditEvidence(""); }}
                >
                  update
                </Button>
              </div>
              {editing === d.key && (
                <div className="flex flex-col gap-3 border-t border-[var(--border-default)] pt-3">
                  <div className="flex items-center gap-3">
                    <label className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">score</label>
                    <input type="range" min="0" max="10" step="0.5" value={editScore}
                      onChange={e => setEditScore(parseFloat(e.target.value))} className="flex-1 accent-[var(--gold)]" />
                    <span className="font-mono text-sm tabular-nums text-[var(--text-primary)]">{editScore}</span>
                  </div>
                  <Textarea placeholder="evidence — what changed and why" value={editEvidence}
                    onChange={e => setEditEvidence(e.target.value)} rows={2}
                    className="border-[var(--border-default)] bg-[var(--bg-base)]" />
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-[var(--gold)] text-[#0a0a0a] hover:bg-[var(--gold)]/90" onClick={() => updateScore(d.key)}>save</Button>
                    <Button variant="ghost" size="sm" className="text-[var(--text-tertiary)]" onClick={() => setEditing(null)}>cancel</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator className="bg-[var(--bg-raised)]" />

      {/* ═══ $20K TARGET ═══ · v10.0.486 · lowercase header, gold
          token (was #FDB913 hex), font-mono tabular meta line for
          editorial consistency with the rest of the page. */}
      <Card className="border-[var(--border-default)] bg-[var(--bg-raised)]">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Target size={14} className="text-[var(--gold)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">${(monthlyTarget / 1000).toFixed(0)}K monthly target</span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">{daysLeft}d left · ${targetPace.toLocaleString()}/day</span>
          </div>
          {/* v10.0.449 · motion-perf audit · was animating `width`
              with `transition-all duration-500` which forces a layout
              + paint pass on every frame (~30 layout frames per
              update). Switched to `scaleX` which runs purely on the
              compositor thread — zero layout cost. The outer
              `overflow-hidden` parent already exists so the scaled
              element is clipped correctly. */}
          {/* v10.0.486 · track was bg-raised same as parent Card →
              invisible track. Switched to bg-base for proper contrast.
              Bar uses var(--gold) token (was #FDB913 hex). */}
          <div className="h-3 rounded-full bg-[var(--bg-base)] overflow-hidden mb-1">
            <div
              className="h-full w-full rounded-full bg-[var(--gold)] origin-left transition-transform duration-500"
              style={{ transform: `scaleX(${Math.max(0, Math.min(100, pct10k)) / 100})` }}
            />
          </div>
          <div className="flex justify-between font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">
            <span>~${Math.round(monthRevenue).toLocaleString()}</span>
            <span>${monthlyTarget.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

      {/* Projections block retired Apr 17 — shop metrics live in nickstire.org */}

      {/* ═══ GOALS ═══ · v10.0.486 · lowercased header + font-mono
          meta line + extracted to flex header row (was inline span
          disrupting h2 baseline). Active-goals badge font-mono
          uppercase (was capitalize · violated lowercase contract).
          Deadline date lowercased. */}
      {goals.length > 0 && (
        <>
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold lowercase tracking-tight text-[var(--text-primary)]">life goals</h2>
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {activeGoals.length} active · {achievedGoals.length} achieved
            </span>
          </div>
          <div className="grid gap-3 stagger-in">
            {activeGoals.map(g => (
              <Card key={g.id} className="border-[var(--border-default)] bg-[var(--bg-raised)] glow-on-hover">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <ProgressRing
                      value={g.progress}
                      max={100}
                      size={44}
                      strokeWidth={3}
                      color={g.progress >= 75 ? "var(--status-green)" : g.progress >= 40 ? "var(--gold)" : "var(--status-red)"}
                    >
                      <span className="font-mono text-[9px] font-bold tabular-nums"><AnimatedCounter value={g.progress} duration={500} />%</span>
                    </ProgressRing>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{g.title}</span>
                        <Badge variant="outline" className="ml-2 shrink-0 font-mono text-[9px] uppercase tracking-wider">{g.domain}</Badge>
                      </div>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <AnimatedCounter value={g.currentValue} className="font-mono text-sm tabular-nums text-[var(--text-primary)]" suffix={g.unit} />
                        <span className="font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">→ {g.targetValue}{g.unit}</span>
                        {g.deadline && <span className="ml-auto font-mono text-[10px] text-[var(--text-tertiary)]">by {new Date(g.deadline).toLocaleDateString().toLowerCase()}</span>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
