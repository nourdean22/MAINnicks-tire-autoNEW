"use client";

/**
 * /system/decision-drift — Nour's decision follow-through pulse (W12.2).
 *
 * Answers: "am I reviewing my decisions? are my predictions getting
 * better? which domains am I consistently wrong in?"
 *
 * Data: MasteryDecision rows. A decision with `actualOutcome` and
 * `grade` populated = "reviewed." Grade drift = behavioral drift.
 *
 * Alive:
 *   · direction arrow ↗/↘/→ pulses on trend break
 *   · review-rate gauge tints by threshold
 *   · per-decision rows fade amber → rose as they go overdue
 *   · 12-week grade trend bars
 */

import { useState, useEffect, useCallback } from "react";
import { Panel } from "@/components/panel";
// PageHeader removed · parent /system/quality page provides one
import { cn } from "@/lib/utils/cn";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { TrendCounter } from "@/components/ui/trend-counter";
import { DecisionSpread } from "@/components/ui/decision-spread";
import { FreshnessChip } from "@/components/ui/freshness-chip";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface Miss {
  id: number;
  title: string;
  date: string;
  chosen: string | null;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  grade: string | null;
  domain: string | null;
}
interface Overdue {
  id: number;
  title: string;
  date: string;
  reviewDate: string | null;
  chosen: string | null;
  domain: string | null;
}
interface DomainRow {
  domain: string;
  count: number;
  reviewRate: number;
  avgGrade: number | null;
}
interface Agg {
  total: number;
  reviewed: number;
  reviewRate: number;
  avgGrade: number | null;
  gradeDistribution: Record<string, number>;
  misses: Miss[];
  overdue: Overdue[];
  domainBreakdown: DomainRow[];
}
interface Feed {
  today: Agg;
  last7d: Agg;
  last30d: Agg;
  last90d: Agg;
  trend: { week: string; avgGrade: number | null; count: number }[];
  delta: number;
  direction: "rising" | "falling" | "flat";
  generatedAt: string;
}

type Win = "today" | "7d" | "30d" | "90d";

function tintForGrade(n: number | null): string {
  if (n === null) return "text-zinc-600";
  if (n >= 3.5) return "text-emerald-400";
  if (n >= 2.5) return "text-sky-300";
  if (n >= 1.5) return "text-amber-400";
  return "text-rose-400";
}

/** v10.0.220 · letter grade → numeric for the DecisionSpread score
 *  display. A=4, B=3, C=2, D=1, F=0. Used in the misses panel to
 *  drive the failure scale visually via the connector. */
function gradeToNumeric(grade: string | null): number {
  if (!grade) return 0;
  const g = grade.trim().toUpperCase().charAt(0);
  return ({ A: 4, B: 3, C: 2, D: 1, F: 0 } as Record<string, number>)[g] ?? 0;
}

function bgForGrade(n: number | null): string {
  if (n === null) return "bg-zinc-800";
  if (n >= 3.5) return "bg-gradient-to-t from-emerald-700 to-emerald-300";
  if (n >= 2.5) return "bg-gradient-to-t from-sky-700 to-sky-300";
  if (n >= 1.5) return "bg-gradient-to-t from-amber-700 to-amber-300";
  return "bg-gradient-to-t from-rose-700 to-rose-300";
}

function tintForReviewRate(rate: number): string {
  if (rate >= 75) return "text-emerald-400";
  if (rate >= 50) return "text-amber-400";
  return "text-rose-400 animate-pulse";
}

