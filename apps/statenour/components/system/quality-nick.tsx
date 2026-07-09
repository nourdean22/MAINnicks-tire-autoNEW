"use client";

/**
 * /system/quality — Is Nick getting better? (W12.1)
 *
 * Reads BrainMemory(category=nick_quality) via /api/system/quality.
 * Shows:
 *   · headline overall score + 7d delta + direction arrow
 *   · 4-axis breakdown (specificity / cliche / antiNour / length)
 *   · regen rate (% of replies flagged shouldRegen=true)
 *   · 14-day daily-mean trend (bar chart)
 *   · volume strip — replies/day per window
 *   · breakdown by turn intent + output shape (leaderboards)
 *
 * Alive:
 *   · animated count-up on overall score
 *   · direction arrow rotates/colors with delta
 *   · bars tint: ≥80 emerald, ≥65 amber, else rose
 */

import { useState, useEffect } from "react";
import { Panel } from "@/components/panel";
// PageHeader removed · parent /system/quality page provides one
import { cn } from "@/lib/utils/cn";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";

import { trpc } from "@/lib/trpc/client";
interface WindowAgg {
  replies: number;
  overall: { avg: number; median: number; p25: number; p75: number };
  axes: { specificity: number; cliche: number; antiNour: number; length: number };
  regenRate: number;
  byIntent: { intent: string; count: number }[];
  byShape: { shape: string; count: number }[];
}

interface Feed {
  today: WindowAgg;
  last7d: WindowAgg;
  last30d: WindowAgg;
  trend: { day: string; mean: number; count: number }[];
  delta: number;
  direction: "rising" | "falling" | "flat";
  generatedAt: string;
}

type Win = "today" | "7d" | "30d";

function tintForScore(n: number): string {
  if (n >= 80) return "text-emerald-400";
  if (n >= 65) return "text-amber-400";
  if (n > 0) return "text-rose-400";
  return "text-zinc-600";
}
function bgForScore(n: number): string {
  if (n >= 80) return "bg-gradient-to-t from-emerald-700 to-emerald-300";
  if (n >= 65) return "bg-gradient-to-t from-amber-700 to-amber-300";
  if (n > 0) return "bg-gradient-to-t from-rose-700 to-rose-300";
  return "bg-zinc-800";
}
// a11y (WCAG 1.4.1): status is also conveyed by hue (emerald/amber/rose).
// statusForScore supplies the matching word so color isn't the sole cue —
// fed into title/aria-label on the colored bars + indicators.
function statusForScore(n: number): "good" | "warning" | "critical" | "no data" {
  if (n >= 80) return "good";
  if (n >= 65) return "warning";
  if (n > 0) return "critical";
  return "no data";
}

function AnimatedScore({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const start = display;
    const diff = value - start;
    if (Math.abs(diff) < 1) { 
      if (start !== value) {
        requestAnimationFrame(() => setDisplay(value));
      }
      return; 
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 500);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + diff * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{display}</>;
}

function AxisBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>{label}</span>
        <span className={cn("font-mono tabular-nums", tintForScore(value))}>{value}</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900"
        role="img"
        aria-label={`${value}/100 · ${statusForScore(value)}`}
        title={`${value}/100 · ${statusForScore(value)}`}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500", bgForScore(value))}
          style={{ width: `${Math.max(2, value)}%` }}
        />
      </div>
    </div>
  );
}

