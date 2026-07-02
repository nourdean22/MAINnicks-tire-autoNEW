"use client";

import { HomeIdentityHeader } from "./home-identity-header";
import { HomeNickDock } from "./home-nick-dock";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { FollowUpsList } from "./follow-ups-list";
import { ExecutiveActionMatrix } from "./executive-action-matrix";
import { HomeJournalHub } from "./home-journal-hub";
import { HomeEnginesDeck } from "./home-engines-deck";
import { HomeBrainGraph } from "./home-brain-graph";

export function HomeConsole() {
  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 pb-8 flex flex-col gap-6">
      {/* 1. Intelligence & Command Center */}
      <section aria-label="Intelligence and Command Center" className="space-y-4">
        <HomeIdentityHeader />
        <HomeNickDock />
        <div className="flex flex-col gap-3">
          <CoachEventBanner surface="home" />
          <FollowUpsList />
        </div>
      </section>

      {/* 2. Main Dashboard Split Layout */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_480px]">
        
        {/* Left Column: Execution Matrix & Infrastructure */}
        <section aria-label="Execution and Infrastructure" className="space-y-6 min-w-0">
          <ExecutiveActionMatrix />
          <HomeJournalHub />
          <HomeEnginesDeck />
        </section>

        {/* Right Column: Visual Intelligence */}
        <section aria-label="Visual Intelligence" className="lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)] min-w-0">
          <HomeBrainGraph variant="home" />
        </section>

      </div>
    </div>
  );
}
