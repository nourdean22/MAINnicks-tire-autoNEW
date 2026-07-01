import { ExecutiveActionMatrix } from "@/components/home/executive-action-matrix";
import { NicksMorningBrief } from "@/components/missions/nicks-morning-brief";
import { HomeJournalHub } from "@/components/home/home-journal-hub";
import { HomeStatePulse } from "@/components/home/home-state-pulse";
import { HomeIdentityHeader } from "@/components/home/home-identity-header";
import { HomeNickDock } from "@/components/home/home-nick-dock";
import { HomeBrainGraph } from "@/components/home/home-brain-graph";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { ObsidianEngineCard } from "@/components/obsidian/obsidian-engine-card";
import { FollowUpsList } from "@/components/home/follow-ups-list";

/**
 * The home route · 2026-06-22 · Redesigned Nour Command Center layout.
 *
 * Wide responsive grid:
 *   - Left Main: new action matrix + journal
 *   - Right Side: HomeBrainGraph (sticky on desktop, compact preview on mobile)
 *   - Floating Bottom: HomeNickDock command bar
 */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 pb-8 space-y-4">
      <HomeIdentityHeader />
      <FollowUpsList />
      <CoachEventBanner surface="home" />
      
      {/* Inline Command Dock at the Top */}
      <HomeNickDock />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_520px]">
        {/* Main Left Bento Stack */}
        <main className="space-y-4 min-w-0">
          <NicksMorningBrief />
          <ExecutiveActionMatrix />
          <HomeJournalHub />
          <ObsidianEngineCard />
          <HomeStatePulse />
        </main>

        {/* Right Sticky Graph Column / Mobile Preview */}
        <aside className="lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)] min-w-0">
          <HomeBrainGraph variant="home" />
        </aside>
      </div>
    </div>
  );
}