function TrendBars({ trend }: { trend: Feed["trend"] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex h-24 items-end gap-1">
      {trend.map((t) => {
        const h = Math.max(4, Math.round((t.mean / 100) * 88));
        const isToday = t.day === today;
        return (
          <div key={t.day} className="group flex flex-1 flex-col items-center gap-1">
            <div className="relative w-full">
              <div
                className={cn(
                  "w-full rounded-sm transition-all",
                  t.mean === 0
                    ? "bg-zinc-900 h-1"
                    : bgForScore(t.mean),
                  isToday && "ring-1 ring-white/20",
                )}
                style={{ height: t.mean === 0 ? "4px" : `${h}px` }}
                role="img"
                aria-label={`${t.day} · avg ${t.mean}/100 · ${statusForScore(t.mean)} · n=${t.count}`}
                title={`${t.day} · avg ${t.mean}/100 · ${statusForScore(t.mean)} · n=${t.count}`}
              />
            </div>
            <span className="hidden text-[9px] text-zinc-600 sm:block">{t.day.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function QualityNickView() {
  const [win, setWin] = useState<Win>("7d");

  // Phase VV (2026-05-22) · REST→tRPC · system.quality. The legacy route
  // returned the feed directly (no `{data}` wrap) and the page polled it
  // on a 60s setInterval — refetchInterval now drives that. `refresh`
  // repoints to refetch (also serves the manual refresh button).
  const qualityQuery = trpc.system.quality.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const feed: Feed | null = qualityQuery.data ?? null;
  const loading = qualityQuery.isPending || qualityQuery.isFetching;
  const load = () => void qualityQuery.refetch();

  const active = feed ? (win === "today" ? feed.today : win === "7d" ? feed.last7d : feed.last30d) : null;
  const dirIcon = feed ? (feed.direction === "rising" ? "↗" : feed.direction === "falling" ? "↘" : "→") : "—";
  const dirTint = feed
    ? feed.direction === "rising"
      ? "text-emerald-400"
      : feed.direction === "falling"
        ? "text-rose-400 animate-pulse"
        : "text-zinc-400"
    : "text-zinc-500";

  return (
    <div className="space-y-4">
      {/* PageHeader removed · parent /system/quality renders title.
          Inline mini-row keeps the freshness chip + refresh button. */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>
          {feed
            ? `7d avg ${feed.last7d.overall.avg}/100 · ${feed.last7d.replies} replies · regen ${feed.last7d.regenRate}%`
            : "loading…"}
        </span>
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={feed?.generatedAt}
            source="db · BrainMemory(nick_quality)"
            onReload={load}
          />
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-3 py-1 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
          >
            {loading ? "refreshing…" : "refresh"}
          </button>
        </div>
      </div>

      {feed && active && (
        <>
          {/* Headline */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">overall · {win}</div>
                <div className={cn("mt-1 font-mono text-5xl font-bold tabular-nums", tintForScore(active.overall.avg))}>
                  <AnimatedScore value={active.overall.avg} />
                  <span className="text-xl text-zinc-500">/100</span>
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  <AnimatedCounter value={active.replies} /> replies · median {active.overall.median}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">7d vs prior</div>
                <div className={cn("mt-1 font-mono text-5xl font-bold tabular-nums", dirTint)}>
                  {dirIcon}{" "}<AnimatedCounter value={feed.delta} prefix={feed.delta >= 0 ? "+" : ""} />
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">{feed.direction}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">regen rate · {win}</div>
                <div className={cn(
                  "mt-1 font-mono text-5xl font-bold tabular-nums",
                  active.regenRate > 25 ? "text-rose-400 animate-pulse" : active.regenRate > 10 ? "text-amber-400" : "text-emerald-400"
                )}>
                  <AnimatedCounter value={active.regenRate} /><span className="text-xl text-zinc-500">%</span>
                </div>
                {/* a11y (WCAG 1.4.1): status word so the rose/amber/emerald
                    hue isn't the only signal of severity. */}
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  would regenerate · {active.regenRate > 25 ? "critical" : active.regenRate > 10 ? "warning" : "good"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">spread · p25 — p75</div>
                <div className="mt-1 font-mono text-5xl font-bold tabular-nums text-sky-300">
                  {active.overall.p25}<span className="text-xl text-zinc-500">—</span>{active.overall.p75}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">middle 50%</div>
              </div>
            </div>
          </Panel>

          {/* Window pills */}
          <div className="flex flex-wrap gap-2">
            {(["today", "7d", "30d"] as Win[]).map((w) => (
              <button
                key={w}
                onClick={() => setWin(w)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition",
                  win === w ? "bg-emerald-500/15 text-emerald-200" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                )}
              >
                {w}
              </button>
            ))}
          </div>

          {/* 14-day trend */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">14-day mean score</h2>
              <span className="text-xs text-zinc-500">
                {feed.trend.filter((t) => t.mean > 0).length}/14 days with data
              </span>
            </div>
            <TrendBars trend={feed.trend} />
            {feed.trend.every((t) => t.count === 0) && (
              <p className="mt-3 text-center text-[11px] text-zinc-500">
                no nick_quality rows yet · data accumulates as Nick replies. First row typically 1 chat turn away.
              </p>
            )}
          </Panel>

          {/* 4-axis breakdown */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">4-axis breakdown · {win}</h2>
              <span className="text-xs text-zinc-500">weights: spec 35 · cliche 25 · antiNour 20 · length 20</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <AxisBar label="specificity · numbers/names/dates per 100w" value={active.axes.specificity} />
              <AxisBar label="cliche freedom · low stock-phrase density"   value={active.axes.cliche} />
              <AxisBar label="anti-nour · corp-speak avoidance"            value={active.axes.antiNour} />
              <AxisBar label="length match · within expected shape range"  value={active.axes.length} />
            </div>
          </Panel>

          {/* Leaderboards */}
          <div className="grid gap-4 md:grid-cols-2">
            <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
              <h2 className="mb-3 text-sm font-semibold text-white">by intent · {win}</h2>
              {active.byIntent.length === 0 ? (
                <p className="text-xs text-zinc-500">no data yet in window</p>
              ) : (
                <div className="space-y-1">
                  {active.byIntent.map((r) => (
                    <div key={r.intent} className="flex items-center justify-between rounded px-2 py-1 transition hover:bg-white/[0.03]">
                      <span className="font-mono text-xs text-zinc-300">{r.intent}</span>
                      <span className="text-[10px] tabular-nums text-zinc-500">{r.count}×</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
              <h2 className="mb-3 text-sm font-semibold text-white">by shape · {win}</h2>
              {active.byShape.length === 0 ? (
                <p className="text-xs text-zinc-500">no data yet in window</p>
              ) : (
                <div className="space-y-1">
                  {active.byShape.map((r) => (
                    <div key={r.shape} className="flex items-center justify-between rounded px-2 py-1 transition hover:bg-white/[0.03]">
                      <span className="font-mono text-xs text-zinc-300">{r.shape}</span>
                      <span className="text-[10px] tabular-nums text-zinc-500">{r.count}×</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      {!feed && loading && <p className="text-center text-xs text-zinc-500">loading…</p>}
      <p className="pt-2 text-center text-[10px] text-zinc-600">
        auto-refresh 60s · source: BrainMemory(nick_quality) · writes come from post-stream output-critic
      </p>
    </div>
  );
}
