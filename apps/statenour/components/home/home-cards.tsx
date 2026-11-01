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
import { goalDue, timeLeftLabel } from "@/lib/brain/goal-pace";

// UI v3 grammar (ratchet glassCard): ruled, not glass: a left rule, no panel, no radius, like the brief rows.
const CARD = "block min-h-11 py-2";
const OPEN_STATUSES = new Set(["active", "in_progress"]);

export interface GoalsCardRead {
  title: string;
  /** Time to the nearest date ahead (a set deadline, or a horizon's derived end), or null when no goal has one. */
  label: string | null;
  active: number;
}

/**
 * Pure: the open goal whose date (goalDue: a set deadline wins, else the horizon's derived end) comes next, else
 * the first open goal with no date; null only when no goal is open. Nour 2026-11-01: 0 of his 6 goals had a
 * deadline, so the old deadline-only read showed "No dated goals" every day.
 */
export function goalsCardRead(
  goals: ReadonlyArray<{
    title: string;
    deadline: string | null;
    status: string;
    horizon: string | null;
    createdAt: string;
    horizonSetAt?: string | null;
  }>,
  now: number = Date.now(),
): GoalsCardRead | null {
  const open = goals.filter((g) => OPEN_STATUSES.has(g.status));
  if (open.length === 0) return null;
  const ahead = open
    .map((g) => ({ g, due: goalDue(g) }))
    .filter((x) => x.due.at !== null && Date.parse(x.due.at) >= now)
    .sort((a, b) => Date.parse(a.due.at!) - Date.parse(b.due.at!));
  if (ahead.length === 0) return { title: open[0].title, label: null, active: open.length };
  const { g, due } = ahead[0];
  const left = timeLeftLabel(now, Date.parse(due.at!));
  return { title: g.title, label: due.source === "horizon" ? `${left}, ${due.label}` : left, active: open.length };
}

function Unknown({ what }: { what: string }) {
  return <p className="mt-1 text-[13px] text-amber-300">{what} unknown, couldn&apos;t load</p>;
}

function Skeleton() {
  return <span className="mt-2 block h-5 w-24 animate-pulse rounded-micro bg-raised" aria-hidden />;
}

/** The /api/people page size the card reads (the route's own maximum). */
export const PEOPLE_READ_LIMIT = 200;

type PeopleTotals = { neglected: number; total: number };

/**
 * /api/people computes its totals over the page it returns (take: limit), so a FULL page cannot prove
 * "All current": due profiles may sit past the cap (Codex P2 on #3405). A full page reads as capped.
 */
export function peopleReadFrom(totals: PeopleTotals, limit: number = PEOPLE_READ_LIMIT): PeopleTotals | "capped" {
  return totals.total >= limit ? "capped" : totals;
}

export function PeopleCardView({ read }: { read: PeopleTotals | "capped" | "loading" | "error" }) {
  return (
    <GlassCard as="a" ruled href="/people" className={CARD}>
      <div aria-busy={read === "loading"}>
        <p className="text-[13px] text-fg-secondary">People</p>
        {read === "loading" ? (
          <Skeleton />
        ) : read === "error" ? (
          <Unknown what="People" />
        ) : read === "capped" ? (
          <p className="mt-1 text-[13px] text-fg-secondary">{PEOPLE_READ_LIMIT}+ profiles, open People to see who is due</p>
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

export function GoalsCardView({ read }: { read: GoalsCardRead | null | "loading" | "error" }) {
  return (
    // /stats opens on Mastery without a tab, and GoalBoard mounts only on the Goals tab (Codex P2 on #3405).
    <GlassCard as="a" ruled href="/stats?tab=goals" className={CARD}>
      <div aria-busy={read === "loading"}>
        <p className="text-[13px] text-fg-secondary">Goals</p>
        {read === "loading" ? (
          <Skeleton />
        ) : read === "error" ? (
          <Unknown what="Goals" />
        ) : read === null ? (
          <p className="mt-1 text-[15px] text-fg">No active goals</p>
        ) : (
          <>
            <p className="mt-1 line-clamp-2 text-[15px] text-fg">{read.title}</p>
            <p className="mt-0.5 font-mono text-[12px] tabular-nums text-fg-secondary">
              {read.label ? `${read.label} · ${read.active} active` : `${read.active} active, no date set`}
            </p>
          </>
        )}
      </div>
    </GlassCard>
  );
}

export function HomeCards() {
  const people = usePollingFetch<{ totals: PeopleTotals }>(`/api/people?limit=${PEOPLE_READ_LIMIT}`, {
    intervalMs: 5 * 60_000,
  });
  const goals = trpc.operator.goalsSnapshot.useQuery(undefined, { staleTime: 5 * 60_000, refetchOnWindowFocus: false });

  const peopleRead = people.data ? peopleReadFrom(people.data.totals) : people.error ? "error" : "loading";
  const goalsRead = goals.data
    ? goalsCardRead(Object.values(goals.data.ladder).flat())
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
