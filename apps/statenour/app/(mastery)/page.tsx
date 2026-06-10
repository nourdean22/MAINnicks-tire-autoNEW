import { NicksHomeBrief } from "@/components/home/nicks-home-brief";
import { JournalNextMove } from "@/components/home/journal-next-move";
import { HomeOneTapMoves } from "@/components/home/home-one-tap-moves";
import { HomeStatePulse } from "@/components/home/home-state-pulse";
import { HomeIdentityHeader } from "@/components/home/home-identity-header";
import { HomeComposer } from "@/components/home/home-composer";

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
 *   4. HomeComposer           · simple textarea · routes to /chat on send
 *
 * Wave AC.c fix · 2026-05-28 · the prior implementation embedded the full
 * <ChatPage /> below the home content, but ChatPage's outer wrapper is
 * `fixed inset-x-0 z-10` (it's a viewport overlay) which silently covered
 * EVERYTHING above it · operator could only see ChatPage, never the home
 * content. Replaced with <HomeComposer /> · a simple textarea that
 * stashes the draft in sessionStorage[chat:seed] then router.push("/chat")
 * to continue. Clean separation · home is a dashboard, chat is the
 * conversation surface.
 *
 * Wrapped by `app/(mastery)/layout.tsx` which provides NourStateProvider
 * + AmbientAura + PageTracker + KeyboardShortcuts.
 */
export default function HomePage() {
  return (
    <div className="space-y-4 max-w-3xl mx-auto px-3 pb-32">
      <HomeIdentityHeader />
      <NicksHomeBrief />
      {/* Item G (2026-06-10) · the journal loop's "Act" output lands where
          the day starts — freshest extracted NEXT MOVE, deep-linked to its
          entry. Self-hides when the last 48h implied no real action. */}
      <JournalNextMove />
      <HomeOneTapMoves />
      <HomeStatePulse />
      <HomeComposer />
    </div>
  );
}
