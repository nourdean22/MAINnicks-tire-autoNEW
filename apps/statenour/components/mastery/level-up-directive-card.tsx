"use client";

/**
 * <LevelUpDirectiveCard> · /stats delivery-layer pass · 2026-06-10.
 *
 * The stat board's missing sentence: "level THIS stat today, because X,
 * and here is the exact rep." Selection is pure + deterministic
 * (lib/mastery/level-up-directive: tier ladder documented there); this
 * component only feeds it data the page ALREADY fetches and renders the
 * verdict. Zero new server work:
 *   · operator.characterSheet: same query key + staleTime as
 *     <CharacterSheet> below → one network call, shared cache.
 *   · task.goals: same key GoalBoard's utils.task.goals.fetch()
 *     populates → shared cache.
 *   · operator.bodyTracking({range:"90d"}): same key the lazy
 *     BodySection fetches → this card just warms it earlier.
 *
 * Honesty contract: a failed, paused or unanswered read is named in the
 * card (ReadStateNote), never hidden and never read as an empty board; a
 * real empty board → an explicit "Missing data" line, never a fabricated
 * recommendation. Every reason starts
 * "Because…"/"Based on…": no mysterious AI vibes (and no AI: this is
 * arithmetic over the XP log).
 *
 * Supersedes the old CharacterSheet "Next rep" strip: that heuristic
 * (max progressPct) lives on as this selector's weakest tier ("closest").
 */
import { useMemo } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { today } from "@/lib/utils/datetime";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { isRetrying, readState } from "@/lib/query-state";
import { computePace } from "@/lib/brain/goal-pace";
import {
  selectLevelUpDirective,
  type DirectiveStat,
  type DirectiveGoal,
} from "@/lib/mastery/level-up-directive";

/** Structural subset of the task.goals payload rows this card reads. */
interface GoalRow {
  id: string;
  title: string;
  status: string;
  progress: number;
  currentValue: number;
  targetValue: number;
  deadline: string | null;
  createdAt: string;
  stats?: { statKey: string; weight: number }[];
  nextMove?: { id: string; title: string; status: string } | null;
}

interface BodyRow {
  date: string;
  sleepHours: number | null;
  energy: number | null;
  workoutDone: boolean | null;
}

