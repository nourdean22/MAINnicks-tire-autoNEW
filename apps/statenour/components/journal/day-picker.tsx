"use client";

/**
 * Open the day view for ANY day (W8b, item 7): a native date input (16px, so iOS does not zoom) and a
 * "Yesterday" shortcut, then that day's done tasks and contacts (the W7 panel). A day with no journal entry
 * had no header in the feed and so no way in; this is the way in.
 */
import { useState } from "react";

import { DayActivityPanel } from "@/components/journal/day-activity";
import type { DayActivity } from "@/lib/services/journal-day";
import { trpc } from "@/lib/trpc/client";
import { etDateKey } from "@/lib/utils/datetime";

const DAY_MS = 86_400_000;

export function DayPickerView({
  date,
  onChange,
  read,
}: {
  date: string;
  onChange: (date: string) => void;
  read: DayActivity | "loading" | "failed";
}) {
  const yesterday = etDateKey(new Date(Date.now() - DAY_MS));
  return (
    <section aria-labelledby="day-picker-heading" className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label id="day-picker-heading" htmlFor="day-picker-date" className="font-mono text-[11px] text-fg-tertiary">
          Any day
        </label>
        <input
          id="day-picker-date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="min-h-[44px] rounded-control border border-edge bg-elevated px-3 text-[16px] text-fg"
        />
        <button
          type="button"
          onClick={() => onChange(yesterday)}
          aria-pressed={date === yesterday}
          className="inline-flex min-h-[44px] items-center px-2 text-[13px] font-medium text-fg-secondary hover:text-fg"
        >
          Yesterday
        </button>
      </div>
      <DayActivityPanel read={read} />
    </section>
  );
}

export function DayPicker() {
  const [date, setDate] = useState(() => etDateKey(new Date(Date.now() - DAY_MS)));
  const q = trpc.journal.day.useQuery({ date }, { staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  return <DayPickerView date={date} onChange={setDate} read={q.data ?? (q.isError ? "failed" : "loading")} />;
}
