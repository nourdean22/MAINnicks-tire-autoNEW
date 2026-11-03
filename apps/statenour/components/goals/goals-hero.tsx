"use client";

/**
 * The Goals tab's hero (job 2026-11-02-nour-os-interconnect W5; spec
 * docs/superpowers/specs/2026-05-29-goals-sam-redesign-design.md, item 2): the one goal that matters
 * today, why it was picked, its one move (the page's only gold primary), whether it moved lately, a
 * maxim only at a goal moment, and a one-line pulse of the rest. The stats band of the spec folds into
 * that line: three tiles at 390 px pushed the board below the fold.
 *
 * GoalsHeroView takes plain data; GoalsHero adds the one read it needs (the since-list, the same query
 * the card's check-in panel makes, so an expanded card shares the cache).
 */
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { GoalHealthChip } from "./goal-check-in";
import { goalPaceView } from "@/lib/brain/goal-pace";
import { movedLine, type GoalMaxim, type GoalMomentState, type HeroReason, type PageGoal, type SinceForHero } from "@/lib/stats/goals-page";

const REASON_LABEL: Record<HeroReason, string> = {
  due_soonest: "Due soonest",
  furthest_behind: "Furthest behind",
  first: "Your first goal",
};

const MOMENT_LABEL: Record<GoalMomentState, string> = {
  achieved: "goal reached",
  off_track: "off track",
  behind: "behind pace",
  check_in_due: "check-in due",
};

export interface HeroGoal extends PageGoal {
  nextMove?: { id: string; title: string; status: string } | null;
}

export type GoalsPulse = { total: number; behind: number; offTrack: number; checkInDue: number };

export function pulseLine(p: GoalsPulse): string {
  const parts = [`${p.total} goal${p.total === 1 ? "" : "s"}`];
  if (p.offTrack > 0) parts.push(`${p.offTrack} off track`);
  if (p.behind > 0) parts.push(`${p.behind} behind`);
  if (p.checkInDue > 0) parts.push(`${p.checkInDue} need${p.checkInDue === 1 ? "s" : ""} a check-in`);
  if (parts.length === 1) parts.push("none behind");
  return parts.join(" · ");
}

/** Opens Nick's side pane with a question about one goal, prefilled and never sent (Nour fires the turn). */
export function askNickAboutGoal(
  g: { id: string; title: string },
  target: Pick<EventTarget, "dispatchEvent"> = window,
): void {
  target.dispatchEvent(
    new CustomEvent("statenour:open-nick", {
      detail: {
        pendingPrompt: `About my goal "${g.title}" [id:${g.id}]: what is the one move that moves it most this week?`,
        submitOnMount: false,
      },
    }),
  );
}

const SECONDARY =
  "inline-flex items-center justify-center rounded-control border border-edge-default px-3 text-[13px] font-medium text-fg-secondary hover:border-edge-strong hover:text-fg";

export function GoalsHeroView(p: {
  goal: HeroGoal;
  reason: HeroReason;
  pulse: GoalsPulse;
  maxim: GoalMaxim | null;
  moved: string;
  now: number;
  onOpen: () => void;
  onAskNick: () => void;
}) {
  const { goal: g } = p;
  const pace = goalPaceView(g, p.now);
  const paceText = pace?.kind === "note" ? pace.text : pace?.label;
  return (
    <section aria-label="Today's goal" className="rounded-surface border border-edge-subtle bg-content p-4 space-y-3">
      <div className="space-y-1">
        <p className="font-mono text-[11px] text-fg-tertiary">Today&apos;s goal · {REASON_LABEL[p.reason]}</p>
        <h2 className="text-[17px] font-semibold leading-snug text-fg">{g.title}</h2>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-fg-secondary">
          <GoalHealthChip health={g.health} onOpen={p.onOpen} />
          {paceText && <span>{paceText}</span>}
          <span className="text-fg-tertiary">{p.moved}</span>
        </div>
      </div>

      {g.nextMove ? (
        <Link
          href={`/missions?taskId=${encodeURIComponent(g.nextMove.id)}`}
          className="flex min-h-11 w-full items-center rounded-control bg-accent px-3 text-[14px] font-medium text-[var(--text-inverse)] hover:bg-accent-hover"
        >
          <span className="truncate">
            {g.nextMove.status === "DOING" ? "In flight: " : "Next: "}
            {g.nextMove.title}
          </span>
        </Link>
      ) : (
        <button type="button" onClick={p.onOpen} className={`min-h-11 w-full ${SECONDARY} justify-start`}>
          No next step yet: add one
        </button>
      )}

      {p.maxim && (
        <figure className="space-y-0.5 border-l border-edge-default pl-3">
          <blockquote className="text-[14px] leading-relaxed text-fg-secondary">{p.maxim.text}</blockquote>
          <figcaption className="font-mono text-[11px] text-fg-tertiary">
            {p.maxim.source} · for a goal {MOMENT_LABEL[p.maxim.state]}
          </figcaption>
        </figure>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={p.onOpen} className={`min-h-11 min-w-11 ${SECONDARY}`}>
          Open goal
        </button>
        <button type="button" onClick={p.onAskNick} className={`min-h-11 min-w-11 ${SECONDARY}`}>
          Ask Nick about this goal
        </button>
      </div>

      <p className="font-mono text-[12px] text-fg-tertiary">{pulseLine(p.pulse)}</p>
    </section>
  );
}

export function GoalsHero(p: Omit<Parameters<typeof GoalsHeroView>[0], "moved" | "onAskNick">) {
  const q = trpc.task.goalSinceCheckIn.useQuery({ goalId: p.goal.id }, { staleTime: 60_000 });
  const read: SinceForHero = q.isError ? "error" : q.data ? (q.data.found ? q.data : "error") : "loading";
  return <GoalsHeroView {...p} moved={movedLine(read, p.now)} onAskNick={() => askNickAboutGoal(p.goal)} />;
}