export function LevelUpDirectiveCard() {
  const sheetQ = trpc.operator.characterSheet.useQuery(undefined, {
    staleTime: 60_000,
  });
  const goalsQ = trpc.task.goals.useQuery(undefined, { staleTime: 60_000 });
  const bodyQ = trpc.operator.bodyTracking.useQuery(
    { range: "90d" },
    { staleTime: 60_000 },
  );

  const stats = sheetQ.data as DirectiveStat[] | undefined;

  const directive = useMemo(() => {
    if (!stats || stats.length === 0) return null;
    const rows =
      (goalsQ.data as { goals?: GoalRow[] } | undefined)?.goals ?? [];
    const goals: DirectiveGoal[] = rows
      .filter((g) => g.status === "active")
      .map((g) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        progress: g.progress,
        stats: g.stats,
        nextMove: g.nextMove,
        pace: computePace({
          currentValue: g.currentValue,
          targetValue: g.targetValue,
          deadline: g.deadline,
          createdAt: g.createdAt,
        }),
      }));
    const entries =
      (bodyQ.data as { entries?: BodyRow[] } | undefined)?.entries ?? [];
    const latest = entries.length > 0 ? entries[entries.length - 1] : null;
    return selectLevelUpDirective({
      stats,
      goals,
      latestBody: latest,
      todayKey: today(),
    });
  }, [stats, goalsQ.data, bodyQ.data]);

  // Cold load → wait one beat so the tier doesn't visibly re-rank as
  // signals land (the page never breaks on a child's fetch).
  if (sheetQ.isLoading || goalsQ.isLoading || bodyQ.isLoading) return null;

  // A failed, paused or unanswered read is named, never read as "nothing here" (lib/query-state.ts).
  // Goals and body only sharpen the ranking, so when they fail the directive still renders from
  // the stats and the note says what it ranked without. ReadStateNote is null for a ready read.
  const notes = (
    [
      ["Stat list", sheetQ],
      ["Goal list", goalsQ],
      ["Body log", bodyQ],
    ] as const
  ).map(([label, q]) => (
    <ReadStateNote
      key={label}
      state={readState(q)}
      label={label}
      onRetry={() => void q.refetch()}
      retrying={isRetrying(q)}
    />
  ));

  // The stat read is the ranking's base: with no stat data there is nothing to rank and nothing to
  // call empty.
  if (sheetQ.data === undefined) {
    return (
      <section
        aria-label="level-up directive"
        className="rounded-surface border border-edge-subtle bg-content px-3.5 py-2.5"
      >
        <p className="font-mono text-[11px] text-fg-tertiary">
          Level-up directive
        </p>
        {notes}
      </section>
    );
  }

  // Honest empty: the stat read succeeded and the board is genuinely bare.
  if (!stats || stats.length === 0 || !directive) {
    return (
      <section
        aria-label="level-up directive"
        className="rounded-surface border border-edge-subtle bg-content px-3.5 py-2.5"
      >
        <p className="font-mono text-[11px] text-fg-tertiary">
          Level-up directive
        </p>
        {notes}
        <p className="mt-1 text-[12px] leading-snug text-fg-secondary">
          Missing data: no stat history to rank yet. Complete a{" "}
          <Link href="/missions" className="underline decoration-edge-strong underline-offset-2 hover:text-fg">
            Mission task
          </Link>{" "}
          to put the first rep on the board.
        </p>
      </section>
    );
  }

  const { stat } = directive;
  const showGoalAnchor =
    directive.goal && directive.rep.href !== `/stats?tab=goals#goal-${directive.goal.id}`;

  return (
    <section
      aria-label="level-up directive"
      className="rounded-surface border px-3.5 py-2.5 space-y-1.5"
      style={{
        borderColor: `${stat.color}40`,
        backgroundColor: `${stat.color}0f`,
      }}
    >
      {/* eyebrow + avoidance mirror */}
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[11px] text-fg-tertiary">
          Level-up directive
        </p>
        {directive.neglected ? (
          <p className="shrink-0 font-mono text-[11px] text-amber-300">
            Neglected this week · 0 XP in 7 days
          </p>
        ) : null}
      </div>
      {notes}

      {/* the stat + the XP math */}
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-medium text-fg">
          {stat.shortLabel || stat.label}
        </span>
        <span
          className="ml-auto shrink-0 text-[11px] font-semibold tabular-nums"
          style={{ color: stat.color }}
        >
          {Math.round(directive.xpToNext)} XP → Lvl {stat.level + 1}
        </span>
      </div>

      {/* why · always "Because…" / "Based on…" */}
      <p className="text-[12px] leading-snug text-fg-secondary">
        {directive.reason}
      </p>

      {/* skill-cape milestone, only when the next level is a tier gate */}
      {directive.milestone ? (
        <p className="text-[12px] tabular-nums text-fg-tertiary">
          Milestone in reach · {Math.round(directive.xpToNext)} XP to Lvl{" "}
          {directive.milestone.level} {directive.milestone.tier}
        </p>
      ) : null}

      {/* the rep · CTA + goal bridge */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5">
        <Link
          href={directive.rep.href}
          className="inline-flex min-h-11 items-center rounded-control border px-3 text-[13px] font-medium transition-colors duration-[var(--motion-state)] hover:bg-surface-hover"
          style={{ borderColor: `${stat.color}66`, color: stat.color }}
        >
          {directive.rep.cta} →
        </Link>
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg-secondary">
          {directive.rep.text}
        </span>
        {showGoalAnchor ? (
          <a
            href={`/stats?tab=goals#goal-${directive.goal!.id}`}
            className="shrink-0 max-w-[160px] truncate text-[11px] text-fg-tertiary underline decoration-edge-strong underline-offset-2 hover:text-fg"
            title={directive.goal!.title}
          >
            Goal: {directive.goal!.title}
          </a>
        ) : null}
      </div>

      {/* build diagnosis · only when the math is clear */}
      {directive.imbalance ? (
        <p className="font-mono text-[11px] text-fg-tertiary">
          Build imbalance · {directive.imbalance}
        </p>
      ) : null}
    </section>
  );
}
