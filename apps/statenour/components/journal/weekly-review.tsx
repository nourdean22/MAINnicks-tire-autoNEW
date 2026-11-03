"use client";

/**
 * The weekly review on /journal?review=week (W7, Sunsama S3/S4). One goal per block: what got done, what he wrote,
 * a health chip (on track / at risk / off track: the note then saves as that goal's check-in, W8a S3), a note box,
 * and for a WEEK goal "Extend a week" / "Achieved" / "Missed" (W8a S4: each sets the status, so the goal's events
 * and brain moment fire). Save writes the notes as journal entries grounded to their goals
 * (lib/services/weekly-review.ts) and applies the goal actions. Nothing is written until Save.
 */
import Link from "next/link";
import { useState } from "react";

import { trpc } from "@/lib/trpc/client";
import type { ReviewGoal, SaveWeeklyReviewResult } from "@/lib/services/weekly-review";
import { CHECK_IN_HEALTH, type CheckInHealth } from "@/lib/brain/goal-pace";

type GoalAction = "extend" | "achieved" | "missed" | null;

const HEALTH_LABEL: Record<CheckInHealth, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track" };

const TEXTAREA =
  "mt-2 block w-full rounded-control border border-edge-default bg-raised px-3 py-2 text-base text-fg placeholder:text-fg-tertiary focus:border-edge-strong focus:outline-none";
const TOGGLE = "inline-flex min-h-11 items-center rounded-control border px-3 text-[13px] transition-colors";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });

