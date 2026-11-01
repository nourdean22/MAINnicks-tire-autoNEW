"use client";

/**
 * deck-rhythms.tsx · the habit list, directly under the next move.
 *
 * What Nour does on /missions is tick habits (prod 14 d: 42 of 54 completions
 * were DAILY/WEEKLY loops), so this list sits second on the page and each tick
 * answers in place: the circle fills and the row says "done" before the deck
 * refetches, not only in a toast. Completion state is the page's one accent.
 * A failed write takes the mark back and says so. The rolling window
 * ("6 of last 7") degrades gradually instead of snapping a streak to zero.
 *
 * 2026-10-26 · the list is also where rhythms are managed: the title opens the
 * page's task editor (cadence daily / weekly with weekdays, delete), the cadence
 * is written under the title, and the last row adds a daily rhythm.
 */
import { useState } from "react";
import type { MissionsDeck } from "@/lib/missions/deck";

type Props = {
  rhythms: MissionsDeck["rhythms"];
  /** Resolves true only on a confirmed write. */
  onComplete: (taskId: string, loopKind: string) => Promise<boolean>;
  /** Opens the task editor for this rhythm. */
  onEdit: (taskId: string) => void;
  /** Creates a DAILY rhythm; resolves true only on a confirmed write. */
  onAdd: (title: string) => Promise<boolean>;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "daily", "weekly · Mon Wed Fri", or bare "weekly" when no weekdays are on file. */
function cadenceWords(loopKind: string, recurringDays: number[] | undefined): string {
  if (loopKind === "DAILY") return "daily";
  if (loopKind !== "WEEKLY") return loopKind.toLowerCase();
  const days = [...new Set(recurringDays ?? [])].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  return days.length > 0 ? `weekly · ${days.map((d) => WEEKDAYS[d]).join(" ")}` : "weekly";
}

const CONTROL = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control px-3 text-[13px] font-medium";

function AddRhythmRow({ onAdd }: { onAdd: Props["onAdd"] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] w-full items-center px-3 text-left text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg"
      >
        + rhythm
      </button>
    );
  }

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const ok = await onAdd(trimmed);
    setBusy(false);
    if (ok) {
      setTitle("");
      setOpen(false);
    }
  };

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        type="text"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={busy}
        placeholder="new rhythm, daily to start"
        aria-label="new rhythm title"
        autoComplete="off"
        className="min-h-[44px] min-w-0 flex-1 border-0 border-b-2 border-edge bg-transparent px-0 py-2 text-[16px] text-fg placeholder:text-fg-tertiary focus:border-accent focus:outline-none disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={!title.trim() || busy}
        className={`${CONTROL} border border-edge-default text-fg-secondary hover:border-edge-strong hover:text-fg disabled:opacity-40`}
      >
        Add
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setTitle("");
          setOpen(false);
        }}
        className={`${CONTROL} text-fg-tertiary hover:text-fg disabled:opacity-40`}
      >
        Cancel
      </button>
    </form>
  );
}

export function DeckRhythms({ rhythms, onComplete, onEdit, onAdd }: Props) {
  const [marked, setMarked] = useState<Record<string, "pending" | "done" | "failed">>({});
  const [announce, setAnnounce] = useState("");

  const tick = async (id: string, title: string, loopKind: string) => {
    setMarked((m) => ({ ...m, [id]: "pending" }));
    const ok = await onComplete(id, loopKind);
    setMarked((m) => ({ ...m, [id]: ok ? "done" : "failed" }));
    setAnnounce(ok ? `${title} done for today.` : `${title} could not be saved. Try again.`);
  };

  const isDone = (r: Props["rhythms"][number]) => r.doneToday || marked[r.id] === "done";
  // A weekly rhythm off its weekdays is not today's work (Nour 2026-11-01, Sunday): it waits under "not due today"
  // and never counts in "N of M today". Ticked anyway, it joins today's list.
  const today = rhythms.filter((r) => r.dueToday || isDone(r));
  const later = rhythms.filter((r) => !r.dueToday && !isDone(r));
  const doneCount = today.filter(isDone).length;

  const row = (r: Props["rhythms"][number]) => {
    const state = marked[r.id];
    const done = isDone(r);
    return (
      <li key={r.id} className="flex items-center gap-3 py-1">
        <button
          type="button"
          disabled={done || state === "pending"}
          onClick={() => void tick(r.id, r.title, r.loopKind)}
          aria-label={done ? `${r.title}, done today` : `Mark ${r.title} done`}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control active:scale-[0.97]"
        >
          <span
            aria-hidden
            className={
              done
                ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-[12px] font-bold text-[var(--text-inverse)]"
                : state === "pending"
                  ? "inline-block h-6 w-6 rounded-full border-2 border-emerald-400/60"
                  : "inline-block h-6 w-6 rounded-full border border-edge-default transition-colors duration-[var(--motion-state)] hover:border-edge-strong"
            }
          >
            {done ? "✓" : ""}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onEdit(r.id)}
          aria-label={`Edit ${r.title}`}
          className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center text-left"
        >
          <span className={done ? "w-full truncate text-[15px] text-fg-tertiary" : "w-full truncate text-[15px] text-fg"}>
            {r.title}
          </span>
          <span className="w-full truncate font-mono text-[11px] text-fg-tertiary">
            {cadenceWords(r.loopKind, r.recurringDays)}
          </span>
        </button>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-tertiary">
          {state === "failed"
            ? <span className="text-rose-300">not saved</span>
            : done
              ? <span className="text-emerald-300">done</span>
              : r.windowOf > 0
                ? `${r.windowDone} of ${r.windowOf}`
                : null}
        </span>
      </li>
    );
  };

  return (
    <section aria-labelledby="rhythms-heading">
      <div className="flex items-end justify-between gap-3 border-b border-edge pb-3">
        <h2 id="rhythms-heading" className="vt-eyebrow text-fg-secondary">
          rhythms
        </h2>
        {/* An empty list says nothing about today: no "0 of 0". */}
        {today.length > 0 && (
          <span className="font-mono text-[12px] tabular-nums text-fg-tertiary">
            {doneCount} of {today.length} today
          </span>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <ul className="divide-y divide-edge">{today.map(row)}</ul>
      {later.length > 0 && (
        <div aria-label="Rhythms not due today" role="group" className="mt-3">
          <p className="border-b border-edge pb-2 font-mono text-[11px] text-fg-tertiary">not due today</p>
          <ul className="divide-y divide-edge">{later.map(row)}</ul>
        </div>
      )}
      <div className={rhythms.length > 0 ? "border-t border-edge" : ""}>
        <AddRhythmRow onAdd={onAdd} />
      </div>
    </section>
  );
}
