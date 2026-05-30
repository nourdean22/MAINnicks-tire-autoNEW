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
import { trpc } from "@/lib/trpc/client";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
import { BRANCHES } from "@/lib/mastery/config";

interface StatLevel {
  key: string;
  label: string;
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
  // The slope: the stat that gained the most XP this week. The dopamine is
  // in the derivative — what's accelerating, not the static level.
  const topRiser = stats.reduce<StatLevel | null>(
    (best, x) => (x.rising7dXp > (best?.rising7dXp ?? 0) ? x : best),
    null,
  );

  return (
    <section className="mt-6 space-y-3">
      <MasterySectionLabel label="Mastery · character sheet" count={stats.length} />

      {/* Overall-power hero · the one number that sums every stat. */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3.5 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">
            Power
          </span>
          <span className="text-2xl font-medium tabular-nums text-[var(--brand-gold,#FDB913)] leading-none">
            Lvl {totalLevel}
          </span>
          <span className="text-[10px] tabular-nums text-white/35">
            {totalXp.toLocaleString()} XP
          </span>
        </div>
        {topRiser ? (
          <p
            className="text-[11px] text-white/70 truncate"
            title={`Fastest riser this week · +${topRiser.rising7dXp} XP`}
          >
            <span style={{ color: topRiser.color }}>▲ week</span> {topRiser.icon}{" "}
            {topRiser.label}{" "}
            <span className="tabular-nums text-white/50">+{topRiser.rising7dXp}</span>
          </p>
        ) : (
          <p className="text-[11px] text-white/70 truncate" title="Peak stat">
            <span className="text-white/35">peak</span> {peak.tierEmoji} {peak.icon}{" "}
            {peak.label}
          </p>
        )}
      </div>

      {/* Per-branch skill-tree groups. Stats arrive pre-sorted by level;
          we keep that order within each branch so the strongest leads. */}
      {BRANCHES.map((br) => {
        const inBranch = stats.filter((s) => s.branch === br.key);
        if (inBranch.length === 0) return null;
        return (
          <div key={br.key} className="space-y-2 pt-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm" aria-hidden>
                {br.icon}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                {br.label}
              </span>
              <span className="text-[10px] text-white/30">· {br.blurb}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {inBranch.map((s) => (
                <StatCard key={s.key} stat={s} />
              ))}
            </div>
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
            {stat.label}
          </span>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-white/90">
            Lvl {stat.level}
            <span className="ml-0.5 text-[10px]" aria-hidden>
              {stat.tierEmoji}
            </span>
          </span>
        </div>
        {/* line 2 · thin progress bar (stat color) + xp-into-level */}
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
      </div>
    </div>
  );
}
