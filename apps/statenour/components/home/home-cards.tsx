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
import { DayActivityPanel } from "@/components/journal/day-activity";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { trpc } from "@/lib/trpc/client";
import { goalDue, timeLeftLabel } from "@/lib/brain/goal-pace";
import type { GoalCheckInDue, WeeklyReviewDue } from "@/lib/home/operator-brief";
import type { DayActivity } from "@/lib/services/journal-day";
import { etDateKey } from "@/lib/utils/datetime";

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
  const dated = open.map((g) => ({ g, due: goalDue(g) })).filter((x) => x.due.at !== null);
  // A deadline he set that has passed is news, and beats any date ahead (silent-failure read, 2026-11-01). A horizon
  // period that ended is not: the derived date is only a pace yardstick.
  const overdue = dated
    .filter((x) => x.due.source === "set" && Date.parse(x.due.at!) < now)
    .sort((a, b) => Date.parse(b.due.at!) - Date.parse(a.due.at!))[0];
  if (overdue) return { title: overdue.g.title, label: timeLeftLabel(now, Date.parse(overdue.due.at!)), active: open.length };
  const ahead = dated
    .filter((x) => Date.parse(x.due.at!) >= now)
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

/** The brief's most overdue goal check-in (Linear L3): null = none due, "unknown" = its read failed. */
function CheckInDueLine({ checkIn }: { checkIn: GoalCheckInDue | null | "unknown" | undefined }) {
  if (checkIn === "unknown") return <p className="mt-1 text-[13px] text-amber-300">Check-in unknown, couldn&apos;t load</p>;
  if (!checkIn) return null;
  return (
    <p className="mt-1 line-clamp-2 text-[13px] text-amber-300">
      Check-in due: {checkIn.title}
      <span className="font-mono tabular-nums text-fg-secondary">{checkIn.daysOverdue > 0 ? ` · ${checkIn.daysOverdue}d over` : ""}</span>
    </p>
  );
}

export function GoalsCardView({
  read,
  checkIn,
}: {
  read: GoalsCardRead | null | "loading" | "error";
  checkIn?: GoalCheckInDue | null | "unknown";
}) {
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
              {read.label ? `${read.label} · ${read.active} active` : `${read.active} active, no date ahead`}
            </p>
            <CheckInDueLine checkIn={checkIn} />
          </>
        )}
      </div>
    </GlassCard>
  );
}

/**
 * W8b (item 7): the weekly review's standing (Sunsama S3), from the brief's loadWeeklyReviewDue. A row of its own,
 * not a line in the Goals card: that card is one anchor to /stats and a review is not a goal.
 * Ruling: Home row - the Goals card is a single <a> (W8a makes its due line a Link) and a nested anchor is invalid;
 * cost if wrong: one extra card on Home.
 */
export function ReviewCardView({ read }: { read: WeeklyReviewDue | "unknown" | "loading" }) {
  return (
    <GlassCard as="a" ruled href="/journal?review=week" className={`${CARD} col-span-2`}>
      <div aria-busy={read === "loading"}>
        <p className="text-[13px] text-fg-secondary">Weekly review</p>
        {read === "loading" ? (
          <Skeleton />
        ) : read === "unknown" ? (
          <Unknown what="Weekly review" />
        ) : read.due ? (
          <p className="mt-1 text-[15px] text-amber-300">
            {"Weekly review due"}
            <span className="font-mono text-[12px] tabular-nums text-fg-secondary">
              {read.daysSince === null ? " · never done" : ` · ${read.daysSince}d since the last`}
            </span>
          </p>
        ) : (
          <p className="mt-1 font-mono text-[12px] tabular-nums text-fg-secondary">{`Reviewed ${read.daysSince}d ago`}</p>
        )}
      </div>
    </GlassCard>
  );
}

/** W8b (item 7): today's done tasks and contacts on Home, the W7 day panel over journal.day for today's ET date. */
export function TodayCardView({ date, read }: { date: string; read: DayActivity | "loading" | "failed" }) {
  return (
    <section aria-labelledby="home-today-heading" className="col-span-2 border-l-2 border-edge pl-4">
      <h3 id="home-today-heading" className="text-[13px] text-fg-secondary">
        Today: done and contacts <span className="font-mono text-[11px] text-fg-tertiary">{date}</span>
      </h3>
      <DayActivityPanel read={read} />
    </section>
  );
}

function TodayPanel() {
  const date = etDateKey(new Date());
  const q = trpc.journal.day.useQuery({ date }, { staleTime: 60_000, refetchOnWindowFocus: false });
  return <TodayCardView date={date} read={q.data ?? (q.isError ? "failed" : "loading")} />;
}

export function HomeCards() {
  const people = usePollingFetch<{ totals: PeopleTotals }>(`/api/people?limit=${PEOPLE_READ_LIMIT}`, {
    intervalMs: 5 * 60_000,
  });
  const goals = trpc.operator.goalsSnapshot.useQuery(undefined, { staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  // Same key and options as HomeConsole's brief read, so this shares its cache (no second fetch).
  const brief = trpc.operator.brief.useQuery(undefined, { staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: false });

  const peopleRead = people.data ? peopleReadFrom(people.data.totals) : people.error ? "error" : "loading";
  const goalsRead = goals.data
    ? goalsCardRead(Object.values(goals.data.ladder).flat())
    : goals.isError
      ? "error"
      : "loading";

  return (
    <div className="grid grid-cols-2 gap-3">
      <PeopleCardView read={peopleRead} />
      {/* A brief that failed or is loading shows no row here: the brief itself says it couldn't load. */}
      <GoalsCardView read={goalsRead} checkIn={brief.data?.goalCheckInDue} />
      {/* W8b: the review row reads the same brief; while the brief loads or failed, it says so rather than "due". */}
      {/* A brief payload without the field (an older server) is unknown, never "due" and never a crash. */}
      <ReviewCardView read={brief.data ? (brief.data.weeklyReviewDue ?? "unknown") : brief.isError ? "unknown" : "loading"} />
      <TodayPanel />
    </div>
  );
}
