"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { logger as rootLogger } from "@/lib/logger";

// v10.0.31 — structured logger for financial-page errors.
const flog = rootLogger.withSurface("financial/page");
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { ProgressRing } from "@/components/ui/progress-ring";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, DollarSign, Target, BarChart3, Pencil, Check, X } from "lucide-react";
import { PageNick } from "@/components/ai/page-nick";
import { authedFetch } from "@/hooks/use-authed-fetch";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip,
} from "recharts";

const REVENUE_TARGET_KEY = "nour_revenue_target";
const DEFAULT_TARGET = 20000;

interface Snapshot {
  date: string;
  net_worth_estimate: number | null;
  checking_balance: number | null;
  savings_balance: number | null;
  investment_value: number | null;
  business_revenue: number | null;
  owner_take_home: number | null;
  total_debt: number | null;
  savings_rate_pct: number | null;
  notes: string | null;
}

interface RevenueDay {
  date: string;
  revenue: number;
}

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v < 0 ? `-$${Math.abs(v).toLocaleString()}` : `$${v.toLocaleString()}`;
}

function StatCard({ label, value, numValue, danger }: { label: string; value: string; numValue?: number; danger?: boolean }) {
  return (
    <Card className="p-3 bg-[var(--bg-raised)] border-[var(--border-default)] glow-on-hover">
      <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">{label}</p>
      {numValue !== undefined ? (
        <AnimatedCounter
          value={numValue}
          prefix={value.startsWith("-") ? "-$" : "$"}
          className={cn("font-mono text-lg font-semibold mt-0.5", danger && "text-[var(--status-red)]")}
        />
      ) : (
        <p className={cn("font-mono text-lg font-semibold mt-0.5", danger && "text-[var(--status-red)]")}>{value}</p>
      )}
    </Card>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "#111111",
  border: "1px solid #1a1a1a",
  borderRadius: 8,
  color: "#e5e5e5",
  fontSize: 12,
};

export default function FinancialPage() {
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [revenueHistory, setRevenueHistory] = useState<RevenueDay[]>([]);
  const [monthlyTarget, setMonthlyTarget] = useState(DEFAULT_TARGET);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const targetInputRef = useRef<HTMLInputElement>(null);

  // Load target from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REVENUE_TARGET_KEY);
      if (saved) {
        const parsed = Number(saved);
        if (parsed > 0) setMonthlyTarget(parsed);
      }
    } catch (e) {
      // v10.0.31 — surface localStorage failure (private browsing
      // with storage blocked, quota exceeded, etc.) so we know
      // why a target preference vanished.
      flog.warn("localStorage_unavailable", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editingTarget && targetInputRef.current) {
      targetInputRef.current.focus();
      targetInputRef.current.select();
    }
  }, [editingTarget]);

  function startEditTarget() {
    setTargetInput(String(monthlyTarget));
    setEditingTarget(true);
  }

  function saveTarget() {
    const val = Number(targetInput);
    if (val > 0) {
      setMonthlyTarget(val);
      try {
        localStorage.setItem(REVENUE_TARGET_KEY, String(val));
      } catch (e) {
        flog.warn("localStorage_save_failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    setEditingTarget(false);
  }

  function cancelEditTarget() {
    setEditingTarget(false);
  }

  // v10.0.31 — abort signals so 60s + 120s polling intervals don't
  // accumulate stale in-flight requests on slow networks. Latest
  // poll always wins.
  const financialInflightRef = useRef<AbortController | null>(null);
  const revenueInflightRef = useRef<AbortController | null>(null);

  const loadFinancial = useCallback(async () => {
    if (financialInflightRef.current) financialInflightRef.current.abort();
    const ctrl = new AbortController();
    financialInflightRef.current = ctrl;
    try {
      const r = await authedFetch("/api/financial", { signal: ctrl.signal });
      if (!r.ok) throw new Error(`financial fetch ${r.status}`);
      const raw = await r.json();
      const d = raw?.data ?? raw;
      setLatest(d.latest);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      flog.error("financial_load_exception", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRevenueHistory = useCallback(async () => {
    if (revenueInflightRef.current) revenueInflightRef.current.abort();
    const ctrl = new AbortController();
    revenueInflightRef.current = ctrl;
    try {
      const r = await authedFetch("/api/analytics/revenue?period=month", {
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`revenue history fetch ${r.status}`);
      const raw = await r.json();
      const data = raw?.data ?? raw;
      if (data?.byDay) {
        const days: RevenueDay[] = Object.entries(data.byDay as Record<string, number>)
          .map(([date, revenue]) => ({ date, revenue: Number(revenue) }))
          .sort((a, b) => a.date.localeCompare(b.date));
        setRevenueHistory(days);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      flog.error("revenue_history_load_exception", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    loadFinancial();
    loadRevenueHistory();
    const i1 = setInterval(loadFinancial, 60000);
    const i2 = setInterval(loadRevenueHistory, 120000);
    return () => { clearInterval(i1); clearInterval(i2); };
  }, [loadFinancial, loadRevenueHistory]);

  // Dynamic target (editable, persisted to localStorage)
  const MONTHLY_TARGET = monthlyTarget;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysLeft = daysInMonth - dayOfMonth;
  const DAILY_TARGET = Math.round(MONTHLY_TARGET / daysInMonth);
  const monthTotal = revenueHistory.reduce((s, d) => s + d.revenue, 0);
  const pctToTarget = Math.min(100, (monthTotal / MONTHLY_TARGET) * 100);
  const paceNeeded = daysLeft > 0 ? Math.round((MONTHLY_TARGET - monthTotal) / daysLeft) : 0;

  // Chart data with cumulative revenue for area chart
  const chartData = revenueHistory.map((d, i) => {
    const cumulative = revenueHistory.slice(0, i + 1).reduce((s, r) => s + r.revenue, 0);
    const dayNum = new Date(d.date).getDate();
    const targetLine = dayNum * DAILY_TARGET;
    return {
      date: d.date.slice(5), // MM-DD
      daily: Math.round(d.revenue),
      cumulative: Math.round(cumulative),
      target: Math.round(targetLine),
    };
  });

  if (loading) {
    return <div className="space-y-4">{[1,2,3,4].map(i => <div key={i} className="skeleton h-20 w-full" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">Money</h1>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            {monthTotal > 0 ? (
              <>
                ${Math.round(monthTotal).toLocaleString()} this month ·{" "}
                <span className={pctToTarget >= 80 ? "text-green-400" : pctToTarget >= 50 ? "text-amber-400" : "text-red-400"}>
                  {pctToTarget.toFixed(0)}% to target
                </span>
                {" · "}${paceNeeded > 0 ? `need $${paceNeeded}/day` : "on pace"}
              </>
            ) : "Loading revenue data..."}
          </p>
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          <span className={`text-sm font-[var(--font-display)] font-bold ${pctToTarget >= 80 ? "neon-green" : pctToTarget >= 50 ? "text-[var(--gold)]" : "neon-red"}`}>
            {pctToTarget >= 80 ? "ON PACE" : pctToTarget >= 50 ? "BEHIND" : "CRITICAL"}
          </span>
          <FreshnessChip
            lastFetchedAt={latest?.date}
            source="snapshots + revenue"
            onReload={() => { loadFinancial(); loadRevenueHistory(); }}
          />
        </div>
      </header>

      <PageNick page="financial" />

      {/* ═══ REVENUE FORECAST CHART ═══ */}
      {chartData.length > 0 && (
        <Card className="p-4 bg-[var(--bg-raised)] border-[var(--border-default)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={14} className="text-[var(--gold)]" />
              <span className="text-sm font-semibold">Revenue vs ${(MONTHLY_TARGET / 1000).toFixed(0)}K Target</span>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#FDB913]" /> Cumulative</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#666]" style={{ borderStyle: "dashed" }} /> ${DAILY_TARGET}/day pace</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            {/* v10.0.529.106 · Wave 51 · mobile fix · ReferenceLine label was
                position="right" which renders past the chart's right edge,
                clipping the "$20K" target label on iPhone (390px viewport).
                Moved to position="insideTopRight" so it lives inside the
                plot area · also gave the chart a small right margin so the
                last X-axis tick isn't flush with the card border. */}
            <AreaChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#1a1a1a" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: "#666", fontSize: 10 }} axisLine={{ stroke: "#1a1a1a" }} tickLine={false} />
              <YAxis
                tick={{ fill: "#666", fontSize: 10 }}
                axisLine={{ stroke: "#1a1a1a" }}
                tickLine={false}
                width={44}
                tickFormatter={v => `$${(v / 1000).toFixed(0)}K`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={((value: unknown, name: unknown) => {
                  const v = typeof value === "number" ? value : Number(value ?? 0);
                  const n = String(name ?? "");
                  return [`$${v.toLocaleString()}`, n === "cumulative" ? "Revenue" : n === "target" ? "Target Pace" : "Daily"] as [string, string];
                }) as never}
              />
              {/* Target pace line */}
              <Area type="monotone" dataKey="target" stroke="#444" strokeDasharray="6 3" fill="none" dot={false} />
              {/* Actual cumulative revenue */}
              <Area type="monotone" dataKey="cumulative" stroke="#FDB913" fill="#FDB913" fillOpacity={0.1} strokeWidth={2} dot={false} />
              {/* Target reference line · label inside chart so it doesn't clip on mobile */}
              <ReferenceLine y={MONTHLY_TARGET} stroke="#22c55e" strokeDasharray="6 3" label={{ value: `$${(MONTHLY_TARGET / 1000).toFixed(0)}K target`, fill: "#22c55e", fontSize: 10, position: "insideTopRight" }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Monthly Target Progress Bar */}
      <Card className="p-4 bg-[var(--bg-raised)] border-[var(--border-default)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-[var(--gold)]" />
            {editingTarget ? (
              <div className="flex items-center gap-1">
                <span className="text-sm text-[var(--text-tertiary)]">$</span>
                <input
                  ref={targetInputRef}
                  type="number"
                  value={targetInput}
                  onChange={e => setTargetInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveTarget(); if (e.key === "Escape") cancelEditTarget(); }}
                  className="w-24 bg-[var(--nour-border)] border border-[var(--border-default)] rounded px-2 py-0.5 text-sm font-semibold font-mono focus:outline-none focus:ring-1 focus:ring-[var(--nour-gold)]"
                />
                <button onClick={saveTarget} className="p-0.5 hover:text-[var(--gold)] transition-colors" aria-label="Save target">
                  <Check size={14} />
                </button>
                <button onClick={cancelEditTarget} className="p-0.5 hover:text-[var(--status-red)] transition-colors" aria-label="Cancel">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">${MONTHLY_TARGET.toLocaleString()} Monthly Target</span>
                <button onClick={startEditTarget} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors" aria-label="Edit target">
                  <Pencil size={12} />
                </button>
              </div>
            )}
          </div>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {daysLeft}d left · need ${paceNeeded}/day
          </span>
        </div>
        <div className="h-3 rounded-full bg-[var(--nour-border)] overflow-hidden mb-1">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              pctToTarget >= 80 ? "bg-green-400" : pctToTarget >= 50 ? "bg-[var(--nour-gold)]" : "bg-red-400"
            )}
            style={{ width: `${pctToTarget}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
          <span>${Math.round(monthTotal).toLocaleString()} earned</span>
          <span className="font-mono">{pctToTarget.toFixed(0)}%</span>
          <span>${MONTHLY_TARGET.toLocaleString()} goal</span>
        </div>
      </Card>

      {/* v10.0.529.55 · Shop Revenue stub cut · 28 LOC placeholder
          flagged HIGH by audit Wave 9 · was a permanent stub linking
          to nickstire admin · zero data load · removed cleanly. The
          ShopRevenue function definition below is also unused now. */}

      {/* ═══ PERSONAL FINANCE ═══ */}
      {latest ? (
        <>
          <div className="border-t border-[var(--border-default)] pt-6">
            <h2 className="text-lg font-bold mb-3 lowercase tracking-wider">personal finance</h2>

            {/* Net Worth Hero */}
            <Card className="p-5 bg-[var(--bg-raised)] border-[var(--border-default)] mb-3">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign size={14} className="text-[var(--gold)]" />
                <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Net Worth</span>
              </div>
              {latest.net_worth_estimate !== null ? (
                <AnimatedCounter value={latest.net_worth_estimate} prefix="$" className="font-mono text-3xl font-bold" duration={1200} />
              ) : (
                <p className="font-mono text-3xl font-bold">—</p>
              )}
            </Card>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2 stagger-in">
              <StatCard label="Checking" value={fmt(latest.checking_balance)} numValue={latest.checking_balance ?? undefined} danger={(latest.checking_balance ?? 0) < 0} />
              <StatCard label="Savings" value={fmt(latest.savings_balance)} numValue={latest.savings_balance ?? undefined} />
              <StatCard label="Investments" value={fmt(latest.investment_value)} numValue={latest.investment_value ?? undefined} />
              <StatCard label="Business Rev" value={fmt(latest.business_revenue)} numValue={latest.business_revenue ?? undefined} />
              <StatCard label="Take-Home" value={fmt(latest.owner_take_home)} numValue={latest.owner_take_home ?? undefined} />
              <StatCard label="Total Debt" value={fmt(latest.total_debt)} numValue={latest.total_debt ?? undefined} danger={(latest.total_debt ?? 0) > 0} />
            </div>

            {/* Savings Rate */}
            {latest.savings_rate_pct !== null && (
              <Card className="p-3 flex items-center gap-3 bg-[var(--bg-raised)] border-[var(--border-default)] mt-3">
                {latest.savings_rate_pct >= 20 ? (
                  <TrendingUp size={16} className="text-[var(--status-green)]" />
                ) : (
                  <TrendingDown size={16} className="text-[var(--status-red)]" />
                )}
                <div>
                  <p className="text-xs text-[var(--text-tertiary)]">Savings Rate</p>
                  <p className="font-mono font-semibold">{latest.savings_rate_pct}%</p>
                </div>
              </Card>
            )}

            {latest.notes && (
              <Card className="p-3 bg-[var(--bg-raised)] border-[var(--border-default)] mt-3">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">Notes</p>
                <p className="text-sm">{latest.notes}</p>
              </Card>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--text-tertiary)]">No personal finance data recorded yet.</p>
      )}
    </div>
  );
}

// Apr 17 separation pass — shop revenue lives in nickstire.org/admin.
// This card stays as a placeholder so the financial page layout doesn't
// jump. When a nickstire-oversight API gets wired, reconnect here.
// v10.0.31 — was a stub component holding `useState<any>({_stub: true})`
// that always rendered the same link. The state was never set, the
// `return null` branch was unreachable. Replaced with a plain
// component that just renders the placeholder.
// v10.0.529.55 · ShopRevenue component deleted · was a placeholder
// stub linking to nickstire admin · no mount remains.
