"use client";

/**
 * BrainContinuityView · v10.0.330 · cross-session memory continuity
 * dashboard.
 *
 * Extracted from /brain/continuity for cluster-merge with health +
 * categories views into the unified /brain/health page. Drops the
 * page-level PageHeader · the unified shell provides title + tabs.
 *
 * What this view shows:
 *   · Memory totals (all-time / active / expired)
 *   · GlobalActivityStream · cross-entity audit feed (Phase 2A · v8.1)
 *   · Category movers · 24h + 7d deltas
 *   · 4-column recent activity · NEW · REINFORCED · PROMOTED · DECAYING
 *   · Top reinforced (last 7d) + Top confidence (all-time)
 *
 * Each memory row · confidence + seenCount + age. The continuity lens
 * answers "what happened in Nick's head since yesterday."
 */

import { trpc } from "@/lib/trpc/client";
import { Sparkline } from "@/components/ui/sparkline";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Brain,
  ChevronDown,
  Loader2,
  Flame,
} from "lucide-react";
import { useCallback, useState } from "react";
import { ReceiptsTimeline } from "@/components/brain/receipts-timeline";

interface Memory {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  seenCount: number;
  source: string;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
}

interface ContinuityPayload {
  totals: {
    allTime: number;
    active: number;
    expired: number;
    byCategory: Record<string, number>;
  };
  recent: {
    created: Memory[];
    reinforced: Memory[];
    decayed: Memory[];
    promoted: Memory[];
    prunedEstimate: number;
  };
  topReinforced: Memory[];
  topConfidence: Memory[];
  categoryMovers: Array<{ category: string; delta24h: number; delta7d: number; total: number }>;
  computedAt: string;
}

