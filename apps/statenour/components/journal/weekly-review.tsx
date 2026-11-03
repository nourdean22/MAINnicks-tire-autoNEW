"use client";

/**
 * The weekly review on /journal?review=week (W7, Sunsama S3/S4). One goal per block: what got done, what he wrote,
 * a note box, and for a WEEK goal "Extend a week" / "Close". Save writes the notes as journal entries grounded to
 * their goals (lib/services/weekly-review.ts) and applies the goal actions. Nothing is written until Save.
 */
import Link from "next/link";
import { useState } from "react";

import { trpc } from "@/lib/trpc/client";
import type { ReviewGoal, SaveWeeklyReviewResult } from "@/lib/services/weekly-review";

type GoalAction = "extend" | "close" | null;

const TEXTAREA =
  "mt-2 block w-full rounded-control border border-edge-default bg-raised px-3 py-2 text-base text-fg placeholder:text-fg-tertiary focus:border-edge-strong focus:outline-none";
const TOGGLE = "inline-flex min-h-11 items-center rounded-control border px-3 text-[13px] transition-colors";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });

export function WeeklyReviewGoalView({
  row,
  note,
  action,
  onNote,
  onAction,
}: {
  row: ReviewGoal;
  note: string;
  action: GoalAction;
  onNote: (text: string) => void;
  onAction: (a: GoalAction) => void;
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
      {doneTasks.length === 0 && entries.length === 0 ? (
        <p className="mt-2 text-[13px] text-fg-tertiary">Nothing done or written for this goal since the last review.</p>
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
      <label className="mt-3 block text-[12px] text-fg-secondary">
        Note on this goal
        <textarea rows={2} value={note} onChange={(e) => onNote(e.target.value)} className={TEXTAREA} placeholder="What moved, what stuck" />
      </label>
      {goal.canExtendOrClose && (
        <div className="mt-2 flex flex-wrap gap-2">
          {toggle("extend", "Extend a week")}
          {toggle("close", "Close")}
        </div>
      )}
    </section>
  );
}

export function WeeklyReview() {
  const utils = trpc.useUtils();
  const q = trpc.journal.weeklyReview.useQuery(undefined, { refetchOnWindowFocus: false });
  const save = trpc.journal.saveWeeklyReview.useMutation();
  const [week, setWeek] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<Record<string, GoalAction>>({});
  const [result, setResult] = useState<SaveWeeklyReviewResult | null>(null);

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

  if (result) {
    return (
      <div className="py-6 text-[14px] text-fg">
        <p>
          Saved {result.saved.length} {result.saved.length === 1 ? "entry" : "entries"}
          {result.extended.length ? `, extended ${result.extended.length}` : ""}
          {result.closed.length ? `, closed ${result.closed.length}` : ""}.
        </p>
        {result.failed.length > 0 && (
          <p role="status" className="mt-1 text-[13px] text-amber-300">
            {result.failed.length} goal {result.failed.length === 1 ? "change" : "changes"} failed; open Goals to retry.
          </p>
        )}
        <Link href="/journal" className="mt-3 inline-flex min-h-11 items-center text-[13px] text-fg-secondary underline-offset-2 hover:underline">
          Back to the journal
        </Link>
      </div>
    );
  }

  const r = q.data;
  const written = week.trim() || Object.values(notes).some((n) => n.trim());
  const submit = async () => {
    const res = await save
      .mutateAsync({
        week,
        notes: Object.entries(notes).map(([goalId, text]) => ({ goalId, text })),
        extend: Object.keys(actions).filter((id) => actions[id] === "extend"),
        close: Object.keys(actions).filter((id) => actions[id] === "close"),
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
      {r.failed.length > 0 && (
        <p role="status" className="mt-1 text-[12px] text-amber-300">
          Couldn&apos;t read: {r.failed.join(", ")}. Those rows are missing, not zero.
        </p>
      )}
      {r.goals.length === 0 ? (
        <p className="py-4 text-[13px] text-fg-tertiary">No active goals. The week note below still saves to the journal.</p>
      ) : (
        r.goals.map((row) => (
          <WeeklyReviewGoalView
            key={row.goal.id}
            row={row}
            note={notes[row.goal.id] ?? ""}
            action={actions[row.goal.id] ?? null}
            onNote={(text) => setNotes((n) => ({ ...n, [row.goal.id]: text }))}
            onAction={(a) => setActions((m) => ({ ...m, [row.goal.id]: a }))}
          />
        ))
      )}
      <label className="mt-4 block text-[12px] text-fg-secondary">
        The week
        <textarea rows={3} value={week} onChange={(e) => setWeek(e.target.value)} className={TEXTAREA} placeholder="How the week went" />
      </label>
      {save.isError && (
        <p role="status" className="mt-2 text-[13px] text-rose-300">
          {save.error.message || "Save failed."} Nothing was lost: your text is still here.
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
