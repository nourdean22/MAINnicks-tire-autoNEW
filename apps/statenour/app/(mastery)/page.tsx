import { Suspense } from "react";
import ChatPage from "./chat/page";
import { NicksHomeBrief } from "@/components/home/nicks-home-brief";
import { HomeOneTapMoves } from "@/components/home/home-one-tap-moves";
import { HomeStatePulse } from "@/components/home/home-state-pulse";

/**
 * The home route · 2026-05-28 · Wave AC · Sam-led home.
 *
 * Pre-Wave-AC: chat surface was the entire page. Operator opened → blank
 * chat composer awaiting input. The unfair advantage (Nick + BrainMemory
 * + cross-surface awareness) was inverted: the operator had to ASK Nick
 * for what Nick already knew.
 *
 * Wave AC flips the lead. Order on the home page:
 *
 *   1. NicksHomeBrief         · cross-surface 2-3 sentence brief
 *   2. HomeOneTapMoves        · 3 proposed actions (mission · outreach · journal)
 *   3. HomeStatePulse         · thin one-line state strip
 *   4. <ChatPage>             · the chat composer stays · just at the bottom
 *
 * Each upper component self-hides when empty so a clean morning is
 * still silent · the chat composer is always reachable.
 *
 * Wrapped by `app/(mastery)/layout.tsx` which provides NourStateProvider
 * + AmbientAura + PageTracker + KeyboardShortcuts.
 */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <div className="space-y-4 max-w-3xl pb-2">
        <NicksHomeBrief />
        <HomeOneTapMoves />
        <HomeStatePulse />
      </div>
      <ChatPage />
    </Suspense>
  );
}
