import { NicksHomeBrief } from "@/components/home/nicks-home-brief";
import { HomeCommandStack } from "@/components/home/home-command-stack";
import { HomeActionHub } from "@/components/home/home-action-hub";
import { HomeJournalHub } from "@/components/home/home-journal-hub";
import { HomeStatePulse } from "@/components/home/home-state-pulse";
import { HomeIdentityHeader } from "@/components/home/home-identity-header";
import { HomeComposer } from "@/components/home/home-composer";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";

/**
 * The home route · 2026-06-16 · Redesigned and Decluttered.
 *
 * Streamlined layout structure:
 *   1. HomeIdentityHeader     · unconditional page identification
 *   2. CoachEventBanner       · active system notifications
 *   3. NicksHomeBrief         · AI-generated 2-3 sentence overview
 *   4. HomeCommandStack       · Bento grid (Today's Critical Few + Stats + Proof logs)
 *   5. HomeActionHub          · Tabbed Center (Inbox Triage, Hygiene, Suggestions)
 *   6. HomeJournalHub         · Unified Journal brief (4-line status + Next Move)
 *   7. HomeStatePulse         · System state pulse bar
 *   8. HomeComposer           · Input composer (Navigates to /chat)
 */
export default function HomePage() {
  return (
    <div className="space-y-4 max-w-3xl mx-auto px-3 pb-32">
      <HomeIdentityHeader />
      <CoachEventBanner surface="home" />
      <NicksHomeBrief />
      <HomeCommandStack />
      <HomeActionHub />
      <HomeJournalHub />
      <HomeStatePulse />
      <HomeComposer />
    </div>
  );
}
