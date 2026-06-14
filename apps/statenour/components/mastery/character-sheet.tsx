"use client";

/**
 * <CharacterSheet> · 2026-05-30 · the leveling engine's face.
 *
 * Renders every mastery stat as an RPG-style level card — icon · tier ·
 * big level number · an XP progress bar in the stat's own color ·
 * "X / Y XP to Lvl N+1". Sorted server-side by level so the strongest
 * stats lead. Plus an "Overall power" hero (sum of levels), the classic
 * total-level metaphor (RuneScape-style) the operator asked for:
 * "leveling up in a video game whenever I do anything."
 *
 * Reads `trpc.operator.characterSheet` → computeCharacterSheet(), the
 * SAME numbers Nick's system prompt speaks in (lib/mastery/character-
 * sheet.statLine). Schema-free · no new tables.
 *
 * Aesthetic: matches /scoreboard's editorial-minimalist Card contract
 * (border-white/10 · bg-white/[0.02] · text-[10px] uppercase labels ·
 * tabular-nums). The only added color is each stat's own accent on its
 * progress bar — identity without noise.
 *
 * Degradation: self-hides on a transient query error (never breaks the
 * page). Stats open at a starting level seeded from your baseline self-
 * rating and climb as work lands, so the board reads as who you are today.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
import { BRANCHES } from "@/lib/mastery/config";
import { ShieldAlert } from "lucide-react";
import { ErrorCard } from "@/components/ui/error-card";
import { EmptyState } from "@/components/ui/empty-state";

interface StatLevel {
  key: string;
  label: string;
  shortLabel?: string;
  description?: string;
  icon: string;
  color: string;
  branch: string;
  xp: number;
  level: number;
  tier: string;
  tierEmoji: string;
  xpIntoLevel: number;
  xpForNext: number;
  progressPct: number;
  rising7dXp: number;
  goals?: { id: string; title: string }[];
}

export function CharacterSheet() {
  const query = trpc.operator.characterSheet.useQuery(undefined, {
    staleTime: 60_000,
  });
  const stats = (query.data as StatLevel[] | undefined) ?? [];

  // 2026-05-30 · mobile · collapsible branch sections. 33 stats in one phone
  // column is a ~4-screen scroll; folding a branch (persisted to localStorage)
  // cuts it. Default = all expanded (no first-visit regression). These hooks
  // run BEFORE the early returns below so hook order stays stable.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("nour:stats:collapsed-branches:v1");
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* corrupt/unavailable storage — stay all-expanded */
    }
  }, []);
  const toggleBranch = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(
          "nour:stats:collapsed-branches:v1",
          JSON.stringify([...next]),
        );
      } catch {
        /* ignore */
      }
      return next;
    });

  // Cold load: render nothing (the scoreboard already has plenty above).
  if (query.isLoading && stats.length === 0) return null;

  // Render error card if the query fails.
  if (query.error) {
    return (
      <section className="mt-6 space-y-4">
        <MasterySectionLabel label="Mastery · character sheet" />
        <ErrorCard
          title="Failed to load character sheet"
          message={query.error.message || "Stats data is unavailable right now."}
          domain="operator:characterSheet"
          onRetry={() => query.refetch()}
        />
      </section>
    );
  }

  // Render empty state if query succeeded but there's no stats recorded.
  if (stats.length === 0) {
    return (
      <section className="mt-6 space-y-4">
        <MasterySectionLabel label="Mastery · character sheet" />
        <EmptyState
          icon={ShieldAlert}
          title="No stats recorded yet"
          why="Stats populate as daily reps and goal events are logged."
          unlock="Log a workout, weight entry, or complete a mission task."
        />
      </section>
    );
  }

  // Total level — the classic RPG aggregate. Sum, not average, so every
  // level in every stat visibly counts toward one number.
  const totalLevel = stats.reduce((s, x) => s + x.level, 0);
  const totalXp = Math.round(stats.reduce((s, x) => s + x.xp, 0));
  // Highest current tier reached across all stats, for the hero badge.
  const peak = stats[0]; // already sorted by level desc
  // The slope: the stat that gained the most XP this week. The dopamine is
  // in the derivative — what's accelerating, not the static level.
  const topRiser = stats.reduce<StatLevel | null>(
    (best, x) => (x.rising7dXp > (best?.rising7dXp ?? 0) ? x : best),
    null,
  );
  // Agentic nudge — the stat you're closest to leveling (most progress into
  // its current level). Null when nothing's on the verge.
  const nextRep = stats.reduce<StatLevel | null>(
    (best, x) => (x.progressPct > (best?.progressPct ?? 0) ? x : best),
    null,
  );

  // Compute branch level summaries for the Identity Build Card
  const branchLevels = stats.reduce<Record<string, number>>((acc, s) => {
    acc[s.branch] = (acc[s.branch] || 0) + s.level;
    return acc;
  }, { body: 0, mind: 0, empire: 0, influence: 0 });

  const totalBranchLevel = Object.values(branchLevels).reduce((a, b) => a + b, 0);

  let archetypeLabel = "Balanced Polymath";
  let archetypeDesc = "Disciplined mastery across all domains";

  if (totalBranchLevel > 0) {
    const sortedBranches = Object.entries(branchLevels).sort((a, b) => b[1] - a[1]);
    const topBranch = sortedBranches[0];
    const runnerUpBranch = sortedBranches[1];
    
    // If top branch is dominant (more than 5% lead over runner up)
    if (topBranch[1] - runnerUpBranch[1] > totalBranchLevel * 0.05) {
      if (topBranch[0] === "body") {
        archetypeLabel = "Physical Sentinel";
        archetypeDesc = "Peak vitality & condition";
      } else if (topBranch[0] === "mind") {
        archetypeLabel = "Mind Strategist";
        archetypeDesc = "Fortitude & focus mastery";
      } else if (topBranch[0] === "empire") {
        archetypeLabel = "Empire Architect";
        archetypeDesc = "Systems & craft building";
      } else if (topBranch[0] === "influence") {
        archetypeLabel = "Sovereign Influencer";
        archetypeDesc = "Networking & people leadership";
      }
    }
  }

  // Find the highest-level stat that hasn't gained any XP this week (rising7dXp === 0)
  const highestNeglected = [...stats]
    .filter((s) => s.rising7dXp === 0)
    .sort((a, b) => b.level - a.level)[0] ?? null;

  return (
    <section className="mt-6 space-y-4">
      <MasterySectionLabel label="Mastery · character sheet" count={stats.length} />

      {/* RPG Hero Card & Identity Build Card - Bento Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Card 1: Core Hero Sheet */}
        <div className="md:col-span-2 rounded-xl border border-white/10 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950/80 p-4 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[140px]">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--gold)]/5 rounded-full blur-2xl pointer-events-none" />
          
          <div className="flex items-start justify-between">
            <div className="space-y-0.5">
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--gold)]/80">
                character sheet
              </span>
              <h3 className="text-lg font-bold uppercase tracking-wide text-white/90">
                {archetypeLabel}
              </h3>
            </div>
            <span className="text-[10px] font-mono text-white/35 uppercase tracking-wider">
              {archetypeDesc}
            </span>
          </div>

          <div className="mt-4 flex items-end justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[9px] font-mono uppercase text-white/40">total level</span>
                <span className="text-3xl font-extrabold text-[var(--gold)] font-display tracking-tight leading-none">
                  {totalLevel}
                </span>
              </div>
              <span className="block text-[10px] font-mono text-white/35">
                {totalXp.toLocaleString()} TOTAL XP
              </span>
            </div>

            {/* Branch Level bars summary */}
            <div className="flex items-center gap-3 shrink-0">
              {BRANCHES.map((br) => {
                const brLvl = branchLevels[br.key] || 0;
                const brPct = totalLevel > 0 ? (brLvl / totalLevel) * 100 : 0;
                return (
                  <div key={br.key} className="flex flex-col items-center gap-1" title={`${br.label}: Level ${brLvl}`}>
                    <span className="text-xs" aria-hidden>{br.icon}</span>
                    <div className="h-8 w-1.5 rounded-full bg-white/5 overflow-hidden flex flex-col justify-end">
                      <div className="w-full bg-[var(--gold)] rounded-full" style={{ height: `${brPct}%` }} />
                    </div>
                    <span className="text-[8px] font-mono text-white/40">{brLvl}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card 2: Next Rep & Neglected Stats */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between space-y-3">
          {nextRep ? (
            <div className="space-y-1">
              <span className="text-[8px] font-mono uppercase tracking-wider text-white/45 block">
                closest level up (next rep)
              </span>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="text-xs">{nextRep.icon}</span>
                  <span className="text-[12px] font-semibold text-white/95">{nextRep.shortLabel || nextRep.label}</span>
                </div>
                <span className="text-[11px] font-mono font-semibold" style={{ color: nextRep.color }}>
                  Lvl {nextRep.level} → {nextRep.level + 1}
                </span>
              </div>
              <div className="pt-1 flex items-center gap-1.5">
                <div className="h-1 flex-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${nextRep.progressPct}%`, backgroundColor: nextRep.color }} />
                </div>
                <span className="text-[9px] font-mono text-white/50 shrink-0">
                  {Math.round(nextRep.xpForNext - nextRep.xpIntoLevel)} XP
                </span>
              </div>
            </div>
          ) : null}

          {/* Neglected stat check */}
          {highestNeglected ? (
            <div className="pt-2 border-t border-white/5 space-y-1">
              <div className="flex items-center gap-1.5 text-amber-500">
                <ShieldAlert size={10} />
                <span className="text-[8px] font-mono uppercase tracking-wider">
                  neglected stat (7d idle)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-white/80 flex items-center gap-1">
                  <span>{highestNeglected.icon}</span>
                  <span>{highestNeglected.shortLabel || highestNeglected.label}</span>
                </span>
                <span className="text-[10px] font-mono text-white/40">Lvl {highestNeglected.level}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {/* Per-branch skill-tree groups. Stats arrive pre-sorted by level;
          we keep that order within each branch so the strongest leads. */}
      {BRANCHES.map((br) => {
        const inBranch = stats.filter((s) => s.branch === br.key);
        if (inBranch.length === 0) return null;
        const isCollapsed = collapsed.has(br.key);
        return (
          <div key={br.key} className="space-y-2 pt-1">
            {/* Header doubles as a fold toggle · ≥44px tap target · state
                persists in localStorage · cuts the mobile scroll. */}
            <button
              type="button"
              onClick={() => toggleBranch(br.key)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2 min-h-[44px] text-left"
            >
              <span className="text-sm" aria-hidden>
                {br.icon}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                {br.label}
              </span>
              <span className="truncate text-[10px] text-white/30">· {br.blurb}</span>
              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-white/30">
                {inBranch.length}
              </span>
              <span
                className="shrink-0 w-3 text-center text-[11px] text-white/40"
                aria-hidden
              >
                {isCollapsed ? "▸" : "▾"}
              </span>
            </button>
            {isCollapsed ? null : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {inBranch.map((s) => (
                  <StatCard key={s.key} stat={s} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function StatCard({ stat }: { stat: StatLevel }) {
  const pct = Math.max(0, Math.min(100, stat.progressPct));
  return (
    <div
      className="flex items-center gap-2.5 rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5 hover:bg-white/[0.04] transition-colors"
      title={`${stat.tier} · ${Math.round(stat.xp).toLocaleString()} XP total · ${stat.xpIntoLevel}/${stat.xpForNext} to Lvl ${stat.level + 1}`}
    >
      <span className="text-base leading-none shrink-0" aria-hidden>
        {stat.icon}
      </span>
      <div className="min-w-0 flex-1">
        {/* line 1 · label + level + tier emoji */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[11.5px] font-medium text-white/80">
            {stat.shortLabel || stat.label}
          </span>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-white/90">
            Lvl {stat.level}
            <span className="ml-0.5 text-[10px]" aria-hidden>
              {stat.tierEmoji}
            </span>
          </span>
        </div>
        {/* line 2 · thin progress bar (stat color) + xp-into-level */}
        {stat.description ? (
          <p className="mt-0.5 text-[10px] leading-snug text-white/35" title={stat.description}>
            {stat.description}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-1.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: stat.color }}
            />
          </div>
          {stat.rising7dXp > 0 ? (
            <span
              className="shrink-0 text-[9px] font-semibold tabular-nums"
              style={{ color: stat.color }}
              title={`+${stat.rising7dXp} XP this week`}
            >
              ▲{stat.rising7dXp}
            </span>
          ) : null}
        </div>
        {/* line 3 · Ambition Engine P1 citation — the active goals feeding
            this stat (the reverse of the goal-card chips). Each links to its
            goal card on /stats. Renders only when a goal points here, so most
            cards stay one-liner clean. */}
        {Array.isArray(stat.goals) && stat.goals.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="shrink-0 text-[8px] uppercase tracking-[0.16em] text-white/25">
              goals
            </span>
            {stat.goals.slice(0, 3).map((g) => (
              <a
                key={g.id}
                href={`/stats#goal-${g.id}`}
                title={g.title}
                className="max-w-[120px] truncate text-[9px] text-white/45 underline decoration-white/10 underline-offset-2 hover:text-white/75"
              >
                {g.title}
              </a>
            ))}
            {stat.goals.length > 3 ? (
              <span className="shrink-0 text-[9px] text-white/30">
                +{stat.goals.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
