"use client";

import { Suspense } from "react";
import { NotebookPen } from "lucide-react";

import { SectionHeader } from "@/components/ui/section-header";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { NickSidePane } from "@/components/mastery/nick-side-pane";
import { MissionBreadcrumb } from "@/components/mastery/mission-breadcrumb";
import { ReflectComposer } from "@/components/journal/reflect-composer";

import { JournalFeedView } from "./_components/journal-feed-view";
import { JournalInsightsView } from "./_components/journal-insights-view";
import { useState } from "react";

export default function JournalPage() {
  return (
    <>
      <Suspense fallback={null}>
        <JournalPageInner />
      </Suspense>
      <NickSidePane
        page="journal"
        coachSurface="journal"
        presets={[
          "What pattern keeps surfacing in this week's entries?",
          "Which blind spot am I dancing around?",
          "Which thread is the real story behind today?",
          "What would I tell a younger me about this entry?",
        ]}
      />
    </>
  );
}

function JournalPageInner() {
  // Shared state for the Thread Radar / Rail refresh signal
  const [threadRefresh, setThreadRefresh] = useState(0);

  return (
    <div className="min-h-screen text-zinc-100 space-y-5" data-no-deep-nudge>
      <SectionHeader
        icon={<NotebookPen size={16} className="text-(--gold)" />}
        label="Journal"
        subtitle="thinking · reasoning · insights · decisions · reflections"
        accent="gold"
        live
      />

      <MissionBreadcrumb />
      <CoachEventBanner surface="journal" />

      {/*
        Desktop Split-Pane Architecture
        Left (7 cols): Thought capture & stream
        Right (5 cols): Intelligence HUD & Context Zone

        UI wave (audit 2026-07-15) · three grid children instead of two
        so the single-column MOBILE order becomes composer → intelligence
        → feed. Pre-wave the whole right column stacked BELOW the entire
        feed on the phone (the operator's primary device) — the
        intelligence HUD was effectively invisible. On lg the visual
        layout is unchanged (insights spans both left-column rows).
        The sticky column also gets its own scroll (max-h + overflow) so
        panels below the fold are reachable while stuck — they used to
        be unreachable until the page bottom.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        <div className="lg:col-span-7">
          <ReflectComposer />
        </div>

        {/* Intelligence & Context · 2nd on mobile · right column on lg */}
        <div className="lg:col-span-5 lg:row-span-2 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <JournalInsightsView
            threadRefresh={threadRefresh}
            setThreadRefresh={setThreadRefresh}
          />
        </div>

        <div className="lg:col-span-7 space-y-6">
          <JournalFeedView />
        </div>

      </div>
    </div>
  );
}
