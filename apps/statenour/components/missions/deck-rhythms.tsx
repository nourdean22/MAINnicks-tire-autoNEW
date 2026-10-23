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
 */
import { useState } from "react";
import type { MissionsDeck } from "@/lib/missions/deck";

type Props = {
  rhythms: MissionsDeck["rhythms"];
  /** Resolves true only on a confirmed write. */
  onComplete: (taskId: string) => Promise<boolean>;
};

export function DeckRhythms({ rhythms, onComplete }: Props) {
  const [marked, setMarked] = useState<Record<string, "pending" | "done" | "failed">>({});
  const [announce, setAnnounce] = useState("");

  if (rhythms.length === 0) return null;

  const tick = async (id: string, title: string) => {
    setMarked((m) => ({ ...m, [id]: "pending" }));
    const ok = await onComplete(id);
    setMarked((m) => ({ ...m, [id]: ok ? "done" : "failed" }));
    setAnnounce(ok ? `${title} done for today.` : `${title} could not be saved. Try again.`);
  };

  const doneCount = rhythms.filter((r) => r.doneToday || marked[r.id] === "done").length;

  return (
    <section aria-labelledby="rhythms-heading">
      <div className="flex items-end justify-between gap-3 border-b border-edge pb-3">
        <h2 id="rhythms-heading" className="vt-eyebrow text-fg-secondary">
          rhythms
        </h2>
        <span className="font-mono text-[12px] tabular-nums text-fg-tertiary">
          {doneCount} of {rhythms.length} today
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <ul className="divide-y divide-edge">
        {rhythms.map((r) => {
          const state = marked[r.id];
          const done = r.doneToday || state === "done";
          return (
            <li key={r.id} className="flex items-center gap-3 py-1">
              <button
                type="button"
                disabled={done || state === "pending"}
                onClick={() => void tick(r.id, r.title)}
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
              <span className={done ? "min-w-0 flex-1 truncate text-[15px] text-fg-tertiary" : "min-w-0 flex-1 truncate text-[15px] text-fg"}>
                {r.title}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-tertiary">
                {state === "failed"
                  ? <span className="text-rose-300">not saved</span>
                  : done
                    ? <span className="text-emerald-300">done</span>
                    : r.windowOf > 0
                      ? `${r.windowDone} of ${r.windowOf}${r.loopKind === "WEEKLY" ? " · weekly" : ""}`
                      : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
