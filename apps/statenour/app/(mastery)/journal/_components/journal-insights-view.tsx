"use client";

import { NicksJournalBrief } from "@/components/journal/nicks-journal-brief";
import { TodaysPrompt } from "@/components/journal/todays-prompt";
import { JournalThreadsStrip } from "@/components/journal/journal-threads-strip";
import { JournalInsightsPreview } from "@/components/journal/journal-insights-preview";
import { MetacognitionCard } from "@/components/journal/metacognition-card";
import { ThreadRadar } from "@/components/journal/thread-radar";
import { ThreadRail } from "@/components/journal/thread-rail";
import { ThreadSuggestions } from "@/components/journal/thread-suggestions";
import { NotebookLMContextZone } from "./notebooklm-context-zone";

/**
 * UI wave (audit 2026-07-15) · value-ordered column. Pre-wave the
 * NotebookLM paste zone sat ABOVE the extracted takes and thread ops —
 * the highest-value output of the whole feature (Bold Idea / Challenge
 * / Radar) was buried at the bottom of the sticky column, effectively
 * invisible without scrolling the page to its very end. Order now:
 * brief → prompt → takes → metacognition → threads → thread ops →
 * paste zone last (collapsed).
 */
export function JournalInsightsView({
  threadRefresh,
  setThreadRefresh
}: {
  threadRefresh: number;
  setThreadRefresh: React.Dispatch<React.SetStateAction<number>>;
}) {
  return (
    <div className="space-y-6 animate-fade-in pb-12">

      {/* ── Intelligence Dashboards ── */}
      <NicksJournalBrief />
      <TodaysPrompt />

      {/* ── Brain Signals & Proofs ── */}
      <JournalInsightsPreview />
      <MetacognitionCard />
      <JournalThreadsStrip />

      {/* ── Thread Ops ── */}
      <div className="space-y-4 pt-4 border-t border-white/5">
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
  );
}
