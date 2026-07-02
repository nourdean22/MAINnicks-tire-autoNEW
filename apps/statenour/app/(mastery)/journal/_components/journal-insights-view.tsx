"use client";

import { NicksJournalBrief } from "@/components/journal/nicks-journal-brief";
import { TodaysPrompt } from "@/components/journal/todays-prompt";
import { JournalThreadsStrip } from "@/components/journal/journal-threads-strip";
import { JournalInsightsPreview } from "@/components/journal/journal-insights-preview";
import { ThreadRadar } from "@/components/journal/thread-radar";
import { ThreadRail } from "@/components/journal/thread-rail";
import { ThreadSuggestions } from "@/components/journal/thread-suggestions";
import { NotebookLMContextZone } from "./notebooklm-context-zone";

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
      <JournalThreadsStrip />
      
      {/* ── NotebookLM Integration ── */}
      <NotebookLMContextZone />

      {/* ── Brain Signals & Proofs ── */}
      <JournalInsightsPreview />
      
      {/* ── Thread Ops ── */}
      <div className="space-y-4 pt-4 border-t border-white/5">
        <ThreadRadar onThreadCreated={() => setThreadRefresh((n) => n + 1)} />
        <ThreadRail refreshSignal={threadRefresh} />
        <ThreadSuggestions
          refreshSignal={threadRefresh}
          onActioned={() => setThreadRefresh((n) => n + 1)}
        />
      </div>
    </div>
  );
}
