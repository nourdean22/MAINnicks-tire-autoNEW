"use client";

/**
 * The journal's day view (W7, Tana T3): the tasks finished and the contacts logged on one day, under that day's
 * header in the feed. A failed read is named; a measured empty day says so in plain words.
 */
import Link from "next/link";
import { useState } from "react";

import type { DayActivity } from "@/lib/services/journal-day";
import { DAY_ROWS_CAP } from "@/lib/services/journal-day-limits";
import { trpc } from "@/lib/trpc/client";

const READ_LABEL: Record<string, string> = { tasks: "Done tasks", contacts: "Contacts" };
const PERSON_HREF = (id: string) => `/people?inspect=person:${encodeURIComponent(id)}`;

export function DayActivityPanel({ read }: { read: DayActivity | "loading" | "failed" }) {
  if (read === "loading") {
    return <p className="px-1 py-2 text-[12px] text-fg-tertiary">Reading that day…</p>;
  }
  if (read === "failed") {
    return (
      <p role="status" className="px-1 py-2 text-[12px] text-amber-300">
        That day couldn&apos;t load, state unknown
      </p>
    );
  }
  const empty = read.tasksDone.length === 0 && read.contacts.length === 0 && read.failed.length === 0;
  return (
    <div className="space-y-2 border-l-2 border-edge-default py-1 pl-3 text-[13px]">
      {read.failed.map((f) => (
        <p key={f} role="status" className="text-[12px] text-amber-300">
          {READ_LABEL[f] ?? f} couldn&apos;t load
        </p>
      ))}
      {read.truncated.map((t) => (
        <p key={t} role="status" className="text-[12px] text-amber-300">
          {READ_LABEL[t] ?? t}: only the latest {DAY_ROWS_CAP} shown
        </p>
      ))}
      {empty && <p className="text-fg-tertiary">No tasks done and no contacts logged that day.</p>}
      {read.tasksDone.length > 0 && (
        <div>
          <p className="text-[12px] text-fg-secondary">Done</p>
          <ul>
            {read.tasksDone.map((t) => (
              <li key={t.taskId} className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-fg">
                <span>{t.title}</span>
                {t.goal && (
                  <Link
                    href={`/missions?goalId=${encodeURIComponent(t.goal.id)}`}
                    className="inline-flex min-h-11 items-center font-mono text-[11px] text-sky-300 hover:underline"
                  >
                    goal · {t.goal.title}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {read.contacts.length > 0 && (
        <div>
          <p className="text-[12px] text-fg-secondary">Contacts</p>
          <ul>
            {read.contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 text-fg">
                <Link
                  href={PERSON_HREF(c.person.id)}
                  className="inline-flex min-h-11 items-center text-fg-secondary underline-offset-2 hover:underline"
                >
                  {c.person.name}
                </Link>
                <span className="text-fg-tertiary">{c.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The day header's "Done and contacts" disclosure; the day is read only when opened. */
export function DayActivityToggle({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const q = trpc.journal.day.useQuery({ date }, { enabled: open, staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  return (
    <div className="mb-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center px-1 font-mono text-[11px] text-fg-secondary hover:text-fg"
      >
        {open ? "Hide done and contacts" : "Done and contacts"}
      </button>
      {open && <DayActivityPanel read={q.data ?? (q.isError ? "failed" : "loading")} />}
    </div>
  );
}
