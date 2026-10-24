"use client";

import { useEffect, useRef, useState } from "react";
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
import { trpc } from "@/lib/trpc/client";
import { readState } from "@/lib/query-state";

type PanelNode = { children: ArrayLike<unknown>; hasAttribute(name: string): boolean };

/**
 * Panels that actually rendered. Each panel returns null while loading or empty, so the count is
 * read from the DOM; a `[data-panel-group]` wrapper counts its children, not itself.
 */
export function countRenderedPanels(body: { children: ArrayLike<PanelNode> }): number {
  let n = 0;
  for (const child of Array.from(body.children)) {
    n += child.hasAttribute("data-panel-group") ? child.children.length : 1;
  }
  return n;
}

/**
 * Order: brief, prompt, Signals, Threads (closed). Wave E1 (2026-10-24) merged takes, self-assessment and
 * thread pace into one "Signals" row list, put radar, rail and suggestions under one closed "Threads"
 * disclosure, and moved the NotebookLM paste zone to Settings (write-only ingest).
 *
 * 2026-10-10 (audit 09-F25) · below lg the column stacked panels between the composer and the entries.
 * It is one native disclosure, "Insights (n)", collapsed after the composer; at lg it is held open with
 * its summary hidden, so the wide layout is unchanged.
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
  const bodyRef = useRef<HTMLDivElement>(null);
  // null until measured: before the panels report, the count is unknown, not zero.
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof MutationObserver === "undefined") return;
    const update = () => setCount(countRenderedPanels(body));
    const frame = requestAnimationFrame(update);
    const observer = new MutationObserver(update);
    observer.observe(body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <details open={wide || open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between border-y border-edge-subtle text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg lg:hidden [&::-webkit-details-marker]:hidden">
        <span>
          Insights
          {count !== null && <span className="font-mono tabular-nums text-fg-tertiary"> ({count})</span>}
        </span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="transition-transform duration-[var(--motion-state)] group-open:rotate-180" />
      </summary>

      <div ref={bodyRef} className="mt-6 space-y-6 animate-fade-in pb-12 lg:mt-0">
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

        {/* ── Thread ops, closed: three panels the operator opens on purpose ── */}
        <ThreadsDisclosure threadRefresh={threadRefresh} setThreadRefresh={setThreadRefresh} />
      </div>
    </details>
  );
}

/**
 * Radar, rail and suggestions under one closed disclosure. A closed fold must not hide a failed read,
 * so the summary reads the same three queries the panels read (react-query shares them by key) and
 * says how many are unreadable.
 */
function ThreadsDisclosure({
  threadRefresh,
  setThreadRefresh,
}: {
  threadRefresh: number;
  setThreadRefresh: React.Dispatch<React.SetStateAction<number>>;
}) {
  const reads = [
    trpc.journal.threads.useQuery({ includeDormant: true }, { refetchOnWindowFocus: false, staleTime: 60_000 }),
    trpc.journal.convergence.useQuery(undefined, { refetchOnWindowFocus: false, staleTime: 60_000 }),
    trpc.journal.suggestions.useQuery(undefined, { refetchOnWindowFocus: false, staleTime: 60_000 }),
  ];
  const unreadable = reads.filter((r) => {
    const s = readState(r);
    return s === "error" || s === "offline";
  }).length;

  return (
    <details aria-label="Threads" className="group border-b border-edge-subtle">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg [&::-webkit-details-marker]:hidden">
        <span>
          Threads
          {unreadable > 0 && <span className="text-red-300"> ({unreadable} unreadable)</span>}
        </span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="transition-transform duration-[var(--motion-state)] group-open:rotate-180" />
      </summary>
      <div className="space-y-4 pt-2">
        <ThreadRadar onThreadCreated={() => setThreadRefresh((n) => n + 1)} />
        <ThreadRail refreshSignal={threadRefresh} />
        <ThreadSuggestions
          refreshSignal={threadRefresh}
          onActioned={() => setThreadRefresh((n) => n + 1)}
        />
      </div>
    </details>
  );
}