export function WeeklyReviewGoalView({
  row,
  failed = [],
  note,
  action,
  health = null,
  onNote,
  onAction,
  onHealth,
}: {
  row: ReviewGoal;
  /** The review read's failed side reads: a failed one is named here, never "nothing done". */
  failed?: string[];
  note: string;
  action: GoalAction;
  health?: CheckInHealth | null;
  onNote: (text: string) => void;
  onAction: (a: GoalAction) => void;
  onHealth?: (h: CheckInHealth | null) => void;
}) {
  const { goal, doneTasks, entries } = row;
  const toggle = (a: Exclude<GoalAction, null>, label: string) => (
    <button
      type="button"
      aria-pressed={action === a}
      onClick={() => onAction(action === a ? null : a)}
      className={`${TOGGLE} ${action === a ? "border-accent text-fg" : "border-edge-default text-fg-secondary hover:text-fg"}`}
    >
      {label}
    </button>
  );
  return (
    <section aria-label={`Goal: ${goal.title}`} className="border-b border-edge-subtle py-4">
      <h3 className="text-[15px] font-semibold text-fg">{goal.title}</h3>
      <p className="mt-0.5 font-mono text-[11px] text-fg-tertiary">
        {(goal.horizon ?? "no horizon").toLowerCase()}
        {goal.due ? ` · due ${shortDate(goal.due)}` : ""}
      </p>
      {failed.includes("done tasks") && (
        <p role="status" className="mt-2 text-[12px] text-amber-300">Done tasks couldn&apos;t load</p>
      )}
      {failed.includes("entries") && (
        <p role="status" className="mt-2 text-[12px] text-amber-300">Entries couldn&apos;t load</p>
      )}
      {doneTasks.length === 0 && entries.length === 0 ? (
        failed.includes("done tasks") || failed.includes("entries") ? null : (
          <p className="mt-2 text-[13px] text-fg-tertiary">Nothing done or written for this goal since the last review.</p>
        )
      ) : (
        <ul className="mt-2 space-y-1 text-[13px]">
          {doneTasks.map((t) => (
            <li key={t.taskId} className="text-fg">
              <span className="font-mono text-[11px] text-emerald-300">done</span> {t.title}
            </li>
          ))}
          {entries.map((e) => (
            <li key={e.id} className="text-fg-secondary">
              <span className="font-mono text-[11px] text-fg-tertiary">{shortDate(e.at)}</span> {e.excerpt}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Health of ${goal.title}`}>
        {CHECK_IN_HEALTH.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={health === h}
            onClick={() => onHealth?.(health === h ? null : h)}
            className={`${TOGGLE} ${health === h ? "border-accent text-fg" : "border-edge-default text-fg-secondary hover:text-fg"}`}
          >
            {HEALTH_LABEL[h]}
          </button>
        ))}
      </div>
      <label className="mt-2 block text-[12px] text-fg-secondary">
        {health ? "Note on this goal (saved as its check-in)" : "Note on this goal"}
        <textarea rows={2} value={note} onChange={(e) => onNote(e.target.value)} className={TEXTAREA} placeholder="What moved, what stuck" />
      </label>
      {goal.canExtendOrClose && (
        <div className="mt-2 flex flex-wrap gap-2">
          {toggle("extend", "Extend a week")}
          {toggle("achieved", "Achieved")}
          {toggle("missed", "Missed")}
        </div>
      )}
    </section>
  );
}

const titleList = (ids: string[], titles: ReadonlyMap<string, string>) => ids.map((id) => titles.get(id) ?? "a goal no longer listed").join(", ");

/** The screen after Save: counts, then every goal change that failed and every note saved without a goal, by title. */
export function ReviewSavedView({ result, titles }: { result: SaveWeeklyReviewResult; titles: ReadonlyMap<string, string> }) {
  return (
    <div className="py-6 text-[14px] text-fg">
      {result.replayed ? (
        <p>This review was already saved ({result.saved.length} {result.saved.length === 1 ? "entry" : "entries"}). Goal changes were not repeated.</p>
      ) : (
        <p>
          Saved {result.saved.length} {result.saved.length === 1 ? "entry" : "entries"}
          {result.extended.length ? `, extended ${result.extended.length}` : ""}
          {result.achieved.length ? `, ${result.achieved.length} achieved` : ""}
          {result.missed.length ? `, ${result.missed.length} missed` : ""}
          {result.checkedIn.length ? `, ${result.checkedIn.length} check-in${result.checkedIn.length === 1 ? "" : "s"} logged` : ""}.
        </p>
      )}
      {result.failed.length > 0 && (
        <p role="status" className="mt-1 text-[13px] text-amber-300">
          Not changed: {titleList(result.failed, titles)}. Open Goals to retry.
        </p>
      )}
      {result.alreadyCheckedIn.length > 0 && (
        <p role="status" className="mt-1 text-[13px] text-amber-300">
          Already checked in today on {titleList(result.alreadyCheckedIn, titles)}; this health was not saved.
        </p>
      )}
      {result.ungrounded.length > 0 && (
        <p role="status" className="mt-1 text-[13px] text-amber-300">
          Saved without a goal, because the goal is no longer active: {titleList(result.ungrounded, titles)}.
        </p>
      )}
      <Link href="/journal" className="mt-3 inline-flex min-h-11 items-center text-[13px] text-fg-secondary underline-offset-2 hover:underline">
        Back to the journal
      </Link>
    </div>
  );
}

export function WeeklyReview() {
  const utils = trpc.useUtils();
  const q = trpc.journal.weeklyReview.useQuery(undefined, { refetchOnWindowFocus: false });
  const save = trpc.journal.saveWeeklyReview.useMutation();
  const [week, setWeek] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [healths, setHealths] = useState<Record<string, CheckInHealth | null>>({});
  const [actions, setActions] = useState<Record<string, GoalAction>>({});
  const [result, setResult] = useState<SaveWeeklyReviewResult | null>(null);
  // One id per review form: a retry after a lost response is recognised by the server and not saved twice.
  const [reviewId] = useState(() => crypto.randomUUID());

  if (q.isLoading) return <p className="py-6 text-[13px] text-fg-tertiary">Reading the week…</p>;
  if (q.isError || !q.data) {
    return (
      <div className="py-6">
        <p role="status" className="text-[13px] text-amber-300">The review couldn&apos;t load: goals unknown, not empty.</p>
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="mt-3 inline-flex min-h-11 items-center rounded-control border border-edge-default px-4 text-[13px] text-fg-secondary"
        >
          Retry
        </button>
      </div>
    );
  }

  if (result) return <ReviewSavedView result={result} titles={new Map(q.data.goals.map((g) => [g.goal.id, g.goal.title]))} />;

  const r = q.data;
  // Round 1 P1-8: a health chip alone is something to save (it is the goal's check-in).
  const written = week.trim() || Object.values(notes).some((n) => n.trim()) || Object.values(healths).some(Boolean);
  const submit = async () => {
    const res = await save
      .mutateAsync({
        reviewId,
        week,
        // Every goal with words OR a health chip (round 1 P1-8: a chip alone used to be dropped here).
        notes: [...new Set([...Object.keys(notes), ...Object.keys(healths).filter((id) => healths[id])])].map((goalId) => ({
          goalId,
          text: notes[goalId] ?? "",
          ...(healths[goalId] ? { health: healths[goalId]! } : {}),
        })),
        extend: Object.keys(actions).filter((id) => actions[id] === "extend"),
        achieved: Object.keys(actions).filter((id) => actions[id] === "achieved"),
        missed: Object.keys(actions).filter((id) => actions[id] === "missed"),
      })
      .catch(() => null);
    if (!res) return;
    setResult(res);
    void utils.journal.feed.invalidate();
    void utils.journal.weeklyReview.invalidate();
  };

  return (
    <div>
      <p className="text-[13px] text-fg-secondary">
        Since {r.lastReviewAt ? `your last review, ${shortDate(r.since)}` : shortDate(r.since)}
      </p>
      {r.failed.includes("last review") && (
        <p role="status" className="mt-1 text-[12px] text-amber-300">
          Couldn&apos;t read when the last review was: this shows the last 7 days, a guess.
        </p>
      )}
      {r.truncated && (
        <p role="status" className="mt-1 text-[12px] text-amber-300">This window has more rows than one read holds: the oldest are not shown.</p>
      )}
      {r.goals.length === 0 ? (
        <p className="py-4 text-[13px] text-fg-tertiary">No active goals. The week note below still saves to the journal.</p>
      ) : (
        r.goals.map((row) => (
          <WeeklyReviewGoalView
            key={row.goal.id}
            row={row}
            failed={r.failed}
            note={notes[row.goal.id] ?? ""}
            action={actions[row.goal.id] ?? null}
            health={healths[row.goal.id] ?? null}
            onNote={(text) => setNotes((n) => ({ ...n, [row.goal.id]: text }))}
            onAction={(a) => setActions((m) => ({ ...m, [row.goal.id]: a }))}
            onHealth={(h) => setHealths((m) => ({ ...m, [row.goal.id]: h }))}
          />
        ))
      )}
      <label className="mt-4 block text-[12px] text-fg-secondary">
        The week
        <textarea rows={3} value={week} onChange={(e) => setWeek(e.target.value)} className={TEXTAREA} placeholder="How the week went" />
      </label>
      {save.isError && (
        <p role="status" className="mt-2 text-[13px] text-rose-300">
          {save.error.message || "Save failed."} Your text is still here, and saving again is safe: a review already saved is not saved twice.
        </p>
      )}
      <button
        type="button"
        disabled={!written || save.isPending}
        onClick={() => void submit()}
        className="mt-4 inline-flex min-h-11 items-center rounded-control bg-accent px-5 text-[14px] font-semibold text-[var(--text-inverse)] disabled:opacity-50"
      >
        {save.isPending ? "Saving…" : "Save the review"}
      </button>
    </div>
  );
}