export function BrainContinuityView() {
  // scattered-components REST→tRPC slice (2026-05-22) · migrated off
  // `useAuthedFetch<ContinuityPayload>("/api/brain/continuity")` onto
  // `trpc.brain.continuityReport.useQuery()`. The procedure delegates
  // to the same `buildContinuityReport` service the REST route also
  // calls. `loading` ← `isLoading`, `error` ← the TRPCClientError's
  // `.message` (the legacy hook surfaced a plain string), `reload` ←
  // `refetch`.
  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
  } = trpc.brain.continuityReport.useQuery();
  const error = queryError?.message ?? null;
  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (loading && !data) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] py-4 justify-center">
          <Loader2 size={12} className="animate-spin" />
          reading the brain…
        </div>
      </GlassCard>
    );
  }

  if (error) {
    return (
      <GlassCard className="border-rose-500/30 bg-rose-500/5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-rose-300">continuity fetch failed</p>
            <p className="text-[10px] text-rose-300/70 mt-0.5 break-words font-mono">{error}</p>
          </div>
          <button
            onClick={reload}
            className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-400/10"
          >
            retry
          </button>
        </div>
      </GlassCard>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* BDN-003 (2026-08-12) · ONE merged activity/receipts timeline —
          the fold ORGANIZATION-WIRING-AUDIT §6/§7 prescribed. Supersedes
          the entity-audit-only GlobalActivityStream here: the receipt
          feed's 3-source merge INCLUDES entity-audit rows, plus
          autonomous-action + agent action_receipt rows, with status
          filters. GlobalActivityStream's file is untouched (Home-console
          precedent: stop mounting, don't delete); its load-older
          archaeology remains reachable via system.entityHistory drawers. */}
      <ReceiptsTimeline limit={30} />

      {/* ── Totals ── */}
      <GlassCard>
        <div className="flex items-center gap-2 mb-3">
          <Brain size={14} className="text-[var(--gold)]" />
          <span className="section-label">Memory totals</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <TotalCell label="all time" value={data.totals.allTime} color="gold" />
          <TotalCell label="active" value={data.totals.active} color="emerald" />
          <TotalCell label="expired" value={data.totals.expired} color="tertiary" />
        </div>
        {data.recent.prunedEstimate > 0 && (
          <p className="mt-2 text-[10px] text-[var(--text-tertiary)] text-center">
            ~{data.recent.prunedEstimate} decayed/pruned in the last cycle
          </p>
        )}
      </GlassCard>

      {/* ── Category movers ── */}
      {data.categoryMovers.length > 0 && (
        <GlassCard>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={13} className="text-[var(--gold)]" />
            <span className="section-label">Category movers · last 24h</span>
          </div>
          <div className="space-y-1">
            {data.categoryMovers.slice(0, 8).map((m) => {
              const ratio = m.total > 0 ? m.delta24h / m.total : 0;
              const hot = ratio > 0.3;
              return (
                <div
                  key={m.category}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded border transition-colors",
                    hot ? "border-[var(--gold)]/30 bg-[var(--gold)]/5" : "border-[var(--border-default)] bg-[var(--bg-base)]/50",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-[var(--text-primary)] truncate">{m.category}</span>
                      {hot && <Flame size={10} className="text-[var(--gold)]" />}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-3 text-[9px] font-mono tabular-nums">
                    <span className={hot ? "text-[var(--gold)]" : "text-[var(--text-secondary)]"}>+{m.delta24h}<span className="text-[var(--text-tertiary)]">/24h</span></span>
                    <span className="text-[var(--text-tertiary)]">+{m.delta7d}/7d</span>
                    <span className="text-[var(--text-tertiary)]">total {m.total}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* ── 4-column recent activity ── */}
      <div className="grid md:grid-cols-2 gap-3">
        <RecentColumn
          title="new · 24h"
          icon={<Sparkles size={13} className="text-emerald-400" />}
          memories={data.recent.created}
          emptyMsg="no new memories in last 24h"
        />
        <RecentColumn
          title="reinforced · 24h"
          icon={<TrendingUp size={13} className="text-[var(--gold)]" />}
          memories={data.recent.reinforced}
          emptyMsg="no reinforcements in last 24h — idle"
        />
        <RecentColumn
          title="promoted to wisdom · 24h"
          icon={<Flame size={13} className="text-violet-400" />}
          memories={data.recent.promoted}
          emptyMsg="no new wisdom promotions"
        />
        <RecentColumn
          title="decaying · low conf + stale"
          icon={<TrendingDown size={13} className="text-rose-400" />}
          memories={data.recent.decayed}
          emptyMsg="no memories below the decay line"
        />
      </div>

      {/* ── Top leaderboards ── */}
      <div className="grid md:grid-cols-2 gap-3">
        <GlassCard>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={13} className="text-[var(--gold)]" />
            <span className="section-label">Top reinforced · last 7d</span>
          </div>
          <MemoryList memories={data.topReinforced} emptyMsg="quiet week" highlight="seenCount" />
        </GlassCard>
        <GlassCard>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={13} className="text-violet-400" />
            <span className="section-label">Top confidence · all time</span>
          </div>
          <MemoryList memories={data.topConfidence} emptyMsg="no high-conf memories yet" highlight="confidence" />
        </GlassCard>
      </div>
    </div>
  );
}

function TotalCell({ label, value, color }: { label: string; value: number; color: "gold" | "emerald" | "tertiary" }) {
  const colorClass = color === "gold" ? "text-[var(--gold)]" : color === "emerald" ? "text-emerald-400" : "text-[var(--text-tertiary)]";
  return (
    <div className="text-center">
      <div className={cn("text-[24px] font-[var(--font-display)] font-bold tabular-nums leading-none", colorClass)}>
        <AnimatedCounter value={value} duration={900} />
      </div>
      <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mt-1">{label}</div>
    </div>
  );
}

function RecentColumn({
  title,
  icon,
  memories,
  emptyMsg,
}: {
  title: string;
  icon: React.ReactNode;
  memories: Memory[];
  emptyMsg: string;
}) {
  const [showAll, setShowAll] = useState(false);
  // v10.0.285 · capture render-time once at mount instead of calling
  // Date.now() inside MemoryRow on every render (impure-call lint).
  // Staleness is acceptable here · this is a snapshot view, ages are
  // re-computed when the parent data refresh forces a remount.
  const [now] = useState(() => Date.now());
  const visible = showAll ? memories : memories.slice(0, 5);
  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="section-label">{title}</span>
        <span className="ml-auto text-[9px] font-mono text-[var(--text-tertiary)] tabular-nums">
          {memories.length}
        </span>
      </div>
      {memories.length === 0 ? (
        <p className="text-[10px] text-[var(--text-tertiary)] italic text-center py-2">{emptyMsg}</p>
      ) : (
        <>
          <div className="space-y-1">
            {visible.map((m) => (
              <MemoryRow key={m.id} m={m} now={now} />
            ))}
          </div>
          {memories.length > 5 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 w-full flex items-center justify-center gap-1 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)]"
            >
              {showAll ? "collapse" : `show ${memories.length - 5} more`}
              <ChevronDown size={10} className={cn("transition-transform", showAll && "rotate-180")} />
            </button>
          )}
        </>
      )}
    </GlassCard>
  );
}

