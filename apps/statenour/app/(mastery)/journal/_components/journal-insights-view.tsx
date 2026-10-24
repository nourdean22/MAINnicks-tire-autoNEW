"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useMinWidth } from "@/hooks/use-min-width";
import { NicksJournalBrief } from "@/components/journal/nicks-journal-brief";
import { TodaysPrompt } from "@/components/journal/todays-prompt";
import { JournalThreadsStrip } from "@/components/journal/journal-threads-strip";
import { JournalInsightsPreview } from "@/components/journal/journal-insights-preview";
import { MetacognitionCard } from "@/components/journal/metacognition-card";
import { ThreadRadar } from "@/components/journal/thread-radar";
import { ThreadRail } from "@/components/journal/thread-rail";
import { ThreadSuggestions } from "@/components/journal/thread-suggestions";
import { DetailFold } from "@/components/system/detail-fold";
import { trpc } from "@/lib/trpc/client";
import { readState } from "@/lib/query-state";

const unreadableCount = (reads: Parameters<typeof readState>[0][]) =>
  reads.filter((r) => {
    const s = readState(r);
    return s === "error" || s === "offline";
  }).length;

/**
 * Order: brief, prompt, Signals, Threads (closed). Wave E1 (2026-10-24) merged takes, self-assessment and
 * thread pace into one "Signals" row list, put radar, rail and suggestions under one closed "Threads"
 * disclosure, and moved the NotebookLM paste zone to Settings (write-only ingest).
 *
 * 2026-10-10 (audit 09-F25) · below lg the column stacked panels between the composer and the entries.
 * It is one native disclosure, "Insights", collapsed after the composer; at lg it is held open with its
 * summary hidden, so the wide layout is unchanged. Closed, the summary says how many of the five reads
 * behind it (takes, self-assessment, thread pace, radar, suggestions) failed; react-query shares them by
 * key with the panels, so asking again costs nothing.
 */
export function JournalInsightsView({
  threadRefresh,
  setThreadRefresh
}: {
  threadRefresh: number;
  setThreadRefresh: React.Dispatch<React.SetStateAction<number>>;
}) {
  const wide = useMinWidth(1024);
  const [open, setOpen] = useState(false);
  const takes = trpc.journal.insightsPreview.useQuery(undefined, { refetchOnWindowFocus: false, staleTime: 2 * 60 * 1000 });
  const selfAssessment = trpc.journal.metacognition.useQuery(undefined, { refetchOnWindowFocus: false, staleTime: 30 * 60 * 1000 });
  const threads = trpc.journal.threads.useQuery({ includeDormant: true }, { refetchOnWindowFocus: false, staleTime: 60_000 });
  const convergence = trpc.journal.convergence.useQuery(undefined, { refetchOnWindowFocus: false, staleTime: 60_000 });
  const suggestions = trpc.journal.suggestions.useQuery(undefined, { refetchOnWindowFocus: false, staleTime: 60_000 });
  const unreadableAll = unreadableCount([takes, selfAssessment, threads, convergence, suggestions]);
  const unreadableThreads = unreadableCount([threads, convergence, suggestions]);

  return (
    <details open={wide || open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between border-y border-edge-subtle text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg lg:hidden [&::-webkit-details-marker]:hidden">
        <span>
          Insights
          {unreadableAll > 0 && <span className="text-red-300"> ({unreadableAll} unreadable)</span>}
        </span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="transition-transform duration-[var(--motion-state)] group-open:rotate-180" />
      </summary>

      <div className="mt-6 space-y-6 animate-fade-in pb-12 lg:mt-0">
        {/* ── Intelligence Dashboards ── */}
        <NicksJournalBrief />
        <TodaysPrompt />

        {/* ── Signals: takes, self-assessment, thread pace (each row keeps its own loading, empty and failed state) ── */}
        <section aria-label="Signals">
          <h3 className="text-[13px] font-medium text-fg-secondary">Signals</h3>
          <ul className="mt-1 divide-y divide-edge-subtle border-y border-edge-subtle">
            <JournalInsightsPreview />
            <MetacognitionCard />
            <JournalThreadsStrip />
          </ul>
        </section>

        {/* ── Thread ops, closed: three panels the operator opens on purpose. The fold summary adds the
            unreadable count of the three reads behind them (the panels draw their own failed states). ── */}
        <DetailFold label="Threads" unreadable={unreadableThreads} className="border-t-0">
          <ThreadRadar onThreadCreated={() => setThreadRefresh((n) => n + 1)} />
          <ThreadRail refreshSignal={threadRefresh} />
          <ThreadSuggestions
            refreshSignal={threadRefresh}
            onActioned={() => setThreadRefresh((n) => n + 1)}
          />
        </DetailFold>
      </div>
    </details>
  );
}
