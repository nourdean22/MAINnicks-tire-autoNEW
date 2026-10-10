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
import { NotebookLMContextZone } from "./notebooklm-context-zone";

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
 * UI wave (audit 2026-07-15) · value-ordered column. Pre-wave the
 * NotebookLM paste zone sat ABOVE the extracted takes and thread ops —
 * the highest-value output of the whole feature (Bold Idea / Challenge
 * / Radar) was buried at the bottom of the sticky column, effectively
 * invisible without scrolling the page to its very end. Order now:
 * brief → prompt → takes → metacognition → threads → thread ops →
 * paste zone last (collapsed).
 *
 * 2026-10-10 (audit 09-F25) · below lg the column stacked up to nine panels between the composer
 * and the entries. It is now one native disclosure, "Insights (n)", collapsed after the composer;
 * at lg it is held open with its summary hidden, so the wide layout is unchanged.
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

        {/* ── Brain Signals & Proofs ── */}
        <JournalInsightsPreview />
        <MetacognitionCard />
        <JournalThreadsStrip />

        {/* ── Thread Ops ── */}
        <div data-panel-group className="space-y-4 pt-4 border-t border-edge-subtle">
          <ThreadRadar onThreadCreated={() => setThreadRefresh((n) => n + 1)} />
          <ThreadRail refreshSignal={threadRefresh} />
          <ThreadSuggestions
            refreshSignal={threadRefresh}
            onActioned={() => setThreadRefresh((n) => n + 1)}
          />
        </div>

        {/* ── NotebookLM Integration (write-only ingest · last) ── */}
        <NotebookLMContextZone />
      </div>
    </details>
  );
}