function MemoryRow({ m, now }: { m: Memory; now: number }) {
  const confPct = Math.round(m.confidence * 100);
  const confColor = confPct >= 80 ? "text-emerald-400" : confPct >= 50 ? "text-[var(--gold)]" : confPct >= 25 ? "text-amber-400" : "text-rose-400";
  const ageMs = now - new Date(m.lastSeen).getTime();
  const ageLabel = ageMs < 60_000 ? "just now" : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m` : ageMs < 86_400_000 ? `${Math.floor(ageMs / 3_600_000)}h` : `${Math.floor(ageMs / 86_400_000)}d`;
  return (
    <div className="group px-2 py-1.5 rounded bg-[var(--bg-base)]/50 border border-[var(--border-default)] hover:border-[var(--border-default)]/70 transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">{m.category}</span>
            <span className={cn("text-[9px] font-mono tabular-nums", confColor)}>{confPct}%</span>
            {m.seenCount > 1 && <span className="text-[9px] font-mono tabular-nums text-[var(--text-tertiary)]">×{m.seenCount}</span>}
            <span className="text-[9px] font-mono tabular-nums text-[var(--text-tertiary)] ml-auto">{ageLabel}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] leading-snug line-clamp-2">{m.content}</p>
        </div>
      </div>
    </div>
  );
}

function MemoryList({ memories, emptyMsg, highlight }: { memories: Memory[]; emptyMsg: string; highlight: "seenCount" | "confidence" }) {
  if (memories.length === 0) {
    return <p className="text-[10px] text-[var(--text-tertiary)] italic text-center py-2">{emptyMsg}</p>;
  }
  return (
    <div className="space-y-1">
      {memories.map((m, i) => (
        <div key={m.id} className="flex items-start gap-2 px-2 py-1.5 rounded bg-[var(--bg-base)]/50 border border-[var(--border-default)]">
          <span className="shrink-0 w-4 text-[9px] font-mono text-[var(--text-tertiary)] tabular-nums">#{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">{m.category}</span>
              {highlight === "seenCount" && <span className="text-[9px] font-mono tabular-nums text-[var(--gold)]">×{m.seenCount}</span>}
              {highlight === "confidence" && <span className="text-[9px] font-mono tabular-nums text-violet-400">{Math.round(m.confidence * 100)}%</span>}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] leading-snug line-clamp-2">{m.content}</p>
          </div>
        </div>
      ))}
      {/* Mini-sparkline: confidence ladder visualization */}
      <div className="mt-2 flex items-center gap-2 text-[9px] font-mono text-[var(--text-tertiary)]">
        <span>ladder</span>
        <Sparkline data={memories.map((m) => (highlight === "confidence" ? m.confidence : m.seenCount))} width={120} height={18} color={highlight === "confidence" ? "#a78bfa" : "var(--gold)"} />
      </div>
    </div>
  );
}
