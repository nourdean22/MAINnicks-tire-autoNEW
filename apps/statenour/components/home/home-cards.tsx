"use client";

/**
 * Home cards (2026-10-30, home-pulse W2b): the two things Home did not already show. Today and the
 * items that need him are the brief itself, so they get no second card. Each card READS an existing
 * model and owns none of it:
 *  · People: /api/people totals (people-tracker's engine; its `isNeglected` rule changes there, not here).
 *  · Goals: operator.goalsSnapshot (goals-system's read model) and goal-pace's `timeLeftLabel`.
 * Three states each: measured, loading, unknown. A failed read never reads as "0" or "none".
 */
import { GlassCard } from "@/components/ui/glass-card";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { trpc } from "@/lib/trpc/client";
import { timeLeftLabel } from "@/lib/brain/goal-pace";

// UI v3 grammar (ratchet glassCard): ruled, not glass: a left rule, no panel, no radius, like the brief rows.
const CARD = "block min-h-11 py-2";
const OPEN_STATUSES = new Set(["active", "in_progress"]);

export interface NextGoal {
  title: string;
  label: string;
  withDeadline: number;
}

/** Pure: the nearest open goal deadline, or null when no open goal has one. */
export function nextGoalDue(
  goals: ReadonlyArray<{ title: string; deadline: string | null; status: string }>,
  now: number = Date.now(),
): NextGoal | null {
  const dated = goals.filter((g) => g.deadline && OPEN_STATUSES.has(g.status));
  if (dated.length === 0) return null;
  const next = dated.reduce((a, b) => (Date.parse(a.deadline!) <= Date.parse(b.deadline!) ? a : b));
  return { title: next.title, label: timeLeftLabel(now, Date.parse(next.deadline!)), withDeadline: dated.length };
}

function Unknown({ what }: { what: string }) {
  return <p className="mt-1 text-[13px] text-amber-300">{what} unknown, couldn&apos;t load</p>;
}

function Skeleton() {
  return <span className="mt-2 block h-5 w-24 animate-pulse rounded-micro bg-raised" aria-hidden />;
}

export function PeopleCardView({ read }: { read: { neglected: number; total: number } | "loading" | "error" }) {
  return (
    <GlassCard as="a" ruled href="/people" className={CARD}>
      <div aria-busy={read === "loading"}>
        <p className="text-[13px] text-fg-secondary">People</p>
        {read === "loading" ? (
          <Skeleton />
        ) : read === "error" ? (
          <Unknown what="People" />
        ) : read.neglected > 0 ? (
          <p className="mt-1 text-[15px] text-fg">
            <span className="font-semibold tabular-nums">{read.neglected}</span> due a touch
          </p>
        ) : (
          <p className="mt-1 text-[15px] text-fg">All current</p>
        )}
      </div>
    </GlassCard>
  );
}

export function GoalsCardView({ read }: { read: NextGoal | null | "loading" | "error" }) {
  return (
    <GlassCard as="a" ruled href="/stats" className={CARD}>
      <div aria-busy={read === "loading"}>
        <p className="text-[13px] text-fg-secondary">Goals</p>
        {read === "loading" ? (
          <Skeleton />
        ) : read === "error" ? (
          <Unknown what="Goals" />
        ) : read === null ? (
          <p className="mt-1 text-[15px] text-fg">No dated goals</p>
        ) : (
          <>
            <p className="mt-1 line-clamp-2 text-[15px] text-fg">{read.title}</p>
            <p className="mt-0.5 font-mono text-[12px] tabular-nums text-fg-secondary">{read.label}</p>
          </>
        )}
      </div>
    </GlassCard>
  );
}

export function HomeCards() {
  const people = usePollingFetch<{ totals: { neglected: number; total: number } }>("/api/people?limit=100", {
    intervalMs: 5 * 60_000,
  });
  const goals = trpc.operator.goalsSnapshot.useQuery(undefined, { staleTime: 5 * 60_000, refetchOnWindowFocus: false });

  const peopleRead = people.data ? people.data.totals : people.error ? "error" : "loading";
  const goalsRead = goals.data
    ? nextGoalDue(Object.values(goals.data.ladder).flat())
    : goals.isError
      ? "error"
      : "loading";

  return (
    <div className="grid grid-cols-2 gap-3">
      <PeopleCardView read={peopleRead} />
      <GoalsCardView read={goalsRead} />
    </div>
  );
}
