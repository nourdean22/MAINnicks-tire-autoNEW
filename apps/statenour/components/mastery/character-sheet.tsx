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
 * page); renders the honest Day-1 state (all Lvl 1) when there's no XP
 * yet — that empty board is the thing that lights up as work lands.
 */
import { trpc } from "@/lib/trpc/client";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";

interface StatLevel {
  key: string;
  label: string;
  icon: string;
  color: string;
  xp: number;
  level: number;
  tier: string;
  tierEmoji: string;
  xpIntoLevel: number;
  xpForNext: number;
  progressPct: number;
}

export function CharacterSheet() {
  const query = trpc.operator.characterSheet.useQuery(undefined, {
    staleTime: 60_000,
  });
  const stats = (query.data as StatLevel[] | undefined) ?? [];

  // Cold load: render nothing (the scoreboard already has plenty above).
  if (query.isLoading && stats.length === 0) return null;
  // Transient error: self-hide rather than break the page.
  if (query.error || stats.length === 0) return null;

  // Total level — the classic RPG aggregate. Sum, not average, so every
  // level in every stat visibly counts toward one number.
  const totalLevel = stats.reduce((s, x) => s + x.level, 0);
  const totalXp = Math.round(stats.reduce((s, x) => s + x.xp, 0));
  // Highest current tier reached across all stats, for the hero badge.
  const peak = stats[0]; // already sorted by level desc

  return (
    <section className="mt-6 space-y-3">
      <MasterySectionLabel label="Mastery · character sheet" count={stats.length} />

      {/* Overall-power hero · the one number that sums every stat. */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-1">
            Overall power
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-medium tabular-nums text-[var(--brand-gold,#FDB913)]">
              Lvl {totalLevel}
            </span>
            <span className="text-[11px] tabular-nums text-white/40">
              {totalXp.toLocaleString()} XP
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-1">
            Peak stat
          </p>
          <p className="text-[13px] text-white/85">
            {peak.tierEmoji} {peak.icon} {peak.label}
          </p>
        </div>
      </div>

      {/* Per-stat level cards. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {stats.map((s) => (
          <StatCard key={s.key} stat={s} />
        ))}
      </div>
    </section>
  );
}

function StatCard({ stat }: { stat: StatLevel }) {
  const pct = Math.max(0, Math.min(100, stat.progressPct));
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition">
      {/* icon + label + tier */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base leading-none shrink-0" aria-hidden>
            {stat.icon}
          </span>
          <span className="text-[12px] font-medium text-white/85 truncate">
            {stat.label}
          </span>
        </div>
        <span
          className="text-[9px] uppercase tracking-[0.14em] text-white/50 shrink-0 whitespace-nowrap"
          title={`${stat.tier} tier`}
        >
          {stat.tierEmoji} {stat.tier}
        </span>
      </div>

      {/* big level */}
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-medium tabular-nums text-white">
          Lvl {stat.level}
        </span>
        <span className="text-[10px] tabular-nums text-white/35">
          {Math.round(stat.xp).toLocaleString()} XP total
        </span>
      </div>

      {/* progress bar · stat's own color */}
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: stat.color }}
        />
      </div>
      <p className="mt-1.5 text-[10px] tabular-nums text-white/40">
        {stat.xpIntoLevel} / {stat.xpForNext} XP → Lvl {stat.level + 1}
      </p>
    </div>
  );
}