function GradeTrendBars({ trend }: { trend: Feed["trend"] }) {
  if (trend.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-zinc-500">
        no graded decisions in the last 12 weeks
      </div>
    );
  }
  return (
    <div className="flex h-20 items-end gap-1">
      {trend.map((t) => {
        const h = t.avgGrade !== null ? Math.max(4, Math.round((t.avgGrade / 4) * 76)) : 4;
        return (
          <div key={t.week} className="group flex flex-1 flex-col items-center gap-1">
            <div className="relative w-full">
              <div
                className={cn("w-full rounded-sm transition-all", bgForGrade(t.avgGrade))}
                style={{ height: `${h}px` }}
                title={`${t.week} · avg ${t.avgGrade?.toFixed(2) ?? "—"}/4 · n=${t.count}`}
              />
            </div>
            <span className="hidden text-[9px] text-zinc-600 md:block">{t.week.slice(-2)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function QualityDecisionsView() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState<Win>("30d");

  const load = useCallback(async () => {
    try {
      const res = await authedFetch("/api/system/decision-drift", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setFeed(json.data ?? json);
    } catch (e) {
      console.error("decision-drift load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(load, 120_000);
    return () => clearInterval(i);
  }, [load]);

  const active = feed
    ? win === "today"
      ? feed.today
      : win === "7d"
        ? feed.last7d
        : win === "30d"
          ? feed.last30d
          : feed.last90d
    : null;

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
          Inline mini-row keeps freshness chip + refresh button. */}
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>
          {feed
            ? `7d avg ${feed.last7d.avgGrade?.toFixed(2) ?? "—"}/4 · review rate ${feed.last7d.reviewRate}% · ${feed.last30d.overdue.length} overdue reviews`
            : "loading…"}
        </span>
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={feed?.generatedAt}
            source="db · MasteryDecision"
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
          {/* v10.0.220 · headline grid uses TrendCounter so each card
              carries its own baseline. avgGrade compares against last30d
              (or last90d when win=30d/90d), reviewRate compares to last30d,
              the existing 7d-vs-30d delta drives its own direction tone. */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="grid gap-3 md:grid-cols-4">
              <TrendCounter
                value={active.avgGrade ?? 0}
                baseline={
                  win !== "today" && feed.last30d.avgGrade !== null && active.avgGrade !== null
                    ? feed.last30d.avgGrade
                    : null
                }
                baselineLabel="vs 30d"
                history={feed.trend.slice(-12).map((t) => t.avgGrade ?? 0)}
                label={`avg grade · ${win} · /4`}
                goodWhen="high"
                tone={
                  active.avgGrade === null ? "tertiary"
                  : active.avgGrade >= 3.5 ? "emerald"
                  : active.avgGrade >= 2.5 ? "tertiary"
                  : active.avgGrade >= 1.5 ? "amber"
                  : "rose"
                }
                format={(n) => active.avgGrade === null ? "—" : `${n.toFixed(2)}`}
              />
              <TrendCounter
                value={active.reviewRate}
                baseline={win !== "today" ? feed.last30d.reviewRate : null}
                baselineLabel="vs 30d"
                label="review rate · w/ outcome"
                goodWhen="high"
                tone={
                  active.reviewRate >= 70 ? "emerald"
                  : active.reviewRate >= 40 ? "amber"
                  : "rose"
                }
                format={(n) => `${Math.round(n)}%`}
              />
              <TrendCounter
                value={feed.delta}
                label={`7d vs 30d · ${feed.direction}`}
                goodWhen="high"
                tone={
                  feed.direction === "rising" ? "emerald"
                  : feed.direction === "falling" ? "rose"
                  : "tertiary"
                }
                format={(n) => `${dirIcon} ${n >= 0 ? "+" : ""}${n.toFixed(2)}`}
              />
              <TrendCounter
                value={active.overdue.length}
                label="overdue reviews · no outcome"
                goodWhen="low"
                tone={
                  active.overdue.length === 0 ? "emerald"
                  : active.overdue.length > 5 ? "rose"
                  : "amber"
                }
              />
            </div>
          </Panel>

          {/* Window pills */}
          <div className="flex flex-wrap gap-2">
            {(["today", "7d", "30d", "90d"] as Win[]).map((w) => (
              <button
                key={w}
                onClick={() => setWin(w)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition",
                  win === w ? "bg-sky-500/15 text-sky-200" : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
                )}
              >
                {w}
              </button>
            ))}
          </div>

          {/* 12-week trend */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">12-week grade trend</h2>
              <span className="text-xs text-zinc-500">oldest → newest · 4.0 scale</span>
            </div>
            <GradeTrendBars trend={feed.trend} />
          </Panel>

          {/* Grade distribution */}
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <h2 className="mb-3 text-sm font-semibold text-white">Grade distribution · {win}</h2>
            {/* v8.24 · 6 letter buckets crammed into 6 cols overflowed
                phone width. Switch to 3 cols on mobile (2 rows of 3),
                6 cols on tablet+. */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {(["A", "B", "C", "D", "F", "ungraded"] as const).map((letter) => {
                const count = active.gradeDistribution[letter] ?? 0;
                const pct = active.total > 0 ? Math.round((count / active.total) * 100) : 0;
                const tint =
                  letter === "A" ? "text-emerald-400" :
                  letter === "B" ? "text-sky-300" :
                  letter === "C" ? "text-amber-400" :
                  letter === "D" ? "text-orange-400" :
                  letter === "F" ? "text-rose-400" :
                  "text-zinc-500";
                return (
                  <div key={letter} className="rounded-lg bg-[var(--bg-raised)]/[0.03] p-3 text-center">
                    <div className={cn("text-3xl font-bold tabular-nums", tint)}>
                      <AnimatedCounter value={count} />
                    </div>
                    <div className={cn("mt-1 text-[10px] uppercase tracking-wider", tint)}>{letter}</div>
                    <div className="mt-0.5 text-[9px] text-zinc-600">{pct}%</div>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Domain breakdown */}
          {active.domainBreakdown.length > 0 && (
            <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
              <h2 className="mb-3 text-sm font-semibold text-white">by domain · {win}</h2>
              {/* v8.24 · 4 stacked numeric columns overflowed on phone
                  and the count + review% + avgGrade got truncated. On
                  mobile, stack the metrics under the domain name with
                  flex-wrap; restore the inline grid at sm+. */}
              <div className="space-y-1">
                {active.domainBreakdown.map((d) => (
                  <div
                    key={d.domain}
                    className="rounded px-2 py-2 transition hover:bg-white/[0.03] flex flex-col gap-1 sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-3"
                  >
                    <span className="font-mono text-xs text-zinc-200">{d.domain}</span>
                    <span className="text-[10px] tabular-nums text-zinc-500">{d.count} decisions</span>
                    <span className={cn("font-mono text-xs tabular-nums", tintForReviewRate(d.reviewRate))}>
                      {d.reviewRate}% reviewed
                    </span>
                    <span className={cn("font-mono text-xs tabular-nums", tintForGrade(d.avgGrade))}>
                      {d.avgGrade !== null ? `${d.avgGrade.toFixed(2)}/4` : "ungraded"}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Overdue reviews */}
          {active.overdue.length > 0 && (
            <Panel className="border-amber-500/30 bg-amber-500/[0.02]">
              <h2 className="mb-3 text-sm font-semibold text-amber-300">⚠ Overdue reviews · {active.overdue.length}</h2>
              <p className="mb-3 text-[11px] text-zinc-400">
                these decisions passed their review date without an actualOutcome. Every one unrevised is a lesson left on the table.
              </p>
              <div className="space-y-1">
                {active.overdue.map((d) => (
                  <div key={d.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded border border-amber-500/20 bg-amber-500/[0.03] px-3 py-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    <div className="min-w-0">
                      <div className="truncate text-xs text-zinc-200">{d.title}</div>
                      <div className="text-[10px] text-zinc-500">chose: {d.chosen ?? "—"}</div>
                    </div>
                    <span className="text-[10px] text-zinc-500">{d.domain ?? "unclassified"}</span>
                    <span className="font-mono text-[10px] text-amber-300">{d.reviewDate}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* v10.0.220 · Misses rendered as DecisionSpread cards — the
              core insight is "predicted vs actual didn't match", which
              is exactly the paired-decision shape the primitive was
              built for. Score in the connector is the numeric grade
              (D=1, F=0) so the failure scale is felt visually. Domain
              + grade chip ride the left label; the chosen action goes
              into the actions rail as a small badge. */}
          {active.misses.length > 0 && (
            <div>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-rose-300">Misses · D/F grade in {win}</h2>
                <p className="text-[11px] text-zinc-400">
                  patterns in these → candidates for the anti-pattern library.
                </p>
              </div>
              <div className="space-y-2">
                {active.misses.map((d) => {
                  const gradeNum = gradeToNumeric(d.grade);
                  return (
                    <DecisionSpread
                      key={d.id}
                      className="border-rose-500/30 hover:border-rose-500/50"
                      leftLabel={
                        <span className="inline-flex items-center gap-2">
                          <span>predicted</span>
                          {d.domain && (
                            <span className="font-mono tracking-[0.18em] opacity-80 normal-case">
                              {d.domain.slice(0, 4).toUpperCase()}
                            </span>
                          )}
                        </span>
                      }
                      leftTitle={d.title}
                      leftBody={d.predictedOutcome ?? "no prediction recorded"}
                      leftMeta={
                        d.chosen
                          ? `chose · ${d.chosen.slice(0, 80)}`
                          : new Date(d.date).toLocaleDateString()
                      }
                      score={gradeNum}
                      scoreFormat={() => d.grade ?? "—"}
                      scoreLabel="grade"
                      rightLabel="actual"
                      rightTitle={d.actualOutcome?.slice(0, 80) ?? "no outcome logged"}
                      rightBody={
                        d.actualOutcome && d.actualOutcome.length > 80 ? (
                          <p className="text-[11px] leading-relaxed">
                            {d.actualOutcome.slice(80, 320)}
                          </p>
                        ) : null
                      }
                      actions={
                        <div className="flex items-center justify-end">
                          <a
                            href={`/decisions/${d.id}`}
                            className="inline-flex items-center gap-1.5 rounded border border-[var(--gold)]/40 bg-[var(--gold)]/[0.06] px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--gold)]/90 hover:bg-[var(--gold)]/15 hover:text-[var(--gold)] transition-colors"
                          >
                            open decision →
                          </a>
                        </div>
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {!feed && loading && <p className="text-center text-xs text-zinc-500">loading…</p>}
      <p className="pt-2 text-center text-[10px] text-zinc-600">
        auto-refresh 2m · source: MasteryDecision · decision_replay endpoint backs /api/decisions
      </p>
    </div>
  );
}
