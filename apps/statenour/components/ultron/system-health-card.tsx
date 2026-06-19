"use client";

/**
 * SystemHealthCard — morning health digest surfaced on HQ.
 *
 * Reads the latest persisted digest from BrainMemory(category=
 * "system_health_digest") via /api/ultron/health-digest. The digest is
 * written nightly at 4am ET by /api/cron/health-digest. This card
 * closes the "push, not pull" loop: silent degradation now surfaces
 * WITHOUT Nour having to remember to open /system/diagnostics.
 *
 * Render policy — deliberately SUBTLE when everything is healthy:
 *   • overall = "healthy" → card self-hides (no clutter)
 *   • overall = "warning" → amber strip, one-line summary, expandable
 *   • overall = "critical" → red card with pulse, top 3 highlights inline
 *   • digest >36h old → "stale" badge (nightly cron missed — itself a signal)
 *
 * Click any headline to deep-link into the matching detail page. Click
 * the rightmost chevron to collapse/expand. The header chip always
 * links to /system/diagnostics for the full probe grid.
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  TrendingDown,
  TrendingUp,
  Minus,
  RefreshCw,
} from "lucide-react";
import { useUltronFetch } from "@/lib/ultron/client-cache";
import { cn } from "@/lib/utils";
import { AnimatedCounter } from "@/components/ui/animated-counter";

import { trpc } from "@/lib/trpc/client";
interface HealthDigest {
  generatedAt: string;
  overall: "healthy" | "warning" | "critical";
  counts: { critical: number; warning: number; healthy: number };
  highlights: Array<{
    severity: "critical" | "warning" | "info";
    headline: string;
    link?: string;
  }>;
  stats: {
    cronsDeclared: number;
    cronsSilent: number;
    cronLogRows48h: number;
    staleRows: number;
    googleOauth: boolean;
    envReady: number;
    envTotal: number;
  };
  trend?: {
    priorDate: string;
    criticalDelta: number;
    warningDelta: number;
    silentCronsDelta: number;
    staleRowsDelta: number;
    overallDirection: "improving" | "degrading" | "stable";
  } | null;
  /** Set when the route recomputed live in this request. */
  livelyComputed?: boolean;
  /** Set when recompute failed and the route fell back to a stale row.
   *  When true, the card refuses to surface yesterday's highlights as
   *  authoritative — Nour explicitly asked never to see old info
   *  presented as current. */
  staleFallback?: boolean;
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function signedNum(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : String(n);
}

