"use client";

/**
 * FinancialTab · the Money section of the merged /business surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/financial/page.tsx — the only
 * change is the outer <StandardPage> wrapper became a fragment (page-level
 * chrome now lives on /business), and the former StandardPage `description`
 * subtitle ($X this month) + `actions` (the ON PACE/BEHIND/CRITICAL label
 * and FreshnessChip) moved into an inline header row at the top of the
 * fragment so nothing is lost. All data hooks, the editable target +
 * localStorage, the forecast chart, location ranking, and the personal-
 * finance grid are unchanged.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { logger as rootLogger } from "@/lib/logger";

// v10.0.31 — structured logger for financial-page errors.
const flog = rootLogger.withSurface("financial/page");
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, DollarSign, Target, BarChart3, Pencil, Check, X } from "lucide-react";
import { PageNick } from "@/components/ai/page-nick";
import { LocationRankingCard } from "@/components/financial/location-ranking-card";
// misc-pages slice (2026-05-22) · the two polled reads moved off
// authedFetch onto trpc.operator.financialSnapshot +
// operator.revenueStats · React Query's refetchInterval replaces the
// manual setInterval + AbortController plumbing (each refetch
// supersedes the prior in-flight request — the "latest poll wins"
// behavior the abort controllers were enforcing).
import { trpc } from "@/lib/trpc/client";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip,
} from "recharts";

const REVENUE_TARGET_KEY = "nour_revenue_target";
const DEFAULT_TARGET = 20000;

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
    <GlassCard className="p-3 glow-on-hover">
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
    </GlassCard>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "#111111",
  border: "1px solid #1a1a1a",
  borderRadius: 8,
  color: "#e5e5e5",
  fontSize: 12,
};

export function FinancialTab() {
  const [monthlyTarget, setMonthlyTarget] = useState(DEFAULT_TARGET);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const targetInputRef = useRef<HTMLInputElement>(null);

  // misc-pages slice (2026-05-22) · the two polled reads · React
  // Query's refetchInterval replaces the prior setInterval (60s /
  // 120s) + per-request AbortController plumbing — a refetch
  // supersedes the in-flight request, so "latest poll wins" holds.
  const financialQuery = trpc.operator.financialSnapshot.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const revenueQuery = trpc.operator.revenueStats.useQuery(
    { period: "month" },
    { refetchInterval: 120_000 },
  );
  // `latest` is the FinancialSnapshotView the operator.financialSnapshot
  // procedure returns (camelCase Prisma row). Type flows straight from
  // the procedure — no cast, no local interface. The prior snake_case
  // `Snapshot` interface silently mismatched the camelCase payload, so
  // every personal-finance field rendered "—" (fixed 2026-05-22).
  const latest = financialQuery.data?.latest ?? null;
  const loading = financialQuery.isLoading;
  const revenueHistory: RevenueDay[] = revenueQuery.data?.byDay
    ? Object.entries(revenueQuery.data.byDay as Record<string, number>)
        .map(([date, revenue]) => ({ date, revenue: Number(revenue) }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

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

  // FreshnessChip's reload — refetches both polled queries.
  const reloadAll = useCallback(() => {
    void financialQuery.refetch();
    void revenueQuery.refetch();
  }, [financialQuery, revenueQuery]);

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
    <>
      {/* Inline header row · former StandardPage description + actions.
          Subtitle ($X this month) on the left · ON PACE/BEHIND/CRITICAL
          status + FreshnessChip on the right. */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-[var(--text-secondary)]">
          {monthTotal > 0
            ? `$${Math.round(monthTotal).toLocaleString()} this month`
            : revenueQuery.isLoading
            ? "Loading revenue data..."
            : revenueQuery.isError
            ? "Revenue feed unavailable — shop bridge not responding"
            : "$0 this month so far — check the shop bridge if unexpected"}
        </p>
        <div className="text-right flex flex-col items-end gap-1 shrink-0">
          <span className={`text-sm font-[var(--font-display)] font-bold ${pctToTarget >= 80 ? "neon-green" : pctToTarget >= 50 ? "text-[var(--gold)]" : "neon-red"}`}>
            {pctToTarget >= 80 ? "ON PACE" : pctToTarget >= 50 ? "BEHIND" : "CRITICAL"}
          </span>
          <FreshnessChip
            lastFetchedAt={latest?.date}
            source="snapshots + revenue"
            onReload={reloadAll}
          />
        </div>
      </div>

      <PageNick page="financial" />

      {/* ═══ REVENUE FORECAST CHART ═══ */}
      {chartData.length > 0 && (
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={14} className="text-[var(--gold)]" />
              <span className="text-sm font-semibold">Revenue vs ${(MONTHLY_TARGET / 1000).toFixed(0)}K Target</span>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--gold)]" /> Cumulative</span>
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
              <Area type="monotone" dataKey="cumulative" stroke="var(--gold)" fill="var(--gold)" fillOpacity={0.1} strokeWidth={2} dot={false} />
              {/* Target reference line · label inside chart so it doesn't clip on mobile */}
              <ReferenceLine y={MONTHLY_TARGET} stroke="#22c55e" strokeDasharray="6 3" label={{ value: `$${(MONTHLY_TARGET / 1000).toFixed(0)}K target`, fill: "#22c55e", fontSize: 10, position: "insideTopRight" }} />
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>
      )}

      {/* Monthly Target Progress Bar */}
      <GlassCard className="p-4">
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
      </GlassCard>

      {/* 2026-05-24 · Wave X.f activation · monthly second-location
          ranking from the `monthly-location-rank` cron. Pre-fix the
          cron ran 1st of month, the API was live, but no operator
          surface rendered it · the strategic-decision signal was
          dark. Silent-hides when no ranking persisted for the
          current month. */}
      <LocationRankingCard />

      {/* ═══ PERSONAL FINANCE ═══ */}
      {latest ? (
        <>
          <div className="border-t border-[var(--border-default)] pt-6">
            <h2 className="text-lg font-bold mb-3 lowercase tracking-wider">personal finance</h2>

            {/* Net Worth Hero */}
            <GlassCard className="p-5 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign size={14} className="text-[var(--gold)]" />
                <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Net Worth</span>
              </div>
              {latest.netWorthEstimate !== null ? (
                <AnimatedCounter value={latest.netWorthEstimate} prefix="$" className="font-mono text-3xl font-bold" duration={1200} />
              ) : (
                <p className="font-mono text-3xl font-bold">—</p>
              )}
            </GlassCard>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2 stagger-in">
              <StatCard label="Checking" value={fmt(latest.checkingBalance)} numValue={latest.checkingBalance ?? undefined} danger={(latest.checkingBalance ?? 0) < 0} />
              <StatCard label="Savings" value={fmt(latest.savingsBalance)} numValue={latest.savingsBalance ?? undefined} />
              <StatCard label="Investments" value={fmt(latest.investmentValue)} numValue={latest.investmentValue ?? undefined} />
              <StatCard label="Business Rev" value={fmt(latest.businessRevenue)} numValue={latest.businessRevenue ?? undefined} />
              <StatCard label="Take-Home" value={fmt(latest.ownerTakeHome)} numValue={latest.ownerTakeHome ?? undefined} />
              <StatCard label="Total Debt" value={fmt(latest.totalDebt)} numValue={latest.totalDebt ?? undefined} danger={(latest.totalDebt ?? 0) > 0} />
            </div>

            {/* Savings Rate */}
            {latest.savingsRatePct !== null && (
              <GlassCard className="p-3 flex items-center gap-3 mt-3">
                {latest.savingsRatePct >= 20 ? (
                  <TrendingUp size={16} className="text-[var(--status-green)]" />
                ) : (
                  <TrendingDown size={16} className="text-[var(--status-red)]" />
                )}
                <div>
                  <p className="text-xs text-[var(--text-tertiary)]">Savings Rate</p>
                  <p className="font-mono font-semibold">{latest.savingsRatePct}%</p>
                </div>
              </GlassCard>
            )}

            {latest.notes && (
              <GlassCard className="p-3 mt-3">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">Notes</p>
                <p className="text-sm">{latest.notes}</p>
              </GlassCard>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--text-tertiary)]">No personal finance data recorded yet.</p>
      )}
    </>
  );
}
