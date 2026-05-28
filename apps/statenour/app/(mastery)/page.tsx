import { Suspense } from "react";
import ChatPage from "./chat/page";
import { NicksHomeBrief } from "@/components/home/nicks-home-brief";
import { HomeOneTapMoves } from "@/components/home/home-one-tap-moves";
import { HomeStatePulse } from "@/components/home/home-state-pulse";
import { HomeIdentityHeader } from "@/components/home/home-identity-header";

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
 *   0. HomeIdentityHeader     · ALWAYS-visible "Nick · home · YYYY-MM-DD"
 *                                 eyebrow + 24h pulse line · proves the
 *                                 page is /home even on quiet mornings
 *   1. NicksHomeBrief         · cross-surface 2-3 sentence brief
 *   2. HomeOneTapMoves        · 3 proposed actions (mission · outreach · journal)
 *   3. HomeStatePulse         · thin one-line state strip
 *   4. <ChatPage>             · the chat composer stays · just at the bottom
 *
 * Wave AC.b fix · the upper 3 components all self-hide on null data; on a
 * quiet morning the page used to collapse to look identical to /chat. The
 * HomeIdentityHeader is the always-on affordance · the operator sees they
 * are on /home, not /chat, even before any dynamic data lands.
 *
 * Wrapped by `app/(mastery)/layout.tsx` which provides NourStateProvider
 * + AmbientAura + PageTracker + KeyboardShortcuts.
 */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <div className="space-y-4 max-w-3xl pb-2">
        <HomeIdentityHeader />
        <NicksHomeBrief />
        <HomeOneTapMoves />
        <HomeStatePulse />
      </div>
      <ChatPage />
    </Suspense>
  );
}