export function SystemHealthCard() {
  const { data, refetch } = useUltronFetch<HealthDigest>("/api/ultron/health-digest", {
    // Digest refreshes once a day. A 15-min HQ-local cache is ample —
    // no need to hammer the endpoint.
    ttlMs: 900_000,
  });
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Phase B.6a (2026-05-22) · the POST recompute migrated off
  // `authedFetch` onto `trpc.operator.refreshHealthDigest`. The
  // GET-side read still uses `useUltronFetch` above (that's a separate
  // endpoint · out of this sub-slice's scope) — so `manualRefresh`
  // fires the mutation, then refetches the GET to pull the freshly
  // persisted row, exactly as before.
  const refreshDigest = trpc.operator.refreshHealthDigest.useMutation();

  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Forces the route to recompute live regardless of age.
      await refreshDigest.mutateAsync();
      await refetch?.();
    } catch {
      /* surface via the data error path */
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refreshDigest]);

  // Silent when healthy — the whole point of the "push" digest is
  // to flag problems, not to congratulate on a clean run.
  if (!data) return null;
  if (data.overall === "healthy") return null;

  // ── Stale-fallback render path ──
  // Apr 26 · "I don't want to see any old information presented to me
  // anymore." When the route couldn't recompute and fell back to a
  // stale row, refuse to display yesterday's highlights as if they're
  // today's truth. Show only a refresh prompt + the staleness itself.
  if (data.staleFallback) {
    return (
      <section
        aria-label="System health digest (stale)"
        className="rounded-xl border border-white/10 bg-white/[0.02] backdrop-blur-sm"
      >
        <div className="flex items-center gap-2 px-3 py-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)]" />
          <AlertTriangle className="h-4 w-4 text-[var(--text-tertiary)]" />
          <div className="flex-1 min-w-0 text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">
              Health digest stale
            </span>
            <span className="ml-2 text-[var(--text-tertiary)]">
              · couldn&apos;t refresh — last data {Math.round(hoursSince(data.generatedAt))}h old, hidden
            </span>
          </div>
          <button
            type="button"
            onClick={manualRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-white/20 hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </section>
    );
  }
  // Inconsistent-data guard: the digest says "degraded" but counts
  // are empty AND highlights are empty. That's a stale or malformed
  // row — the fallback banner was misleading. Silent > noise.
  const noCounts =
    (data.counts?.critical ?? 0) === 0 && (data.counts?.warning ?? 0) === 0;
  const noHighlights =
    !Array.isArray(data.highlights) || data.highlights.length === 0;
  if (noCounts && noHighlights) return null;

  // Defensive normalization — the digest is stored as serialized JSON
  // so older rows might not have newer optional fields. Force shape
  // sanity so a missing field never crashes the whole HQ page.
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  const counts = data.counts ?? { critical: 0, warning: 0, healthy: 0 };
  const stats = data.stats ?? {
    cronsDeclared: 0,
    cronsSilent: 0,
    cronLogRows48h: 0,
    staleRows: 0,
    googleOauth: false,
    envReady: 0,
    envTotal: 0,
  };

  const ageH = hoursSince(data.generatedAt ?? new Date().toISOString());
  const stale = ageH > 36; // nightly cron itself missed a beat

  const critical = data.overall === "critical";
  const Icon = critical ? AlertCircle : AlertTriangle;

  // Tailwind-safe palette map — critical pulses, warning sits steady.
  const palette = critical
    ? {
        border: "border-rose-500/40",
        bg: "bg-rose-500/[0.08]",
        accent: "text-rose-300",
        dot: "bg-rose-400",
        ring: "ring-1 ring-rose-500/30",
        pulse: "animate-pulse",
      }
    : {
        border: "border-amber-500/30",
        bg: "bg-amber-500/[0.06]",
        accent: "text-amber-200",
        dot: "bg-amber-400",
        ring: "",
        pulse: "",
      };

  const topHighlights = critical
    ? highlights.filter((h) => h.severity === "critical").slice(0, 3)
    : highlights.slice(0, 2);

  // Second-layer safety: if a degraded overall resolves into zero
  // highlights (shape mismatch), synthesize a single line so the
  // card still renders something useful instead of an empty list.
  if (topHighlights.length === 0) {
    const label = critical ? "critical" : "degraded";
    topHighlights.push({
      severity: critical ? "critical" : "warning",
      headline: `System ${label} — open diagnostics for details`,
      link: "/system/health",
    });
  }

  return (
    <section
      aria-label="System health digest"
      className={cn(
        "rounded-xl border backdrop-blur-sm transition-colors",
        palette.border,
        palette.bg,
        palette.ring,
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <span className={cn("h-2 w-2 rounded-full", palette.dot, palette.pulse)} />
        <Icon className={cn("h-4 w-4", palette.accent)} />
        <div className="flex-1 min-w-0 text-sm">
          <span className={cn("font-semibold", palette.accent)}>
            {critical ? "System critical" : "System degraded"}
          </span>
          <span className="ml-2 text-[var(--text-secondary)]">
            {counts.critical > 0 ? (
              <>
                <AnimatedCounter value={counts.critical} /> critical ·{" "}
              </>
            ) : (
              ""
            )}
            {counts.warning > 0 ? (
              <>
                <AnimatedCounter value={counts.warning} /> warning
              </>
            ) : (
              "all other probes clean"
            )}
          </span>
        </div>
        {data.trend && data.trend.overallDirection !== "stable" && (
          <span
            title={`vs ${data.trend.priorDate}: critical ${signedNum(data.trend.criticalDelta)} · warning ${signedNum(data.trend.warningDelta)} · silent crons ${signedNum(data.trend.silentCronsDelta)}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              data.trend.overallDirection === "degrading"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
            )}
          >
            {data.trend.overallDirection === "degrading" ? (
              <TrendingUp className="h-2.5 w-2.5" />
            ) : (
              <TrendingDown className="h-2.5 w-2.5" />
            )}
            <span>{data.trend.overallDirection}</span>
          </span>
        )}
        {data.trend?.overallDirection === "stable" && (
          <span
            title={`vs ${data.trend.priorDate}: no change`}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.02] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
          >
            <Minus className="h-2.5 w-2.5" />
            <span>stable</span>
          </span>
        )}
        {stale && (
          <button
            type="button"
            onClick={manualRefresh}
            disabled={refreshing}
            title={`Digest generated ${Math.round(ageH)}h ago — tap to refresh now`}
            className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-300 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-2.5 w-2.5", refreshing && "animate-spin")} />
            <span>{refreshing ? "refreshing" : `stale ${Math.round(ageH)}h`}</span>
          </button>
        )}
        {data.livelyComputed && !stale && (
          <span
            title="Recomputed live in this request — not from yesterday's nightly cron"
            className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300"
          >
            live
          </span>
        )}
        <Link
          href="/system/health"
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-white/20 hover:text-[var(--text-primary)] transition-colors"
        >
          diagnostics →
        </Link>
        <button
          type="button"
          aria-label={expanded ? "Collapse details" : "Expand details"}
          onClick={() => setExpanded((x) => !x)}
          className="rounded-md p-1 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center text-[var(--text-tertiary)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-colors"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </header>

      {/* Top 2-3 highlights always visible — that's the push value */}
      <ul className="space-y-1 border-t border-white/5 px-3 py-2 text-xs">
        {topHighlights.map((h, i) => {
          const dotColor =
            h.severity === "critical"
              ? "bg-rose-400"
              : h.severity === "warning"
                ? "bg-amber-400"
                : "bg-sky-400";
          return (
            <li key={i} className="flex items-start gap-2">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dotColor)} />
              {h.link ? (
                <Link
                  href={h.link}
                  className="flex-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors inline-flex items-center gap-1"
                >
                  <span>{h.headline}</span>
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </Link>
              ) : (
                <span className="flex-1 text-[var(--text-secondary)]">{h.headline}</span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Expanded — full stats grid for deep-dive */}
      {expanded && (
        <div className="grid grid-cols-2 gap-2 border-t border-white/5 px-3 py-2 text-[11px] sm:grid-cols-4">
          <StatCell
            label="crons declared"
            numeric={stats.cronsDeclared}
          />
          <StatCell
            label="silent 48h"
            numeric={stats.cronsSilent}
            warn={stats.cronsSilent > 0}
          />
          <StatCell
            label="stale rows"
            numeric={stats.staleRows}
            warn={stats.staleRows > 50}
          />
          <StatCell
            label="cron logs 48h"
            numeric={stats.cronLogRows48h}
          />
          <StatCell
            label="google oauth"
            value={stats.googleOauth ? "ok" : "expired"}
            warn={!stats.googleOauth}
          />
          <StatCell
            label="env groups"
            value={`${stats.envReady}/${stats.envTotal}`}
            warn={stats.envTotal - stats.envReady > 2}
          />
          <StatCell
            label="generated"
            value={`${Math.round(ageH)}h ago`}
            warn={stale}
          />
          <StatCell
            label="source"
            value="cron:health-digest"
          />
        </div>
      )}
    </section>
  );
}

function StatCell({
  label,
  value,
  numeric,
  warn = false,
}: {
  label: string;
  value?: string;
  numeric?: number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1">
      <div className="text-[var(--text-tertiary)] text-[9px] uppercase tracking-wide">
        {label}
      </div>
      <div
        className={cn(
          "text-xs font-medium tabular-nums",
          warn ? "text-amber-300" : "text-[var(--text-primary)]",
        )}
      >
        {numeric !== undefined ? <AnimatedCounter value={numeric} /> : value}
      </div>
    </div>
  );
}
